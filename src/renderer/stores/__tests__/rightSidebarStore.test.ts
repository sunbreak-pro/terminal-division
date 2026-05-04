import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  useRightSidebarStore,
  clampRightSidebarWidth,
  effectiveMaxWidth,
  RIGHT_SIDEBAR_WIDTH_BOUNDS,
} from "../rightSidebarStore";

describe("rightSidebarStore", () => {
  beforeEach(() => {
    useRightSidebarStore.setState({
      isOpen: false,
      width: RIGHT_SIDEBAR_WIDTH_BOUNDS.default,
    });
  });

  describe("clampRightSidebarWidth", () => {
    let originalInnerWidth: number;
    beforeEach(() => {
      originalInnerWidth = window.innerWidth;
    });
    afterEach(() => {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      });
    });

    function setWindowWidth(w: number): void {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: w,
      });
    }

    it("returns the default for non-finite input", () => {
      expect(clampRightSidebarWidth(Number.NaN)).toBe(
        RIGHT_SIDEBAR_WIDTH_BOUNDS.default,
      );
      expect(clampRightSidebarWidth(Number.POSITIVE_INFINITY)).toBe(
        RIGHT_SIDEBAR_WIDTH_BOUNDS.default,
      );
    });

    it("clamps to the minimum width when too small", () => {
      setWindowWidth(2000);
      expect(clampRightSidebarWidth(50)).toBe(RIGHT_SIDEBAR_WIDTH_BOUNDS.min);
      expect(clampRightSidebarWidth(0)).toBe(RIGHT_SIDEBAR_WIDTH_BOUNDS.min);
    });

    it("clamps to half the window width when too large", () => {
      setWindowWidth(1600);
      // 1600 * 0.5 = 800
      expect(clampRightSidebarWidth(5000)).toBe(800);
    });

    it("returns the requested width when within bounds", () => {
      setWindowWidth(2000); // max = 1000
      expect(clampRightSidebarWidth(600)).toBe(600);
    });

    it("rounds non-integer widths", () => {
      setWindowWidth(2000);
      expect(clampRightSidebarWidth(500.7)).toBe(501);
    });

    it("never returns a value below the absolute minimum even on tiny windows", () => {
      // ウィンドウが極端に小さくても最小幅は維持する
      setWindowWidth(200);
      expect(clampRightSidebarWidth(500)).toBe(RIGHT_SIDEBAR_WIDTH_BOUNDS.min);
    });
  });

  describe("effectiveMaxWidth", () => {
    afterEach(() => {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: 1024,
      });
    });

    it("returns 50% of the window width", () => {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: 1800,
      });
      expect(effectiveMaxWidth()).toBe(900);
    });

    it("falls back to the absolute maximum when innerWidth is 0", () => {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: 0,
      });
      expect(effectiveMaxWidth()).toBe(RIGHT_SIDEBAR_WIDTH_BOUNDS.max);
    });
  });

  describe("setOpen / toggleOpen", () => {
    it("sets the open state", () => {
      useRightSidebarStore.getState().setOpen(true);
      expect(useRightSidebarStore.getState().isOpen).toBe(true);
    });

    it("toggles the open state", () => {
      useRightSidebarStore.getState().toggleOpen();
      expect(useRightSidebarStore.getState().isOpen).toBe(true);
      useRightSidebarStore.getState().toggleOpen();
      expect(useRightSidebarStore.getState().isOpen).toBe(false);
    });

    it("setOpen is a no-op when value is unchanged", () => {
      const initial = useRightSidebarStore.getState();
      useRightSidebarStore.getState().setOpen(false);
      // 参照同一性で no-op を確認（再レンダー抑止の意図確認）
      expect(useRightSidebarStore.getState()).toBe(initial);
    });
  });

  describe("setWidth", () => {
    let originalInnerWidth: number;
    beforeEach(() => {
      originalInnerWidth = window.innerWidth;
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: 2000,
      });
    });
    afterEach(() => {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      });
    });

    it("sets the width applying the clamp", () => {
      useRightSidebarStore.getState().setWidth(50);
      expect(useRightSidebarStore.getState().width).toBe(
        RIGHT_SIDEBAR_WIDTH_BOUNDS.min,
      );
    });

    it("is a no-op when the clamped value is unchanged", () => {
      useRightSidebarStore.getState().setWidth(600);
      const snapshot = useRightSidebarStore.getState();
      useRightSidebarStore.getState().setWidth(600);
      expect(useRightSidebarStore.getState()).toBe(snapshot);
    });
  });
});
