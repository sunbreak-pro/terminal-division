import React, { useCallback, useMemo } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { useRootId, useNodes } from "../stores/terminalStore";
import { useThemeConfig } from "../stores/themeStore";
import type {
  SplitNode,
  TerminalPane as TerminalPaneType,
} from "../types/layout";
import { collectPaneIdsInOrder } from "../utils/layoutUtils";
import TerminalPane from "./TerminalPane";
import * as terminalManager from "../services/terminalManager";

const SplitContainer: React.FC = React.memo(() => {
  const rootId = useRootId();
  const nodes = useNodes();
  const themeConfig = useThemeConfig();

  // ペイン番号マップ（ツリー走査順で1から割り当て）
  const paneNumberMap = useMemo(() => {
    const ids = collectPaneIdsInOrder(rootId, nodes);
    const map = new Map<string, number>();
    ids.forEach((id, index) => map.set(id, index + 1));
    return map;
  }, [rootId, nodes]);

  // Panel のリサイズ通知 → 葉ペインだけ即座に fit + pty.resize。
  // ResizeObserver より早く正確なサイズが取れるため、scrollback の cols 不整合を防ぐ。
  // Panel.onResize は SplitNode (内部) にも付くが、id が paneNumberMap に無いものは
  // 葉ペインではないので無視する。
  // 兄弟ペインを閉じた直後の "expand" でもこのハンドラが呼ばれるが、その時点で
  // lastSize キャッシュが古い値のままだと fit() が同サイズ判定で IPC を抑制してしまう。
  // invalidate してから fit すれば、必ず最新サイズで fitAddon.fit() → terminal.resize()
  // が走り、scrollback も新しい cols で reflow される。
  const handlePanelResize = useCallback(
    (
      _size: { asPercentage: number; inPixels: number },
      panelId: string | number | undefined,
    ): void => {
      if (typeof panelId !== "string") return;
      if (!paneNumberMap.has(panelId)) return;
      terminalManager.invalidateLastSize(panelId);
      // pty.resize は terminalManager.fit() 内部で trailing-debounce 経由に集約。
      // ここで明示的に呼ぶと drag 中に毎フレーム SIGWINCH が走り、TUI が連続再描画して
      // scrollback が前回描画で汚染される（同じ文章が縦に大量複製される現象）。
      terminalManager.fit(panelId);
    },
    [paneNumberMap],
  );

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
                    minSize="10%"
                    defaultSize={`${100 / splitNode.children.length}%`}
                    onResize={handlePanelResize}
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
    [
      nodes,
      separatorStyleHorizontal,
      separatorStyleVertical,
      paneNumberMap,
      handlePanelResize,
    ],
  );

  return (
    <div style={{ height: "100%", width: "100%" }}>{renderNode(rootId)}</div>
  );
});

SplitContainer.displayName = "SplitContainer";

export default SplitContainer;
