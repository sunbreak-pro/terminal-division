import { describe, it, expect } from "vitest";
import { withAlpha, isLightBackground } from "../colorUtils";

describe("withAlpha", () => {
  it("appends 100% alpha as ff", () => {
    expect(withAlpha("#0066cc", 1)).toBe("#0066ccff");
  });

  it("appends 0% alpha as 00", () => {
    expect(withAlpha("#0066cc", 0)).toBe("#0066cc00");
  });

  it("appends 50% alpha as 80 (round to nearest)", () => {
    // Math.round(0.5 * 255) = 128 = 0x80
    expect(withAlpha("#ffffff", 0.5)).toBe("#ffffff80");
  });

  it("clamps alpha > 1 to 1 (ff)", () => {
    expect(withAlpha("#000000", 2)).toBe("#000000ff");
  });

  it("clamps negative alpha to 0 (00)", () => {
    expect(withAlpha("#000000", -0.5)).toBe("#00000000");
  });

  it("preserves the # prefix", () => {
    expect(withAlpha("#abcdef", 0.25).startsWith("#")).toBe(true);
  });

  it("normalizes input by stripping a leading # before re-adding", () => {
    // "#" 1 個に正規化されること（入力に # が無くても付与）
    expect(withAlpha("123456", 1)).toBe("#123456ff");
  });

  it("returns input unchanged for non-#rrggbb shapes (#rgb shorthand)", () => {
    // 短縮形は対応外。アプリ内で短縮 hex は使わないため、誤動作より素通しが安全
    expect(withAlpha("#abc", 0.5)).toBe("#abc");
  });

  it("returns input unchanged for too-long hex", () => {
    expect(withAlpha("#0011223344", 0.5)).toBe("#0011223344");
  });

  it("alpha conversion is single-byte (always 2 hex chars)", () => {
    // 0.001 はほぼ 0 だが、0 ではない -> "00" にラウンドされる
    const result = withAlpha("#000000", 0.001);
    expect(result.length).toBe(9); // # + 6 + 2
  });
});

describe("isLightBackground", () => {
  it("returns true for pure white", () => {
    expect(isLightBackground("#ffffff")).toBe(true);
  });

  it("returns false for pure black", () => {
    expect(isLightBackground("#000000")).toBe(false);
  });

  it("returns true for light theme background (#f5f5f5)", () => {
    expect(isLightBackground("#f5f5f5")).toBe(true);
  });

  it("returns true for light theme terminal background (#fbfbf9)", () => {
    expect(isLightBackground("#fbfbf9")).toBe(true);
  });

  it("returns false for dark theme backgrounds (#1a1a1a, #0d0d0d)", () => {
    expect(isLightBackground("#1a1a1a")).toBe(false);
    expect(isLightBackground("#0d0d0d")).toBe(false);
  });

  it("returns false for dracula background (#282a36)", () => {
    expect(isLightBackground("#282a36")).toBe(false);
  });

  it("returns false for one-dark background (#1e2127)", () => {
    expect(isLightBackground("#1e2127")).toBe(false);
  });

  it("uses weighted luminance: pure blue (#0000ff) is dark", () => {
    // 0.114 * 1 = 0.114 < 0.5 → dark
    expect(isLightBackground("#0000ff")).toBe(false);
  });

  it("uses weighted luminance: pure green (#00ff00) is light", () => {
    // 0.587 * 1 = 0.587 > 0.5 → light
    expect(isLightBackground("#00ff00")).toBe(true);
  });

  it("uses weighted luminance: pure red (#ff0000) is dark (0.299 < 0.5)", () => {
    expect(isLightBackground("#ff0000")).toBe(false);
  });

  it("returns false for shorthand hex (#fff) — unsupported format", () => {
    // 現実装は #rrggbb のみサポート
    expect(isLightBackground("#fff")).toBe(false);
  });

  it("returns false for invalid hex strings", () => {
    expect(isLightBackground("#zzzzzz")).toBe(false);
    expect(isLightBackground("not-a-color")).toBe(false);
    expect(isLightBackground("")).toBe(false);
  });

  it("accepts hex without leading #", () => {
    expect(isLightBackground("ffffff")).toBe(true);
    expect(isLightBackground("000000")).toBe(false);
  });

  it("threshold is exactly 0.5: a value just over qualifies as light", () => {
    // 灰色 #808080 (128/255 = 0.502) は light 判定
    expect(isLightBackground("#808080")).toBe(true);
  });

  it("threshold: medium gray below 50% luminance is dark", () => {
    // #777777 (119/255 ≈ 0.467) は dark 判定
    expect(isLightBackground("#777777")).toBe(false);
  });
});
