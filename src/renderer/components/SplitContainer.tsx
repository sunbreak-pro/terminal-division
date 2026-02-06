import React, { useCallback, useMemo } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { useRootId, useNodes } from "../stores/terminalStore";
import { useThemeConfig } from "../stores/themeStore";
import type {
  SplitNode,
  TerminalPane as TerminalPaneType,
} from "../types/layout";
import TerminalPane from "./TerminalPane";

const SplitContainer: React.FC = React.memo(() => {
  const rootId = useRootId();
  const nodes = useNodes();
  const themeConfig = useThemeConfig();

  const separatorStyleHorizontal = useMemo(
    () => ({
      width: themeConfig.spacing.xs,
      cursor: "col-resize",
      touchAction: "none" as const,
      userSelect: "none" as const,
      transition: "background-color 0.15s ease",
    }),
    [themeConfig.spacing.xs],
  );

  const separatorStyleVertical = useMemo(
    () => ({
      height: themeConfig.spacing.xs,
      cursor: "row-resize",
      touchAction: "none" as const,
      userSelect: "none" as const,
      transition: "background-color 0.15s ease",
    }),
    [themeConfig.spacing.xs],
  );

  const renderNode = useCallback(
    (nodeId: string): React.ReactNode => {
      const node = nodes.get(nodeId);
      if (!node) return null;

      if ("type" in node && node.type === "split") {
        const splitNode = node as SplitNode;
        const isHorizontal = splitNode.direction === "horizontal";
        return (
          <Group
            key={nodeId}
            id={nodeId}
            orientation={splitNode.direction}
            style={{ height: "100%", width: "100%" }}
          >
            {splitNode.children.map((childId, index) => {
              return (
                <React.Fragment key={childId}>
                  <Panel
                    id={childId}
                    minSize={10}
                    defaultSize={100 / splitNode.children.length}
                  >
                    {renderNode(childId)}
                  </Panel>
                  {index < splitNode.children.length - 1 && (
                    <Separator
                      id={`handle-${nodeId}-${index}`}
                      style={
                        isHorizontal
                          ? separatorStyleHorizontal
                          : separatorStyleVertical
                      }
                    />
                  )}
                </React.Fragment>
              );
            })}
          </Group>
        );
      }

      const terminalNode = node as TerminalPaneType;
      return <TerminalPane key={terminalNode.id} id={terminalNode.id} />;
    },
    [nodes, separatorStyleHorizontal, separatorStyleVertical],
  );

  return (
    <div style={{ height: "100%", width: "100%" }}>{renderNode(rootId)}</div>
  );
});

SplitContainer.displayName = "SplitContainer";

export default SplitContainer;
