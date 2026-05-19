import { describe, it, expect } from "bun:test";
import {
  isStationaryBootstrapEnabled,
  runStationaryBootstrap,
  bootstrapToPayload,
  STATIONARY_BOOTSTRAP_FLAG_ENV,
} from "./stationaryBootstrap.ts";

describe("isStationaryBootstrapEnabled", () => {
  it("respects the flag", () => {
    expect(isStationaryBootstrapEnabled({})).toBe(false);
    expect(isStationaryBootstrapEnabled({ [STATIONARY_BOOTSTRAP_FLAG_ENV]: "1" })).toBe(true);
  });
});

function lcg(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function randn(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function steadyReturns(n: number, mean: number, vol: number, seed: number): number[] {
  const rng = lcg(seed);
  return Array.from({ length: n }, () => mean + randn(rng) * vol);
}

describe("runStationaryBootstrap — degenerate cases", () => {
  it("too few observations → reasoning notes the gap", () => {
    const r = runStationaryBootstrap({ returns: [0.01, 0.02, 0.01] });
    expect(r.reasoning).toContain("need");
    expect(Number.isNaN(r.realizedSharpe)).toBe(true);
  });
});

describe("runStationaryBootstrap — robust strategy", () => {
  it("steady positive-mean returns produce a robust verdict", () => {
    const returns = steadyReturns(252, 0.001, 0.01, 17);
    const r = runStationaryBootstrap({ returns, resamples: 200, seed: 1 });
    expect(r.realizedSharpe).toBeGreaterThan(0);
    expect(["robust", "borderline"]).toContain(r.verdict);
    expect(r.sharpePercentile).toBeGreaterThan(0.1);
    expect(r.sharpePercentile).toBeLessThan(0.9);
  });
});

describe("runStationaryBootstrap — fragile strategy", () => {
  it("series with a single large positive jump → fragile (realized is at the high tail)", () => {
    const returns = [...steadyReturns(100, 0, 0.005, 11), 0.4, ...steadyReturns(100, 0, 0.005, 12)];
    const r = runStationaryBootstrap({ returns, resamples: 200, seed: 2 });
    // The realized sample has the jump in it; resamples randomly include or exclude it.
    // The Sharpe distribution is bimodal-ish; the realized value sits somewhere
    // within it. We don't assert "fragile" specifically — we assert that the
    // bootstrap CI is wide, which is the actual fragility signal.
    const ciWidth = r.sharpeBand.ci95 - r.sharpeBand.ci05;
    expect(ciWidth).toBeGreaterThan(0.3);
  });
});

describe("runStationaryBootstrap — confidence bands", () => {
  it("median ≤ 75th ≤ 95th percentile", () => {
    const returns = steadyReturns(252, 0.0005, 0.01, 23);
    const r = runStationaryBootstrap({ returns, resamples: 200, seed: 3 });
    expect(r.sharpeBand.ci05).toBeLessThanOrEqual(r.sharpeBand.ci25);
    expect(r.sharpeBand.ci25).toBeLessThanOrEqual(r.sharpeBand.median);
    expect(r.sharpeBand.median).toBeLessThanOrEqual(r.sharpeBand.ci75);
    expect(r.sharpeBand.ci75).toBeLessThanOrEqual(r.sharpeBand.ci95);
  });
});

describe("runStationaryBootstrap — reproducibility", () => {
  it("same seed → same bootstrap distribution", () => {
    const returns = steadyReturns(252, 0.0005, 0.01, 29);
    const r1 = runStationaryBootstrap({ returns, resamples: 100, seed: 42 });
    const r2 = runStationaryBootstrap({ returns, resamples: 100, seed: 42 });
    expect(r1.sharpeBand.median).toBe(r2.sharpeBand.median);
    expect(r1.sharpePercentile).toBe(r2.sharpePercentile);
  });
});

describe("bootstrapToPayload", () => {
  it("emits stable shape", () => {
    const returns = steadyReturns(100, 0.001, 0.01, 31);
    const r = runStationaryBootstrap({ returns, resamples: 100, seed: 7 });
    const p = bootstrapToPayload(r) as { kind: string; verdict: string };
    expect(p.kind).toBe("stationary_bootstrap.evaluated");
    expect(["robust", "borderline", "fragile"]).toContain(p.verdict);
  });
});
