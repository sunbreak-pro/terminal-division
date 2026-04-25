// セッション永続化の保存トリガ。terminalStore / terminalMetaStore を購読し、
// 変更を検出したら debounce 後に Main へ IPC で送信する。

import { useTerminalStore } from "../stores/terminalStore";
import { useTerminalMetaStore } from "../stores/terminalMetaStore";
import { serializeCurrentSession } from "./sessionRestore";

const DEBOUNCE_MS = 200;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastSerialized: string | null = null;

function scheduleSave(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    const payload = serializeCurrentSession();
    // 直前と同一スナップショットなら IPC を送らない（純粋なフォーカス変動等を抑制）
    const json = JSON.stringify(payload);
    if (json === lastSerialized) return;
    lastSerialized = json;
    window.api.session.save(payload);
  }, DEBOUNCE_MS);
}

// アプリ起動時に 1 度呼ぶ。返り値は購読解除関数。
export function startSessionPersist(): () => void {
  const unsubLayout = useTerminalStore.subscribe((state, prev) => {
    // レイアウトの構造変化のみ検出（active 切り替えだけでは保存しない）
    if (
      state.nodes !== prev.nodes ||
      state.rootId !== prev.rootId ||
      state.terminalCount !== prev.terminalCount
    ) {
      scheduleSave();
    }
  });

  const unsubMeta = useTerminalMetaStore.subscribe((state, prev) => {
    // CWD 変化を検出（processName / shellName / lastActiveAt の変動は保存対象外）
    if (state.metas === prev.metas) return;
    if (hasCwdChanged(prev.metas, state.metas)) {
      scheduleSave();
    }
  });

  return () => {
    unsubLayout();
    unsubMeta();
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };
}

function hasCwdChanged(
  prev: Map<string, { cwd: string | null }>,
  next: Map<string, { cwd: string | null }>,
): boolean {
  if (prev.size !== next.size) return true;
  for (const [id, meta] of next.entries()) {
    const before = prev.get(id);
    if (!before || before.cwd !== meta.cwd) return true;
  }
  return false;
}
