import { describe, expect, test } from "bun:test";
import {
  analyzeSmtDivergence,
  formatSmtDivergence,
  type AssetSnapshot,
} from "./smt-divergence.ts";

function snap(
  symbol: string,
  windowHigh: number,
  windowLow: number,
  referenceLevel: number,
  adr = 10,
): AssetSnapshot {
  return { symbol, windowHigh, windowLow, referenceLevel, adr };
}

describe("analyzeSmtDivergence", () => {
  test("fewer than 2 assets → insufficient_data", () => {
    const r = analyzeSmtDivergence([snap("NQ", 100, 95, 99)], { direction: "up" });
    expect(r.verdict).toBe("insufficient_data");
  });

  test("all three sweep up → confirmed_sweep", () => {
    const r = analyzeSmtDivergence(
      [
        snap("NQ", 105, 95, 99),
        snap("ES", 104, 95, 99),
        snap("YM", 106, 95, 99),
      ],
      { direction: "up" },
    );
    expect(r.verdict).toBe("confirmed_sweep");
    expect(r.sweptCount).toBe(3);
    expect(r.isolatedSweeper).toBeNull();
  });

  test("classic SMT: NQ sweeps high, ES + YM refuse → divergent_sweep, short", () => {
    const r = analyzeSmtDivergence(
      [
        snap("NQ", 105, 95, 99), // 6 above ref → 0.6 of ADR
        snap("ES", 98, 95, 99), // 1 below ref → -0.1 of ADR, refused
        snap("YM", 97, 90, 99), // 2 below ref → refused
      ],
      { direction: "up" },
    );
    expect(r.verdict).toBe("divergent_sweep");
    expect(r.isolatedSweeper).toBe("NQ");
    expect(r.reversalDirection).toBe("short");
  });

  test("YM sweeps low, NQ + ES refuse → divergent_sweep, long", () => {
    const r = analyzeSmtDivergence(
      [
        snap("NQ", 105, 99, 98), // low 99 above ref 98 → refused
        snap("ES", 104, 99, 98), // refused
        snap("YM", 100, 92, 98), // 6 below ref → swept
      ],
      { direction: "down" },
    );
    expect(r.verdict).toBe("divergent_sweep");
    expect(r.isolatedSweeper).toBe("YM");
    expect(r.reversalDirection).toBe("long");
  });

  test("nobody crosses → no_sweep", () => {
    const r = analyzeSmtDivergence(
      [
        snap("NQ", 98, 95, 99),
        snap("ES", 97, 95, 99),
        snap("YM", 97, 95, 99),
      ],
      { direction: "up" },
    );
    expect(r.verdict).toBe("no_sweep");
    expect(r.sweptCount).toBe(0);
  });

  test("two sweep, one refuses → partial_confirmation", () => {
    const r = analyzeSmtDivergence(
      [
        snap("NQ", 105, 95, 99),
        snap("ES", 104, 95, 99),
        snap("YM", 97, 90, 99),
      ],
      { direction: "up" },
    );
    expect(r.verdict).toBe("partial_confirmation");
    expect(r.sweptCount).toBe(2);
  });

  test("oversized sweep (full breakout) NOT treated as sweep", () => {
    // 30 above ref on ADR of 10 = 3.0 → above maxSweepFraction default 1.5
    const r = analyzeSmtDivergence(
      [
        snap("NQ", 130, 95, 99),
        snap("ES", 96, 90, 99),
        snap("YM", 96, 90, 99),
      ],
      { direction: "up" },
    );
    expect(r.assetStatuses[0]!.swept).toBe(false);
  });

  test("respects custom sweep thresholds", () => {
    const lax = analyzeSmtDivergence(
      [
        snap("NQ", 99.4, 95, 99), // 0.04 of ADR → below default 0.05
        snap("ES", 96, 95, 99),
        snap("YM", 96, 95, 99),
      ],
      { direction: "up", minSweepFraction: 0.01 },
    );
    expect(lax.sweptCount).toBe(1);
  });

  test("two assets — one sweeps, one refuses → divergent_sweep", () => {
    const r = analyzeSmtDivergence(
      [snap("BTC", 110, 95, 99), snap("ETH", 97, 90, 99)],
      { direction: "up" },
    );
    expect(r.verdict).toBe("divergent_sweep");
    expect(r.isolatedSweeper).toBe("BTC");
  });

  test("zero ADR doesn't crash", () => {
    const r = analyzeSmtDivergence(
      [
        { symbol: "X", windowHigh: 100, windowLow: 95, referenceLevel: 99, adr: 0 },
        snap("Y", 100, 95, 99),
      ],
      { direction: "up" },
    );
    expect(r).toBeDefined();
  });
});

describe("formatSmtDivergence", () => {
  test("renders sweep table + isolated sweeper note when divergent", () => {
    const r = analyzeSmtDivergence(
      [
        snap("NQ", 105, 95, 99),
        snap("ES", 98, 95, 99),
        snap("YM", 97, 90, 99),
      ],
      { direction: "up" },
    );
    const text = formatSmtDivergence(r);
    expect(text).toContain("Multi-Asset SMT");
    expect(text).toContain("DIVERGENT_SWEEP");
    expect(text).toContain("Isolated sweeper: NQ");
  });
});
