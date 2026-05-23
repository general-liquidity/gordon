import { describe, expect, test } from "bun:test";
import { estimateLatencyCost, formatLatencyCost } from "./latency-cost.ts";

describe("estimateLatencyCost", () => {
  test("low latency on small commission → negligible", () => {
    const r = estimateLatencyCost({
      annualizedVolatility: 0.25,
      bidAskSpread: 0.01,
      latencyMs: 1,
      timeHorizonSeconds: 10,
      commissionPerShare: 0.005,
    });
    expect(r.verdict).toBe("negligible");
    expect(r.latencyCostPerShare).toBeLessThan(0.001);
  });

  test("high latency + small horizon → larger cost", () => {
    const fast = estimateLatencyCost({
      annualizedVolatility: 0.3,
      bidAskSpread: 0.01,
      latencyMs: 1,
      timeHorizonSeconds: 10,
    });
    const slow = estimateLatencyCost({
      annualizedVolatility: 0.3,
      bidAskSpread: 0.01,
      latencyMs: 500,
      timeHorizonSeconds: 10,
    });
    expect(slow.latencyCostPerShare).toBeGreaterThan(fast.latencyCostPerShare);
  });

  test("retail commission dwarfs latency cost → negligible verdict", () => {
    // Retail operator: $10 commission per trade, ~100 shares typical
    // = $0.10 per share commission. Latency cost on a 25% vol asset
    // at 200ms latency over 10s should be tiny vs that.
    const r = estimateLatencyCost({
      annualizedVolatility: 0.25,
      bidAskSpread: 0.01,
      latencyMs: 200,
      timeHorizonSeconds: 10,
      commissionPerShare: 0.10,
    });
    expect(r.verdict).toBe("negligible");
    expect(r.latencyCostAsFractionOfCommission).toBeLessThan(0.01);
  });

  test("higher volatility raises cost monotonically", () => {
    const lowVol = estimateLatencyCost({
      annualizedVolatility: 0.1,
      bidAskSpread: 0.01,
      latencyMs: 100,
      timeHorizonSeconds: 10,
    });
    const highVol = estimateLatencyCost({
      annualizedVolatility: 0.5,
      bidAskSpread: 0.01,
      latencyMs: 100,
      timeHorizonSeconds: 10,
    });
    expect(highVol.latencyCostPerShare).toBeGreaterThan(lowVol.latencyCostPerShare);
  });

  test("wider spread → higher cost", () => {
    const tight = estimateLatencyCost({
      annualizedVolatility: 0.25,
      bidAskSpread: 0.01,
      latencyMs: 100,
      timeHorizonSeconds: 10,
    });
    const wide = estimateLatencyCost({
      annualizedVolatility: 0.25,
      bidAskSpread: 0.10,
      latencyMs: 100,
      timeHorizonSeconds: 10,
    });
    expect(wide.latencyCostPerShare).toBeGreaterThan(tight.latencyCostPerShare);
  });

  test("expected drift scales as sqrt(latency)", () => {
    const oneMs = estimateLatencyCost({
      annualizedVolatility: 0.25,
      bidAskSpread: 0.01,
      latencyMs: 1,
      timeHorizonSeconds: 10,
    });
    const hundredMs = estimateLatencyCost({
      annualizedVolatility: 0.25,
      bidAskSpread: 0.01,
      latencyMs: 100,
      timeHorizonSeconds: 10,
    });
    // sqrt(100) = 10x scaling — within tolerance
    const ratio = hundredMs.expectedDriftPerLatencyWindow / oneMs.expectedDriftPerLatencyWindow;
    expect(ratio).toBeGreaterThan(9);
    expect(ratio).toBeLessThan(11);
  });

  test("fraction-of-spread surfaced in output", () => {
    const r = estimateLatencyCost({
      annualizedVolatility: 0.30,
      bidAskSpread: 0.01,
      latencyMs: 200,
      timeHorizonSeconds: 5,
    });
    expect(r.latencyCostAsFractionOfSpread).toBeGreaterThan(0);
  });

  test("scaling constant respected", () => {
    const k1 = estimateLatencyCost({
      annualizedVolatility: 0.25,
      bidAskSpread: 0.01,
      latencyMs: 50,
      timeHorizonSeconds: 10,
      scalingConstant: 1.0,
    });
    const k2 = estimateLatencyCost({
      annualizedVolatility: 0.25,
      bidAskSpread: 0.01,
      latencyMs: 50,
      timeHorizonSeconds: 10,
      scalingConstant: 2.0,
    });
    expect(k2.latencyCostPerShare).toBeCloseTo(k1.latencyCostPerShare * 2, 6);
  });

  test("zero spread doesn't crash", () => {
    const r = estimateLatencyCost({
      annualizedVolatility: 0.25,
      bidAskSpread: 0,
      latencyMs: 50,
      timeHorizonSeconds: 10,
    });
    expect(r).toBeDefined();
    expect(r.latencyCostPerShare).toBe(0);
  });

  test("verdict ladder: negligible → marginal → material → dominant", () => {
    // Without commission, verdict anchors to spread fraction
    const tinyLatency = estimateLatencyCost({
      annualizedVolatility: 0.25,
      bidAskSpread: 0.01,
      latencyMs: 0.001,
      timeHorizonSeconds: 1,
    });
    const hugeLatency = estimateLatencyCost({
      annualizedVolatility: 1.0,
      bidAskSpread: 0.01,
      latencyMs: 1000,
      timeHorizonSeconds: 1,
    });
    expect(tinyLatency.verdict).toBe("negligible");
    expect(["material", "dominant"]).toContain(hugeLatency.verdict);
  });
});

describe("formatLatencyCost", () => {
  test("renders verdict + advisory text on negligible", () => {
    const r = estimateLatencyCost({
      annualizedVolatility: 0.25,
      bidAskSpread: 0.01,
      latencyMs: 1,
      timeHorizonSeconds: 10,
      commissionPerShare: 0.10,
    });
    const text = formatLatencyCost(r);
    expect(text).toContain("Latency Cost");
    expect(text).toContain("NEGLIGIBLE");
    expect(text).toContain("signal quality");
  });
});
