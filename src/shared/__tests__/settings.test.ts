import { describe, it, expect } from "vitest";
import {
  validateAppSettings,
  mergeSettings,
  DEFAULT_SETTINGS,
  SETTINGS_VERSION,
  OPACITY_MIN,
  OPACITY_MAX,
  type AppSettings,
} from "../settings";
import { XTERM_THEME_KEYS, APP_COLOR_KEYS, type Theme } from "../theme-types";

function makeValidTheme(id = "custom-1"): Theme {
  const xterm = Object.fromEntries(
    XTERM_THEME_KEYS.map((k) => [k, "#000000"]),
  ) as Theme["xterm"];
  const colors = Object.fromEntries(
    APP_COLOR_KEYS.map((k) => [k, "#ffffff"]),
  ) as Theme["colors"];
  return { id, name: id, colors, xterm };
}

describe("validateAppSettings", () => {
  it("returns defaults for null / undefined / non-object", () => {
    expect(validateAppSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(validateAppSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(validateAppSettings("garbage")).toEqual(DEFAULT_SETTINGS);
    expect(validateAppSettings(42)).toEqual(DEFAULT_SETTINGS);
  });

  it("returns defaults when version mismatches", () => {
    const result = validateAppSettings({
      version: 999,
      theme: { currentThemeId: "dracula", customThemes: [] },
    });
    expect(result).toEqual(DEFAULT_SETTINGS);
  });

  it("preserves valid currentThemeId", () => {
    const result = validateAppSettings({
      version: SETTINGS_VERSION,
      theme: { currentThemeId: "dracula", customThemes: [] },
    });
    expect(result.theme.currentThemeId).toBe("dracula");
  });

  it("falls back to default currentThemeId when invalid", () => {
    const result = validateAppSettings({
      version: SETTINGS_VERSION,
      theme: { currentThemeId: 42, customThemes: [] },
    });
    expect(result.theme.currentThemeId).toBe(
      DEFAULT_SETTINGS.theme.currentThemeId,
    );
  });

  it("filters out invalid customThemes but keeps valid ones", () => {
    const valid = makeValidTheme("custom-good");
    const broken = { id: "broken", name: "Broken" }; // colors / xterm 不在
    const result = validateAppSettings({
      version: SETTINGS_VERSION,
      theme: { customThemes: [valid, broken, "garbage"] },
    });
    expect(result.theme.customThemes).toHaveLength(1);
    expect(result.theme.customThemes[0].id).toBe("custom-good");
  });

  it("clamps opacity to [OPACITY_MIN, OPACITY_MAX]", () => {
    const tooLow = validateAppSettings({
      version: SETTINGS_VERSION,
      window: { opacity: 0.1 },
    });
    const tooHigh = validateAppSettings({
      version: SETTINGS_VERSION,
      window: { opacity: 2.0 },
    });
    expect(tooLow.window.opacity).toBe(OPACITY_MIN);
    expect(tooHigh.window.opacity).toBe(OPACITY_MAX);
  });

  it("falls back to default opacity for non-number values", () => {
    const result = validateAppSettings({
      version: SETTINGS_VERSION,
      window: { opacity: "string" },
    });
    expect(result.window.opacity).toBe(DEFAULT_SETTINGS.window.opacity);
  });

  it("only treats explicit true as vibrancyEnabled", () => {
    expect(
      validateAppSettings({
        version: SETTINGS_VERSION,
        window: { vibrancyEnabled: true },
      }).window.vibrancyEnabled,
    ).toBe(true);
    expect(
      validateAppSettings({
        version: SETTINGS_VERSION,
        window: { vibrancyEnabled: 1 },
      }).window.vibrancyEnabled,
    ).toBe(false);
    expect(
      validateAppSettings({
        version: SETTINGS_VERSION,
        window: { vibrancyEnabled: "true" },
      }).window.vibrancyEnabled,
    ).toBe(false);
  });

  it("preserves valid shortcut bindings (string and null)", () => {
    const result = validateAppSettings({
      version: SETTINGS_VERSION,
      shortcuts: {
        "split-vertical": "Cmd+1",
        "close-pane": null,
        "garbage-entry": 42, // 数値は drop される
      },
    });
    expect(result.shortcuts["split-vertical"]).toBe("Cmd+1");
    expect(result.shortcuts["close-pane"]).toBeNull();
    expect(result.shortcuts["garbage-entry"]).toBeUndefined();
  });

  it("rejects shortcut key strings that are too long", () => {
    const tooLong = "a".repeat(100);
    const result = validateAppSettings({
      version: SETTINGS_VERSION,
      shortcuts: { "split-vertical": tooLong },
    });
    expect(result.shortcuts["split-vertical"]).toBeUndefined();
  });
});

describe("mergeSettings", () => {
  const base: AppSettings = {
    version: SETTINGS_VERSION,
    theme: { currentThemeId: "dark", customThemes: [] },
    shortcuts: { "split-vertical": "Cmd+1" },
    window: { opacity: 1.0, vibrancyEnabled: false },
  };

  it("returns a base copy when patch is empty", () => {
    const result = mergeSettings(base, {});
    expect(result).toEqual(base);
    expect(result).not.toBe(base); // 別オブジェクトを返す
  });

  it("merges only provided theme fields", () => {
    const result = mergeSettings(base, {
      theme: { currentThemeId: "dracula" },
    });
    expect(result.theme.currentThemeId).toBe("dracula");
    expect(result.theme.customThemes).toEqual([]); // 既存維持
    expect(result.shortcuts).toEqual(base.shortcuts); // 他は変わらない
  });

  it("replaces shortcuts entirely (not merge)", () => {
    const result = mergeSettings(base, {
      shortcuts: { "close-pane": "Cmd+0" },
    });
    expect(result.shortcuts["split-vertical"]).toBeUndefined();
    expect(result.shortcuts["close-pane"]).toBe("Cmd+0");
  });

  it("clamps opacity in patch", () => {
    expect(
      mergeSettings(base, { window: { opacity: 5.0 } }).window.opacity,
    ).toBe(OPACITY_MAX);
    expect(
      mergeSettings(base, { window: { opacity: -1 } }).window.opacity,
    ).toBe(OPACITY_MIN);
  });

  it("only treats explicit true as vibrancyEnabled in patch", () => {
    expect(
      mergeSettings(base, { window: { vibrancyEnabled: true } }).window
        .vibrancyEnabled,
    ).toBe(true);
    // @ts-expect-error: 不正な値で fallback を確認
    expect(
      mergeSettings(base, { window: { vibrancyEnabled: "yes" } }).window
        .vibrancyEnabled,
    ).toBe(false);
  });

  it("filters invalid customThemes in patch", () => {
    const valid = {
      id: "good",
      name: "Good",
      colors: Object.fromEntries(APP_COLOR_KEYS.map((k) => [k, "#ffffff"])),
      xterm: Object.fromEntries(XTERM_THEME_KEYS.map((k) => [k, "#000000"])),
    } as Theme;
    const result = mergeSettings(base, {
      theme: {
        customThemes: [valid, { id: "broken" } as unknown as Theme],
      },
    });
    expect(result.theme.customThemes).toHaveLength(1);
    expect(result.theme.customThemes[0].id).toBe("good");
  });
});
