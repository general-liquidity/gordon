import { describe, it, expect } from "bun:test";
import {
  permuteOHLCBars,
  barPermutationToPayload,
  type OHLCBar,
} from "./barPermutation.ts";

// Deterministic RNG for synthetic data.
function makeRng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function makeSyntheticOHLC(n: number, seed: number = 42): OHLCBar[] {
  const rng = makeRng(seed);
  const bars: OHLCBar[] = [];
  let prevClose = 100;
  for (let i = 0; i < n; i++) {
    const gap = (rng() - 0.5) * 0.002;
    const open = prevClose * Math.exp(gap);
    const highRel = rng() * 0.01;
    const lowRel = -rng() * 0.01;
    const closeRel = (rng() - 0.5) * 0.01;
    const high = open * Math.exp(Math.max(highRel, closeRel, 0));
    const low = open * Math.exp(Math.min(lowRel, closeRel, 0));
    const close = open * Math.exp(closeRel);
    bars.push({ open, high, low, close });
    prevClose = close;
  }
  return bars;
}

describe("permuteOHLCBars — invariants", () => {
  it("preserves the first bar exactly", () => {
    const bars = makeSyntheticOHLC(50);
    const perm = permuteOHLCBars({ ohlc: bars, seed: 7 });
    expect(perm.ohlc[0]!.open).toBeCloseTo(bars[0]!.open, 10);
    expect(perm.ohlc[0]!.high).toBeCloseTo(bars[0]!.high, 10);
    expect(perm.ohlc[0]!.low).toBeCloseTo(bars[0]!.low, 10);
    expect(perm.ohlc[0]!.close).toBeCloseTo(bars[0]!.close, 10);
  });

  it("preserves the last close exactly (key MCPT invariant)", () => {
    const bars = makeSyntheticOHLC(100);
    const perm = permuteOHLCBars({ ohlc: bars, seed: 13 });
    const origLastClose = bars[bars.length - 1]!.close;
    const permLastClose = perm.ohlc[perm.ohlc.length - 1]!.close;
    expect(permLastClose).toBeCloseTo(origLastClose, 8);
  });

  it("preserves length", () => {
    const bars = makeSyntheticOHLC(75);
    const perm = permuteOHLCBars({ ohlc: bars, seed: 1 });
    expect(perm.ohlc.length).toBe(bars.length);
  });

  it("preserves bars before startIndex", () => {
    const bars = makeSyntheticOHLC(60);
    const startIndex = 25;
    const perm = permuteOHLCBars({ ohlc: bars, startIndex, seed: 99 });
    for (let i = 0; i <= startIndex; i++) {
      expect(perm.ohlc[i]!.open).toBeCloseTo(bars[i]!.open, 10);
      expect(perm.ohlc[i]!.close).toBeCloseTo(bars[i]!.close, 10);
    }
  });

  it("each bar has high >= max(open, close) and low <= min(open, close)", () => {
    const bars = makeSyntheticOHLC(80);
    const perm = permuteOHLCBars({ ohlc: bars, seed: 22 });
    for (const b of perm.ohlc) {
      expect(b.high).toBeGreaterThanOrEqual(Math.max(b.open, b.close) - 1e-9);
      expect(b.low).toBeLessThanOrEqual(Math.min(b.open, b.close) + 1e-9);
    }
  });
});

describe("permuteOHLCBars — destroys ordering", () => {
  it("produces a path different from the original", () => {
    const bars = makeSyntheticOHLC(100);
    const perm = permuteOHLCBars({ ohlc: bars, seed: 5 });
    // Some middle bar should differ
    let anyDifferent = false;
    for (let i = 10; i < 90; i++) {
      if (Math.abs(perm.ohlc[i]!.close - bars[i]!.close) > 1e-6) {
        anyDifferent = true;
        break;
      }
    }
    expect(anyDifferent).toBe(true);
  });
});

describe("permuteOHLCBars — determinism", () => {
  it("same seed → identical permutation", () => {
    const bars = makeSyntheticOHLC(60);
    const a = permuteOHLCBars({ ohlc: bars, seed: 42 });
    const b = permuteOHLCBars({ ohlc: bars, seed: 42 });
    for (let i = 0; i < a.ohlc.length; i++) {
      expect(a.ohlc[i]!.close).toBeCloseTo(b.ohlc[i]!.close, 12);
    }
  });

  it("different seeds → different permutations", () => {
    const bars = makeSyntheticOHLC(60);
    const a = permuteOHLCBars({ ohlc: bars, seed: 1 });
    const b = permuteOHLCBars({ ohlc: bars, seed: 2 });
    let anyDifferent = false;
    for (let i = 5; i < a.ohlc.length; i++) {
      if (Math.abs(a.ohlc[i]!.close - b.ohlc[i]!.close) > 1e-6) {
        anyDifferent = true;
        break;
      }
    }
    expect(anyDifferent).toBe(true);
  });
});

describe("permuteOHLCBars — validation", () => {
  it("throws on negative startIndex", () => {
    expect(() =>
      permuteOHLCBars({ ohlc: makeSyntheticOHLC(10), startIndex: -1 }),
    ).toThrow();
  });

  it("throws on series too short for startIndex", () => {
    expect(() =>
      permuteOHLCBars({ ohlc: makeSyntheticOHLC(5), startIndex: 10 }),
    ).toThrow();
  });

  it("throws on non-positive prices", () => {
    expect(() =>
      permuteOHLCBars({
        ohlc: [
          { open: 100, high: 101, low: 99, close: 100 },
          { open: 0, high: 100, low: 100, close: 100 },
        ],
      }),
    ).toThrow();
  });

  it("throws on high < low", () => {
    expect(() =>
      permuteOHLCBars({
        ohlc: [
          { open: 100, high: 101, low: 99, close: 100 },
          { open: 100, high: 99, low: 101, close: 100 },
        ],
      }),
    ).toThrow();
  });
});

describe("permuteOHLCBars — moments", () => {
  it("mean of intra-close log return component is preserved", () => {
    const bars = makeSyntheticOHLC(200);
    const perm = permuteOHLCBars({ ohlc: bars, seed: 33 });
    // Sum of intra-close (log(close) - log(open)) is permutation-invariant,
    // so mean is identical
    let sumOrig = 0;
    let sumPerm = 0;
    for (let i = 1; i < bars.length; i++) {
      sumOrig += Math.log(bars[i]!.close) - Math.log(bars[i]!.open);
      sumPerm += Math.log(perm.ohlc[i]!.close) - Math.log(perm.ohlc[i]!.open);
    }
    expect(sumPerm).toBeCloseTo(sumOrig, 6);
  });
});

describe("barPermutationToPayload", () => {
  it("emits stable shape", () => {
    const bars = makeSyntheticOHLC(20);
    const result = permuteOHLCBars({ ohlc: bars, seed: 1 });
    const p = barPermutationToPayload(result) as { kind: string };
    expect(p.kind).toBe("bar_permutation.computed");
  });
});
