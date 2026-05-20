import { describe, it, expect } from "bun:test";
import {
  detectTrendlines,
  trendlineDetectionToPayload,
  isTrendlineDetectionEnabled,
  TRENDLINE_DETECTION_FLAG_ENV,
  type PriceBar,
} from "./trendlineDetection.ts";

function flat(n: number, h: number, l: number): PriceBar[] {
  return Array.from({ length: n }, () => ({ high: h, low: l }));
}

function risingLinear(n: number, h0: number, l0: number, dh: number, dl: number): PriceBar[] {
  return Array.from({ length: n }, (_, i) => ({
    high: h0 + dh * i,
    low: l0 + dl * i,
  }));
}

describe("isTrendlineDetectionEnabled", () => {
  it("respects the flag", () => {
    expect(isTrendlineDetectionEnabled({})).toBe(false);
    expect(isTrendlineDetectionEnabled({ [TRENDLINE_DETECTION_FLAG_ENV]: "1" })).toBe(true);
    expect(isTrendlineDetectionEnabled({ [TRENDLINE_DETECTION_FLAG_ENV]: "true" })).toBe(true);
    expect(isTrendlineDetectionEnabled({ [TRENDLINE_DETECTION_FLAG_ENV]: "0" })).toBe(false);
  });
});

describe("detectTrendlines — validation", () => {
  it("rejects fewer than 3 bars", () => {
    expect(() =>
      detectTrendlines({ bars: [{ high: 10, low: 9 }, { high: 11, low: 10 }] }),
    ).toThrow(/at least 3/);
  });

  it("rejects non-finite values", () => {
    expect(() =>
      detectTrendlines({ bars: [{ high: NaN, low: 1 }, { high: 2, low: 1 }, { high: 3, low: 2 }] }),
    ).toThrow(/non-finite/);
  });

  it("rejects low > high", () => {
    expect(() =>
      detectTrendlines({
        bars: [{ high: 5, low: 6 }, { high: 7, low: 6 }, { high: 8, low: 7 }],
      }),
    ).toThrow(/low.*>.*high/);
  });

  it("rejects bad method", () => {
    expect(() =>
      detectTrendlines({
        bars: flat(5, 10, 9),
        method: "ransac" as never,
      }),
    ).toThrow(/method must be/);
  });

  it("rejects minInliers < 2", () => {
    expect(() => detectTrendlines({ bars: flat(5, 10, 9), minInliers: 1 })).toThrow(/minInliers/);
  });

  it("rejects minInliers > bar count", () => {
    expect(() => detectTrendlines({ bars: flat(5, 10, 9), minInliers: 10 })).toThrow(
      /cannot exceed/,
    );
  });

  it("rejects negative touchTolerance", () => {
    expect(() => detectTrendlines({ bars: flat(5, 10, 9), touchTolerance: -0.01 })).toThrow(
      /touchTolerance/,
    );
  });
});

describe("detectTrendlines — flat series", () => {
  it("flat highs and lows → slope 0, r² 1, all bars touch", () => {
    const r = detectTrendlines({ bars: flat(10, 100, 99) });
    expect(r.upper.slope).toBeCloseTo(0, 9);
    expect(r.upper.intercept).toBeCloseTo(100, 9);
    expect(r.upper.rSquared).toBeCloseTo(1, 9);
    expect(r.upper.touchCount).toBe(10);
    expect(r.lower.slope).toBeCloseTo(0, 9);
    expect(r.lower.intercept).toBeCloseTo(99, 9);
    expect(r.lower.touchCount).toBe(10);
  });
});

describe("detectTrendlines — linear trend", () => {
  it("perfectly linear uptrend → slope matches input, r² ≈ 1", () => {
    const r = detectTrendlines({ bars: risingLinear(10, 100, 99, 1, 1), method: "ols" });
    expect(r.upper.slope).toBeCloseTo(1, 9);
    expect(r.upper.rSquared).toBeCloseTo(1, 9);
    expect(r.lower.slope).toBeCloseTo(1, 9);
    expect(r.upper.startValue).toBeCloseTo(100, 9);
    expect(r.upper.endValue).toBeCloseTo(109, 9);
  });

  it("perfectly linear downtrend → negative slope", () => {
    const r = detectTrendlines({ bars: risingLinear(10, 100, 99, -1, -1), method: "ols" });
    expect(r.upper.slope).toBeCloseTo(-1, 9);
    expect(r.upper.rSquared).toBeCloseTo(1, 9);
  });
});

describe("detectTrendlines — peel_off envelope behavior", () => {
  it("upper line passes through the highest highs only", () => {
    // Bars where most highs are low, but a few are clearly elevated.
    const bars: PriceBar[] = [
      { high: 100, low: 98 },
      { high: 95, low: 90 }, // low bar (should be peeled off)
      { high: 102, low: 100 },
      { high: 94, low: 90 }, // low bar
      { high: 104, low: 102 },
    ];
    const r = detectTrendlines({ bars, method: "peel_off" });
    // peel_off should retain the rising highs (100, 102, 104) → slope ≈ 1
    expect(r.upper.slope).toBeGreaterThan(0);
    expect(r.upper.nInliers).toBeLessThanOrEqual(bars.length);
    expect(r.upper.nInliers).toBeGreaterThanOrEqual(3);
  });

  it("lower line passes through the lowest lows only", () => {
    const bars: PriceBar[] = [
      { high: 100, low: 80 },
      { high: 101, low: 90 }, // high low (should be peeled off)
      { high: 102, low: 82 },
      { high: 103, low: 91 }, // high low
      { high: 104, low: 84 },
    ];
    const r = detectTrendlines({ bars, method: "peel_off" });
    // peel_off should retain the rising lows (80, 82, 84) → slope ≈ 1
    expect(r.lower.slope).toBeGreaterThan(0);
    expect(r.lower.nInliers).toBeLessThanOrEqual(bars.length);
    expect(r.lower.nInliers).toBeGreaterThanOrEqual(3);
  });

  it("peel_off reduces inlier count when there are clear outliers", () => {
    const bars = risingLinear(10, 100, 99, 1, 1);
    // Inject one outlier high
    bars[5] = { high: 90, low: 85 };
    const r = detectTrendlines({ bars, method: "peel_off" });
    expect(r.upper.nInliers).toBeLessThan(10);
  });
});

describe("detectTrendlines — ols vs peel_off divergence", () => {
  it("ols includes all bars; peel_off may exclude outliers", () => {
    const bars = risingLinear(20, 100, 99, 1, 1);
    bars[10] = { high: 80, low: 79 }; // one clear outlier
    const ols = detectTrendlines({ bars, method: "ols" });
    const peel = detectTrendlines({ bars, method: "peel_off" });
    expect(ols.upper.nInliers).toBe(20);
    expect(peel.upper.nInliers).toBeLessThan(20);
    // Both should still detect uptrend (slope > 0)
    expect(ols.upper.slope).toBeGreaterThan(0);
    expect(peel.upper.slope).toBeGreaterThan(0);
  });
});

describe("detectTrendlines — touch counting", () => {
  it("touches respects touchTolerance", () => {
    const bars = flat(5, 100, 99);
    const r1 = detectTrendlines({ bars, touchTolerance: 0.001 });
    expect(r1.upper.touchCount).toBe(5);

    // A slight non-flat series — touch tolerance should determine touch count
    const bars2: PriceBar[] = [
      { high: 100, low: 99 },
      { high: 100.05, low: 99 },
      { high: 100, low: 99 },
      { high: 100.05, low: 99 },
      { high: 100, low: 99 },
    ];
    const tight = detectTrendlines({ bars: bars2, touchTolerance: 0.0001 });
    const loose = detectTrendlines({ bars: bars2, touchTolerance: 0.01 });
    expect(loose.upper.touchCount).toBeGreaterThanOrEqual(tight.upper.touchCount);
  });
});

describe("detectTrendlines — output structure", () => {
  it("returns expected fields", () => {
    const r = detectTrendlines({ bars: risingLinear(5, 100, 99, 1, 1) });
    expect(r.nBars).toBe(5);
    expect(r.method).toBe("peel_off");
    expect(r.reasoning).toContain("trendline");
    expect(r.upper.side).toBe("upper");
    expect(r.lower.side).toBe("lower");
    expect(r.upper.endValue).toBeCloseTo(r.upper.slope * 4 + r.upper.intercept, 9);
  });

  it("rSquared is in [0, 1]", () => {
    const r = detectTrendlines({ bars: risingLinear(10, 100, 99, 1, 1) });
    expect(r.upper.rSquared).toBeGreaterThanOrEqual(0);
    expect(r.upper.rSquared).toBeLessThanOrEqual(1);
    expect(r.lower.rSquared).toBeGreaterThanOrEqual(0);
    expect(r.lower.rSquared).toBeLessThanOrEqual(1);
  });
});

describe("trendlineDetectionToPayload", () => {
  it("emits stable shape", () => {
    const r = detectTrendlines({ bars: risingLinear(5, 100, 99, 1, 1), method: "ols" });
    const p = trendlineDetectionToPayload(r) as {
      kind: string;
      method: string;
      nBars: number;
      upper: Record<string, unknown>;
      lower: Record<string, unknown>;
    };
    expect(p.kind).toBe("trendline.detected");
    expect(p.method).toBe("ols");
    expect(p.nBars).toBe(5);
    expect(p.upper).toBeDefined();
    expect(p.lower).toBeDefined();
  });
});
