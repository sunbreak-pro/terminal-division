import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import SplitContainer from '../SplitContainer'
import type { LayoutNode, SplitNode, TerminalPane } from '../../types/layout'

// terminalStoreモック
vi.mock('../../stores/terminalStore', () => ({
  useRootId: vi.fn(() => 'root-1'),
  useNodes: vi.fn(() => new Map())
}))

// themeStoreモック
vi.mock('../../stores/themeStore', () => ({
  useThemeConfig: () => ({
    spacing: {
      xs: '4px',
      sm: '8px',
      md: '12px',
      lg: '16px',
      xl: '24px'
    },
    borderRadius: '4px',
    headerHeight: '40px'
  })
}))

// TerminalPaneをモック（unit testとして分離）
vi.mock('../TerminalPane', () => ({
  default: ({ id }: { id: string }) => (
    <div data-testid={`terminal-pane-${id}`}>Terminal: {id}</div>
  )
}))

// react-resizable-panelsをモック
vi.mock('react-resizable-panels', () => ({
  Group: ({ children, id, orientation }: { children: React.ReactNode; id: string; orientation: string }) => (
    <div data-testid={`group-${id}`} data-orientation={orientation}>
      {children}
    </div>
  ),
  Panel: ({ children, id }: { children: React.ReactNode; id: string }) => (
    <div data-testid={`panel-${id}`}>{children}</div>
  ),
  Separator: ({ id }: { id: string }) => <div data-testid={`separator-${id}`} />
}))

import * as terminalStore from '../../stores/terminalStore'

describe('SplitContainer', () => {
  it('renders single terminal (leaf node)', () => {
    const nodes = new Map<string, LayoutNode>()
    const terminalPane: TerminalPane = { id: 'terminal-1', parentId: null }
    nodes.set('terminal-1', terminalPane)

    vi.mocked(terminalStore.useRootId).mockReturnValue('terminal-1')
    vi.mocked(terminalStore.useNodes).mockReturnValue(nodes)

    render(<SplitContainer />)

    expect(screen.getByTestId('terminal-pane-terminal-1')).toBeInTheDocument()
  })

  it('renders horizontal split', () => {
    const nodes = new Map<string, LayoutNode>()
    const splitNode: SplitNode = {
      id: 'split-1',
      type: 'split',
      direction: 'horizontal',
      children: ['terminal-1', 'terminal-2'],
      parentId: null
    }
    const terminal1: TerminalPane = { id: 'terminal-1', parentId: 'split-1' }
    const terminal2: TerminalPane = { id: 'terminal-2', parentId: 'split-1' }

    nodes.set('split-1', splitNode)
    nodes.set('terminal-1', terminal1)
    nodes.set('terminal-2', terminal2)

    vi.mocked(terminalStore.useRootId).mockReturnValue('split-1')
    vi.mocked(terminalStore.useNodes).mockReturnValue(nodes)

    render(<SplitContainer />)

    // Groupがhorizontal方向で描画される
    const group = screen.getByTestId('group-split-1')
    expect(group).toHaveAttribute('data-orientation', 'horizontal')

    // 2つのターミナルがある
    expect(screen.getByTestId('terminal-pane-terminal-1')).toBeInTheDocument()
    expect(screen.getByTestId('terminal-pane-terminal-2')).toBeInTheDocument()

    // セパレーターがある
    expect(screen.getByTestId('separator-handle-split-1-0')).toBeInTheDocument()
  })

  it('renders vertical split', () => {
    const nodes = new Map<string, LayoutNode>()
    const splitNode: SplitNode = {
      id: 'split-1',
      type: 'split',
      direction: 'vertical',
      children: ['terminal-1', 'terminal-2'],
      parentId: null
    }
    const terminal1: TerminalPane = { id: 'terminal-1', parentId: 'split-1' }
    const terminal2: TerminalPane = { id: 'terminal-2', parentId: 'split-1' }

    nodes.set('split-1', splitNode)
    nodes.set('terminal-1', terminal1)
    nodes.set('terminal-2', terminal2)

    vi.mocked(terminalStore.useRootId).mockReturnValue('split-1')
    vi.mocked(terminalStore.useNodes).mockReturnValue(nodes)

    render(<SplitContainer />)

    // Groupがvertical方向で描画される
    const group = screen.getByTestId('group-split-1')
    expect(group).toHaveAttribute('data-orientation', 'vertical')
  })

  it('renders nested splits', () => {
    const nodes = new Map<string, LayoutNode>()

    // ルートのsplit（horizontal）
    const rootSplit: SplitNode = {
      id: 'split-root',
      type: 'split',
      direction: 'horizontal',
      children: ['terminal-1', 'split-nested'],
      parentId: null
    }

    // ネストされたsplit（vertical）
    const nestedSplit: SplitNode = {
      id: 'split-nested',
      type: 'split',
      direction: 'vertical',
      children: ['terminal-2', 'terminal-3'],
      parentId: 'split-root'
    }

    const terminal1: TerminalPane = { id: 'terminal-1', parentId: 'split-root' }
    const terminal2: TerminalPane = { id: 'terminal-2', parentId: 'split-nested' }
    const terminal3: TerminalPane = { id: 'terminal-3', parentId: 'split-nested' }

    nodes.set('split-root', rootSplit)
    nodes.set('split-nested', nestedSplit)
    nodes.set('terminal-1', terminal1)
    nodes.set('terminal-2', terminal2)
    nodes.set('terminal-3', terminal3)

    vi.mocked(terminalStore.useRootId).mockReturnValue('split-root')
    vi.mocked(terminalStore.useNodes).mockReturnValue(nodes)

    render(<SplitContainer />)

    // ルートのグループ
    const rootGroup = screen.getByTestId('group-split-root')
    expect(rootGroup).toHaveAttribute('data-orientation', 'horizontal')

    // ネストされたグループ
    const nestedGroup = screen.getByTestId('group-split-nested')
    expect(nestedGroup).toHaveAttribute('data-orientation', 'vertical')

    // 3つのターミナルがある
    expect(screen.getByTestId('terminal-pane-terminal-1')).toBeInTheDocument()
    expect(screen.getByTestId('terminal-pane-terminal-2')).toBeInTheDocument()
    expect(screen.getByTestId('terminal-pane-terminal-3')).toBeInTheDocument()
  })

  it('handles missing node gracefully', () => {
    const nodes = new Map<string, LayoutNode>()
    // ノードが見つからない場合

    vi.mocked(terminalStore.useRootId).mockReturnValue('non-existent')
    vi.mocked(terminalStore.useNodes).mockReturnValue(nodes)

    const { container } = render(<SplitContainer />)

    // 何も描画されない（空のdiv）
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.children.length).toBe(0)
  })

  it('renders panels with correct ids', () => {
    const nodes = new Map<string, LayoutNode>()
    const splitNode: SplitNode = {
      id: 'split-1',
      type: 'split',
      direction: 'horizontal',
      children: ['terminal-1', 'terminal-2'],
      parentId: null
    }
    const terminal1: TerminalPane = { id: 'terminal-1', parentId: 'split-1' }
    const terminal2: TerminalPane = { id: 'terminal-2', parentId: 'split-1' }

    nodes.set('split-1', splitNode)
    nodes.set('terminal-1', terminal1)
    nodes.set('terminal-2', terminal2)

    vi.mocked(terminalStore.useRootId).mockReturnValue('split-1')
    vi.mocked(terminalStore.useNodes).mockReturnValue(nodes)

    render(<SplitContainer />)

    // パネルのIDが正しい
    expect(screen.getByTestId('panel-terminal-1')).toBeInTheDocument()
    expect(screen.getByTestId('panel-terminal-2')).toBeInTheDocument()
  })
})
