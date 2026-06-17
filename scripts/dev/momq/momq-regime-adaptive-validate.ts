#!/usr/bin/env bun
/**
 * Regime-adaptive validation over the real Model to Market data (data/momq/bars).
 *
 * Runs `regimeAdaptiveSignal` (mean-revert in chop, momentum in trend) through the
 * cost-honest competition dry-run, per tradeable instrument, IS(70%)/OOS(30%),
 * taker + maker. Reports return / non-annualized 15-min Sharpe (the competition
 * metric) / max-drawdown / win-instruments / trades, PLUS the regime split — how
 * often each regime classified and fired — so you can see WHICH branch is doing
 * the work.
 *
 *   bun run scripts/dev/momq/momq-regime-adaptive-validate.ts
 *
 * HONEST CAVEATS (read these):
 *   - This is NOT a proven edge. No single signal showed stable post-cost edge in
 *     this session's validations; regime-adaptive is the honest best-available
 *     DEFAULT, valued for robustness across regimes + not taking the structurally
 *     wrong bet, NOT for demonstrated positive expectancy.
 *   - One month of data + a single IS/OOS split is INDICATIVE, not conclusive.
 *   - This is the PRE-COMPETITION window, not the live contest week.
 *   - Regime-adaptive ≠ guaranteed: adapting the signal can still lose after costs.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  runCompetitionDryRun,
  type DryRunBar,
  type DryRunSignal,
  type SignalFn,
} from "../../../src/backtest/competition-dry-run.ts";
import { COMPETITION_RISK_AGGRESSIVE } from "../../../src/core/risk-management/competition-risk-preset.ts";
import {
  regimeAdaptiveSignal,
  classifyRegime,
} from "../../../src/core/alpha/regime-adaptive-strategy.ts";

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
  const bpsList = raw.filter((b) => b.close > 0 && b.spread > 0).map((b) => (b.spread / b.close) * 10_000);
  bpsList.sort((a, b) => a - b);
  const spreadBps = bpsList.length ? bpsList[Math.floor(bpsList.length / 2)]! : 2;
  return { bars, spreadBps };
}

// Regime-split bookkeeping, accumulated across every signal evaluation.
interface RegimeSplit { trendingBars: number; choppyBars: number; trendingFires: number; choppyFires: number; }
const emptySplit = (): RegimeSplit => ({ trendingBars: 0, choppyBars: 0, trendingFires: 0, choppyFires: 0 });

/** Wrap `regimeAdaptiveSignal` as a dry-run SignalFn, tallying the regime split. */
function makeSignal(split: RegimeSplit): SignalFn {
  return (bar, hist): DryRunSignal | null => {
    if (hist.length < SIG_LOOKBACK + 1) return null;
    const closes = hist.map((b) => b.close).concat(bar.close);
    const regime = classifyRegime(closes, SIG_LOOKBACK);
    if (regime === "trending") split.trendingBars++;
    else split.choppyBars++;
    const sig = regimeAdaptiveSignal(closes, { lookback: SIG_LOOKBACK });
    if (sig) {
      if (regime === "trending") split.trendingFires++;
      else split.choppyFires++;
    }
    return sig;
  };
}

interface Agg { ret: number; sharpe: number; maxDd: number; trades: number; n: number; winInstr: number }
const emptyAgg = (): Agg => ({ ret: 0, sharpe: 0, maxDd: 0, trades: 0, n: 0, winInstr: 0 });

function runSlice(bars: DryRunBar[], split: RegimeSplit, spreadBps: number, execution: "taker" | "maker") {
  const r = runCompetitionDryRun({
    bars,
    signal: makeSignal(split),
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
  console.log(`\n── regime-adaptive validation: ${loaded.length}/${TRADEABLE.length} instruments, IS(70%)/OOS(30%) ──\n`);

  const aggs: Record<string, Agg> = {
    "taker IS": emptyAgg(), "taker OOS": emptyAgg(), "maker IS": emptyAgg(), "maker OOS": emptyAgg(),
  };
  const splits: Record<string, RegimeSplit> = {
    "taker IS": emptySplit(), "taker OOS": emptySplit(), "maker IS": emptySplit(), "maker OOS": emptySplit(),
  };

  for (const { bars, spreadBps } of loaded) {
    const cut = Math.floor(bars.length * 0.7);
    for (const exec of ["taker", "maker"] as const) {
      const slices: [string, DryRunBar[]][] = [
        [`${exec} IS`, bars.slice(0, cut)],
        [`${exec} OOS`, bars.slice(cut)],
      ];
      for (const [key, slice] of slices) {
        const r = runSlice(slice, splits[key]!, spreadBps, exec);
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

  const fmt = (a: Agg) =>
    `ret ${((a.ret / a.n) * 100).toFixed(2).padStart(7)}%  sharpe ${(a.sharpe / a.n).toFixed(3).padStart(7)}  ` +
    `maxDD ${((a.maxDd / a.n) * 100).toFixed(1).padStart(5)}%  win ${a.winInstr}/${a.n}  trades ${(a.trades / a.n).toFixed(0)}`;

  console.log("regimeAdaptive");
  for (const [label, agg] of Object.entries(aggs)) console.log(`  ${label.padEnd(9)} ${fmt(agg)}`);
  console.log("");

  console.log("regime split (across all signal evaluations, summed over instruments)");
  for (const [label, s] of Object.entries(splits)) {
    const totalBars = s.trendingBars + s.choppyBars || 1;
    const trendPct = ((s.trendingBars / totalBars) * 100).toFixed(0);
    const choppyPct = ((s.choppyBars / totalBars) * 100).toFixed(0);
    console.log(
      `  ${label.padEnd(9)} trending ${trendPct.padStart(3)}% (fires ${s.trendingFires}) · ` +
        `choppy ${choppyPct.padStart(3)}% (fires ${s.choppyFires})`,
    );
  }
  console.log("");

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

  console.log("HONEST CAVEATS:");
  console.log("  - NOT a proven edge — no single signal showed stable post-cost edge this session;");
  console.log("    regime-adaptive is the honest best-available DEFAULT (robustness, not alpha).");
  console.log("  - One month + a single IS/OOS split is INDICATIVE, not conclusive.");
  console.log("  - PRE-COMPETITION window, not the live contest week. Regime-adaptive ≠ guaranteed.\n");
  console.log("(avg per-instrument; 15-min Sharpe = the competition metric; costs = per-instrument median spread + 1bps slippage)\n");
}

main();
