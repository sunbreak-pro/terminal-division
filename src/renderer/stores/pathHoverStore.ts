import { create } from "zustand";

// ターミナル上のパス hover 時にカーソル付近で表示する小さな tooltip の状態。
// シングルトン (画面上同時に 1 つだけ表示) で十分なため、Zustand で集約する。
//
// 実装ノート:
// - terminalManager の link provider は React lifecycle と独立した
//   モジュールスコープ。setState 系のコールバックを直接保持すると
//   StrictMode の二重マウント等で stale 参照が起きる。
//   store 経由 (`getState()`) で更新すればこの問題を避けられる。
// - 表示位置は `clientX` / `clientY` (viewport 基準) で渡す。
//   tooltip 側で +offset して `position: fixed` で配置する。

export interface PathHoverState {
  visible: boolean;
  text: string;
  x: number;
  y: number;
  show: (text: string, x: number, y: number) => void;
  hide: () => void;
}

export const usePathHoverStore = create<PathHoverState>((set) => ({
  visible: false,
  text: "",
  x: 0,
  y: 0,
  show: (text, x, y) => set({ visible: true, text, x, y }),
  hide: () => set({ visible: false }),
}));
