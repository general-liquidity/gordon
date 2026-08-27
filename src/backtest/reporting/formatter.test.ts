import { describe, expect, it } from "bun:test";

import { formatBacktestSummary, tradeReturnsPerYear } from "./formatter.ts";
import type { BacktestResult, BacktestTrade } from "../types.ts";

// ---------------------------------------------------------------------------
// Fixture: a backtest with enough trades to trigger the credibility block.
// ---------------------------------------------------------------------------

function trade(i: number, ret: number): BacktestTrade {
  const entryPrice = 100;
  const exitPrice = entryPrice * (1 + ret);
  return {
    id: `t${i}`,
    entryTime: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(),
    exitTime: new Date(Date.UTC(2024, 0, 2 + i)).toISOString(),
    entryPrice,
    exitPrice,
    quantity: 1,
    positionValue: entryPrice,
    side: "LONG",
    pnl: exitPrice - entryPrice,
    pnlPercent: ret * 100,
    fees: 0,
    exitReason: "SIGNAL",
  };
}

function makeResult(overrides: Partial<BacktestResult> = {}): BacktestResult {
  // 24 trades with a positive mean and modest dispersion, a Sharpe that looks
  // publishable, which is exactly when the deflation question matters.
  const rets = Array.from({ length: 24 }, (_, i) => 0.012 + ((i % 5) - 2) * 0.004);
  return {
    id: "bt_test",
    strategyName: "TestStrategy",
    config: {
      strategyId: "test",
      symbol: "BTCUSDT",
      timeframe: "4h",
      days: 365,
      initialCapital: 10000,
      positionSizePercent: 10,
      compounding: false,
      feePercent: 0.1,
      slippagePercent: 0.05,
    },
    metrics: {
      totalReturn: 24,
      annualizedReturn: 24,
      cagr: 24,
      maxDrawdown: 8,
      sharpeRatio: 1.8,
      sortinoRatio: 2.2,
      volatility: 0.15,
      calmarRatio: 3,
      totalTrades: 24,
      winningTrades: 18,
      losingTrades: 6,
      winRate: 0.75,
      profitFactor: 2.1,
      averageTrade: 1.2,
      averageWin: 2,
      averageLoss: -1,
      expectancy: 1.2,
      maxConsecutiveWins: 5,
      maxConsecutiveLosses: 2,
      initialValue: 10000,
      finalValue: 12400,
      totalPnl: 2400,
      netProfit: 2400,
      totalFees: 50,
      avgTradeDuration: 86400000,
      maxDrawdownDuration: 3,
    },
    trades: rets.map((r, i) => trade(i, r)),
    equityCurve: [],
    drawdownCurve: [],
    startDate: new Date(Date.UTC(2024, 0, 1)).toISOString(),
    endDate: new Date(Date.UTC(2025, 0, 1)).toISOString(),
    executionTime: 10,
    createdAt: new Date().toISOString(),
    warnings: [],
    ...overrides,
  };
}

describe("formatBacktestSummary: deflated Sharpe honesty (Tier-0 Group B, item 3)", () => {
  it("declines to report a deflated Sharpe when no trial count is supplied", () => {
    const out = formatBacktestSummary(makeResult());

    // Before the fix this printed a concrete "DSR NN% ✓/✗" computed at
    // numStrategiesTested = 1, which is a PSR wearing a DSR label.
    expect(out).toContain("DSR n/a (trial count not supplied, not deflated)");
    expect(out).toContain("undeflated (multiple-testing burden unknown)");
    expect(out).not.toMatch(/DSR \d+%/);
    // PSR is a legitimate single-track statistic and is still reported.
    expect(out).toMatch(/PSR \d+%/);
  });

  it("reports a deflated Sharpe, labelled with the trial count, when one is supplied", () => {
    const out = formatBacktestSummary(makeResult(), { trialsTested: 50 });

    expect(out).toMatch(/DSR \d+% [✓✗] \(50 trials\)/);
    expect(out).not.toContain("not deflated");
  });

  it("a larger trial count never raises the deflated Sharpe", () => {
    const few = formatBacktestSummary(makeResult(), { trialsTested: 2 });
    const many = formatBacktestSummary(makeResult(), { trialsTested: 500 });

    const pct = (s: string): number => Number(/DSR (\d+)%/.exec(s)![1]);
    expect(pct(many)).toBeLessThanOrEqual(pct(few));
  });

  it("treats a trial count below 2 as no deflation at all", () => {
    // A DSR at one trial is arithmetically the PSR, so claiming deflation there
    // is the bug, not a degenerate-but-harmless case.
    expect(formatBacktestSummary(makeResult(), { trialsTested: 1 })).toContain("not deflated");
  });
});

describe("tradeReturnsPerYear: per-trade annualization (Tier-0 Group B, item 3)", () => {
  it("uses realized trade frequency, not a hardcoded 365", () => {
    // 24 trades over one year is 24 return observations per year, not 365.
    // The old call site asserted 365 regardless of span or trade count.
    expect(tradeReturnsPerYear(makeResult(), 24)).toBeCloseTo(24 / (366 / 365.25), 3);
  });

  it("scales with the backtest span, not the bar interval", () => {
    // Same 24 trades, one month instead of one year: ~292 per year.
    const oneMonth = makeResult({
      startDate: new Date(Date.UTC(2024, 0, 1)).toISOString(),
      endDate: new Date(Date.UTC(2024, 1, 1)).toISOString(),
    });
    const perYear = tradeReturnsPerYear(oneMonth, 24);
    expect(perYear).toBeGreaterThan(270);
    expect(perYear).toBeLessThan(300);
    // And the 4h bar interval (2190 bars/yr) is NOT what it returns.
    expect(perYear).toBeLessThan(2190);
  });

  it("falls back to 365 on an unusable span rather than throwing", () => {
    expect(tradeReturnsPerYear(makeResult({ startDate: "not-a-date" }), 24)).toBe(365);
    expect(
      tradeReturnsPerYear(
        makeResult({ endDate: new Date(Date.UTC(2024, 0, 1)).toISOString() }),
        24,
      ),
    ).toBe(365);
  });

  it("clamps to a sane band", () => {
    // One trade over ten years would annualize below 1; clamp to 1.
    const tenYears = makeResult({
      endDate: new Date(Date.UTC(2034, 0, 1)).toISOString(),
    });
    expect(tradeReturnsPerYear(tenYears, 1)).toBe(1);
  });

  it("does not throw when formatting a summary with an unusable span", () => {
    const out = formatBacktestSummary(
      makeResult({ startDate: "not-a-date", endDate: "also-not-a-date" }),
      { trialsTested: 10 },
    );
    expect(out).toMatch(/PSR \d+%/);
  });
});
