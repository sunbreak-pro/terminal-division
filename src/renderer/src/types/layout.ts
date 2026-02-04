export type SplitDirection = 'horizontal' | 'vertical'

export interface TerminalPane {
  id: string
  parentId: string | null
}

export interface SplitNode {
  id: string
  type: 'split'
  direction: SplitDirection
  children: string[]
  parentId: string | null
}

export type LayoutNode = TerminalPane | SplitNode
