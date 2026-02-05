import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import * as terminalManager from '../services/terminalManager'
import type {
  SplitDirection,
  TerminalPane,
  SplitNode,
  LayoutNode
} from '../types/layout'

export type { SplitDirection, TerminalPane, SplitNode, LayoutNode }

const MAX_TERMINALS = 6

function isTerminalPane(node: LayoutNode): node is TerminalPane {
  return !('type' in node && node.type === 'split')
}

export interface TerminalStore {
  nodes: Map<string, LayoutNode>
  rootId: string
  activeTerminalId: string | null
  terminalCount: number

  setActiveTerminal: (id: string | null) => void
  splitTerminal: (terminalId: string, direction: SplitDirection) => boolean
  closeTerminal: (terminalId: string) => void
  getNode: (id: string) => LayoutNode | undefined
  canSplit: () => boolean
}

function generateId(): string {
  return `pane-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

const initialTerminalId = generateId()
const initialNodes = new Map<string, LayoutNode>()
initialNodes.set(initialTerminalId, { id: initialTerminalId, parentId: null })

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  nodes: initialNodes,
  rootId: initialTerminalId,
  activeTerminalId: initialTerminalId,
  terminalCount: 1,

  setActiveTerminal: (id) => set({ activeTerminalId: id }),

  canSplit: () => get().terminalCount < MAX_TERMINALS,

  splitTerminal: (terminalId, direction) => {
    const state = get()
    if (state.terminalCount >= MAX_TERMINALS) return false

    const targetNode = state.nodes.get(terminalId)
    if (!targetNode || !isTerminalPane(targetNode)) return false

    const newNodes = new Map(state.nodes)
    const newTerminalId = generateId()
    const newSplitId = generateId()

    const newTerminal: TerminalPane = {
      id: newTerminalId,
      parentId: newSplitId
    }

    const newSplit: SplitNode = {
      id: newSplitId,
      type: 'split',
      direction,
      children: [terminalId, newTerminalId],
      parentId: targetNode.parentId
    }

    const updatedTarget: TerminalPane = {
      ...targetNode,
      parentId: newSplitId
    }

    if (targetNode.parentId === null) {
      set({
        nodes: new Map(newNodes)
          .set(newSplitId, newSplit)
          .set(terminalId, updatedTarget)
          .set(newTerminalId, newTerminal),
        rootId: newSplitId,
        terminalCount: state.terminalCount + 1,
        activeTerminalId: newTerminalId
      })
    } else {
      const parentNode = state.nodes.get(targetNode.parentId) as SplitNode
      const updatedParent: SplitNode = {
        ...parentNode,
        children: parentNode.children.map((childId) =>
          childId === terminalId ? newSplitId : childId
        )
      }

      set({
        nodes: new Map(newNodes)
          .set(newSplitId, newSplit)
          .set(terminalId, updatedTarget)
          .set(newTerminalId, newTerminal)
          .set(parentNode.id, updatedParent),
        terminalCount: state.terminalCount + 1,
        activeTerminalId: newTerminalId
      })
    }

    return true
  },

  closeTerminal: (terminalId) => {
    const state = get()
    const targetNode = state.nodes.get(terminalId)
    if (!targetNode || !isTerminalPane(targetNode)) return

    if (state.terminalCount === 1) return

    // Destroy terminal instance (cleanup listeners and dispose)
    terminalManager.destroy(terminalId)
    window.api.pty.kill(terminalId)

    const newNodes = new Map(state.nodes)
    newNodes.delete(terminalId)

    if (targetNode.parentId === null) {
      return
    }

    const parentSplit = state.nodes.get(targetNode.parentId) as SplitNode
    const siblingId = parentSplit.children.find((id) => id !== terminalId)!
    const siblingNode = state.nodes.get(siblingId)!

    newNodes.delete(parentSplit.id)

    if (parentSplit.parentId === null) {
      const updatedSibling = { ...siblingNode, parentId: null }
      newNodes.set(siblingId, updatedSibling)

      const allTerminals = Array.from(newNodes.values()).filter(isTerminalPane)
      const newActiveId =
        state.activeTerminalId === terminalId
          ? allTerminals[0]?.id ?? null
          : state.activeTerminalId

      set({
        nodes: newNodes,
        rootId: siblingId,
        terminalCount: state.terminalCount - 1,
        activeTerminalId: newActiveId
      })
    } else {
      const grandParent = state.nodes.get(parentSplit.parentId) as SplitNode
      const updatedGrandParent: SplitNode = {
        ...grandParent,
        children: grandParent.children.map((id) => (id === parentSplit.id ? siblingId : id))
      }
      const updatedSibling = { ...siblingNode, parentId: grandParent.id }

      newNodes.set(grandParent.id, updatedGrandParent)
      newNodes.set(siblingId, updatedSibling)

      const allTerminals = Array.from(newNodes.values()).filter(isTerminalPane)
      const newActiveId =
        state.activeTerminalId === terminalId
          ? allTerminals[0]?.id ?? null
          : state.activeTerminalId

      set({
        nodes: newNodes,
        terminalCount: state.terminalCount - 1,
        activeTerminalId: newActiveId
      })
    }
  },

  getNode: (id) => get().nodes.get(id)
}))

// Selector hooks (prevent unnecessary re-renders)
export const useActiveTerminalId = (): string | null =>
  useTerminalStore((s) => s.activeTerminalId)
export const useTerminalCount = (): number => useTerminalStore((s) => s.terminalCount)
export const useRootId = (): string => useTerminalStore((s) => s.rootId)
export const useNodes = (): Map<string, LayoutNode> => useTerminalStore((s) => s.nodes)
export const useCanSplit = (): (() => boolean) => useTerminalStore((s) => s.canSplit)

// Action selectors (stable function references with shallow comparison)
export const useTerminalActions = (): Pick<
  TerminalStore,
  'setActiveTerminal' | 'splitTerminal' | 'closeTerminal' | 'getNode'
> =>
  useTerminalStore(
    useShallow((s) => ({
      setActiveTerminal: s.setActiveTerminal,
      splitTerminal: s.splitTerminal,
      closeTerminal: s.closeTerminal,
      getNode: s.getNode
    }))
  )
