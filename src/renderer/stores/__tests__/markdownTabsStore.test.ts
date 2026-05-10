import { describe, it, expect, beforeEach } from "vitest";
import { useMarkdownTabsStore } from "../markdownTabsStore";

describe("markdownTabsStore", () => {
  beforeEach(() => {
    useMarkdownTabsStore.setState({ tabs: [] });
  });

  describe("openMarkdown", () => {
    it("adds a new tab and returns its id", () => {
      const result = useMarkdownTabsStore
        .getState()
        .openMarkdown("/work/a.md", "# A");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.existed).toBe(false);
      }
      const state = useMarkdownTabsStore.getState();
      expect(state.tabs.length).toBe(1);
      expect(state.tabs[0].filePath).toBe("/work/a.md");
    });

    it("returns the same tabId when same filePath is opened twice (no duplicate)", () => {
      const r1 = useMarkdownTabsStore
        .getState()
        .openMarkdown("/work/a.md", "# A");
      const r2 = useMarkdownTabsStore
        .getState()
        .openMarkdown("/work/a.md", "ignored");
      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      if (r1.ok && r2.ok) {
        expect(r2.existed).toBe(true);
        expect(r2.tabId).toBe(r1.tabId);
      }
      expect(useMarkdownTabsStore.getState().tabs.length).toBe(1);
    });

    it("returns ok:false with reason 'limit' when the 8th tab is exceeded", () => {
      for (let i = 0; i < 8; i++) {
        useMarkdownTabsStore.getState().openMarkdown(`/work/${i}.md`, "");
      }
      expect(useMarkdownTabsStore.getState().tabs.length).toBe(8);
      const result = useMarkdownTabsStore
        .getState()
        .openMarkdown("/work/9.md", "");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("limit");
      }
    });
  });

  describe("closeTab", () => {
    it("removes the tab without affecting siblings", () => {
      const r1 = useMarkdownTabsStore.getState().openMarkdown("/a.md", "");
      const r2 = useMarkdownTabsStore.getState().openMarkdown("/b.md", "");
      const r3 = useMarkdownTabsStore.getState().openMarkdown("/c.md", "");
      if (!r1.ok || !r2.ok || !r3.ok) throw new Error("setup failed");
      useMarkdownTabsStore.getState().closeTab(r3.tabId);
      const state = useMarkdownTabsStore.getState();
      expect(state.tabs.map((t) => t.filePath)).toEqual(["/a.md", "/b.md"]);
    });

    it("clears the tabs list when last tab is closed", () => {
      const r = useMarkdownTabsStore.getState().openMarkdown("/a.md", "");
      if (!r.ok) throw new Error("setup failed");
      useMarkdownTabsStore.getState().closeTab(r.tabId);
      const state = useMarkdownTabsStore.getState();
      expect(state.tabs.length).toBe(0);
    });
  });

  describe("setDirty / markSaved", () => {
    it("updates dirty state on a specific tab without affecting others", () => {
      const a = useMarkdownTabsStore.getState().openMarkdown("/a.md", "");
      const b = useMarkdownTabsStore.getState().openMarkdown("/b.md", "");
      if (!a.ok || !b.ok) throw new Error("setup failed");
      useMarkdownTabsStore.getState().setDirty(a.tabId, true);
      const state = useMarkdownTabsStore.getState();
      const tabA = state.tabs.find((t) => t.id === a.tabId);
      const tabB = state.tabs.find((t) => t.id === b.tabId);
      expect(tabA?.dirty).toBe(true);
      expect(tabB?.dirty).toBe(false);
    });

    it("markSaved updates savedContent and clears dirty", () => {
      const a = useMarkdownTabsStore.getState().openMarkdown("/a.md", "");
      if (!a.ok) throw new Error("setup failed");
      useMarkdownTabsStore.getState().setDirty(a.tabId, true);
      useMarkdownTabsStore.getState().markSaved(a.tabId, "saved!");
      const tab = useMarkdownTabsStore
        .getState()
        .tabs.find((t) => t.id === a.tabId);
      expect(tab?.dirty).toBe(false);
      expect(tab?.savedContent).toBe("saved!");
    });
  });

  describe("canOpenMore", () => {
    it("returns true when under the limit", () => {
      expect(useMarkdownTabsStore.getState().canOpenMore()).toBe(true);
    });

    it("returns false at exactly 8 tabs", () => {
      for (let i = 0; i < 8; i++) {
        useMarkdownTabsStore.getState().openMarkdown(`/${i}.md`, "");
      }
      expect(useMarkdownTabsStore.getState().canOpenMore()).toBe(false);
    });
  });
});
