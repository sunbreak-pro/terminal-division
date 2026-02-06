import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useTerminalStore } from '../terminalStore'
import type { SplitNode, TerminalPane } from '../../types/layout'
import * as terminalManager from '../../services/terminalManager'

// terminalManagerとwindow.api.ptyをモック
vi.mock('../../services/terminalManager', () => ({
  destroy: vi.fn()
}))

// グローバルwindow.api.ptyのモック
Object.defineProperty(window, 'api', {
  value: {
    pty: {
      kill: vi.fn()
    }
  },
  writable: true
})

describe('terminalStore', () => {
  beforeEach(() => {
    // ストアを初期状態にリセット
    useTerminalStore.setState({
      nodes: new Map([['initial', { id: 'initial', parentId: null }]]),
      rootId: 'initial',
      activeTerminalId: 'initial',
      terminalCount: 1
    })
    vi.clearAllMocks()
  })

  describe('setActiveTerminal', () => {
    it('should set active terminal id', () => {
      const { setActiveTerminal } = useTerminalStore.getState()
      setActiveTerminal('new-terminal')
      expect(useTerminalStore.getState().activeTerminalId).toBe('new-terminal')
    })

    it('should allow setting null', () => {
      const { setActiveTerminal } = useTerminalStore.getState()
      setActiveTerminal(null)
      expect(useTerminalStore.getState().activeTerminalId).toBeNull()
    })
  })

  describe('canSplit', () => {
    it('should return true when under MAX_TERMINALS', () => {
      const { canSplit } = useTerminalStore.getState()
      expect(canSplit()).toBe(true)
    })

    it('should return false when at MAX_TERMINALS', () => {
      useTerminalStore.setState({ terminalCount: 6 })
      const { canSplit } = useTerminalStore.getState()
      expect(canSplit()).toBe(false)
    })
  })

  describe('splitTerminal', () => {
    it('should split a terminal pane horizontally', () => {
      const { splitTerminal } = useTerminalStore.getState()
      const result = splitTerminal('initial', 'horizontal')

      expect(result).toBe(true)

      const state = useTerminalStore.getState()
      expect(state.terminalCount).toBe(2)

      // ルートはSplitNodeに変わる
      const rootNode = state.nodes.get(state.rootId) as SplitNode
      expect(rootNode.type).toBe('split')
      expect(rootNode.direction).toBe('horizontal')
      expect(rootNode.children).toHaveLength(2)
    })

    it('should split a terminal pane vertically', () => {
      const { splitTerminal } = useTerminalStore.getState()
      const result = splitTerminal('initial', 'vertical')

      expect(result).toBe(true)

      const state = useTerminalStore.getState()
      const rootNode = state.nodes.get(state.rootId) as SplitNode
      expect(rootNode.direction).toBe('vertical')
    })

    it('should set new terminal as active', () => {
      const { splitTerminal } = useTerminalStore.getState()
      splitTerminal('initial', 'horizontal')

      const state = useTerminalStore.getState()
      // 新しいターミナルがアクティブになる（initialではない）
      expect(state.activeTerminalId).not.toBe('initial')
    })

    it('should fail when MAX_TERMINALS reached', () => {
      useTerminalStore.setState({ terminalCount: 6 })
      const { splitTerminal } = useTerminalStore.getState()
      const result = splitTerminal('initial', 'horizontal')

      expect(result).toBe(false)
      expect(useTerminalStore.getState().terminalCount).toBe(6)
    })

    it('should fail for non-existent terminal', () => {
      const { splitTerminal } = useTerminalStore.getState()
      const result = splitTerminal('non-existent', 'horizontal')

      expect(result).toBe(false)
      expect(useTerminalStore.getState().terminalCount).toBe(1)
    })

    it('should properly update parent references when splitting nested terminal', () => {
      const { splitTerminal } = useTerminalStore.getState()

      // 最初のスプリット
      splitTerminal('initial', 'horizontal')
      const state1 = useTerminalStore.getState()
      const rootNode = state1.nodes.get(state1.rootId) as SplitNode
      const newTerminalId = rootNode.children[1]

      // 新しいターミナルを更にスプリット
      splitTerminal(newTerminalId, 'vertical')

      const state2 = useTerminalStore.getState()
      expect(state2.terminalCount).toBe(3)

      // ルートはそのまま
      expect(state2.rootId).toBe(state1.rootId)
    })
  })

  describe('closeTerminal', () => {
    it('should not close the last terminal', () => {
      const { closeTerminal } = useTerminalStore.getState()
      closeTerminal('initial')

      expect(useTerminalStore.getState().terminalCount).toBe(1)
    })

    it('should close terminal and promote sibling to root', () => {
      const { splitTerminal, closeTerminal } = useTerminalStore.getState()
      splitTerminal('initial', 'horizontal')

      const stateAfterSplit = useTerminalStore.getState()
      const rootNode = stateAfterSplit.nodes.get(stateAfterSplit.rootId) as SplitNode
      const newTerminalId = rootNode.children[1]

      closeTerminal('initial')

      const stateAfterClose = useTerminalStore.getState()
      expect(stateAfterClose.terminalCount).toBe(1)
      // 残ったターミナルがルートになる
      expect(stateAfterClose.rootId).toBe(newTerminalId)
      // 親参照はnullになる
      const remainingNode = stateAfterClose.nodes.get(newTerminalId) as TerminalPane
      expect(remainingNode.parentId).toBeNull()
    })

    it('should update active terminal when closing active terminal', () => {
      const { splitTerminal, closeTerminal, setActiveTerminal } = useTerminalStore.getState()
      splitTerminal('initial', 'horizontal')

      const stateAfterSplit = useTerminalStore.getState()
      const rootNode = stateAfterSplit.nodes.get(stateAfterSplit.rootId) as SplitNode
      const newTerminalId = rootNode.children[1]

      // アクティブターミナルを閉じる
      setActiveTerminal(newTerminalId)
      closeTerminal(newTerminalId)

      const stateAfterClose = useTerminalStore.getState()
      // 別のターミナルがアクティブになる
      expect(stateAfterClose.activeTerminalId).toBe('initial')
    })

    it('should call terminalManager.destroy and pty.kill', () => {
      const { splitTerminal, closeTerminal } = useTerminalStore.getState()

      splitTerminal('initial', 'horizontal')
      closeTerminal('initial')

      expect(terminalManager.destroy).toHaveBeenCalledWith('initial')
      expect(window.api.pty.kill).toHaveBeenCalledWith('initial')
    })
  })

  describe('getNode', () => {
    it('should return the node for a valid id', () => {
      const { getNode } = useTerminalStore.getState()
      const node = getNode('initial')
      expect(node).toBeDefined()
      expect(node?.id).toBe('initial')
    })

    it('should return undefined for invalid id', () => {
      const { getNode } = useTerminalStore.getState()
      const node = getNode('non-existent')
      expect(node).toBeUndefined()
    })
  })

  describe('MAX_TERMINALS limit', () => {
    it('should allow exactly 6 terminals', () => {
      const { splitTerminal } = useTerminalStore.getState()

      // 初期1 + 5スプリット = 6ターミナル
      for (let i = 0; i < 5; i++) {
        const state = useTerminalStore.getState()
        // 最後のアクティブターミナルをスプリット
        const result = splitTerminal(state.activeTerminalId!, 'horizontal')
        expect(result).toBe(true)
      }

      expect(useTerminalStore.getState().terminalCount).toBe(6)

      // 7つ目は失敗する
      const state = useTerminalStore.getState()
      const result = splitTerminal(state.activeTerminalId!, 'horizontal')
      expect(result).toBe(false)
      expect(useTerminalStore.getState().terminalCount).toBe(6)
    })
  })
})
