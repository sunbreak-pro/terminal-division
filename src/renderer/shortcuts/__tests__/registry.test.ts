import { describe, it, expect } from "vitest";
import {
  parseKey,
  matchKey,
  formatKey,
  resolveShortcutKey,
  findConflictingIds,
  SHORTCUT_DEFINITIONS,
  getDefinition,
} from "../registry";

// KeyboardEvent ライクな最小オブジェクト（parseKey/matchKey の入力に使う）
function ev(opts: {
  key: string;
  meta?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
}): {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
} {
  return {
    key: opts.key,
    metaKey: !!opts.meta,
    ctrlKey: !!opts.ctrl,
    altKey: !!opts.alt,
    shiftKey: !!opts.shift,
  };
}

describe("parseKey", () => {
  it("normalizes letter keys to uppercase", () => {
    expect(parseKey(ev({ key: "d", meta: true }))).toBe("Cmd+D");
    expect(parseKey(ev({ key: "D", meta: true }))).toBe("Cmd+D");
  });

  it("preserves modifier order: Cmd+Ctrl+Option+Shift", () => {
    expect(
      parseKey(
        ev({ key: "k", meta: true, ctrl: true, alt: true, shift: true }),
      ),
    ).toBe("Cmd+Ctrl+Option+Shift+K");
  });

  it("preserves arrow key names", () => {
    expect(parseKey(ev({ key: "ArrowLeft", meta: true, alt: true }))).toBe(
      "Cmd+Option+ArrowLeft",
    );
    expect(parseKey(ev({ key: "ArrowDown", meta: true, alt: true }))).toBe(
      "Cmd+Option+ArrowDown",
    );
  });

  it("preserves symbol keys", () => {
    expect(parseKey(ev({ key: ".", meta: true }))).toBe("Cmd+.");
    expect(parseKey(ev({ key: ",", meta: true }))).toBe("Cmd+,");
  });

  it("converts space to 'Space'", () => {
    expect(parseKey(ev({ key: " ", meta: true }))).toBe("Cmd+Space");
  });

  it("returns null for modifier-only press", () => {
    expect(parseKey(ev({ key: "Meta", meta: true }))).toBeNull();
    expect(parseKey(ev({ key: "Shift", shift: true }))).toBeNull();
    expect(parseKey(ev({ key: "Control", ctrl: true }))).toBeNull();
    expect(parseKey(ev({ key: "Alt", alt: true }))).toBeNull();
    expect(parseKey(ev({ key: "Dead" }))).toBeNull();
  });

  it("encodes Backspace and Enter as-is", () => {
    expect(parseKey(ev({ key: "Backspace", meta: true }))).toBe(
      "Cmd+Backspace",
    );
    expect(parseKey(ev({ key: "Enter", shift: true }))).toBe("Shift+Enter");
  });
});

describe("matchKey", () => {
  it("matches normalized key strings", () => {
    expect(matchKey(ev({ key: "d", meta: true }), "Cmd+D")).toBe(true);
    expect(matchKey(ev({ key: "d", meta: true }), "Cmd+Shift+D")).toBe(false);
  });

  it("is case-insensitive on the expected side (alias resolution)", () => {
    expect(matchKey(ev({ key: "d", meta: true }), "cmd+d")).toBe(true);
    expect(matchKey(ev({ key: "d", meta: true }), "CMD+D")).toBe(true);
  });

  it("accepts modifier aliases (meta / command / alt / control)", () => {
    expect(matchKey(ev({ key: "d", meta: true }), "Meta+D")).toBe(true);
    expect(matchKey(ev({ key: "d", meta: true }), "Command+D")).toBe(true);
    expect(matchKey(ev({ key: "d", alt: true }), "Alt+D")).toBe(true);
    expect(matchKey(ev({ key: "d", ctrl: true }), "Control+D")).toBe(true);
  });

  it("returns false for null / undefined / empty expected", () => {
    expect(matchKey(ev({ key: "d", meta: true }), null)).toBe(false);
    expect(matchKey(ev({ key: "d", meta: true }), undefined)).toBe(false);
    expect(matchKey(ev({ key: "d", meta: true }), "")).toBe(false);
  });

  it("returns false for modifier-only events", () => {
    expect(matchKey(ev({ key: "Meta", meta: true }), "Cmd+D")).toBe(false);
  });
});

describe("formatKey", () => {
  it("renders modifier symbols", () => {
    expect(formatKey("Cmd+Shift+D")).toBe("⌘ ⇧ D");
    expect(formatKey("Cmd+Option+ArrowLeft")).toBe("⌘ ⌥ ←");
    expect(formatKey("Shift+Enter")).toBe("⇧ ⏎");
    expect(formatKey("Cmd+Backspace")).toBe("⌘ ⌫");
  });

  it("returns placeholder for null / empty", () => {
    expect(formatKey(null)).toBe("（未設定）");
    expect(formatKey(undefined)).toBe("（未設定）");
    expect(formatKey("")).toBe("（未設定）");
  });

  it("normalizes case-insensitive input", () => {
    expect(formatKey("cmd+shift+d")).toBe("⌘ ⇧ D");
  });
});

describe("resolveShortcutKey", () => {
  it("returns default when bindings has no entry", () => {
    expect(resolveShortcutKey("split-vertical", {})).toBe("Cmd+D");
  });

  it("returns user override when bindings has the id", () => {
    expect(
      resolveShortcutKey("split-vertical", { "split-vertical": "Cmd+1" }),
    ).toBe("Cmd+1");
  });

  it("returns null when bindings explicitly disables a shortcut", () => {
    expect(
      resolveShortcutKey("split-vertical", { "split-vertical": null }),
    ).toBeNull();
  });
});

describe("findConflictingIds", () => {
  it("detects defaults that already use the same key", () => {
    const conflicts = findConflictingIds("Cmd+D", {});
    expect(conflicts).toContain("split-vertical");
  });

  it("excludes the current id from conflicts", () => {
    const conflicts = findConflictingIds("Cmd+D", {}, "split-vertical");
    expect(conflicts).not.toContain("split-vertical");
  });

  it("respects user overrides", () => {
    // close-pane を Cmd+D に割り当てると、デフォルトの split-vertical と衝突
    const conflicts = findConflictingIds(
      "Cmd+D",
      { "close-pane": "Cmd+D" },
      "close-pane",
    );
    expect(conflicts).toContain("split-vertical");
    expect(conflicts).not.toContain("close-pane");
  });

  it("ignores disabled (null) bindings", () => {
    // split-vertical を null にすると Cmd+D は誰にも割り当てられていない
    const conflicts = findConflictingIds("Cmd+D", {
      "split-vertical": null,
    });
    expect(conflicts).not.toContain("split-vertical");
    expect(conflicts.length).toBe(0);
  });
});

describe("SHORTCUT_DEFINITIONS / getDefinition", () => {
  it("contains unique ids", () => {
    const ids = SHORTCUT_DEFINITIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("getDefinition returns the definition for a known id", () => {
    expect(getDefinition("split-vertical")?.defaultKey).toBe("Cmd+D");
  });

  it("getDefinition returns undefined for unknown id", () => {
    // @ts-expect-error: 不明な ID を意図的に渡してテスト
    expect(getDefinition("nonexistent")).toBeUndefined();
  });
});
