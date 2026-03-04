/**
 * Tests for visual effects utilities
 */

import { describe, test, expect } from "bun:test";
import { sparklineString, sparklineTrend } from "./Sparkline.tsx";
import { getGradientColor, GRADIENTS } from "./GradientText.tsx";

describe("sparklineString", () => {
  test("returns empty string for empty data", () => {
    expect(sparklineString([])).toBe("");
  });

  test("returns single block for single value", () => {
    const result = sparklineString([42]);
    expect(result).toHaveLength(1);
  });

  test("ascending data produces ascending blocks", () => {
    const result = sparklineString([1, 2, 3, 4, 5, 6, 7, 8]);
    // Each character should be >= previous
    for (let i = 1; i < result.length; i++) {
      expect(result.charCodeAt(i)).toBeGreaterThanOrEqual(result.charCodeAt(i - 1));
    }
  });

  test("flat data produces same blocks", () => {
    const result = sparklineString([5, 5, 5, 5]);
    const chars = [...result];
    expect(chars.every((c) => c === chars[0])).toBe(true);
  });

  test("min value gets lowest block, max gets highest", () => {
    const result = sparklineString([0, 100]);
    expect(result[0]).toBe("▁");
    expect(result[1]).toBe("█");
  });

  test("handles negative values", () => {
    const result = sparklineString([-10, -5, 0, 5, 10]);
    expect(result).toHaveLength(5);
    expect(result[0]).toBe("▁");
    expect(result[4]).toBe("█");
  });
});

describe("sparklineTrend", () => {
  test("returns up for ascending data", () => {
    expect(sparklineTrend([10, 12, 15, 20])).toBe("up");
  });

  test("returns down for descending data", () => {
    expect(sparklineTrend([20, 15, 12, 10])).toBe("down");
  });

  test("returns flat for stable data", () => {
    expect(sparklineTrend([100, 100.5, 100.2, 100.1])).toBe("flat");
  });

  test("returns flat for single value", () => {
    expect(sparklineTrend([42])).toBe("flat");
  });

  test("returns flat for empty data", () => {
    expect(sparklineTrend([])).toBe("flat");
  });
});

describe("getGradientColor", () => {
  test("returns first color at t=0", () => {
    const color = getGradientColor(["#ff0000", "#00ff00"], 0);
    expect(color).toBe("#ff0000");
  });

  test("returns last color at t=1", () => {
    const color = getGradientColor(["#ff0000", "#00ff00"], 1);
    expect(color).toBe("#00ff00");
  });

  test("returns midpoint at t=0.5", () => {
    const color = getGradientColor(["#000000", "#ffffff"], 0.5);
    // Should be approximately #808080
    expect(color).toMatch(/^#[0-9a-f]{6}$/);
    // Each channel should be ~128 (0x80)
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    expect(r).toBeGreaterThan(120);
    expect(r).toBeLessThan(136);
    expect(g).toBeGreaterThan(120);
    expect(b).toBeGreaterThan(120);
  });

  test("works with named gradients", () => {
    const color = getGradientColor("GORDON", 0.5);
    expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });

  test("clamps t outside 0-1", () => {
    const at0 = getGradientColor(["#ff0000", "#00ff00"], 0);
    const atNeg = getGradientColor(["#ff0000", "#00ff00"], -5);
    expect(at0).toBe(atNeg);

    const at1 = getGradientColor(["#ff0000", "#00ff00"], 1);
    const at5 = getGradientColor(["#ff0000", "#00ff00"], 5);
    expect(at1).toBe(at5);
  });
});

describe("GRADIENTS", () => {
  test("all named gradients have at least 2 colors", () => {
    for (const [name, colors] of Object.entries(GRADIENTS)) {
      expect(colors.length).toBeGreaterThanOrEqual(2);
    }
  });

  test("all gradient colors are valid hex", () => {
    for (const [name, colors] of Object.entries(GRADIENTS)) {
      for (const color of colors) {
        expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });
});
