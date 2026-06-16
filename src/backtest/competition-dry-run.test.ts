import { describe, expect, it } from "bun:test";
import {
  runCompetitionDryRun,
  type DryRunBar,
  type DryRunSignal,
  type SignalFn,
} from "./competition-dry-run.ts";

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Single-symbol bar series from a price path; one bar per `stepMs`. */
function series(symbol: string, prices: number[], stepMs: number, vol: number, t0 = 0): DryRunBar[] {
  return prices.map((close, i) => ({ symbol, time: t0 + i * stepMs, close, volAnnual: vol }));
}

const START = 1_000_000;

describe("runCompetitionDryRun — money-path spine", () => {
  it("no signal → no trades, flat equity, zero Sharpe", () => {
    const bars = series("EURUSD", [100, 101, 100, 99, 100], DAY, 0.1);
    const r = runCompetitionDryRun({
      bars,
      signal: () => null,
      startingEquity: START,
      periodsPerYear: 252,
    });
    expect(r.tradeCount).toBe(0);
    expect(r.finalEquity).toBe(START);
    expect(r.sharpe).toBe(0);
    expect(r.haltedDays).toBe(0);
  });

  it("steady winning trend compounds equity and scores a positive Sharpe", () => {
    // Price steps +1/bar; long with target +1 (hits next bar), stop −2 (never hit).
    const prices = Array.from({ length: 60 }, (_, i) => 100 + i);
    const bars = series("XAUUSD", prices, DAY, 0.1);
    const signal: SignalFn = (): DryRunSignal => ({ side: "long", stopDistance: 2, targetDistance: 1 });
    const r = runCompetitionDryRun({ bars, signal, startingEquity: START, periodsPerYear: 252 });

    expect(r.finalEquity).toBeGreaterThan(START);
    expect(r.totalReturnPct).toBeGreaterThan(0);
    expect(r.sharpe).toBeGreaterThan(0);
    expect(r.winRate).toBeGreaterThan(0.9);
    expect(r.haltedDays).toBe(0);
    // Default sizing on a tight stop binds on per-trade risk, not exposure.
    expect(r.bindingHistogram.risk_per_trade).toBeGreaterThan(0);
  });

  it("daily-loss-kill halts new entries once the day crosses −3%, without wiping out", () => {
    // Declining price, all within one day → repeated long stop-outs (~0.5% each).
    const prices = Array.from({ length: 14 }, (_, i) => 100 - 3 * i);
    const bars = series("BTCUSD", prices, HOUR, 0.5);
    const signal: SignalFn = (): DryRunSignal => ({ side: "long", stopDistance: 2 });
    const r = runCompetitionDryRun({ bars, signal, startingEquity: START, periodsPerYear: 365 });

    expect(r.haltedDays).toBe(1);
    expect(r.bindingHistogram.risk_per_trade).toBeGreaterThan(0);
    // Survive: the kill caps the day's bleed — well above ruin, modest single-day loss.
    expect(r.finalEquity).toBeGreaterThan(0.9 * START);
    expect(r.finalEquity).toBeLessThan(START);
    // Halt stopped re-entry: far fewer trades than the 14 declining bars.
    expect(r.tradeCount).toBeLessThan(9);
  });

  it("long losing streak across many days never approaches ruin (survive-and-compound)", () => {
    // One losing trade per day for 40 days; 0.5% risk each can't compound to wipeout.
    const prices: number[] = [];
    for (let d = 0; d < 40; d++) prices.push(100, 96); // enter @100, stop @98 hit next bar
    const bars: DryRunBar[] = prices.map((close, i) => ({
      symbol: "GBPUSD",
      time: Math.floor(i / 2) * DAY + (i % 2) * HOUR,
      close,
      volAnnual: 0.1,
    }));
    const signal: SignalFn = (): DryRunSignal => ({ side: "long", stopDistance: 2 });
    const r = runCompetitionDryRun({ bars, signal, startingEquity: START, periodsPerYear: 252 });

    expect(r.finalEquity).toBeGreaterThan(0.7 * START); // 40 × ~0.5% ≈ −18%, nowhere near ruin
    expect(r.winRate).toBe(0);
  });

  it("exposure cap bounds gross exposure and blocks fills past the 60%-of-equity budget", () => {
    // 20 symbols all signal on flat prices; per-trade ~5% risk → cap fills ~12 then skips.
    const N = 20;
    const bars: DryRunBar[] = [];
    for (let b = 0; b < 3; b++) {
      for (let s = 0; s < N; s++) {
        bars.push({ symbol: `SYM${s}`, time: b * HOUR, close: 100, volAnnual: 0.5 });
      }
    }
    const signal: SignalFn = (): DryRunSignal => ({ side: "long", stopDistance: 10 });
    const r = runCompetitionDryRun({ bars, signal, startingEquity: START, periodsPerYear: 252 });

    expect(r.peakExposurePct).toBeLessThanOrEqual(0.6 + 1e-9);
    expect(r.bindingHistogram.exposure_cap).toBeGreaterThan(0);
    expect(r.tradeCount).toBeLessThan(N); // the cap prevented all 20 from filling
    expect(r.tradeCount).toBeGreaterThan(5);
  });

  it("reports the official competition metrics (return, drawdown, non-annualized 15-min Sharpe)", () => {
    const prices = Array.from({ length: 60 }, (_, i) => 100 + i);
    const r = runCompetitionDryRun({
      bars: series("XAUUSD", prices, 15 * 60_000, 0.1), // 15-min bars = the official Sharpe interval
      signal: (): DryRunSignal => ({ side: "long", stopDistance: 2, targetDistance: 1 }),
      startingEquity: START,
      periodsPerYear: 252,
    });
    // Return off the starting equity, max drawdown, and a non-annualized 15-min Sharpe.
    expect(r.competition.returnPct).toBeCloseTo(r.finalEquity / START - 1, 9);
    expect(r.competition.maxDrawdownPct).toBeGreaterThanOrEqual(0);
    expect(r.competition.sharpe15mObs).toBe(r.equityCurve.length - 1);
    expect(Number.isFinite(r.competition.sharpe15m)).toBe(true);
  });

  it("spread + slippage costs reduce returns and are reported (no commission/swap)", () => {
    const prices = Array.from({ length: 60 }, (_, i) => 100 + i);
    const run = (costs?: { spreadBps?: number; slippageBps?: number }) =>
      runCompetitionDryRun({
        bars: series("XAUUSD", prices, DAY, 0.1),
        signal: (): DryRunSignal => ({ side: "long", stopDistance: 2, targetDistance: 1 }),
        startingEquity: START,
        periodsPerYear: 252,
        costs,
      });
    const free = run();
    const withCost = run({ spreadBps: 5, slippageBps: 2 });

    expect(free.totalCostsPaid).toBe(0);
    expect(withCost.totalCostsPaid).toBeGreaterThan(0);
    expect(withCost.finalEquity).toBeLessThan(free.finalEquity); // friction drags returns
  });

  it("a thin gross edge can flip to a net loss once friction is charged", () => {
    // Every trade wins exactly +1 gross; heavy per-fill cost should overwhelm it.
    const prices = Array.from({ length: 40 }, (_, i) => 100 + i);
    const cfg = (costs?: { spreadBps?: number }) =>
      runCompetitionDryRun({
        bars: series("EURUSD", prices, DAY, 0.1),
        signal: (): DryRunSignal => ({ side: "long", stopDistance: 2, targetDistance: 1 }),
        startingEquity: START,
        periodsPerYear: 252,
        costs,
      });
    expect(cfg().totalReturnPct).toBeGreaterThan(0); // profitable gross
    expect(cfg({ spreadBps: 300 }).totalReturnPct).toBeLessThan(0); // unprofitable net
  });

  it("taker round-trip pays roughly the spread (positive total cost)", () => {
    const prices = Array.from({ length: 60 }, (_, i) => 100 + i);
    const r = runCompetitionDryRun({
      bars: series("XAUUSD", prices, DAY, 0.1),
      signal: (): DryRunSignal => ({ side: "long", stopDistance: 2, targetDistance: 1 }),
      startingEquity: START,
      periodsPerYear: 252,
      costs: { spreadBps: 6, slippageBps: 2 },
      // execution omitted → taker
    });
    expect(r.totalCostsPaid).toBeGreaterThan(0);
    expect(r.makerFillRate).toBe(1); // taker fills always
  });

  it("maker mode earns the spread → strictly lower total cost than taker on the same winning trend", () => {
    const prices = Array.from({ length: 60 }, (_, i) => 100 + i);
    // slippage ≥ half-spread keeps the long maker post at/above close, so it fills
    // every bar (same trade count); the earned half-spread cuts total cost.
    const costs = { spreadBps: 6, slippageBps: 4 };
    const mk = (execution: "taker" | "maker") =>
      runCompetitionDryRun({
        bars: series("XAUUSD", prices, DAY, 0.1),
        signal: (): DryRunSignal => ({ side: "long", stopDistance: 2, targetDistance: 1 }),
        startingEquity: START,
        periodsPerYear: 252,
        costs,
        execution,
      });
    const taker = mk("taker");
    const maker = mk("maker");

    expect(maker.totalCostsPaid).toBeLessThan(taker.totalCostsPaid); // rebate
    expect(maker.tradeCount).toBe(taker.tradeCount); // posts fill in this regime
    expect(maker.makerFillRate).toBe(1);
  });

  it("backward-compat: omitting execution yields identical numbers to explicit taker", () => {
    const prices = Array.from({ length: 60 }, (_, i) => 100 + i);
    const cfg = (execution?: "taker" | "maker") =>
      runCompetitionDryRun({
        bars: series("XAUUSD", prices, DAY, 0.1),
        signal: (): DryRunSignal => ({ side: "long", stopDistance: 2, targetDistance: 1 }),
        startingEquity: START,
        periodsPerYear: 252,
        costs: { spreadBps: 6, slippageBps: 2 },
        ...(execution ? { execution } : {}),
      });
    const omitted = cfg();
    const explicitTaker = cfg("taker");
    expect(omitted.finalEquity).toBe(explicitTaker.finalEquity);
    expect(omitted.totalCostsPaid).toBe(explicitTaker.totalCostsPaid);
    expect(omitted.tradeCount).toBe(explicitTaker.tradeCount);
    expect(omitted.sharpe).toBe(explicitTaker.sharpe);
  });

  it("Sharpe uses the supplied annualization (FX 252 ≠ crypto 365 on the same path)", () => {
    const prices = Array.from({ length: 60 }, (_, i) => 100 + i);
    const mk = (ppy: number) =>
      runCompetitionDryRun({
        bars: series("XAGUSD", prices, DAY, 0.1),
        signal: (): DryRunSignal => ({ side: "long", stopDistance: 2, targetDistance: 1 }),
        startingEquity: START,
        periodsPerYear: ppy,
      }).sharpe;
    // Same positive-return path annualized at two frequencies → different Sharpe.
    expect(mk(365)).toBeGreaterThan(mk(252));
  });
});
