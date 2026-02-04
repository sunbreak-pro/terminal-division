import React, { useCallback } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { useRootId, useNodes } from '../stores/terminalStore'
import type { SplitNode, TerminalPane as TerminalPaneType } from '../types/layout'
import TerminalPane from './TerminalPane'

const SplitContainer: React.FC = React.memo(() => {
  const rootId = useRootId()
  const nodes = useNodes()

  const renderNode = useCallback(
    (nodeId: string): React.ReactNode => {
      const node = nodes.get(nodeId)
      if (!node) return null

      if ('type' in node && node.type === 'split') {
        const splitNode = node as SplitNode
        return (
          <PanelGroup
            key={nodeId}
            direction={splitNode.direction}
            style={{ height: '100%', width: '100%' }}
          >
            {splitNode.children.map((childId, index) => (
              <React.Fragment key={childId}>
                <Panel minSize={10} defaultSize={100 / splitNode.children.length}>
                  {renderNode(childId)}
                </Panel>
                {index < splitNode.children.length - 1 && <PanelResizeHandle />}
              </React.Fragment>
            ))}
          </PanelGroup>
        )
      }

      const terminalNode = node as TerminalPaneType
      return <TerminalPane key={terminalNode.id} id={terminalNode.id} />
    },
    [nodes]
  )

  return <div style={{ height: '100%', width: '100%' }}>{renderNode(rootId)}</div>
})

SplitContainer.displayName = 'SplitContainer'

export default SplitContainer
