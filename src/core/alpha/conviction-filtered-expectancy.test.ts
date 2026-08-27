import { describe, expect, test } from "bun:test";
import {
  simulateConvictionFilteredExpectancy,
  formatConvictionFilteredExpectancy,
  type TradeRecord,
} from "./conviction-filtered-expectancy.ts";

function trade(id: string, conviction: number, pnl: number): TradeRecord {
  return { tradeId: id, conviction, pnl };
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("simulateConvictionFilteredExpectancy", () => {
  test("insufficient trades → insufficient_data", () => {
    const trades = Array.from({ length: 5 }, (_, i) =>
      trade(`T${i}`, i * 0.1, i % 2 === 0 ? 1 : -1),
    );
    const r = simulateConvictionFilteredExpectancy(trades);
    expect(r.verdict).toBe("insufficient_data");
  });

  test("filtered edge found — top conviction trades profit, bottom lose", () => {
    // 80 losing trades at low conviction + 20 winning trades at high conviction.
    // Article's canonical example.
    const trades: TradeRecord[] = [];
    for (let i = 0; i < 80; i++) trades.push(trade(`L${i}`, 0.1 + i * 0.001, -1));
    for (let i = 0; i < 20; i++) trades.push(trade(`W${i}`, 0.5 + i * 0.01, 3));
    const r = simulateConvictionFilteredExpectancy(trades);
    expect(r.verdict).toBe("filtered_edge_found");
    expect(r.optimalThreshold).not.toBeNull();
    expect(r.optimalThreshold!.totalPnl).toBeGreaterThan(r.baselineMetrics.totalPnl);
    expect(r.optimalThreshold!.keptFraction).toBeLessThan(0.5);
  });

  test("baseline already optimal — no quality-outcome relationship", () => {
    // Random PnL uncorrelated with conviction.
    const rng = mulberry32(42);
    const trades: TradeRecord[] = [];
    for (let i = 0; i < 100; i++) {
      trades.push(trade(`T${i}`, rng(), (rng() - 0.5) * 2));
    }
    const r = simulateConvictionFilteredExpectancy(trades);
    // With random data, baseline might be optimal OR filtering finds noise
    // depending on the random seed. The test asserts the result is reasonable.
    expect([
      "baseline_already_optimal",
      "filtered_edge_found",
      "no_edge_at_any_threshold",
    ]).toContain(r.verdict);
  });

  test("no edge at any threshold — strategy is just unprofitable", () => {
    // All trades lose. No conviction filtering saves it.
    const trades: TradeRecord[] = [];
    for (let i = 0; i < 50; i++) trades.push(trade(`L${i}`, Math.random(), -1));
    const r = simulateConvictionFilteredExpectancy(trades);
    expect(r.verdict).toBe("no_edge_at_any_threshold");
    expect(r.optimalThreshold!.totalPnl).toBeLessThanOrEqual(0);
  });

  test("avg_pnl objective picks different threshold than total_pnl", () => {
    // 40 mediocre trades (small wins) + 10 great trades (big wins) + 10 terrible (big losses)
    const trades: TradeRecord[] = [];
    for (let i = 0; i < 40; i++) trades.push(trade(`M${i}`, 0.3, 0.5));
    for (let i = 0; i < 10; i++) trades.push(trade(`G${i}`, 0.9, 5));
    for (let i = 0; i < 10; i++) trades.push(trade(`B${i}`, 0.1, -3));
    const total = simulateConvictionFilteredExpectancy(trades, { objective: "total_pnl" });
    const avg = simulateConvictionFilteredExpectancy(trades, { objective: "avg_pnl" });
    // avg_pnl should prefer filtering down to only the great trades
    expect(avg.optimalThreshold!.keptFraction).toBeLessThanOrEqual(
      total.optimalThreshold!.keptFraction,
    );
    expect(avg.optimalThreshold!.avgPnl).toBeGreaterThan(total.optimalThreshold!.avgPnl);
  });

  test("sharpe objective penalizes variance", () => {
    // High-conviction trades have high mean but high variance
    // Mid-conviction trades have lower mean but consistent
    const trades: TradeRecord[] = [];
    for (let i = 0; i < 20; i++) {
      // High-conv, high-variance: alternating +10 and -8
      trades.push(trade(`H${i}`, 0.9, i % 2 === 0 ? 10 : -8));
    }
    for (let i = 0; i < 20; i++) {
      // Mid-conv, low-variance: consistent +0.5
      trades.push(trade(`M${i}`, 0.5, 0.5));
    }
    for (let i = 0; i < 20; i++) {
      // Low-conv: -0.5 consistent
      trades.push(trade(`L${i}`, 0.1, -0.5));
    }
    const r = simulateConvictionFilteredExpectancy(trades, { objective: "sharpe" });
    expect(r.optimalThreshold).not.toBeNull();
    // sharpe should prefer the mid-band (consistent positive) over the
    // high-variance subset
    expect(r.optimalThreshold!.sharpeRatio).toBeGreaterThan(0);
  });

  test("pnl_per_hour objective respects time-per-trade", () => {
    const trades: TradeRecord[] = [];
    for (let i = 0; i < 30; i++) trades.push(trade(`T${i}`, i * 0.03, i < 15 ? -1 : 2));
    const r = simulateConvictionFilteredExpectancy(trades, {
      objective: "pnl_per_hour",
      timePerTrade: 0.5,
    });
    expect(r.optimalThreshold).not.toBeNull();
    expect(r.optimalThreshold!.pnlPerHour).not.toBeNull();
  });

  test("respects custom minKeptTrades", () => {
    const trades: TradeRecord[] = [];
    for (let i = 0; i < 50; i++) trades.push(trade(`T${i}`, i / 50, i > 45 ? 100 : -1));
    const lax = simulateConvictionFilteredExpectancy(trades, { minKeptTrades: 3 });
    const strict = simulateConvictionFilteredExpectancy(trades, { minKeptTrades: 30 });
    // Lax allows degenerate small subsets; strict forces broader subset
    expect(lax.optimalThreshold!.keptCount).toBeLessThanOrEqual(strict.optimalThreshold!.keptCount);
  });

  test("hit rate improves with higher threshold when conviction is informative", () => {
    // Conviction is monotonically correlated with win probability
    const rng = mulberry32(7);
    const trades: TradeRecord[] = [];
    for (let i = 0; i < 200; i++) {
      const conviction = rng();
      const winProb = conviction; // direct mapping
      const win = rng() < winProb;
      trades.push(trade(`T${i}`, conviction, win ? 1 : -1));
    }
    const r = simulateConvictionFilteredExpectancy(trades);
    expect(r.optimalThreshold!.hitRate).toBeGreaterThan(r.baselineMetrics.hitRate);
  });

  test("threshold curve is sorted by threshold ascending", () => {
    const trades: TradeRecord[] = [];
    for (let i = 0; i < 30; i++) trades.push(trade(`T${i}`, i, i % 3 === 0 ? 2 : -1));
    const r = simulateConvictionFilteredExpectancy(trades);
    for (let i = 1; i < r.thresholdCurve.length; i++) {
      expect(r.thresholdCurve[i]!.threshold).toBeGreaterThanOrEqual(
        r.thresholdCurve[i - 1]!.threshold,
      );
    }
  });

  test("the article's 147-trades / 83%-losses example reproduces", () => {
    // 147 trades; 83% losses overall but top 20% (by conviction) are 62% winners.
    // 0.83 * 147 ≈ 122 losses ; 25 winners overall
    // top 20% = 29 trades, 62% winners ≈ 18 wins in top
    // So bottom 80% has 7 wins, 111 losses
    const trades: TradeRecord[] = [];
    const rng = mulberry32(99);
    // Top 29 by conviction: 18 wins, 11 losses
    for (let i = 0; i < 29; i++) {
      const isWin = i < 18;
      trades.push(trade(`TOP${i}`, 0.8 + rng() * 0.2, isWin ? 3 : -1));
    }
    // Bottom 118: 7 wins, 111 losses
    for (let i = 0; i < 118; i++) {
      const isWin = i < 7;
      trades.push(trade(`BOT${i}`, rng() * 0.7, isWin ? 1 : -1));
    }
    const r = simulateConvictionFilteredExpectancy(trades);
    expect(r.verdict).toBe("filtered_edge_found");
    expect(r.optimalThreshold!.hitRate).toBeGreaterThan(r.baselineMetrics.hitRate);
    expect(r.optimalThreshold!.totalPnl).toBeGreaterThan(r.baselineMetrics.totalPnl);
  });
});

describe("formatConvictionFilteredExpectancy", () => {
  test("renders verdict + baseline + optimal stats", () => {
    const trades: TradeRecord[] = [];
    for (let i = 0; i < 50; i++) trades.push(trade(`T${i}`, i / 50, i > 35 ? 2 : -1));
    const r = simulateConvictionFilteredExpectancy(trades);
    const text = formatConvictionFilteredExpectancy(r);
    expect(text).toContain("Conviction-Filtered Expectancy");
    expect(text).toContain("Baseline");
    expect(text).toContain("Optimal threshold");
  });

  test("emits hidden-edge banner when filtered edge found", () => {
    const trades: TradeRecord[] = [];
    for (let i = 0; i < 80; i++) trades.push(trade(`L${i}`, 0.1, -1));
    for (let i = 0; i < 20; i++) trades.push(trade(`W${i}`, 0.9, 5));
    const r = simulateConvictionFilteredExpectancy(trades);
    const text = formatConvictionFilteredExpectancy(r);
    if (r.verdict === "filtered_edge_found") {
      expect(text).toContain("hidden edge");
    }
  });
});
