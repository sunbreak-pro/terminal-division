import type { LayoutNode, TerminalPane } from '../types/layout'

export function isTerminalPane(node: LayoutNode): node is TerminalPane {
  return !('type' in node && node.type === 'split')
}

export function getAllTerminalIds(nodes: Map<string, LayoutNode>): string[] {
  const ids: string[] = []
  for (const [id, node] of nodes) {
    if (isTerminalPane(node)) {
      ids.push(id)
    }
  }
  return ids
}
