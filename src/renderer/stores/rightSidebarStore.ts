import { create } from "zustand";

// 右サイドバー（Markdown 表示エリア）の UI 状態。
// width は絶対値 px。最大幅はウィンドウ幅の RIGHT_SIDEBAR_MAX_RATIO 倍まで実行時 clamp する。
// 永続化は Main プロセスの right-sidebar-state.json で行う（IPC 経由）。

const DEFAULT_WIDTH = 480;
const MIN_WIDTH = 320;
// 物理的な絶対上限。実行時に画面幅 × RIGHT_SIDEBAR_MAX_RATIO で更に絞る。
const ABSOLUTE_MAX_WIDTH = 4000;
// 「中央付近まで」を画面幅の半分として解釈する。
export const RIGHT_SIDEBAR_MAX_RATIO = 0.5;

export const RIGHT_SIDEBAR_WIDTH_BOUNDS = {
  min: MIN_WIDTH,
  max: ABSOLUTE_MAX_WIDTH,
  default: DEFAULT_WIDTH,
} as const;

// 実行時の最大幅（ウィンドウ幅依存）。renderer 側でドラッグ中・mount 時に呼ぶ。
export function effectiveMaxWidth(): number {
  if (typeof window === "undefined") return ABSOLUTE_MAX_WIDTH;
  const w = window.innerWidth;
  if (!Number.isFinite(w) || w <= 0) return ABSOLUTE_MAX_WIDTH;
  return Math.max(MIN_WIDTH, Math.floor(w * RIGHT_SIDEBAR_MAX_RATIO));
}

export function clampRightSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_WIDTH;
  const max = effectiveMaxWidth();
  return Math.max(MIN_WIDTH, Math.min(max, Math.round(width)));
}

interface RightSidebarStore {
  isOpen: boolean;
  isFullscreen: boolean;
  width: number;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  setFullscreen: (fullscreen: boolean) => void;
  toggleFullscreen: () => void;
  setWidth: (width: number) => void;
}

export const useRightSidebarStore = create<RightSidebarStore>((set, get) => ({
  isOpen: false,
  isFullscreen: false,
  width: DEFAULT_WIDTH,

  setOpen: (open) => {
    if (get().isOpen === open) return;
    // 閉じるときに fullscreen も解除しておく（次回開いたとき通常幅で戻す）。
    if (!open && get().isFullscreen) {
      set({ isOpen: open, isFullscreen: false });
      return;
    }
    set({ isOpen: open });
  },

  toggleOpen: () => {
    const { isOpen, isFullscreen } = get();
    if (isOpen && isFullscreen) {
      set({ isOpen: false, isFullscreen: false });
      return;
    }
    set({ isOpen: !isOpen });
  },

  setFullscreen: (fullscreen) => {
    if (get().isFullscreen === fullscreen) return;
    // fullscreen を ON にするときはサイドバーも自動で開く。
    if (fullscreen) {
      set({ isFullscreen: true, isOpen: true });
    } else {
      set({ isFullscreen: false });
    }
  },

  toggleFullscreen: () => {
    const { isFullscreen } = get();
    if (isFullscreen) {
      set({ isFullscreen: false });
    } else {
      set({ isFullscreen: true, isOpen: true });
    }
  },

  setWidth: (width) => {
    const clamped = clampRightSidebarWidth(width);
    if (get().width === clamped) return;
    set({ width: clamped });
  },
}));

export const useRightSidebarOpen = (): boolean =>
  useRightSidebarStore((s) => s.isOpen);
export const useRightSidebarWidth = (): number =>
  useRightSidebarStore((s) => s.width);
export const useRightSidebarFullscreen = (): boolean =>
  useRightSidebarStore((s) => s.isFullscreen);
