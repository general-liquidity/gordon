#!/usr/bin/env bun
/**
 * Edge validation over the real Model to Market data (data/momq/bars).
 *
 * Runs a small set of TRANSPARENT, parameter-light candidate strategies through
 * the cost-honest competition dry-run, per tradeable instrument, split into
 * in-sample (first 70%) and out-of-sample (last 30%). Reports each strategy's
 * aggregate return / non-annualized 15-min Sharpe (the competition metric) /
 * max-drawdown / trade count, IS vs OOS, so an edge is only believed if it
 * survives out-of-sample AND after costs.
 *
 *   bun run scripts/dev/momq-edge-validate.ts
 *
 * Honest scope: one month of data + a single IS/OOS split is INDICATIVE, not
 * conclusive — and this is the pre-competition window, not the live week.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  runCompetitionDryRun,
  type DryRunBar,
  type SignalFn,
} from "../../src/backtest/competition-dry-run.ts";
import { COMPETITION_RISK_AGGRESSIVE } from "../../src/core/risk-management/competition-risk-preset.ts";

const DIR = "data/momq/bars";
const M15_PER_YEAR = 24 * 4 * 365;
const VOL_LOOKBACK = 20;
const SIG_LOOKBACK = 20;

// The 15 competition-tradeable instruments (FX majors + gold/silver + 5 crypto).
const TRADEABLE = [
  "EURUSD", "GBPUSD", "USDCHF", "USDJPY", "USDCAD", "AUDUSD", "EURGBP", "EURCHF",
  "XAUUSD", "XAGUSD", "BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "BARUSD",
];

interface RawBar { time: number; open: number; high: number; low: number; close: number; spread: number }

const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / (xs.length || 1);
const std = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((v) => (v - m) ** 2)));
};

/** Load a symbol's bars → DryRunBar[] with a rolling realized-vol estimate per bar. */
function loadBars(symbol: string): { bars: DryRunBar[]; spreadBps: number } | null {
  let raw: RawBar[];
  try {
    raw = JSON.parse(readFileSync(join(DIR, `${symbol}_M15.json`), "utf8")) as RawBar[];
  } catch {
    return null;
  }
  if (raw.length < 100) return null;
  const bars: DryRunBar[] = raw.map((b, i) => {
    const start = Math.max(1, i - VOL_LOOKBACK + 1);
    const rets: number[] = [];
    for (let j = start; j <= i; j++) {
      const prev = raw[j - 1]!.close;
      if (prev > 0) rets.push(raw[j]!.close / prev - 1);
    }
    const volAnnual = Math.max(1e-4, std(rets) * Math.sqrt(M15_PER_YEAR));
    return { symbol, time: b.time * 1000, close: b.close, volAnnual };
  });
  // Per-instrument cost estimate: median spread in bps of price.
  const bpsList = raw.filter((b) => b.close > 0 && b.spread > 0).map((b) => (b.spread / b.close) * 10_000);
  bpsList.sort((a, b) => a - b);
  const spreadBps = bpsList.length ? bpsList[Math.floor(bpsList.length / 2)]! : 2;
  return { bars, spreadBps };
}

// ── candidate strategies (symmetric — no hindsight directional bias) ──
const STRATEGIES: Record<string, SignalFn> = {
  meanReversion: (bar, hist) => {
    if (hist.length < SIG_LOOKBACK) return null;
    const c = hist.slice(-SIG_LOOKBACK).map((b) => b.close);
    const m = mean(c);
    const sd = std(c);
    if (sd === 0) return null;
    const z = (bar.close - m) / sd;
    if (z < -1.5) return { side: "long", stopDistance: 2 * sd, targetDistance: Math.max(sd, Math.abs(bar.close - m)) };
    if (z > 1.5) return { side: "short", stopDistance: 2 * sd, targetDistance: Math.max(sd, Math.abs(bar.close - m)) };
    return null;
  },
  momentumBreakout: (bar, hist) => {
    if (hist.length < SIG_LOOKBACK) return null;
    const c = hist.slice(-SIG_LOOKBACK).map((b) => b.close);
    const sd = std(c);
    if (sd === 0) return null;
    const hi = Math.max(...c);
    const lo = Math.min(...c);
    if (bar.close > hi) return { side: "long", stopDistance: 2 * sd, targetDistance: 3 * sd };
    if (bar.close < lo) return { side: "short", stopDistance: 2 * sd, targetDistance: 3 * sd };
    return null;
  },
};

interface Agg { ret: number; sharpe: number; maxDd: number; trades: number; n: number; winInstr: number }
const emptyAgg = (): Agg => ({ ret: 0, sharpe: 0, maxDd: 0, trades: 0, n: 0, winInstr: 0 });

function runSlice(bars: DryRunBar[], signal: SignalFn, spreadBps: number, execution: "taker" | "maker") {
  const r = runCompetitionDryRun({
    bars,
    signal,
    startingEquity: 1_000_000,
    periodsPerYear: M15_PER_YEAR,
    riskParams: COMPETITION_RISK_AGGRESSIVE,
    execution,
    costs: { spreadBps, slippageBps: 1 },
  });
  return {
    ret: r.competition.returnPct,
    sharpe: r.competition.sharpe15m,
    maxDd: r.competition.maxDrawdownPct,
    trades: r.tradeCount,
  };
}

function main(): void {
  const loaded = TRADEABLE.map((s) => ({ symbol: s, ...(loadBars(s) ?? { bars: [], spreadBps: 0 }) })).filter(
    (x) => x.bars.length >= 100,
  );
  console.log(`\n── edge validation: ${loaded.length}/${TRADEABLE.length} instruments, IS(70%)/OOS(30%) ──\n`);

  const fmt = (a: Agg) =>
    `ret ${((a.ret / a.n) * 100).toFixed(2).padStart(7)}%  sharpe ${(a.sharpe / a.n).toFixed(3).padStart(7)}  ` +
    `maxDD ${((a.maxDd / a.n) * 100).toFixed(1).padStart(5)}%  win ${a.winInstr}/${a.n}  trades ${(a.trades / a.n).toFixed(0)}`;

  for (const [name, signal] of Object.entries(STRATEGIES)) {
    const aggs: Record<string, Agg> = {
      "taker IS": emptyAgg(), "taker OOS": emptyAgg(), "maker IS": emptyAgg(), "maker OOS": emptyAgg(),
    };
    for (const { bars, spreadBps } of loaded) {
      const cut = Math.floor(bars.length * 0.7);
      for (const exec of ["taker", "maker"] as const) {
        const slices: [string, ReturnType<typeof runSlice>][] = [
          [`${exec} IS`, runSlice(bars.slice(0, cut), signal, spreadBps, exec)],
          [`${exec} OOS`, runSlice(bars.slice(cut), signal, spreadBps, exec)],
        ];
        for (const [key, r] of slices) {
          const agg = aggs[key]!;
          agg.ret += r.ret;
          agg.sharpe += Number.isFinite(r.sharpe) ? r.sharpe : 0;
          agg.maxDd += r.maxDd;
          agg.trades += r.trades;
          agg.n += 1;
          if (r.ret > 0) agg.winInstr += 1;
        }
      }
    }
    console.log(`${name}`);
    for (const [label, agg] of Object.entries(aggs)) console.log(`  ${label.padEnd(9)} ${fmt(agg)}`);
    console.log("");
  }
  // Passive long-only reference (directly computed, not risk-sized) for context.
  const bh = (slice: DryRunBar[]) => (slice.length > 1 ? slice[slice.length - 1]!.close / slice[0]!.close - 1 : 0);
  let bhIs = 0;
  let bhOos = 0;
  for (const { bars } of loaded) {
    const cut = Math.floor(bars.length * 0.7);
    bhIs += bh(bars.slice(0, cut));
    bhOos += bh(bars.slice(cut));
  }
  console.log("marketBuyHold (passive long reference, avg per-instrument)");
  console.log(`  IS  ret ${((bhIs / loaded.length) * 100).toFixed(2)}%`);
  console.log(`  OOS ret ${((bhOos / loaded.length) * 100).toFixed(2)}%\n`);
  console.log("(avg per-instrument; 15-min Sharpe = the competition metric; costs = per-instrument median spread + 1bps slippage)\n");
}

main();
