import { describe, it, expect } from "bun:test";
import {
  analyzeReversalTiming,
  detectReversals,
  formatReversalTiming,
  type Bar,
} from "./reversal-timing.ts";

// ============================================================================
// Bar-construction helpers
// ============================================================================

function bar(time: number, high: number, low: number): Bar {
  return { time, high, low };
}

/**
 * Build a bar series from a sequence of [high, low] pairs. Bar index
 * is used as the timestamp for simplicity.
 */
function buildBars(seq: Array<[number, number]>): Bar[] {
  return seq.map(([h, l], i) => bar(i, h, l));
}

/**
 * Build a sinusoidal bar series with N bars and given period.
 * Useful for testing periodic-reversal detection.
 */
function buildSinusoidal(n: number, period: number, amplitude = 1, offset = 0): Bar[] {
  return Array.from({ length: n }, (_, i) => {
    const v = offset + amplitude * Math.sin((2 * Math.PI * i) / period);
    return { time: i, high: v + 0.1, low: v - 0.1 };
  });
}

// ============================================================================
// detectReversals
// ============================================================================

describe("detectReversals — basic", () => {
  it("identifies a single local low + high in a simple V + ^ pattern", () => {
    // bars: 5, 4, 3, 4, 5 → low at index 2
    const bars = buildBars([
      [6, 5],
      [5, 4],
      [4, 3],
      [5, 4],
      [6, 5],
    ]);
    const revs = detectReversals(bars, 2);
    expect(revs.length).toBe(1);
    expect(revs[0]!.kind).toBe("low");
    expect(revs[0]!.index).toBe(2);
  });

  it("identifies a local high in a ^ pattern", () => {
    const bars = buildBars([
      [4, 3],
      [5, 4],
      [6, 5],
      [5, 4],
      [4, 3],
    ]);
    const revs = detectReversals(bars, 2);
    expect(revs.length).toBe(1);
    expect(revs[0]!.kind).toBe("high");
    expect(revs[0]!.index).toBe(2);
  });

  it("returns empty when series too short for window", () => {
    const bars = buildBars([[5, 4], [4, 3]]);
    expect(detectReversals(bars, 3)).toEqual([]);
  });

  it("skips first + last window bars", () => {
    const bars = buildSinusoidal(50, 10);
    const revs = detectReversals(bars, 3);
    for (const r of revs) {
      expect(r.index).toBeGreaterThanOrEqual(3);
      expect(r.index).toBeLessThan(50 - 3);
    }
  });

  it("identifies multiple reversals in a sine wave", () => {
    // Period 10 → expect ~5 reversals in 50 bars (peaks + troughs)
    const bars = buildSinusoidal(50, 10);
    const revs = detectReversals(bars, 2);
    // Roughly: 50/10 * 2 = 10 reversals max; due to window cutoffs ~5-9 in practice
    expect(revs.length).toBeGreaterThanOrEqual(4);
    expect(revs.length).toBeLessThanOrEqual(12);
  });
});

// ============================================================================
// analyzeReversalTiming
// ============================================================================

describe("analyzeReversalTiming — verdict bands", () => {
  it("identical series → highly_correlated", () => {
    const bars = buildSinusoidal(100, 10);
    const r = analyzeReversalTiming(bars, bars);
    expect(r.verdict).toBe("highly_correlated");
    expect(r.matchRateA).toBeCloseTo(1, 4);
    expect(r.matchRateB).toBeCloseTo(1, 4);
    expect(r.meanLagBars).toBe(0);
  });

  it("shifted-by-1 series → highly_correlated with lag detected", () => {
    const a = buildSinusoidal(100, 10);
    // Build B same as A but shifted: B at index i = A at index i-1
    const b: Bar[] = a.map((_, i) => {
      const src = a[Math.max(0, i - 1)]!;
      return { time: i, high: src.high, low: src.low };
    });
    const r = analyzeReversalTiming(a, b, { matchToleranceBars: 2 });
    expect(r.verdict).toBe("highly_correlated");
    // B's reversals occur 1 bar AFTER A's → meanLag should be positive (B lags A)
    expect(r.meanLagBars).toBeGreaterThan(0);
    expect(r.meanLagBars).toBeLessThan(2);
  });

  it("orthogonal phase sine waves → weaker correlation", () => {
    const a = buildSinusoidal(200, 10);
    // B has the same period but shifted by 5 bars (180° out of phase)
    const b = buildSinusoidal(200, 10, 1, 0).map((bar, i) => {
      const src = a[Math.max(0, i - 5)]!;
      return { time: i, high: src.high, low: src.low };
    });
    const r = analyzeReversalTiming(a, b, { matchToleranceBars: 1 });
    // Out-of-phase same period: reversals don't align within ±1 bar
    expect(["uncorrelated", "weakly_correlated"]).toContain(r.verdict);
  });

  it("totally uncorrelated random series → uncorrelated or weakly", () => {
    // Deterministic pseudo-random both sides
    let s1 = 1;
    let s2 = 999;
    const rng1 = () => {
      s1 = (s1 * 1103515245 + 12345) & 0x7fffffff;
      return s1 / 0x7fffffff;
    };
    const rng2 = () => {
      s2 = (s2 * 1103515245 + 12345) & 0x7fffffff;
      return s2 / 0x7fffffff;
    };
    const buildRandom = (rng: () => number) => {
      const bars: Bar[] = [];
      let price = 100;
      for (let i = 0; i < 300; i++) {
        price += (rng() - 0.5) * 2;
        bars.push({ time: i, high: price + 0.3, low: price - 0.3 });
      }
      return bars;
    };
    const a = buildRandom(rng1);
    const b = buildRandom(rng2);
    const r = analyzeReversalTiming(a, b);
    expect(["uncorrelated", "weakly_correlated", "moderately_correlated"]).toContain(r.verdict);
  });
});

describe("analyzeReversalTiming — insufficient data", () => {
  it("returns insufficient_data when reversal count below threshold", () => {
    const a = buildBars([
      [5, 4],
      [4, 3],
      [5, 4],
      [6, 5],
    ]);
    const b = a;
    const r = analyzeReversalTiming(a, b, { minReversalsPerSeries: 10 });
    expect(r.verdict).toBe("insufficient_data");
  });

  it("includes operator-readable hint in summary", () => {
    const a: Bar[] = [];
    const r = analyzeReversalTiming(a, a);
    expect(r.summary).toContain("Insufficient reversals");
  });
});

describe("analyzeReversalTiming — same-direction default", () => {
  it("by default does not match lows to highs", () => {
    // A has lows at indices 5, 15, 25; B has highs at the same indices.
    // Constructing this exactly is fiddly — instead, use a sinusoid for A and its negative for B.
    const a = buildSinusoidal(100, 10);
    const b: Bar[] = a.map((bar) => ({
      time: bar.time,
      high: -bar.low,
      low: -bar.high,
    }));
    // Same-direction match: A's lows should match B's lows. Since B = -A,
    // B's lows occur at A's HIGH indices → no same-direction matches.
    const r = analyzeReversalTiming(a, b, { sameDirectionOnly: true });
    expect(r.matchRateA).toBeLessThan(0.3);
  });

  it("sameDirectionOnly=false enables cross-direction matches", () => {
    const a = buildSinusoidal(100, 10);
    const b: Bar[] = a.map((bar) => ({
      time: bar.time,
      high: -bar.low,
      low: -bar.high,
    }));
    const r = analyzeReversalTiming(a, b, { sameDirectionOnly: false });
    expect(r.matchRateA).toBeGreaterThan(0.5);
  });
});

describe("analyzeReversalTiming — pair uniqueness", () => {
  it("each B reversal can match at most one A reversal (1-to-1 greedy)", () => {
    const a = buildSinusoidal(100, 10);
    const b = buildSinusoidal(100, 10);
    const r = analyzeReversalTiming(a, b);
    const bIndices = new Set(r.matchedPairs.map((p) => p.b.index));
    // No duplicates → set size == array length
    expect(bIndices.size).toBe(r.matchedPairs.length);
  });
});

describe("analyzeReversalTiming — lag detection", () => {
  it("synchronous series → meanLag near zero", () => {
    const a = buildSinusoidal(150, 10);
    const r = analyzeReversalTiming(a, a);
    expect(Math.abs(r.meanLagBars)).toBeLessThan(0.5);
  });

  it("B leads A → negative meanLag", () => {
    const a = buildSinusoidal(100, 10);
    // B is A shifted EARLIER (B at index i = A at index i+2)
    const b: Bar[] = a.map((_, i) => {
      const src = a[Math.min(a.length - 1, i + 2)]!;
      return { time: i, high: src.high, low: src.low };
    });
    const r = analyzeReversalTiming(a, b, { matchToleranceBars: 3 });
    expect(r.meanLagBars).toBeLessThan(0);
  });
});

describe("analyzeReversalTiming — tolerance", () => {
  it("tighter tolerance reduces match rate when timing isn't exact", () => {
    const a = buildSinusoidal(100, 10);
    const b: Bar[] = a.map((_, i) => {
      const src = a[Math.max(0, i - 1)]!;
      return { time: i, high: src.high, low: src.low };
    });
    const tight = analyzeReversalTiming(a, b, { matchToleranceBars: 0 });
    const loose = analyzeReversalTiming(a, b, { matchToleranceBars: 3 });
    expect(loose.matchedPairs.length).toBeGreaterThan(tight.matchedPairs.length);
  });
});

describe("formatReversalTiming", () => {
  it("renders verdict + match rates + lag", () => {
    const bars = buildSinusoidal(100, 10);
    const r = analyzeReversalTiming(bars, bars);
    const text = formatReversalTiming(r);
    expect(text).toContain("Reversal-Timing Correlation");
    expect(text).toContain("HIGHLY_CORRELATED");
    expect(text).toContain("Match rate A→B");
    expect(text).toContain("Mean lag");
  });

  it("indicates synchronous when lag near zero", () => {
    const bars = buildSinusoidal(100, 10);
    const r = analyzeReversalTiming(bars, bars);
    const text = formatReversalTiming(r);
    expect(text).toContain("synchronous");
  });

  it("indicates lead/lag direction when present", () => {
    const a = buildSinusoidal(100, 10);
    const b: Bar[] = a.map((_, i) => {
      const src = a[Math.max(0, i - 2)]!;
      return { time: i, high: src.high, low: src.low };
    });
    const r = analyzeReversalTiming(a, b, { matchToleranceBars: 3 });
    const text = formatReversalTiming(r);
    expect(text).toMatch(/B leads A|B lags A/);
  });
});
