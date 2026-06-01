import { test, expect, describe } from "bun:test";
import { runFeeSensitivitySweep } from "./fee-sensitivity.ts";
import type { FeeSensitivityInput } from "./fee-sensitivity.ts";

describe("runFeeSensitivitySweep", () => {
  // MATH ANCHOR: gross +0.001/trade over 1000 trades.
  // break-even = 0.001 * 1e4 = 10 bps.
  // 9 bps (0.0009): net = +0.0001/trade, still positive, not flipped.
  // 18 bps (0.0018): net = -0.0008/trade, negative, flippedToLoss true.
  const thousandTrades: number[] = Array(1000).fill(0.001);

  const baseInput: FeeSensitivityInput = {
    grossReturns: thousandTrades,
    schedules: [
      { label: "9bps", roundTripBps: 9 },
      { label: "18bps", roundTripBps: 18 },
    ],
  };

  test("returns null on empty trades", () => {
    expect(
      runFeeSensitivitySweep({ grossReturns: [], schedules: [{ label: "x", roundTripBps: 10 }] }),
    ).toBeNull();
  });

  test("returns null on empty schedules", () => {
    expect(runFeeSensitivitySweep({ grossReturns: [0.001], schedules: [] })).toBeNull();
  });

  test("break-even is the gross mean edge in bps (~10 bps)", () => {
    const r = runFeeSensitivitySweep(baseInput)!;
    expect(r).not.toBeNull();
    expect(r.tradeCount).toBe(1000);
    expect(r.grossMeanPerTrade).toBeCloseTo(0.001, 10);
    expect(r.breakEvenRoundTripBps).toBeCloseTo(10, 6);
  });

  test("9 bps schedule: net +0.0001/trade, positive, not flipped", () => {
    const r = runFeeSensitivitySweep(baseInput)!;
    const s9 = r.perSchedule.find((s) => s.label === "9bps")!;
    expect(s9.roundTripBps).toBe(9);
    expect(s9.netMeanPerTrade).toBeCloseTo(0.0001, 10);
    expect(s9.netTotalReturn).toBeGreaterThan(0);
    expect(s9.flippedToLoss).toBe(false);
  });

  test("18 bps schedule: net -0.0008/trade, negative, flipped to loss", () => {
    const r = runFeeSensitivitySweep(baseInput)!;
    const s18 = r.perSchedule.find((s) => s.label === "18bps")!;
    expect(s18.roundTripBps).toBe(18);
    expect(s18.netMeanPerTrade).toBeCloseTo(-0.0008, 10);
    expect(s18.netTotalReturn).toBeLessThan(0);
    expect(s18.flippedToLoss).toBe(true);
  });

  test("maker+taker legs sum into the round-trip cost", () => {
    // maker 3 bps + taker 6 bps = 9 bps round-trip, same as the flat 9bps tier.
    const r = runFeeSensitivitySweep({
      grossReturns: thousandTrades,
      schedules: [{ label: "mk+tk", makerBps: 3, takerBps: 6 }],
    })!;
    const s = r.perSchedule[0]!;
    expect(s.roundTripBps).toBe(9);
    expect(s.netMeanPerTrade).toBeCloseTo(0.0001, 10);
    expect(s.flippedToLoss).toBe(false);
  });

  test("low-frequency 1-bps-edge case barely moves under a sub-bps fee", () => {
    // Gross +0.0001/trade (1 bp edge) over 20 trades. break-even = 1 bp.
    // A 0.5 bp schedule (0.00005) leaves net = +0.00005/trade, still positive.
    const r = runFeeSensitivitySweep({
      grossReturns: Array(20).fill(0.0001),
      schedules: [{ label: "halfbp", roundTripBps: 0.5 }],
    })!;
    expect(r.breakEvenRoundTripBps).toBeCloseTo(1, 6);
    const s = r.perSchedule[0]!;
    expect(s.netMeanPerTrade).toBeCloseTo(0.00005, 12);
    expect(s.flippedToLoss).toBe(false);
  });

  test("high-edge case never flips even under a fat fee schedule", () => {
    // Gross +5%/trade (500 bps edge). break-even = 500 bps.
    // Even a 50 bps round-trip schedule leaves a 450 bps net edge.
    const r = runFeeSensitivitySweep({
      grossReturns: Array(50).fill(0.05),
      schedules: [
        { label: "10bps", roundTripBps: 10 },
        { label: "50bps", roundTripBps: 50 },
      ],
    })!;
    expect(r.breakEvenRoundTripBps).toBeCloseTo(500, 4);
    for (const s of r.perSchedule) {
      expect(s.flippedToLoss).toBe(false);
      expect(s.netMeanPerTrade).toBeGreaterThan(0);
    }
  });

  test("unprofitable-before-fees case is flagged in interpretation, never flipped", () => {
    // Net-negative gross series: flippedToLoss requires gross > 0, so it stays false.
    const r = runFeeSensitivitySweep({
      grossReturns: [-0.01, -0.02, 0.005],
      schedules: [{ label: "10bps", roundTripBps: 10 }],
    })!;
    expect(r.grossTotalReturn).toBeLessThan(0);
    expect(r.perSchedule[0]!.flippedToLoss).toBe(false);
    expect(r.interpretation).toContain("BEFORE fees");
  });

  test("profitFactor and netSharpe are finite numbers", () => {
    const r = runFeeSensitivitySweep(baseInput)!;
    for (const s of r.perSchedule) {
      expect(Number.isFinite(s.profitFactor)).toBe(true);
      expect(Number.isFinite(s.netSharpe)).toBe(true);
    }
  });

  test("all-flip interpretation when every schedule exceeds break-even", () => {
    const r = runFeeSensitivitySweep({
      grossReturns: Array(100).fill(0.001), // break-even 10 bps
      schedules: [
        { label: "12bps", roundTripBps: 12 },
        { label: "20bps", roundTripBps: 20 },
      ],
    })!;
    expect(r.perSchedule.every((s) => s.flippedToLoss)).toBe(true);
    expect(r.interpretation).toContain("ALL");
  });
});
