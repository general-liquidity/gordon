import { describe, it, expect } from "bun:test";

import {
  rebalance,
  simulateDoubleHalfPath,
  formatRebalance,
  rebalanceToPayload,
  TargetWeightSumError,
} from "./shannonsDemonRebalancer.ts";

describe("rebalance — input validation", () => {
  it("throws when target weights don't sum to 1", () => {
    expect(() =>
      rebalance({
        allocations: [{ symbol: "BTC", currentValueUsd: 100 }],
        targets: [{ symbol: "BTC", targetWeight: 0.5 }],
      }),
    ).toThrow(TargetWeightSumError);
  });

  it("tolerates small floating-point drift", () => {
    expect(() =>
      rebalance({
        allocations: [
          { symbol: "BTC", currentValueUsd: 100 },
          { symbol: "USD", currentValueUsd: 100 },
        ],
        targets: [
          { symbol: "BTC", targetWeight: 0.5001 },
          { symbol: "USD", targetWeight: 0.4999 },
        ],
      }),
    ).not.toThrow();
  });
});

describe("rebalance — drift detection", () => {
  it("skips rebalance when drift below threshold", () => {
    const r = rebalance({
      allocations: [
        { symbol: "BTC", currentValueUsd: 100 },
        { symbol: "USD", currentValueUsd: 100 },
      ],
      targets: [
        { symbol: "BTC", targetWeight: 0.5 },
        { symbol: "USD", targetWeight: 0.5 },
      ],
    });
    expect(r.triggered).toBe(false);
    expect(r.maxDrift).toBe(0);
    expect(r.reason).toContain("no action");
  });

  it("triggers when drift exceeds threshold", () => {
    const r = rebalance({
      allocations: [
        { symbol: "BTC", currentValueUsd: 200 },
        { symbol: "USD", currentValueUsd: 100 },
      ],
      targets: [
        { symbol: "BTC", targetWeight: 0.5 },
        { symbol: "USD", targetWeight: 0.5 },
      ],
    });
    expect(r.triggered).toBe(true);
    expect(r.maxDrift).toBeCloseTo(1 / 6, 2);
  });

  it("respects custom minDriftToRebalance", () => {
    const lax = rebalance({
      allocations: [
        { symbol: "BTC", currentValueUsd: 110 },
        { symbol: "USD", currentValueUsd: 100 },
      ],
      targets: [
        { symbol: "BTC", targetWeight: 0.5 },
        { symbol: "USD", targetWeight: 0.5 },
      ],
      minDriftToRebalance: 0.01,
    });
    expect(lax.triggered).toBe(true);
  });
});

describe("rebalance — trade math", () => {
  it("computes sell+buy deltas that restore target weights", () => {
    const r = rebalance({
      allocations: [
        { symbol: "BTC", currentValueUsd: 200 },
        { symbol: "USD", currentValueUsd: 100 },
      ],
      targets: [
        { symbol: "BTC", targetWeight: 0.5 },
        { symbol: "USD", targetWeight: 0.5 },
      ],
    });
    expect(r.totalValueUsd).toBe(300);
    const btcTrade = r.trades.find((t) => t.symbol === "BTC")!;
    const usdTrade = r.trades.find((t) => t.symbol === "USD")!;
    expect(btcTrade.deltaUsd).toBeCloseTo(-50, 5);
    expect(usdTrade.deltaUsd).toBeCloseTo(50, 5);
    expect(btcTrade.deltaUsd + usdTrade.deltaUsd).toBeCloseTo(0, 5);
  });

  it("zero total value produces zero-weight rows", () => {
    const r = rebalance({
      allocations: [
        { symbol: "BTC", currentValueUsd: 0 },
        { symbol: "USD", currentValueUsd: 0 },
      ],
      targets: [
        { symbol: "BTC", targetWeight: 0.5 },
        { symbol: "USD", targetWeight: 0.5 },
      ],
    });
    expect(r.totalValueUsd).toBe(0);
    expect(r.trades.every((t) => t.currentWeight === 0)).toBe(true);
  });
});

describe("simulateDoubleHalfPath — Wright Ch 13 exact example", () => {
  it("$100 split 50/50 doubles then halves → $112.50 (+12.5%)", () => {
    const r = simulateDoubleHalfPath(100, 0.5);
    expect(r.finalValueUsd).toBeCloseTo(112.5, 4);
    expect(r.rebalanceReturn).toBeCloseTo(0.125, 4);
  });

  it("100% asset weight → 0% return (no harvesting)", () => {
    const r = simulateDoubleHalfPath(100, 1);
    expect(r.finalValueUsd).toBeCloseTo(100, 4);
  });

  it("0% asset weight → 0% return (no participation)", () => {
    const r = simulateDoubleHalfPath(100, 0);
    expect(r.finalValueUsd).toBeCloseTo(100, 4);
  });

  it("optimal weight for double/half is 50%", () => {
    const w25 = simulateDoubleHalfPath(100, 0.25).rebalanceReturn;
    const w50 = simulateDoubleHalfPath(100, 0.5).rebalanceReturn;
    const w75 = simulateDoubleHalfPath(100, 0.75).rebalanceReturn;
    expect(w50).toBeGreaterThan(w25);
    expect(w50).toBeGreaterThan(w75);
  });
});

describe("formatRebalance + rebalanceToPayload", () => {
  it("formats triggered rebalance", () => {
    const r = rebalance({
      allocations: [
        { symbol: "BTC", currentValueUsd: 200 },
        { symbol: "USD", currentValueUsd: 100 },
      ],
      targets: [
        { symbol: "BTC", targetWeight: 0.5 },
        { symbol: "USD", targetWeight: 0.5 },
      ],
    });
    const out = formatRebalance(r);
    expect(out).toContain("TRIGGERED");
    expect(out).toContain("SELL BTC");
    expect(out).toContain("BUY USD");
  });

  it("formats skipped rebalance", () => {
    const r = rebalance({
      allocations: [
        { symbol: "BTC", currentValueUsd: 100 },
        { symbol: "USD", currentValueUsd: 100 },
      ],
      targets: [
        { symbol: "BTC", targetWeight: 0.5 },
        { symbol: "USD", targetWeight: 0.5 },
      ],
    });
    expect(formatRebalance(r)).toContain("skipped");
  });

  it("payload stable shape", () => {
    const r = rebalance({
      allocations: [
        { symbol: "BTC", currentValueUsd: 200 },
        { symbol: "USD", currentValueUsd: 100 },
      ],
      targets: [
        { symbol: "BTC", targetWeight: 0.5 },
        { symbol: "USD", targetWeight: 0.5 },
      ],
    });
    const p = rebalanceToPayload(r) as { kind: string; triggered: boolean };
    expect(p.kind).toBe("shannons_demon.rebalance");
    expect(p.triggered).toBe(true);
  });
});
