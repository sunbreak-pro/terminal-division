import { describe, it, expect, beforeEach } from "vitest";
import { useThemeStore } from "../themeStore";
import { useSettingsStore } from "../settingsStore";
import { themes, DEFAULT_THEME_ID } from "../../styles/theme";
import { DEFAULT_SETTINGS } from "../../../shared/settings";

describe("themeStore", () => {
  beforeEach(() => {
    // ストアを初期状態に戻す。settings 側も初期化（custom themes が他テストの影響を残さないように）
    useThemeStore.setState({
      currentThemeId: DEFAULT_THEME_ID,
    });
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        theme: { currentThemeId: DEFAULT_THEME_ID, customThemes: [] },
      },
      isLoaded: false,
    });
  });

  describe("initial state", () => {
    it("should have default theme id", () => {
      expect(useThemeStore.getState().currentThemeId).toBe(DEFAULT_THEME_ID);
    });

    it("should have theme config", () => {
      const { config } = useThemeStore.getState();
      expect(config.spacing).toBeDefined();
      expect(config.borderRadius).toBeDefined();
      expect(config.headerHeight).toBeDefined();
    });
  });

  describe("setTheme", () => {
    it("should change current theme id locally", () => {
      useThemeStore.getState().setTheme("light");
      expect(useThemeStore.getState().currentThemeId).toBe("light");
    });

    it("should persist via settings store", () => {
      useThemeStore.getState().setTheme("dracula");
      expect(useSettingsStore.getState().settings.theme.currentThemeId).toBe(
        "dracula",
      );
    });

    it("should allow switching between all built-in themes", () => {
      for (const themeId of Object.keys(themes)) {
        useThemeStore.getState().setTheme(themeId);
        expect(useThemeStore.getState().currentThemeId).toBe(themeId);
      }
    });
  });

  describe("setThemeIdLocal", () => {
    it("should update currentThemeId without writing to settings", () => {
      const settingsBefore =
        useSettingsStore.getState().settings.theme.currentThemeId;
      useThemeStore.getState().setThemeIdLocal("oneDark");
      expect(useThemeStore.getState().currentThemeId).toBe("oneDark");
      // settings には書き込まれない（起動時の反映用なので）
      expect(useSettingsStore.getState().settings.theme.currentThemeId).toBe(
        settingsBefore,
      );
    });
  });

  describe("theme content (lookup via themes record)", () => {
    it("should resolve dark theme correctly", () => {
      useThemeStore.getState().setTheme("dark");
      const id = useThemeStore.getState().currentThemeId;
      expect(themes[id].colors.background).toBe("#1a1a1a");
      expect(themes[id].colors.text).toBe("#d4d4d4");
    });

    it("should resolve light theme correctly", () => {
      useThemeStore.getState().setTheme("light");
      const id = useThemeStore.getState().currentThemeId;
      expect(themes[id].colors.background).toBe("#f5f5f5");
      expect(themes[id].colors.text).toBe("#333333");
    });

    it("should have xterm theme on every preset", () => {
      for (const themeId of Object.keys(themes)) {
        const t = themes[themeId];
        expect(t.xterm.background).toBeDefined();
        expect(t.xterm.foreground).toBeDefined();
        expect(t.xterm.cursor).toBeDefined();
        expect(t.xterm.black).toBeDefined();
        expect(t.xterm.white).toBeDefined();
      }
    });
  });
});
