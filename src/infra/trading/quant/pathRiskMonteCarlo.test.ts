import { describe, it, expect } from "bun:test";
import {
  makeRng,
  pathMaxDrawdown,
  pathTotalReturn,
  iidBootstrap,
  stationaryBootstrap,
  garchAntitheticPair,
  monteCarloPathRisk,
  pathRiskComparison,
} from "./pathRiskMonteCarlo.ts";

/** Deterministic returns with strong volatility CLUSTERING: calm stretches then a
 *  run of consecutive losses (the serial structure IID resampling destroys). */
function clusteredReturns(n: number, seed: number): number[] {
  const rng = makeRng(seed);
  const out: number[] = [];
  let stressed = false;
  for (let i = 0; i < n; i++) {
    if (rng() < 0.04) stressed = !stressed; // regime flips occasionally → clustering
    if (stressed)
      out.push(-0.02 + (rng() - 0.5) * 0.01); // clustered losses
    else out.push(0.001 + (rng() - 0.5) * 0.004); // calm small gains
  }
  return out;
}

describe("path statistics", () => {
  it("maxDrawdown is a positive fraction; a monotonic-up path has ~0 DD", () => {
    expect(pathMaxDrawdown([0.01, 0.01, 0.01])).toBeCloseTo(0, 6);
    expect(pathMaxDrawdown([0.1, -0.5, 0.1])).toBeGreaterThan(0.4);
  });
  it("totalReturn compounds", () => {
    expect(pathTotalReturn([0.1, 0.1])).toBeCloseTo(0.21, 6);
  });
});

describe("resamplers are deterministic + correct shape", () => {
  const r = [0.01, -0.02, 0.005, -0.01, 0.02, -0.005, 0.001, 0.03];
  it("iid bootstrap: right length, values drawn from the input", () => {
    const path = iidBootstrap(r, 20, makeRng(1));
    expect(path).toHaveLength(20);
    for (const v of path) expect(r).toContain(v);
  });
  it("stationary bootstrap: right length, deterministic for a fixed seed", () => {
    const a = stationaryBootstrap(r, 30, 3, makeRng(7));
    const b = stationaryBootstrap(r, 30, 3, makeRng(7));
    expect(a).toHaveLength(30);
    expect(a).toEqual(b); // same seed → identical
  });
});

describe("monteCarloPathRisk", () => {
  const rets = clusteredReturns(400, 11);
  const cfg = { nPaths: 2000, seed: 99 };

  it("percentiles are ordered (p50 ≤ p95 ≤ p99 ≤ worst for drawdown)", () => {
    const res = monteCarloPathRisk(rets, "stationary", cfg);
    expect(res.drawdownP50).toBeLessThanOrEqual(res.drawdownP95);
    expect(res.drawdownP95).toBeLessThanOrEqual(res.drawdownP99);
    expect(res.drawdownP99).toBeLessThanOrEqual(res.drawdownWorst + 1e-9);
    expect(res.returnP5).toBeLessThanOrEqual(res.returnP50);
    expect(res.returnP50).toBeLessThanOrEqual(res.returnP95);
    expect(res.probRuin).toBeGreaterThanOrEqual(0);
    expect(res.probRuin).toBeLessThanOrEqual(1);
  });

  it("THE KEY RESULT: block bootstrap shows a FATTER tail than IID on clustered returns", () => {
    // The whole point: preserving clustering produces deeper bad-path drawdowns than
    // the optimistic IID resampling that shuffles the losing streaks apart.
    const iid = monteCarloPathRisk(rets, "iid", cfg);
    const block = monteCarloPathRisk(rets, "stationary", { ...cfg, meanBlock: 20 });
    expect(block.drawdownP95).toBeGreaterThan(iid.drawdownP95);
  });

  it("is deterministic for a fixed seed", () => {
    const a = monteCarloPathRisk(rets, "stationary", cfg);
    const b = monteCarloPathRisk(rets, "stationary", cfg);
    expect(a.drawdownP95).toBe(b.drawdownP95);
  });

  it("comparison runs all three methods", () => {
    const cmp = pathRiskComparison(rets, { nPaths: 500, seed: 3 });
    expect(cmp.iid.method).toBe("iid");
    expect(cmp.stationary.method).toBe("stationary");
    expect(cmp.garch.method).toBe("garch");
    for (const m of ["iid", "stationary", "garch"] as const) {
      expect(Number.isFinite(cmp[m].drawdownP95)).toBe(true);
    }
  });
});

describe("antithetic variance reduction (GARCH)", () => {
  const rets = clusteredReturns(400, 23);
  const cfg = { nPaths: 4000, seed: 77 };

  it("the antithetic pair is valid and negatively correlated in total return", () => {
    const rng = makeRng(5);
    const ta: number[] = [];
    const tb: number[] = [];
    for (let p = 0; p < 300; p++) {
      const [a, b] = garchAntitheticPair(rets, 200, rng);
      expect(a).toHaveLength(200);
      expect(a.every(Number.isFinite)).toBe(true);
      expect(b.every(Number.isFinite)).toBe(true);
      ta.push(pathTotalReturn(a));
      tb.push(pathTotalReturn(b));
    }
    // Pearson correlation of paired total returns — antithetic ⇒ negative.
    const mA = ta.reduce((s, x) => s + x, 0) / ta.length;
    const mB = tb.reduce((s, x) => s + x, 0) / tb.length;
    let cov = 0;
    let vA = 0;
    let vB = 0;
    for (let i = 0; i < ta.length; i++) {
      cov += (ta[i]! - mA) * (tb[i]! - mB);
      vA += (ta[i]! - mA) ** 2;
      vB += (tb[i]! - mB) ** 2;
    }
    expect(cov / Math.sqrt(vA * vB)).toBeLessThan(0);
  });

  it("THE KEY RESULT: antithetic cuts the standard error of expectedReturn for the same path count", () => {
    const plain = monteCarloPathRisk(rets, "garch", cfg);
    const anti = monteCarloPathRisk(rets, "garch", { ...cfg, antithetic: true });
    expect(anti.antithetic).toBe(true);
    expect(plain.antithetic).toBe(false);
    // Same number of paths generated, materially lower SE on the mean estimator.
    expect(anti.nPaths).toBe(plain.nPaths);
    expect(anti.returnStdError).toBeLessThan(plain.returnStdError);
    // …and it converges to the same expected return (within a few plain SEs).
    expect(Math.abs(anti.expectedReturn - plain.expectedReturn)).toBeLessThan(
      5 * plain.returnStdError,
    );
  }, 30000);

  it("expected shortfall is a left-tail mean: ES₅ ≤ returnP5 ≤ expectedReturn", () => {
    const res = monteCarloPathRisk(rets, "garch", { ...cfg, antithetic: true });
    expect(res.expectedShortfall5).toBeLessThanOrEqual(res.returnP5 + 1e-12);
    expect(res.returnP5).toBeLessThanOrEqual(res.expectedReturn + 1e-12);
  });

  it("antithetic is deterministic for a fixed seed", () => {
    const a = monteCarloPathRisk(rets, "garch", { ...cfg, antithetic: true });
    const b = monteCarloPathRisk(rets, "garch", { ...cfg, antithetic: true });
    expect(a.returnStdError).toBe(b.returnStdError);
    expect(a.expectedReturn).toBe(b.expectedReturn);
  });

  it("flag is ignored for non-GARCH methods (drawdown distribution unchanged)", () => {
    const off = monteCarloPathRisk(rets, "stationary", cfg);
    const on = monteCarloPathRisk(rets, "stationary", { ...cfg, antithetic: true });
    expect(on.antithetic).toBe(false);
    expect(on.drawdownP95).toBe(off.drawdownP95); // byte-identical — no antithetic for bootstraps
  });
});
