import { describe, it, expect } from "vitest";
import {
  isHexColor,
  validateTheme,
  XTERM_THEME_KEYS,
  APP_COLOR_KEYS,
  type Theme,
} from "../theme-types";

// テスト用の有効な Theme を生成。各キーに #000000 を埋める。
function makeValidTheme(overrides: Partial<Theme> = {}): Theme {
  const xterm = Object.fromEntries(
    XTERM_THEME_KEYS.map((k) => [k, "#000000"]),
  ) as Theme["xterm"];
  const colors = Object.fromEntries(
    APP_COLOR_KEYS.map((k) => [k, "#ffffff"]),
  ) as Theme["colors"];
  return {
    id: "test-theme",
    name: "Test",
    colors,
    xterm,
    ...overrides,
  };
}

describe("isHexColor", () => {
  it("accepts #rgb / #rrggbb / #rrggbbaa", () => {
    expect(isHexColor("#fff")).toBe(true);
    expect(isHexColor("#FFF")).toBe(true);
    expect(isHexColor("#ff0000")).toBe(true);
    expect(isHexColor("#FF0000")).toBe(true);
    expect(isHexColor("#ff0000aa")).toBe(true);
  });

  it("rejects values without leading #", () => {
    expect(isHexColor("ff0000")).toBe(false);
  });

  it("rejects partial / oversized values", () => {
    expect(isHexColor("#")).toBe(false);
    expect(isHexColor("#ff")).toBe(false);
    expect(isHexColor("#ffff")).toBe(false);
    expect(isHexColor("#ffffffff0")).toBe(false);
  });

  it("rejects non-hex characters", () => {
    expect(isHexColor("#gggggg")).toBe(false);
    expect(isHexColor("#zzz")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isHexColor(null)).toBe(false);
    expect(isHexColor(undefined)).toBe(false);
    expect(isHexColor(123)).toBe(false);
    expect(isHexColor({})).toBe(false);
  });
});

describe("validateTheme", () => {
  it("accepts a fully populated valid theme", () => {
    const theme = makeValidTheme();
    expect(validateTheme(theme)).not.toBeNull();
  });

  it("rejects null / non-object input", () => {
    expect(validateTheme(null)).toBeNull();
    expect(validateTheme(undefined)).toBeNull();
    expect(validateTheme("string")).toBeNull();
    expect(validateTheme(42)).toBeNull();
  });

  it("rejects missing id / name", () => {
    const theme = makeValidTheme();
    expect(validateTheme({ ...theme, id: "" })).toBeNull();
    expect(validateTheme({ ...theme, name: "" })).toBeNull();
    expect(validateTheme({ ...theme, id: undefined })).toBeNull();
    expect(validateTheme({ ...theme, name: undefined })).toBeNull();
  });

  it("rejects missing colors object", () => {
    const theme = makeValidTheme();
    expect(validateTheme({ ...theme, colors: undefined })).toBeNull();
    expect(validateTheme({ ...theme, colors: null })).toBeNull();
    expect(validateTheme({ ...theme, colors: "not-an-object" })).toBeNull();
  });

  it("rejects when any AppColors field is invalid hex", () => {
    const theme = makeValidTheme();
    expect(
      validateTheme({
        ...theme,
        colors: { ...theme.colors, accent: "not-a-color" },
      }),
    ).toBeNull();
    expect(
      validateTheme({
        ...theme,
        colors: { ...theme.colors, background: "#ff" }, // 不完全な hex
      }),
    ).toBeNull();
  });

  it("rejects when any XtermTheme field is invalid hex", () => {
    const theme = makeValidTheme();
    expect(
      validateTheme({
        ...theme,
        xterm: { ...theme.xterm, foreground: "red" }, // CSS 色名は不可
      }),
    ).toBeNull();
    expect(
      validateTheme({
        ...theme,
        xterm: { ...theme.xterm, brightYellow: "" },
      }),
    ).toBeNull();
  });

  it("rejects when an XtermTheme field is missing entirely", () => {
    const theme = makeValidTheme();
    const xterm = { ...theme.xterm } as Record<string, string>;
    delete xterm.cursor;
    expect(validateTheme({ ...theme, xterm })).toBeNull();
  });
});
