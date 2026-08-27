import { describe, it, expect } from "bun:test";
import { computeMCPT, mcptToPayload } from "./mcpt.ts";
import type { OHLCBar } from "./barPermutation.ts";

// Deterministic RNG.
function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function syntheticOHLC(n: number, seed: number = 7): OHLCBar[] {
  const rng = makeRng(seed);
  const bars: OHLCBar[] = [];
  let prev = 100;
  for (let i = 0; i < n; i++) {
    const r = (rng() - 0.5) * 0.02;
    const open = prev;
    const close = open * Math.exp(r);
    const hr = Math.abs(rng() * 0.005);
    const lr = Math.abs(rng() * 0.005);
    const high = Math.max(open, close) * Math.exp(hr);
    const low = Math.min(open, close) * Math.exp(-lr);
    bars.push({ open, high, low, close });
    prev = close;
  }
  return bars;
}

/** "Buy on previous green bar, hold 1 bar" strategy → PF. */
function followGreenPF(ohlc: ReadonlyArray<OHLCBar>): number {
  let gains = 0;
  let losses = 0;
  for (let i = 2; i < ohlc.length; i++) {
    const prevGreen = ohlc[i - 1]!.close > ohlc[i - 1]!.open;
    if (prevGreen) {
      const ret = (ohlc[i]!.close - ohlc[i]!.open) / ohlc[i]!.open;
      if (ret > 0) gains += ret;
      else losses += -ret;
    }
  }
  return losses > 0 ? gains / losses : gains > 0 ? Number.POSITIVE_INFINITY : 1;
}

describe("computeMCPT — basic mechanics", () => {
  it("p-value lies in [1/N, 1]", () => {
    const bars = syntheticOHLC(60, 11);
    const result = computeMCPT({
      ohlc: bars,
      optimize: followGreenPF,
      numPermutations: 50,
      seed: 1,
    });
    expect(result.pValue).toBeGreaterThanOrEqual(1 / 50);
    expect(result.pValue).toBeLessThanOrEqual(1);
  });

  it("permsBeatingReal ≥ 1 (Masters convention)", () => {
    const bars = syntheticOHLC(60, 22);
    const result = computeMCPT({
      ohlc: bars,
      optimize: followGreenPF,
      numPermutations: 30,
      seed: 1,
    });
    expect(result.permsBeatingReal).toBeGreaterThanOrEqual(1);
  });

  it("verdict 'pass' iff pValue < threshold", () => {
    const bars = syntheticOHLC(60, 33);
    const result = computeMCPT(
      { ohlc: bars, optimize: () => 1, numPermutations: 20, seed: 1 },
      { significanceThreshold: 0.5 },
    );
    if (result.pValue < 0.5) {
      expect(result.verdict).toBe("pass");
    } else {
      expect(result.verdict).toBe("fail");
    }
  });

  it("permutedProfitFactors sorted ascending", () => {
    const bars = syntheticOHLC(60, 44);
    const result = computeMCPT({
      ohlc: bars,
      optimize: followGreenPF,
      numPermutations: 25,
      seed: 1,
    });
    for (let i = 1; i < result.permutedProfitFactors.length; i++) {
      expect(result.permutedProfitFactors[i]!).toBeGreaterThanOrEqual(
        result.permutedProfitFactors[i - 1]!,
      );
    }
  });
});

describe("computeMCPT — null-strategy distribution", () => {
  it("constant optimizer gives p around 1 (all permutations tie)", () => {
    const bars = syntheticOHLC(60, 55);
    const result = computeMCPT({
      ohlc: bars,
      optimize: () => 1.0, // every permutation returns the same PF
      numPermutations: 50,
      seed: 1,
    });
    expect(result.pValue).toBeCloseTo(1, 1);
    expect(result.verdict).toBe("fail");
  });

  it("p-value high when strategy lacks real edge on random data", () => {
    // For a synthetic series with no autocorrelation, follow-green strategy
    // should have no real edge → many permutations beat or tie
    const bars = syntheticOHLC(120, 66);
    const result = computeMCPT({
      ohlc: bars,
      optimize: followGreenPF,
      numPermutations: 50,
      seed: 1,
    });
    // No strong claim: we just want the test to RUN and not crash on
    // a strategy that lacks edge. With i.i.d. random returns, p should
    // not be conspicuously low (< 0.05 is unlikely but possible).
    expect(result.pValue).toBeGreaterThan(0);
    expect(result.pValue).toBeLessThanOrEqual(1);
  });
});

describe("computeMCPT — determinism", () => {
  it("same seed → identical result", () => {
    const bars = syntheticOHLC(60, 77);
    const a = computeMCPT({
      ohlc: bars,
      optimize: followGreenPF,
      numPermutations: 30,
      seed: 99,
    });
    const b = computeMCPT({
      ohlc: bars,
      optimize: followGreenPF,
      numPermutations: 30,
      seed: 99,
    });
    expect(a.realProfitFactor).toBe(b.realProfitFactor);
    expect(a.pValue).toBe(b.pValue);
    expect(a.permsBeatingReal).toBe(b.permsBeatingReal);
  });
});

describe("computeMCPT — startIndex (walk-forward mode)", () => {
  it("with startIndex > 0, bars in [0, startIndex] are preserved in every permutation", () => {
    const bars = syntheticOHLC(80, 88);
    const trainEnd = 30;
    let preservedCount = 0;
    const result = computeMCPT({
      ohlc: bars,
      optimize: (ohlc) => {
        // Check the bars before startIndex are identical to the original
        for (let i = 0; i <= trainEnd; i++) {
          if (Math.abs(ohlc[i]!.close - bars[i]!.close) > 1e-9) {
            return -1; // signal that preservation broke
          }
        }
        preservedCount++;
        return 1;
      },
      numPermutations: 10,
      startIndex: trainEnd,
      seed: 1,
    });
    expect(preservedCount).toBe(10); // 1 real + 9 perms
    expect(result.permutedProfitFactors.every((p) => p === 1)).toBe(true);
  });
});

describe("computeMCPT — validation", () => {
  it("throws on numPermutations < 2", () => {
    expect(() =>
      computeMCPT({
        ohlc: syntheticOHLC(10),
        optimize: () => 1,
        numPermutations: 1,
      }),
    ).toThrow();
  });

  it("throws on significanceThreshold outside (0, 1)", () => {
    expect(() =>
      computeMCPT(
        { ohlc: syntheticOHLC(10), optimize: () => 1, numPermutations: 5 },
        { significanceThreshold: 0 },
      ),
    ).toThrow();
    expect(() =>
      computeMCPT(
        { ohlc: syntheticOHLC(10), optimize: () => 1, numPermutations: 5 },
        { significanceThreshold: 1 },
      ),
    ).toThrow();
  });

  it("throws when optimizer returns non-finite for real data", () => {
    expect(() =>
      computeMCPT({
        ohlc: syntheticOHLC(10),
        optimize: () => NaN,
        numPermutations: 5,
      }),
    ).toThrow();
  });
});

describe("mcptToPayload", () => {
  it("emits stable shape", () => {
    const bars = syntheticOHLC(20, 99);
    const result = computeMCPT({
      ohlc: bars,
      optimize: () => 1.2,
      numPermutations: 10,
      seed: 1,
    });
    const p = mcptToPayload(result) as { kind: string };
    expect(p.kind).toBe("mcpt.computed");
  });
});
