import React, { useCallback, useMemo } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { useThemeConfig } from "../../stores/themeStore";
import {
  useMdRootId,
  useMdNodes,
  useMdPaneCount,
  collectMdPaneIdsInOrder,
} from "../../stores/markdownLayoutStore";
import { isMdPane, type MdSplitNode } from "../../types/mdLayout";
import { MdPaneView } from "./MdPaneView";

// RightSidebar 内の Markdown ペイン二分木をレンダリングする。
// SplitContainer (ターミナル用) と同じく react-resizable-panels の
// Group / Panel / Separator で再帰描画する。
export const MdSplitContainer: React.FC = React.memo(() => {
  const rootId = useMdRootId();
  const nodes = useMdNodes();
  const paneCount = useMdPaneCount();
  const themeConfig = useThemeConfig();

  // 1 ペイン時はペインを閉じるボタンを表示しない。
  const canClosePane = paneCount > 1;

  // 走査順は SplitContainer と同様。
  const paneOrder = useMemo(
    () => collectMdPaneIdsInOrder(rootId, nodes),
    [rootId, nodes],
  );
  // paneOrder は MdPaneView へは直接渡さないが、再描画キーの安定化に使う。
  void paneOrder;

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
      if (!isMdPane(node)) {
        const splitNode = node as MdSplitNode;
        const isHorizontal = splitNode.direction === "horizontal";
        return (
          <Group
            key={nodeId}
            id={nodeId}
            orientation={splitNode.direction}
            style={{ height: "100%", width: "100%" }}
          >
            {splitNode.children.map((childId, index) => (
              <React.Fragment key={childId}>
                <Panel
                  id={childId}
                  minSize="10%"
                  defaultSize={`${100 / splitNode.children.length}%`}
                >
                  {renderNode(childId)}
                </Panel>
                {index < splitNode.children.length - 1 && (
                  <Separator
                    id={`md-handle-${nodeId}-${index}`}
                    style={
                      isHorizontal
                        ? separatorStyleHorizontal
                        : separatorStyleVertical
                    }
                  />
                )}
              </React.Fragment>
            ))}
          </Group>
        );
      }
      return (
        <MdPaneView
          key={node.id}
          paneId={node.id}
          canClosePane={canClosePane}
        />
      );
    },
    [nodes, canClosePane, separatorStyleHorizontal, separatorStyleVertical],
  );

  return (
    <div style={{ height: "100%", width: "100%" }}>{renderNode(rootId)}</div>
  );
});

MdSplitContainer.displayName = "MdSplitContainer";
