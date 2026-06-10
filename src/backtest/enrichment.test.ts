import { describe, expect, test } from "bun:test";

import { enrichBacktestResult } from "./enrichment.ts";
import { DEFAULT_BACKTEST_PARAMS, type BacktestEngineResult, type BacktestMetrics, type Trade } from "./types.ts";
import type { OptimizationEntry } from "./optimization/overfitting.ts";

const DAY_MS = 86_400_000;
const START = Date.UTC(2026, 0, 1);

function makeTrade(i: number, netPnL: number): Trade {
  return {
    id: `t${i}`,
    side: "LONG",
    entryPrice: 100,
    entryTime: START + i * DAY_MS,
    exitPrice: 100 + netPnL,
    exitTime: START + i * DAY_MS + 12 * 3_600_000,
    quantity: 1,
    grossPnL: netPnL,
    commission: 0,
    netPnL,
    returnPct: netPnL,
    holdingPeriod: 12,
    exitReason: "SIGNAL",
  };
}

function makeMetrics(overrides: Partial<BacktestMetrics> = {}): BacktestMetrics {
  return {
    totalReturn: 25,
    annualizedReturn: 30,
    cagr: 30,
    maxDrawdown: 8,
    sharpeRatio: 1.8,
    sortinoRatio: 2.1,
    volatility: 15,
    calmarRatio: 1.2,
    totalTrades: 30,
    winningTrades: 20,
    losingTrades: 10,
    winRate: 66.7,
    profitFactor: 2.0,
    averageTrade: 50,
    averageWin: 100,
    averageLoss: -50,
    expectancy: 50,
    maxConsecutiveWins: 5,
    maxConsecutiveLosses: 2,
    initialValue: 10_000,
    finalValue: 12_500,
    totalPnl: 2_500,
    netProfit: 2_500,
    totalFees: 30,
    avgTradeDuration: 48,
    maxDrawdownDuration: 5,
    ...overrides,
  };
}

function makeEngineResult(
  overrides: Partial<BacktestEngineResult> = {},
): BacktestEngineResult {
  const trades = Array.from({ length: 30 }, (_, i) =>
    makeTrade(i, i % 3 === 0 ? -50 : 100),
  );
  return {
    strategyId: "test-strategy",
    params: DEFAULT_BACKTEST_PARAMS,
    metrics: makeMetrics(),
    trades,
    equityCurve: [],
    finalCapital: 12_500,
    startDate: START,
    endDate: START + 90 * DAY_MS,
    totalBars: 90 * 24,
    finalPositionClosed: false,
    ...overrides,
  };
}

describe("enrichBacktestResult", () => {
  test("healthy result gets ELIGIBLE verdict + Monte Carlo robustness", async () => {
    const enrichment = await enrichBacktestResult(makeEngineResult(), {
      monteCarlo: { iterations: 200, seed: 42 },
    });

    expect(enrichment.verdict.verdict).toBe("ELIGIBLE");
    expect(enrichment.monteCarlo?.originalTradeCount).toBe(30);
    expect(enrichment.monteCarlo?.config.initialCapital).toBe(
      DEFAULT_BACKTEST_PARAMS.initialCapital,
    );
    expect(enrichment.overfitting).toBeUndefined();
    expect(enrichment.alphaDecay).toBeUndefined();
    expect(enrichment.summaryLines[0]).toContain("[VERDICT] ELIGIBLE");
    expect(enrichment.summaryLines[1]).toContain("[MONTE_CARLO]");
  });

  test("Monte Carlo is seeded-deterministic", async () => {
    const run = () =>
      enrichBacktestResult(makeEngineResult(), {
        monteCarlo: { iterations: 100, seed: 7 },
      });
    const [a, b] = await Promise.all([run(), run()]);
    expect(a.monteCarlo?.returnDistribution.mean).toBe(
      b.monteCarlo?.returnDistribution.mean ?? NaN,
    );
  });

  test("monteCarlo: false skips the simulation", async () => {
    const enrichment = await enrichBacktestResult(makeEngineResult(), {
      monteCarlo: false,
    });
    expect(enrichment.monteCarlo).toBeUndefined();
    expect(enrichment.summaryLines).toHaveLength(1);
  });

  test("zero trades yields CRASH verdict and no Monte Carlo", async () => {
    const enrichment = await enrichBacktestResult(
      makeEngineResult({
        trades: [],
        metrics: makeMetrics({ totalTrades: 0 }),
      }),
    );
    expect(enrichment.verdict.verdict).toBe("CRASH");
    expect(enrichment.monteCarlo).toBeUndefined();
  });

  test("optimization entries trigger overfitting detection", async () => {
    const entries: OptimizationEntry[] = [
      { parameters: { period: 10 }, metrics: makeMetrics(), score: 5.0 },
      { parameters: { period: 14 }, metrics: makeMetrics(), score: 1.0 },
      { parameters: { period: 20 }, metrics: makeMetrics(), score: 0.9 },
      { parameters: { period: 30 }, metrics: makeMetrics(), score: 1.1 },
    ];
    const enrichment = await enrichBacktestResult(makeEngineResult(), {
      monteCarlo: false,
      optimizationEntries: entries,
    });
    expect(enrichment.overfitting?.isLikelyOverfit).toBe(true);
    expect(enrichment.overfitting?.analysis.combinationsTested).toBe(4);
    expect(
      enrichment.summaryLines.some((l) => l.startsWith("[OVERFITTING]")),
    ).toBe(true);
  });

  test("delayed results trigger alpha-decay analysis", async () => {
    const enrichment = await enrichBacktestResult(makeEngineResult(), {
      monteCarlo: false,
      delayedResults: {
        0: { return_pct: 20 },
        1: { return_pct: 19 },
        5: { return_pct: 15 },
        15: { return_pct: 8 },
      },
    });
    expect(enrichment.alphaDecay).toBeDefined();
    if (enrichment.alphaDecay && !("error" in enrichment.alphaDecay)) {
      expect(enrichment.alphaDecay.summary.maxDecayPercent).toBeCloseTo(60, 1);
    } else {
      throw new Error("expected alpha-decay result, got error");
    }
    expect(
      enrichment.summaryLines.some((l) => l.startsWith("[ALPHA_DECAY]")),
    ).toBe(true);
  });

  test("window days derived from engine dates feeds the exposure check", async () => {
    const enrichment = await enrichBacktestResult(
      makeEngineResult({
        endDate: START + 365 * DAY_MS,
        metrics: makeMetrics({ avgTradeDuration: 1, totalTrades: 21 }),
      }),
      { monteCarlo: false },
    );
    expect(enrichment.verdict.verdict).toBe("DISCARD_SAMPLE_SIZE");
    expect(
      enrichment.verdict.violations.some((v) => v.startsWith("exposure")),
    ).toBe(true);
  });
});
