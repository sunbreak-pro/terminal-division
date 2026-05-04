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
  });
});
