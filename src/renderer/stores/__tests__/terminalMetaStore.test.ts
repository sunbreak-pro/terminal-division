import { describe, it, expect, beforeEach } from "vitest";
import { useTerminalMetaStore } from "../terminalMetaStore";

describe("terminalMetaStore", () => {
  beforeEach(() => {
    useTerminalMetaStore.setState({ metas: new Map() });
  });

  describe("initMeta", () => {
    it("creates a meta entry with fontSizeOverride=null and customTitle=null", () => {
      useTerminalMetaStore.getState().initMeta("t1");
      const meta = useTerminalMetaStore.getState().metas.get("t1");
      expect(meta).toBeDefined();
      expect(meta?.fontSizeOverride).toBeNull();
      expect(meta?.customTitle).toBeNull();
    });

    it("does not overwrite existing meta", () => {
      useTerminalMetaStore.getState().initLeafMeta("t1", "/some/cwd");
      useTerminalMetaStore.getState().initMeta("t1"); // 二度目は no-op
      const meta = useTerminalMetaStore.getState().metas.get("t1");
      expect(meta?.cwd).toBe("/some/cwd");
    });
  });

  describe("setFontSizeOverride", () => {
    it("updates the override value when meta exists", () => {
      useTerminalMetaStore.getState().initMeta("t1");
      useTerminalMetaStore.getState().setFontSizeOverride("t1", 18);
      expect(
        useTerminalMetaStore.getState().metas.get("t1")?.fontSizeOverride,
      ).toBe(18);
    });

    it("can reset the override back to null", () => {
      useTerminalMetaStore.getState().initMeta("t1");
      useTerminalMetaStore.getState().setFontSizeOverride("t1", 18);
      useTerminalMetaStore.getState().setFontSizeOverride("t1", null);
      expect(
        useTerminalMetaStore.getState().metas.get("t1")?.fontSizeOverride,
      ).toBeNull();
    });

    it("is a no-op when meta does not exist", () => {
      useTerminalMetaStore.getState().setFontSizeOverride("ghost", 18);
      expect(useTerminalMetaStore.getState().metas.has("ghost")).toBe(false);
    });

    it("does not affect other panes' override", () => {
      useTerminalMetaStore.getState().initMeta("t1");
      useTerminalMetaStore.getState().initMeta("t2");
      useTerminalMetaStore.getState().setFontSizeOverride("t1", 18);
      expect(
        useTerminalMetaStore.getState().metas.get("t2")?.fontSizeOverride,
      ).toBeNull();
    });
  });

  describe("setCustomTitle", () => {
    it("sets a custom title string", () => {
      useTerminalMetaStore.getState().initMeta("t1");
      useTerminalMetaStore.getState().setCustomTitle("t1", "ビルド監視");
      expect(useTerminalMetaStore.getState().metas.get("t1")?.customTitle).toBe(
        "ビルド監視",
      );
    });

    it("clears the custom title with null", () => {
      useTerminalMetaStore.getState().initMeta("t1");
      useTerminalMetaStore.getState().setCustomTitle("t1", "name");
      useTerminalMetaStore.getState().setCustomTitle("t1", null);
      expect(
        useTerminalMetaStore.getState().metas.get("t1")?.customTitle,
      ).toBeNull();
    });

    it("is a no-op for non-existent ids", () => {
      useTerminalMetaStore.getState().setCustomTitle("ghost", "x");
      expect(useTerminalMetaStore.getState().metas.has("ghost")).toBe(false);
    });
  });

  describe("hydrateMetas", () => {
    it("initializes fontSizeOverride and customTitle to null on restore", () => {
      useTerminalMetaStore
        .getState()
        .hydrateMetas([["leaf-1", { cwd: "/restored/path" }]]);
      const meta = useTerminalMetaStore.getState().metas.get("leaf-1");
      expect(meta?.cwd).toBe("/restored/path");
      expect(meta?.fontSizeOverride).toBeNull();
      expect(meta?.customTitle).toBeNull();
    });

    it("restores mdTabs from mdTabFilePaths and sets first as active", () => {
      useTerminalMetaStore.getState().hydrateMetas([
        [
          "leaf-1",
          {
            cwd: "/work",
            mdTabFilePaths: ["/work/a.md", "/work/b.md"],
          },
        ],
      ]);
      const meta = useTerminalMetaStore.getState().metas.get("leaf-1");
      expect(meta?.mdTabs.length).toBe(2);
      expect(meta?.mdTabs[0].filePath).toBe("/work/a.md");
      expect(meta?.mdTabs[1].filePath).toBe("/work/b.md");
      expect(meta?.activeMdTabId).toBe(meta?.mdTabs[0].id);
      // 復元直後は savedContent="" / dirty=false（MarkdownEditor が mount 時に再読込する）
      expect(meta?.mdTabs[0].savedContent).toBe("");
      expect(meta?.mdTabs[0].dirty).toBe(false);
    });

    it("leaves mdTabs empty when no mdTabFilePaths is provided", () => {
      useTerminalMetaStore
        .getState()
        .hydrateMetas([["leaf-1", { cwd: "/restored/path" }]]);
      const meta = useTerminalMetaStore.getState().metas.get("leaf-1");
      expect(meta?.mdTabs).toEqual([]);
      expect(meta?.activeMdTabId).toBeNull();
    });
  });

  describe("openMarkdown (multi-tab)", () => {
    it("adds a new tab and activates it", () => {
      useTerminalMetaStore.getState().initMeta("p1");
      const result = useTerminalMetaStore
        .getState()
        .openMarkdown("p1", "/work/a.md", "# A");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.existed).toBe(false);
      }
      const meta = useTerminalMetaStore.getState().metas.get("p1");
      expect(meta?.mdTabs.length).toBe(1);
      expect(meta?.mdTabs[0].filePath).toBe("/work/a.md");
      expect(meta?.activeMdTabId).toBe(meta?.mdTabs[0].id);
      expect(meta?.viewMode).toBe("md");
    });

    it("activates existing tab when same filePath is opened twice (no duplicate)", () => {
      useTerminalMetaStore.getState().initMeta("p1");
      const r1 = useTerminalMetaStore
        .getState()
        .openMarkdown("p1", "/work/a.md", "# A");
      const r2 = useTerminalMetaStore
        .getState()
        .openMarkdown("p1", "/work/a.md", "ignored");
      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      if (r1.ok && r2.ok) {
        expect(r2.existed).toBe(true);
        expect(r2.tabId).toBe(r1.tabId);
      }
      const meta = useTerminalMetaStore.getState().metas.get("p1");
      expect(meta?.mdTabs.length).toBe(1);
    });

    it("returns ok:false with reason 'limit' when the 8th tab is exceeded", () => {
      useTerminalMetaStore.getState().initMeta("p1");
      for (let i = 0; i < 8; i++) {
        useTerminalMetaStore.getState().openMarkdown("p1", `/work/${i}.md`, "");
      }
      expect(
        useTerminalMetaStore.getState().metas.get("p1")?.mdTabs.length,
      ).toBe(8);
      const result = useTerminalMetaStore
        .getState()
        .openMarkdown("p1", "/work/9.md", "");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("limit");
      }
    });
  });

  describe("closeMdTab", () => {
    it("removes the tab and falls back active to the previous tab", () => {
      useTerminalMetaStore.getState().initMeta("p1");
      const r1 = useTerminalMetaStore
        .getState()
        .openMarkdown("p1", "/a.md", "");
      const r2 = useTerminalMetaStore
        .getState()
        .openMarkdown("p1", "/b.md", "");
      const r3 = useTerminalMetaStore
        .getState()
        .openMarkdown("p1", "/c.md", "");
      if (!r1.ok || !r2.ok || !r3.ok) throw new Error("setup failed");
      // active=t3 を閉じる → 残 [t1, t2]、active=t2 (左隣) になる
      useTerminalMetaStore.getState().closeMdTab("p1", r3.tabId);
      const meta = useTerminalMetaStore.getState().metas.get("p1");
      expect(meta?.mdTabs.map((t) => t.filePath)).toEqual(["/a.md", "/b.md"]);
      expect(meta?.activeMdTabId).toBe(r2.tabId);
    });

    it("clears activeMdTabId and reverts viewMode to cli when last tab is closed", () => {
      useTerminalMetaStore.getState().initMeta("p1");
      const r = useTerminalMetaStore.getState().openMarkdown("p1", "/a.md", "");
      if (!r.ok) throw new Error("setup failed");
      useTerminalMetaStore.getState().closeMdTab("p1", r.tabId);
      const meta = useTerminalMetaStore.getState().metas.get("p1");
      expect(meta?.mdTabs.length).toBe(0);
      expect(meta?.activeMdTabId).toBeNull();
      expect(meta?.viewMode).toBe("cli");
    });
  });

  describe("setMdDirty / markMdSaved", () => {
    it("updates dirty state on a specific tab without affecting others", () => {
      useTerminalMetaStore.getState().initMeta("p1");
      const a = useTerminalMetaStore.getState().openMarkdown("p1", "/a.md", "");
      const b = useTerminalMetaStore.getState().openMarkdown("p1", "/b.md", "");
      if (!a.ok || !b.ok) throw new Error("setup failed");
      useTerminalMetaStore.getState().setMdDirty("p1", a.tabId, true);
      const meta = useTerminalMetaStore.getState().metas.get("p1");
      const tabA = meta?.mdTabs.find((t) => t.id === a.tabId);
      const tabB = meta?.mdTabs.find((t) => t.id === b.tabId);
      expect(tabA?.dirty).toBe(true);
      expect(tabB?.dirty).toBe(false);
    });

    it("markMdSaved updates savedContent and clears dirty", () => {
      useTerminalMetaStore.getState().initMeta("p1");
      const a = useTerminalMetaStore.getState().openMarkdown("p1", "/a.md", "");
      if (!a.ok) throw new Error("setup failed");
      useTerminalMetaStore.getState().setMdDirty("p1", a.tabId, true);
      useTerminalMetaStore.getState().markMdSaved("p1", a.tabId, "saved!");
      const tab = useTerminalMetaStore
        .getState()
        .metas.get("p1")
        ?.mdTabs.find((t) => t.id === a.tabId);
      expect(tab?.dirty).toBe(false);
      expect(tab?.savedContent).toBe("saved!");
    });
  });

  describe("canOpenMoreMd", () => {
    it("returns true when under the limit", () => {
      useTerminalMetaStore.getState().initMeta("p1");
      expect(useTerminalMetaStore.getState().canOpenMoreMd("p1")).toBe(true);
    });

    it("returns false at exactly 8 tabs", () => {
      useTerminalMetaStore.getState().initMeta("p1");
      for (let i = 0; i < 8; i++) {
        useTerminalMetaStore.getState().openMarkdown("p1", `/${i}.md`, "");
      }
      expect(useTerminalMetaStore.getState().canOpenMoreMd("p1")).toBe(false);
    });
  });
});
