import React, { useCallback, useMemo } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { useRootId, useNodes } from "../stores/terminalStore";
import { useThemeConfig } from "../stores/themeStore";
import type {
  SplitNode,
  LayoutNode,
  TerminalPane as TerminalPaneType,
} from "../types/layout";
import TerminalPane from "./TerminalPane";

// ツリー走査でターミナルIDの出現順を取得
function collectTerminalIds(
  nodeId: string,
  nodes: Map<string, LayoutNode>,
): string[] {
  const node = nodes.get(nodeId);
  if (!node) return [];
  if ("type" in node && node.type === "split") {
    const splitNode = node as SplitNode;
    return splitNode.children.flatMap((childId) =>
      collectTerminalIds(childId, nodes),
    );
  }
  return [nodeId];
}

const SplitContainer: React.FC = React.memo(() => {
  const rootId = useRootId();
  const nodes = useNodes();
  const themeConfig = useThemeConfig();

  // ペイン番号マップ（ツリー走査順で1から割り当て）
  const paneNumberMap = useMemo(() => {
    const ids = collectTerminalIds(rootId, nodes);
    const map = new Map<string, number>();
    ids.forEach((id, index) => map.set(id, index + 1));
    return map;
  }, [rootId, nodes]);

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
      return (
        <TerminalPane
          key={terminalNode.id}
          id={terminalNode.id}
          paneNumber={paneNumberMap.get(terminalNode.id) ?? 1}
        />
      );
    },
    [nodes, separatorStyleHorizontal, separatorStyleVertical, paneNumberMap],
  );

  return (
    <div style={{ height: "100%", width: "100%" }}>{renderNode(rootId)}</div>
  );
});

SplitContainer.displayName = "SplitContainer";

export default SplitContainer;
