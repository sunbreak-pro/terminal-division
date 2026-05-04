import { describe, it, expect, beforeEach } from "vitest";
import { useMarkdownDialogStore } from "../markdownDialogStore";

describe("markdownDialogStore", () => {
  beforeEach(() => {
    useMarkdownDialogStore.setState({ current: null });
  });

  it("starts with no active dialog", () => {
    expect(useMarkdownDialogStore.getState().current).toBeNull();
  });

  it("showUnsaved sets a request with kind='unsaved'", () => {
    let saved = false;
    let discarded = false;
    useMarkdownDialogStore.getState().showUnsaved({
      filePath: "/foo/bar.md",
      tabId: "t1",
      reason: "open-other",
      onSave: () => {
        saved = true;
      },
      onDiscard: () => {
        discarded = true;
      },
    });
    const state = useMarkdownDialogStore.getState().current;
    expect(state?.kind).toBe("unsaved");
    if (state?.kind === "unsaved") {
      expect(state.reason).toBe("open-other");
      expect(state.filePath).toBe("/foo/bar.md");
      state.onSave();
      state.onDiscard();
      expect(saved).toBe(true);
      expect(discarded).toBe(true);
    }
  });

  it("dismiss clears the current request", () => {
    useMarkdownDialogStore.getState().showUnsaved({
      filePath: "/foo/bar.md",
      tabId: "t1",
      reason: "open-other",
      onSave: () => {},
      onDiscard: () => {},
    });
    expect(useMarkdownDialogStore.getState().current).not.toBeNull();
    useMarkdownDialogStore.getState().dismiss();
    expect(useMarkdownDialogStore.getState().current).toBeNull();
  });
});
