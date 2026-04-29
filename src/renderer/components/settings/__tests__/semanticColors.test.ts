import { describe, it, expect } from "vitest";
import {
  readSemantic,
  semanticUpdate,
  type SemanticKey,
} from "../AppearanceSettings";
import type { Theme } from "../../../../shared/theme-types";

const theme: Theme = {
  id: "test",
  name: "Test",
  colors: {
    background: "#111111",
    headerBackground: "#222222",
    terminalBackground: "#333333",
    text: "#ffffff",
    textSecondary: "#aaaaaa",
    accent: "#ff00ff",
    activeTerminal: "#ff0000",
    border: "#444444",
    borderActive: "#888888",
    buttonHover: "#555555",
    danger: "#ff3333",
  },
  xterm: {
    background: "#0d0d0d",
    foreground: "#eeeeee",
    cursor: "#cccccc",
    cursorAccent: "#000000",
    selectionBackground: "#666666",
    selectionForeground: "#ffffff",
    black: "#000",
    red: "#f00",
    green: "#0f0",
    yellow: "#ff0",
    blue: "#00f",
    magenta: "#f0f",
    cyan: "#0ff",
    white: "#fff",
    brightBlack: "#222",
    brightRed: "#f44",
    brightGreen: "#4f4",
    brightYellow: "#ff4",
    brightBlue: "#44f",
    brightMagenta: "#f4f",
    brightCyan: "#4ff",
    brightWhite: "#fff",
  },
};

describe("readSemantic", () => {
  it("background は xterm.background を返す（colors.terminalBackground ではない）", () => {
    // ユーザーが「ターミナル背景」を編集したいとき、xterm 本体の背景を見せる必要がある
    expect(readSemantic(theme, "background")).toBe("#0d0d0d");
  });

  it("foreground は xterm.foreground を返す", () => {
    expect(readSemantic(theme, "foreground")).toBe("#eeeeee");
  });

  it("accent は colors.accent を返す", () => {
    expect(readSemantic(theme, "accent")).toBe("#ff00ff");
  });

  it("textSecondary / border / danger は colors の対応フィールドを返す", () => {
    expect(readSemantic(theme, "textSecondary")).toBe("#aaaaaa");
    expect(readSemantic(theme, "border")).toBe("#444444");
    expect(readSemantic(theme, "danger")).toBe("#ff3333");
  });
});

describe("semanticUpdate", () => {
  it("background は xterm + colors の重複 6 フィールドを一括更新する", () => {
    const u = semanticUpdate("background", "#abcdef");
    expect(u.colors).toEqual({
      background: "#abcdef",
      headerBackground: "#abcdef",
      terminalBackground: "#abcdef",
    });
    expect(u.xterm).toEqual({
      background: "#abcdef",
      cursorAccent: "#abcdef",
      selectionForeground: "#abcdef",
    });
  });

  it("foreground は xterm.foreground と colors.text を更新する", () => {
    const u = semanticUpdate("foreground", "#123456");
    expect(u.colors).toEqual({ text: "#123456" });
    expect(u.xterm).toEqual({ foreground: "#123456" });
  });

  it("accent は xterm.cursor / xterm.selectionBackground / colors の 3 フィールドを更新する", () => {
    const u = semanticUpdate("accent", "#ff8800");
    expect(u.colors).toEqual({
      accent: "#ff8800",
      activeTerminal: "#ff8800",
      borderActive: "#ff8800",
    });
    expect(u.xterm).toEqual({
      cursor: "#ff8800",
      selectionBackground: "#ff8800",
    });
  });

  it("textSecondary は単一フィールドのみ更新する", () => {
    const u = semanticUpdate("textSecondary", "#999");
    expect(u.colors).toEqual({ textSecondary: "#999" });
    expect(u.xterm).toBeUndefined();
  });

  it("border は colors.border + buttonHover を更新する", () => {
    const u = semanticUpdate("border", "#333");
    expect(u.colors).toEqual({ border: "#333", buttonHover: "#333" });
    expect(u.xterm).toBeUndefined();
  });

  it("danger は単一フィールドのみ更新する", () => {
    const u = semanticUpdate("danger", "#e22");
    expect(u.colors).toEqual({ danger: "#e22" });
    expect(u.xterm).toBeUndefined();
  });

  it("セマンティック間でフィールドが排他（重複更新なし）", () => {
    // 各セマンティック更新で触れるフィールドの集合を取り、全体で重複がないことを保証する。
    // 重複があると「アクセントを変えたら背景も動く」のような副作用バグになる。
    const keys: SemanticKey[] = [
      "background",
      "foreground",
      "accent",
      "textSecondary",
      "border",
      "danger",
    ];
    const seen = new Set<string>();
    for (const k of keys) {
      const u = semanticUpdate(k, "#000");
      for (const c of Object.keys(u.colors ?? {})) {
        const tag = `colors.${c}`;
        expect(seen.has(tag), `重複: ${tag}`).toBe(false);
        seen.add(tag);
      }
      for (const x of Object.keys(u.xterm ?? {})) {
        const tag = `xterm.${x}`;
        expect(seen.has(tag), `重複: ${tag}`).toBe(false);
        seen.add(tag);
      }
    }
  });
});
