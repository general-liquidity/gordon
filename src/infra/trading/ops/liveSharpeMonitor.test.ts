import { describe, expect, it } from "bun:test";
import {
  evaluateLiveSharpe,
  liveSharpeToPayload,
  requiresHumanReview,
  type SignalHealthInput,
} from "./liveSharpeMonitor.ts";

/**
 * Deterministic return series: n points alternating m+d, m-d. Its per-period
 * Sharpe is ~ m / (d * sqrt(n/(n-1))), so we can dial the realized Sharpe.
 */
function alternating(n: number, m: number, d: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(m + (i % 2 === 0 ? d : -d));
  return out;
}

const BALANCED_SIGNAL: SignalHealthInput = {
  observed: { long: 8, short: 8, flat: 4 },
  expected: { long: 0.4, short: 0.4, flat: 0.2 },
};

describe("evaluateLiveSharpe — Sharpe leg", () => {
  it("returns WARMING_UP under the minimum sample size", () => {
    const r = evaluateLiveSharpe({
      strategyId: "s",
      backtestSharpe: 1.5,
      liveReturns: alternating(10, 0.001, 0.01),
    });
    expect(r.status).toBe("WARMING_UP");
    expect(r.sampleSize).toBe(10);
  });

  it("is HEALTHY when live tracks the backtest Sharpe", () => {
    // m/d chosen so per-period Sharpe ~ backtest 1.5 / sqrt(252).
    const r = evaluateLiveSharpe({
      strategyId: "s",
      backtestSharpe: 1.5,
      liveReturns: alternating(30, 0.000945, 0.01),
      signal: BALANCED_SIGNAL,
    });
    expect(r.status).toBe("HEALTHY");
    expect(r.sharpeDegraded).toBe(false);
    expect(Math.abs(r.sharpeZScore)).toBeLessThan(1);
    expect(r.liveSharpe).toBeGreaterThan(1);
  });

  it("escalates to HUMAN_REVIEW on material Sharpe degradation", () => {
    const r = evaluateLiveSharpe({
      strategyId: "s",
      backtestSharpe: 1.5,
      liveReturns: alternating(30, -0.004, 0.01), // losing live, per-period ~ -0.39
      signal: BALANCED_SIGNAL,
    });
    expect(r.sharpeDegraded).toBe(true);
    expect(r.sharpeZScore).toBeLessThanOrEqual(-2);
    expect(r.status).toBe("HUMAN_REVIEW");
    expect(requiresHumanReview(r)).toBe(true);
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it("flags WATCH on mild underperformance short of the breach threshold", () => {
    const r = evaluateLiveSharpe({
      strategyId: "s",
      backtestSharpe: 1.5,
      liveReturns: alternating(30, -0.0018, 0.01), // per-period ~ -0.18, z ~ -1.5
      signal: BALANCED_SIGNAL,
    });
    expect(r.sharpeDegraded).toBe(false);
    expect(r.sharpeZScore).toBeLessThanOrEqual(-1);
    expect(r.status).toBe("WATCH");
  });
});

describe("evaluateLiveSharpe — signal + data legs", () => {
  const healthyReturns = alternating(30, 0.000945, 0.01);

  it("escalates when the direction mix drifts even if Sharpe is fine", () => {
    const r = evaluateLiveSharpe({
      strategyId: "s",
      backtestSharpe: 1.5,
      liveReturns: healthyReturns,
      signal: {
        observed: { long: 20, short: 0, flat: 0 }, // all long, stopped shorting
        expected: { long: 0.4, short: 0.4, flat: 0.2 },
      },
    });
    expect(r.sharpeDegraded).toBe(false);
    expect(r.signalHealthy).toBe(false);
    expect(r.status).toBe("HUMAN_REVIEW");
  });

  it("escalates on trade-frequency drift", () => {
    const r = evaluateLiveSharpe({
      strategyId: "s",
      backtestSharpe: 1.5,
      liveReturns: healthyReturns,
      signal: {
        ...BALANCED_SIGNAL,
        observedTradesPerPeriod: 5,
        expectedTradesPerPeriod: 1,
      },
    });
    expect(r.signalHealthy).toBe(false);
    expect(r.status).toBe("HUMAN_REVIEW");
  });

  it("escalates on stale input data", () => {
    const r = evaluateLiveSharpe({
      strategyId: "s",
      backtestSharpe: 1.5,
      liveReturns: healthyReturns,
      signal: BALANCED_SIGNAL,
      data: { lastBarAgeMs: 60 * 60 * 1000 }, // 1h stale, default max 15m
    });
    expect(r.dataHealthy).toBe(false);
    expect(r.status).toBe("HUMAN_REVIEW");
  });

  it("escalates on input drift score above threshold", () => {
    const r = evaluateLiveSharpe({
      strategyId: "s",
      backtestSharpe: 1.5,
      liveReturns: healthyReturns,
      signal: BALANCED_SIGNAL,
      data: { inputDriftScore: 0.5 },
    });
    expect(r.dataHealthy).toBe(false);
    expect(r.status).toBe("HUMAN_REVIEW");
  });

  it("stays HEALTHY when all three legs pass", () => {
    const r = evaluateLiveSharpe({
      strategyId: "s",
      backtestSharpe: 1.5,
      liveReturns: healthyReturns,
      signal: { ...BALANCED_SIGNAL, observedTradesPerPeriod: 1, expectedTradesPerPeriod: 1 },
      data: { lastBarAgeMs: 1000, missingFraction: 0, inputDriftScore: 0.05 },
    });
    expect(r.status).toBe("HEALTHY");
    expect(r.signalHealthy).toBe(true);
    expect(r.dataHealthy).toBe(true);
  });
});

describe("liveSharpeToPayload + flag", () => {
  it("projects a flat payload", () => {
    const r = evaluateLiveSharpe({
      strategyId: "abc",
      backtestSharpe: 1.5,
      liveReturns: alternating(30, 0.000945, 0.01),
    });
    const p = liveSharpeToPayload(r);
    expect(p.kind).toBe("live_sharpe.evaluated");
    expect(p.strategyId).toBe("abc");
    expect(typeof p.sharpeZScore).toBe("number");
  });
});
