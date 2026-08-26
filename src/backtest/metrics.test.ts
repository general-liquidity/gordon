import { describe, expect, it } from "bun:test";
import {
  calculateVolatility,
  calculateSharpeRatio,
  calculateSortinoRatio,
  calculateAllMetrics,
  periodsPerYearForTimeframe,
} from "./metrics.ts";
import type { EquityPoint, ClosedTrade } from "./types.ts";

const RET = [0.012, -0.006, 0.018, -0.011, 0.009, 0.004, -0.014, 0.021, -0.003, 0.007];
const factor = Math.sqrt(252 / 365); // per-bar stat annualization scales by √(ppy)

describe("metrics periodsPerYear parameterization", () => {
  it("defaults to 365 (back-compat): omitting periodsPerYear == passing 365", () => {
    expect(calculateVolatility(RET)).toBeCloseTo(calculateVolatility(RET, 365), 12);
    expect(calculateSharpeRatio(RET)).toBeCloseTo(calculateSharpeRatio(RET, 0.02, 365), 12);
    expect(calculateSortinoRatio(RET)).toBeCloseTo(calculateSortinoRatio(RET, 0.02, 365), 12);
  });

  it("volatility scales by √(periodsPerYear)", () => {
    const v365 = calculateVolatility(RET, 365);
    const v252 = calculateVolatility(RET, 252);
    expect(v252).toBeGreaterThan(0);
    expect(v252).toBeCloseTo(v365 * factor, 12);
    // hourly crypto (8760) annualizes to a larger figure than daily (365)
    expect(calculateVolatility(RET, 8760)).toBeGreaterThan(v365);
  });

  it("Sharpe (rf=0) scales by √(periodsPerYear)", () => {
    const s365 = calculateSharpeRatio(RET, 0, 365);
    const s252 = calculateSharpeRatio(RET, 0, 252);
    expect(s252).toBeCloseTo(s365 * factor, 10);
  });

  it("Sortino (rf=0) scales by √(periodsPerYear)", () => {
    const s365 = calculateSortinoRatio(RET, 0, 365);
    const s252 = calculateSortinoRatio(RET, 0, 252);
    expect(Number.isFinite(s365)).toBe(true);
    expect(s252).toBeCloseTo(s365 * factor, 10);
  });

  it("a 365-vs-252 mismatch materially changes annualized vol (the contest-metric bug)", () => {
    // ~20% inflation when crypto-365 is wrongly applied to an FX/equity daily series.
    const inflation = calculateVolatility(RET, 365) / calculateVolatility(RET, 252);
    expect(inflation).toBeCloseTo(Math.sqrt(365 / 252), 12);
    expect(inflation).toBeGreaterThan(1.19);
  });

  it("calculateAllMetrics threads periodsPerYear into the risk metrics", () => {
    const curve: EquityPoint[] = [
      { timestamp: 0, equity: 100000 },
      { timestamp: 1, equity: 101200 },
      { timestamp: 2, equity: 100600 },
      { timestamp: 3, equity: 102400 },
      { timestamp: 4, equity: 101300 },
      { timestamp: 5, equity: 102200 },
    ];
    const trades: ClosedTrade[] = [];
    const m365 = calculateAllMetrics(100000, 102200, curve, trades, 5); // default 365
    const m252 = calculateAllMetrics(100000, 102200, curve, trades, 5, 252);
    expect(m365.volatility).toBeGreaterThan(0);
    // volatility field is a percentage; 252 version is smaller by √(252/365)
    expect(m252.volatility).toBeCloseTo(m365.volatility * factor, 8);
    expect(m252.sharpeRatio).not.toBe(m365.sharpeRatio);
    // calendar-based annualizedReturn is unaffected by periodsPerYear (uses elapsed days)
    expect(m252.annualizedReturn).toBeCloseTo(m365.annualizedReturn, 12);
  });
});

describe("annualization factor comes from the bar, not the calendar", () => {
  it("periodsPerYearForTimeframe counts BARS per year for a 24/7 series", () => {
    expect(periodsPerYearForTimeframe("1d")).toBe(365);
    expect(periodsPerYearForTimeframe("4h")).toBe(2190);
    expect(periodsPerYearForTimeframe("1h")).toBe(8760);
    expect(periodsPerYearForTimeframe("15m")).toBe(35040);
  });

  it("annualizing 4h bars at 365 understates Sharpe by sqrt(2190/365) = 2.45x", () => {
    const wrong = calculateSharpeRatio(RET, 0, 365);
    const right = calculateSharpeRatio(RET, 0, periodsPerYearForTimeframe("4h"));
    expect(right / wrong).toBeCloseTo(Math.sqrt(2190 / 365), 6);
    expect(Math.sqrt(2190 / 365)).toBeCloseTo(2.449, 3);
  });

  it("refuses an unknown timeframe rather than falling back to 365", () => {
    expect(() => periodsPerYearForTimeframe("7h")).toThrow();
  });
});

describe("fees are charged once", () => {
  it("netProfit equals totalPnl, which already carries every commission", () => {
    // finalCapital is produced by a capital path that deducted both legs of
    // every commission. Subtracting totalFees again charged them twice.
    const curve: EquityPoint[] = [
      { timestamp: 0, equity: 10000 },
      { timestamp: 86400000, equity: 10500 },
    ];
    const trades: ClosedTrade[] = [
      {
        id: "t1",
        symbol: "BTCUSDT",
        side: "long",
        entryPrice: 100,
        exitPrice: 106,
        quantity: 100,
        entryTime: 0,
        exitTime: 86400000,
        pnl: 500,
        pnlPercent: 5,
        fees: 100,
      },
    ];
    const m = calculateAllMetrics(10000, 10500, curve, trades, 1);
    expect(m.totalPnl).toBe(500);
    expect(m.totalFees).toBe(100);
    expect(m.netProfit).toBe(500);
  });
});
