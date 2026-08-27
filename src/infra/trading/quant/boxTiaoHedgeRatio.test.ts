import { describe, expect, test } from "bun:test";
import { computeBoxTiaoHedgeRatio } from "./boxTiaoHedgeRatio.ts";

/** Deterministic LCG → uniform(0,1). */
function makeLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

/** Box-Muller standard normal from an LCG. */
function makeNormal(seed: number): () => number {
  const u = makeLcg(seed);
  let spare: number | null = null;
  return () => {
    if (spare != null) {
      const s = spare;
      spare = null;
      return s;
    }
    let a = u();
    const b = u();
    if (a < 1e-12) a = 1e-12;
    const r = Math.sqrt(-2 * Math.log(a));
    const theta = 2 * Math.PI * b;
    spare = r * Math.sin(theta);
    return r * Math.cos(theta);
  };
}

function variance(arr: number[]): number {
  const m = arr.reduce((s, x) => s + x, 0) / arr.length;
  let v = 0;
  for (const x of arr) v += (x - m) * (x - m);
  return v / (arr.length - 1);
}

describe("computeBoxTiaoHedgeRatio", () => {
  test("cointegrated pair: spread is far more stationary than either leg", () => {
    const n = 400;
    const rndX = makeNormal(42);
    const rndOu = makeNormal(99);

    const x: number[] = [100];
    for (let t = 1; t < n; t++) x.push(x[t - 1]! + rndX()); // random walk

    // y = x + stationary OU noise (mean-reverting around 0).
    const ou: number[] = [0];
    const phi = 0.7;
    for (let t = 1; t < n; t++) ou.push(phi * ou[t - 1]! + rndOu());
    const y = x.map((xt, t) => xt + 5 + ou[t]!);

    const result = computeBoxTiaoHedgeRatio({ pricesBySymbol: { X: x, Y: y } });

    expect(result.symbols).toEqual(["X", "Y"]);
    expect(result.weights[0]).toBe(1);
    expect(result.sampleSize).toBe(n);

    // Reconstruct the spread from returned weights.
    const spread = x.map((xt, t) => xt * result.weights[0]! + y[t]! * result.weights[1]!);
    const varSpread = variance(spread);
    const varX = variance(x);
    const varY = variance(y);

    // The mean-reverting combination should be far less variable than the
    // individual integrated legs.
    expect(varSpread).toBeLessThan(varX * 0.1);
    expect(varSpread).toBeLessThan(varY * 0.1);

    // And it should have a finite, short-ish half-life.
    expect(result.halfLife).not.toBeNull();
    expect(result.halfLife!).toBeGreaterThan(0);
    expect(result.halfLife!).toBeLessThan(50);
  });

  test("two independent random walks: no short mean-reversion", () => {
    const n = 400;
    const rndA = makeNormal(7);
    const rndB = makeNormal(8123);

    const a: number[] = [50];
    const b: number[] = [50];
    for (let t = 1; t < n; t++) {
      a.push(a[t - 1]! + rndA());
      b.push(b[t - 1]! + rndB());
    }

    const result = computeBoxTiaoHedgeRatio({ pricesBySymbol: { A: a, B: b } });

    const spread = a.map((at, t) => at * result.weights[0]! + b[t]! * result.weights[1]!);
    const varSpread = variance(spread);
    const varA = variance(a);

    // No genuine cointegration → the "best" combination is not dramatically
    // more stationary than a single leg.
    expect(varSpread).toBeGreaterThan(varA * 0.1);

    // Half-life is either undefined or long (slow / no mean reversion).
    if (result.halfLife != null) {
      expect(result.halfLife).toBeGreaterThan(20);
    }
  });

  test("insufficient data → neutral", () => {
    const result = computeBoxTiaoHedgeRatio({
      pricesBySymbol: { A: [1, 2, 3, 4], B: [2, 3, 4, 5] },
    });
    expect(result.predictability).toBe(1);
    expect(result.halfLife).toBeNull();
    expect(result.weights).toEqual([0, 0]);
    expect(result.interpretation).toContain("Neutral");
  });

  test("single symbol → neutral", () => {
    const result = computeBoxTiaoHedgeRatio({ pricesBySymbol: { A: [1, 2, 3] } });
    expect(result.weights).toEqual([0]);
    expect(result.interpretation).toContain("Neutral");
  });
});
