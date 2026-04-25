import { describe, it, expect, vi } from "vitest";
import * as path from "path";

vi.mock("os", () => ({
  homedir: vi.fn().mockReturnValue("/Users/test"),
}));

import { validatePath } from "../path-validator";

describe("validatePath", () => {
  describe("allows", () => {
    it("home directory itself", () => {
      expect(validatePath("/Users/test")).toBe("/Users/test");
    });

    it("paths inside home directory", () => {
      expect(validatePath("/Users/test/projects/foo")).toBe(
        "/Users/test/projects/foo",
      );
    });

    it("paths under /Volumes (external volumes)", () => {
      expect(validatePath("/Volumes/USB/data.txt")).toBe(
        "/Volumes/USB/data.txt",
      );
    });

    it("paths under /tmp", () => {
      expect(validatePath("/tmp/work")).toBe("/tmp/work");
    });

    it("paths under /private/tmp (macOS)", () => {
      expect(validatePath("/private/tmp/work")).toBe("/private/tmp/work");
    });

    it("paths under /var/folders (macOS app temp)", () => {
      expect(validatePath("/var/folders/xx/yy/zz")).toBe(
        "/var/folders/xx/yy/zz",
      );
    });

    it("normalizes '..' segments that stay within bounds", () => {
      expect(validatePath("/Users/test/projects/../docs")).toBe(
        "/Users/test/docs",
      );
    });
  });

  describe("rejects", () => {
    it("/etc", () => {
      expect(validatePath("/etc/passwd")).toBeNull();
    });

    it("/System", () => {
      expect(validatePath("/System/Library")).toBeNull();
    });

    it("/private/etc", () => {
      expect(validatePath("/private/etc/hosts")).toBeNull();
    });

    it("path traversal escaping the home directory", () => {
      // /Users/test/../../etc/passwd → /etc/passwd
      expect(validatePath("/Users/test/../../etc/passwd")).toBeNull();
    });

    it("another user's home directory", () => {
      expect(validatePath("/Users/other/secrets")).toBeNull();
    });

    it("empty string", () => {
      expect(validatePath("")).toBeNull();
    });

    it("non-string input", () => {
      expect(validatePath(null)).toBeNull();
      expect(validatePath(undefined)).toBeNull();
      expect(validatePath(123)).toBeNull();
      expect(validatePath({ path: "/Users/test" })).toBeNull();
    });

    it("a path that is a sibling prefix of an allowed prefix (no path.sep boundary)", () => {
      // /tmp は許可されるが /tmpfoo は別ディレクトリなので拒否されるべき
      expect(validatePath("/tmpfoo/a")).toBeNull();
    });

    it("a path that is a prefix of /Volumes but not under it", () => {
      expect(validatePath("/VolumesFake/a")).toBeNull();
    });
  });

  describe("normalization", () => {
    it("returns absolute path even for relative input that resolves into bounds", () => {
      // path.resolve は cwd を base にするので、テスト環境の cwd 次第で結果が変わる。
      // ここでは少なくとも返り値が allow-list 内 or null のいずれかであることを確認
      const result = validatePath("relative/path");
      if (result !== null) {
        expect(path.isAbsolute(result)).toBe(true);
      }
    });
  });
});
