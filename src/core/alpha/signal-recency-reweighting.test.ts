import { describe, expect, test } from "bun:test";
import {
  reweightSignals,
  formatSignalReweighting,
  type SignalPerformance,
} from "./signal-recency-reweighting.ts";

describe("reweightSignals", () => {
  test("empty signals → insufficient_data", () => {
    const r = reweightSignals([]);
    expect(r.verdict).toBe("insufficient_data");
  });

  test("single signal → equal_weighted_fallback", () => {
    const r = reweightSignals([
      { signalId: "A", recentReturns: [0.01, 0.02, -0.01, 0.005, 0.015] },
    ]);
    expect(r.verdict).toBe("equal_weighted_fallback");
    expect(r.weights[0]!.weight).toBe(1);
  });

  test("equal-performance signals → near-equal weights", () => {
    const signals: SignalPerformance[] = [
      { signalId: "A", recentReturns: [0.01, 0.01, 0.01, 0.01, 0.01] },
      { signalId: "B", recentReturns: [0.01, 0.01, 0.01, 0.01, 0.01] },
      { signalId: "C", recentReturns: [0.01, 0.01, 0.01, 0.01, 0.01] },
    ];
    const r = reweightSignals(signals);
    expect(r.verdict).toBe("reweighted");
    for (const w of r.weights) {
      expect(w.weight).toBeCloseTo(1 / 3, 3);
    }
  });

  test("better recent performance → higher weight", () => {
    const signals: SignalPerformance[] = [
      { signalId: "WINNER", recentReturns: [0.05, 0.03, 0.04, 0.06, 0.02] },
      { signalId: "AVG", recentReturns: [0.01, 0.0, 0.01, -0.01, 0.02] },
      { signalId: "LOSER", recentReturns: [-0.03, -0.02, -0.05, -0.01, -0.04] },
    ];
    const r = reweightSignals(signals);
    const winner = r.weights.find((w) => w.signalId === "WINNER")!;
    const loser = r.weights.find((w) => w.signalId === "LOSER")!;
    expect(winner.weight).toBeGreaterThan(loser.weight);
    expect(winner.relativeToEqualWeight).toBeGreaterThan(1);
    expect(loser.relativeToEqualWeight).toBeLessThan(1);
  });

  test("weights always sum to 1", () => {
    const signals: SignalPerformance[] = [
      { signalId: "A", recentReturns: [0.05, 0.03, 0.04, 0.06, 0.02] },
      { signalId: "B", recentReturns: [0.01, 0.0, 0.01, -0.01, 0.02] },
      { signalId: "C", recentReturns: [-0.03, -0.02, -0.05, -0.01, -0.04] },
      { signalId: "D", recentReturns: [0.02, 0.01, 0.03, 0.02, 0.01] },
    ];
    const r = reweightSignals(signals);
    const validSum = r.weights.filter((w) => w.weight > 0).reduce((s, w) => s + w.weight, 0);
    expect(validSum).toBeCloseTo(1, 5);
  });

  test("higher strength = larger weight spread", () => {
    const signals: SignalPerformance[] = [
      { signalId: "WINNER", recentReturns: [0.05, 0.05, 0.05, 0.05, 0.05] },
      { signalId: "LOSER", recentReturns: [-0.05, -0.05, -0.05, -0.05, -0.05] },
    ];
    const mild = reweightSignals(signals, { strength: 0.1, maxWeight: 0.95 });
    const aggressive = reweightSignals(signals, { strength: 2.0, maxWeight: 0.95 });
    const mildSpread =
      mild.weights.find((w) => w.signalId === "WINNER")!.weight -
      mild.weights.find((w) => w.signalId === "LOSER")!.weight;
    const aggressiveSpread =
      aggressive.weights.find((w) => w.signalId === "WINNER")!.weight -
      aggressive.weights.find((w) => w.signalId === "LOSER")!.weight;
    expect(aggressiveSpread).toBeGreaterThan(mildSpread);
  });

  test("strength = 0 → equal weights regardless of performance", () => {
    const signals: SignalPerformance[] = [
      { signalId: "WINNER", recentReturns: [0.05, 0.05, 0.05, 0.05, 0.05] },
      { signalId: "LOSER", recentReturns: [-0.05, -0.05, -0.05, -0.05, -0.05] },
    ];
    const r = reweightSignals(signals, { strength: 0 });
    for (const w of r.weights) {
      expect(w.weight).toBeCloseTo(0.5, 3);
    }
  });

  test("sharpe metric works", () => {
    // Both positive mean but HIGH has much lower volatility → higher Sharpe
    const signals: SignalPerformance[] = [
      { signalId: "HIGH_SHARPE", recentReturns: [0.02, 0.015, 0.02, 0.015, 0.02] },
      { signalId: "LOW_SHARPE", recentReturns: [0.08, -0.06, 0.08, -0.06, 0.04] },
    ];
    const r = reweightSignals(signals, { metric: "sharpe", maxWeight: 0.95 });
    const high = r.weights.find((w) => w.signalId === "HIGH_SHARPE")!;
    const low = r.weights.find((w) => w.signalId === "LOW_SHARPE")!;
    expect(high.weight).toBeGreaterThan(low.weight);
  });

  test("hit_rate metric works", () => {
    const signals: SignalPerformance[] = [
      { signalId: "HIGH_HIT", recentReturns: [0.01, 0.01, 0.01, 0.01, 0.01] }, // 100%
      { signalId: "MID_HIT", recentReturns: [0.01, 0.01, -0.01, 0.01, 0.01] }, // 80%
      { signalId: "LOW_HIT", recentReturns: [-0.01, -0.01, -0.01, -0.01, 0.01] }, // 20%
    ];
    const r = reweightSignals(signals, { metric: "hit_rate" });
    const high = r.weights.find((w) => w.signalId === "HIGH_HIT")!;
    const low = r.weights.find((w) => w.signalId === "LOW_HIT")!;
    expect(high.weight).toBeGreaterThan(low.weight);
    expect(high.relativeToEqualWeight).toBeGreaterThan(1);
  });

  test("min/max weight floor/ceiling respected", () => {
    const signals: SignalPerformance[] = [
      { signalId: "WINNER", recentReturns: [1, 1, 1, 1, 1] }, // huge mean
      { signalId: "LOSER", recentReturns: [-1, -1, -1, -1, -1] },
    ];
    const r = reweightSignals(signals, {
      strength: 10,
      minWeight: 0.1,
      maxWeight: 0.7,
    });
    for (const w of r.weights) {
      expect(w.weight).toBeGreaterThanOrEqual(0.1 - 0.001);
      expect(w.weight).toBeLessThanOrEqual(0.7 + 0.001);
    }
  });

  test("invalid signals (insufficient periods) get zero weight", () => {
    const signals: SignalPerformance[] = [
      { signalId: "GOOD", recentReturns: [0.01, 0.02, 0.01, 0.02, 0.01] },
      { signalId: "TOO_FEW", recentReturns: [0.01, 0.02] },
    ];
    const r = reweightSignals(signals, { minPeriodsPerSignal: 5 });
    expect(r.verdict).toBe("equal_weighted_fallback");
  });

  test("Scott's default strength (0.13) produces modest reweighting", () => {
    const signals: SignalPerformance[] = [
      { signalId: "STRONG_WINNER", recentReturns: [0.05, 0.05, 0.05, 0.05, 0.05] },
      { signalId: "NEUTRAL", recentReturns: [0, 0, 0, 0, 0] },
      { signalId: "STRONG_LOSER", recentReturns: [-0.05, -0.05, -0.05, -0.05, -0.05] },
    ];
    const r = reweightSignals(signals);
    const winner = r.weights.find((w) => w.signalId === "STRONG_WINNER")!;
    const loser = r.weights.find((w) => w.signalId === "STRONG_LOSER")!;
    // At strength 0.13, the spread should be modest — not full softmax extremes
    expect(winner.weight).toBeLessThan(0.6);
    expect(loser.weight).toBeGreaterThan(0.15);
  });
});

describe("formatSignalReweighting", () => {
  test("renders weights table", () => {
    const signals: SignalPerformance[] = [
      { signalId: "A", recentReturns: [0.05, 0.03, 0.04, 0.06, 0.02] },
      { signalId: "B", recentReturns: [-0.01, -0.02, -0.03, 0.01, -0.01] },
    ];
    const r = reweightSignals(signals);
    const text = formatSignalReweighting(r);
    expect(text).toContain("Signal Reweighting");
    expect(text).toContain("Weights:");
    expect(text).toContain("A");
    expect(text).toContain("B");
  });
});
