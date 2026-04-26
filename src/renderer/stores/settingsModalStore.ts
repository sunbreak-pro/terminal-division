import { create } from "zustand";
import type { ShortcutId } from "../shortcuts/registry";

interface SettingsModalStore {
  isOpen: boolean;
  // ショートカット録音中の対象 ID。null のときは録音していない。
  // 録音中は App.tsx の global keydown ハンドラでショートカット dispatch を抑制し、
  // ShortcutSettings 側の録音 listener にキー入力を委ねる。
  recordingShortcutId: ShortcutId | null;
  open: () => void;
  close: () => void;
  startRecording: (id: ShortcutId) => void;
  stopRecording: () => void;
}

export const useSettingsModalStore = create<SettingsModalStore>((set) => ({
  isOpen: false,
  recordingShortcutId: null,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false, recordingShortcutId: null }),
  startRecording: (id) => set({ recordingShortcutId: id }),
  stopRecording: () => set({ recordingShortcutId: null }),
}));
