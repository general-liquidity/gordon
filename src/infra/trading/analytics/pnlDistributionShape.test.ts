import { describe, expect, test } from "bun:test";
import {
  computePnlDistributionShape,
  summarizePnlDistributionShape,
} from "./pnlDistributionShape.ts";

describe("computePnlDistributionShape — basic shape", () => {
  test("empty array returns zero-state insufficient_data", () => {
    const shape = computePnlDistributionShape([]);
    expect(shape.count).toBe(0);
    expect(shape.verdict).toBe("insufficient_data");
  });

  test("single value returns insufficient_data", () => {
    const shape = computePnlDistributionShape([0.01]);
    expect(shape.count).toBe(1);
    expect(shape.verdict).toBe("insufficient_data");
  });

  test("below 10 trades returns insufficient_data", () => {
    const shape = computePnlDistributionShape([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(shape.count).toBe(9);
    expect(shape.verdict).toBe("insufficient_data");
  });
});

describe("computePnlDistributionShape — symmetric distribution", () => {
  test("approximately symmetric (Normal-like) returns symmetric", () => {
    // Symmetric distribution around 0
    const data = [-3, -2, -1, -1, 0, 0, 1, 1, 2, 3];
    const shape = computePnlDistributionShape(data);
    expect(shape.count).toBe(10);
    expect(shape.verdict).toBe("symmetric");
    expect(Math.abs(shape.skewness)).toBeLessThan(0.25);
  });

  test("perfectly symmetric — skewness near zero", () => {
    const data = [-5, -4, -3, -2, -1, 1, 2, 3, 4, 5];
    const shape = computePnlDistributionShape(data);
    expect(Math.abs(shape.skewness)).toBeLessThan(0.01);
  });
});

describe("computePnlDistributionShape — long convexity (right-skewed)", () => {
  test("trend-following-like shape", () => {
    // Many small losses, occasional big wins
    const data = [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -0.5, -0.5, -0.5, -0.5, 8, 12];
    const shape = computePnlDistributionShape(data);
    expect(shape.skewness).toBeGreaterThan(0.25);
    expect(shape.verdict).toBe("long_convexity");
  });

  test("min < mean < max with positive skew", () => {
    const data = [-2, -1, -1, -0.5, -0.5, 0, 0, 0.5, 5, 10];
    const shape = computePnlDistributionShape(data);
    expect(shape.min).toBe(-2);
    expect(shape.max).toBe(10);
    expect(shape.skewness).toBeGreaterThan(0);
  });
});

describe("computePnlDistributionShape — short convexity (left-skewed)", () => {
  test("mean-reversion-like shape (lots of small wins, rare big loss)", () => {
    const data = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.3, 0.3, 0.3, 0.3, -8, -12];
    const shape = computePnlDistributionShape(data);
    expect(shape.skewness).toBeLessThan(-0.25);
    expect(shape.verdict).toBe("short_convexity");
  });
});

describe("computePnlDistributionShape — kurtosis", () => {
  test("fat-tailed series has positive excess kurtosis", () => {
    // Mix of moderate values + extreme outliers
    const data = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -10, 10];
    const shape = computePnlDistributionShape(data);
    expect(shape.excessKurtosis).toBeGreaterThan(1);
  });

  test("uniform-like series has negative excess kurtosis", () => {
    const data = Array.from({ length: 20 }, (_, i) => i - 10);
    const shape = computePnlDistributionShape(data);
    expect(shape.excessKurtosis).toBeLessThan(0);
  });
});

describe("summarizePnlDistributionShape", () => {
  test("insufficient_data message", () => {
    const shape = computePnlDistributionShape([1, 2, 3]);
    const summary = summarizePnlDistributionShape(shape);
    expect(summary).toContain("not enough data");
  });

  test("long convexity message", () => {
    const data = [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -0.5, -0.5, -0.5, -0.5, 8, 12];
    const shape = computePnlDistributionShape(data);
    const summary = summarizePnlDistributionShape(shape);
    expect(summary).toContain("long convexity");
    expect(summary).toContain("right tail heavier");
  });

  test("short convexity message", () => {
    const data = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.3, 0.3, 0.3, 0.3, -8, -12];
    const shape = computePnlDistributionShape(data);
    const summary = summarizePnlDistributionShape(shape);
    expect(summary).toContain("short convexity");
    expect(summary).toContain("blow-up");
  });

  test("includes mean and skewness numbers", () => {
    const data = [-3, -2, -1, -1, 0, 0, 1, 1, 2, 3];
    const shape = computePnlDistributionShape(data);
    const summary = summarizePnlDistributionShape(shape);
    expect(summary).toMatch(/mean=/);
    expect(summary).toMatch(/skew=/);
    expect(summary).toMatch(/excess-kurt=/);
  });
});
