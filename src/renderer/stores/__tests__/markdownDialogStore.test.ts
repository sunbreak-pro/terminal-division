import { describe, it, expect, beforeEach } from "vitest";
import { useMarkdownDialogStore } from "../markdownDialogStore";

describe("markdownDialogStore", () => {
  beforeEach(() => {
    useMarkdownDialogStore.setState({ current: null });
  });

  it("starts with no active dialog", () => {
    expect(useMarkdownDialogStore.getState().current).toBeNull();
  });

  it("showOpenConfirm sets a request with kind='open-confirm'", () => {
    let confirmedPaneId: string | null = null;
    useMarkdownDialogStore.getState().showOpenConfirm({
      filePath: "/foo/bar.md",
      availablePanes: [
        { paneId: "p1", paneNumber: 1 },
        { paneId: "p2", paneNumber: 2 },
      ],
      defaultPaneId: "p2",
      onConfirm: (paneId) => {
        confirmedPaneId = paneId;
      },
    });
    const state = useMarkdownDialogStore.getState().current;
    expect(state).not.toBeNull();
    expect(state?.kind).toBe("open-confirm");
    if (state?.kind === "open-confirm") {
      expect(state.filePath).toBe("/foo/bar.md");
      expect(state.availablePanes).toHaveLength(2);
      expect(state.defaultPaneId).toBe("p2");
      state.onConfirm("p1");
      expect(confirmedPaneId).toBe("p1");
    }
  });

  it("showUnsaved sets a request with kind='unsaved'", () => {
    let saved = false;
    let discarded = false;
    useMarkdownDialogStore.getState().showUnsaved({
      filePath: "/foo/bar.md",
      paneId: "p1",
      reason: "close-pane",
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
      expect(state.reason).toBe("close-pane");
      state.onSave();
      state.onDiscard();
      expect(saved).toBe(true);
      expect(discarded).toBe(true);
    }
  });

  it("dismiss clears the current request", () => {
    useMarkdownDialogStore.getState().showOpenConfirm({
      filePath: "/foo/bar.md",
      availablePanes: [{ paneId: "p1", paneNumber: 1 }],
      defaultPaneId: "p1",
      onConfirm: () => {},
    });
    expect(useMarkdownDialogStore.getState().current).not.toBeNull();
    useMarkdownDialogStore.getState().dismiss();
    expect(useMarkdownDialogStore.getState().current).toBeNull();
  });

  it("subsequent show* replaces the prior request (single-active model)", () => {
    useMarkdownDialogStore.getState().showOpenConfirm({
      filePath: "/foo/a.md",
      availablePanes: [{ paneId: "p1", paneNumber: 1 }],
      defaultPaneId: "p1",
      onConfirm: () => {},
    });
    useMarkdownDialogStore.getState().showUnsaved({
      filePath: "/foo/b.md",
      paneId: "p1",
      reason: "open-other",
      onSave: () => {},
      onDiscard: () => {},
    });
    const state = useMarkdownDialogStore.getState().current;
    expect(state?.kind).toBe("unsaved");
    if (state?.kind === "unsaved") {
      expect(state.filePath).toBe("/foo/b.md");
    }
  });
});
