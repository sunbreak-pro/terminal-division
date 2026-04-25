import { create } from "zustand";

interface TerminalSearchStore {
  // 検索オーバーレイが開いているペイン ID（同時に 1 つだけ）
  openPaneId: string | null;
  open: (paneId: string) => void;
  close: () => void;
  toggle: (paneId: string) => void;
}

export const useTerminalSearchStore = create<TerminalSearchStore>(
  (set, get) => ({
    openPaneId: null,
    open: (paneId) => set({ openPaneId: paneId }),
    close: () => set({ openPaneId: null }),
    toggle: (paneId) =>
      set({ openPaneId: get().openPaneId === paneId ? null : paneId }),
  }),
);

export const useSearchOpenForPane = (paneId: string): boolean =>
  useTerminalSearchStore((s) => s.openPaneId === paneId);
