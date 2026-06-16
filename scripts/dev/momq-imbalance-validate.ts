#!/usr/bin/env bun
/**
 * L2 order-book IMBALANCE → signal validation over the Model to Market data
 * (data/momq/bars + data/momq/l2).
 *
 * Joins price bars with the L2 micro-features by `time`, turns the order-book
 * imbalance into a directional signal (bid-heavy book → long, ask-heavy → short)
 * via a per-instrument rolling z-score, and runs it through the SAME cost-honest
 * competition dry-run used by momq-edge-validate.ts — per instrument, IS(70%)/
 * OOS(30%), in both taker and maker execution. An edge is only believed if it
 * survives out-of-sample AND after costs.
 *
 *   bun run scripts/dev/momq-imbalance-validate.ts
 *
 * Honest scope (printed at the end too):
 *  - Pre-competition window, not the live week.
 *  - One IS/OOS split + one month of data is INDICATIVE, not conclusive.
 *  - Imbalance is LAGGED to bar close — the signal at bar t uses bar t's
 *    own imbalance, which is only fully known at close, so any same-bar
 *    entry is an upper bound on realism (the live loop would act next bar).
 *  - L2 is produced by a background extractor that may be only partially
 *    populated; instruments without an L2 file are SKIPPED and listed.
 *  - Crypto has no L2 feed in this dataset (parquet symbols only) — skipped.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  runCompetitionDryRun,
  type DryRunBar,
  type DryRunSignal,
  type SignalFn,
} from "../../src/backtest/competition-dry-run.ts";
import { COMPETITION_RISK_AGGRESSIVE } from "../../src/core/risk-management/competition-risk-preset.ts";

const BARS_DIR = "data/momq/bars";
const L2_DIR = "data/momq/l2";
const M15_PER_YEAR = 24 * 4 * 365;
const VOL_LOOKBACK = 20;
// Rolling window for the per-instrument imbalance z-score (adaptive threshold).
const IMB_LOOKBACK = 48;
// z-score magnitude beyond which the book is "strongly" lopsided.
const IMB_Z_THRESHOLD = 1.0;
// Fallback fixed threshold on raw imbalance when the rolling window is too short
// or degenerate (zero variance), per the brief's k=0.3.
const IMB_K = 0.3;

// The 15 competition-tradeable instruments (FX majors + gold/silver + 5 crypto).
const TRADEABLE = [
  "EURUSD", "GBPUSD", "USDCHF", "USDJPY", "USDCAD", "AUDUSD", "EURGBP", "EURCHF",
  "XAUUSD", "XAGUSD", "BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "BARUSD",
];

interface RawBar { time: number; open: number; high: number; low: number; close: number; spread: number }
interface RawL2 { time: number; imbalance: number; micropriceVsMid: number; spread: number; ticks: number }

const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / (xs.length || 1);
const std = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((v) => (v - m) ** 2)));
};

interface Loaded {
  symbol: string;
  bars: DryRunBar[];
  /** bar.time (ms) → imbalance for that bar, joined from the L2 file. */
  imbByTime: Map<number, number>;
  spreadBps: number;
  /** Bars (of the loaded series) that had a matching L2 row. */
  joined: number;
}

/**
 * Load a symbol's bars + L2 features, join by `time`, derive a rolling
 * realized-vol estimate per bar and a per-instrument median-spread cost.
 * Returns null when there is no L2 file (extractor not yet populated) or
 * insufficient data.
 */
function load(symbol: string): Loaded | null {
  let rawBars: RawBar[];
  try {
    rawBars = JSON.parse(readFileSync(join(BARS_DIR, `${symbol}_M15.json`), "utf8")) as RawBar[];
  } catch {
    return null;
  }
  let rawL2: RawL2[];
  try {
    rawL2 = JSON.parse(readFileSync(join(L2_DIR, `${symbol}_M15.json`), "utf8")) as RawL2[];
  } catch {
    // No L2 file — skip this instrument (handled by caller, reported as skipped).
    return null;
  }
  if (rawBars.length < 100 || rawL2.length === 0) return null;

  // L2 imbalance indexed by epoch-second time, for the bar join.
  const l2BySec = new Map<number, RawL2>();
  for (const row of rawL2) l2BySec.set(row.time, row);

  const bars: DryRunBar[] = [];
  const imbByTime = new Map<number, number>();
  let joined = 0;
  for (let i = 0; i < rawBars.length; i++) {
    const b = rawBars[i]!;
    const start = Math.max(1, i - VOL_LOOKBACK + 1);
    const rets: number[] = [];
    for (let j = start; j <= i; j++) {
      const prev = rawBars[j - 1]!.close;
      if (prev > 0) rets.push(rawBars[j]!.close / prev - 1);
    }
    const volAnnual = Math.max(1e-4, std(rets) * Math.sqrt(M15_PER_YEAR));
    const timeMs = b.time * 1000;
    bars.push({ symbol, time: timeMs, close: b.close, volAnnual });
    const l2 = l2BySec.get(b.time);
    if (l2 && Number.isFinite(l2.imbalance)) {
      imbByTime.set(timeMs, l2.imbalance);
      joined++;
    }
  }
  // Require a meaningful join — otherwise the signal never fires anyway.
  if (joined < 50) return null;

  // Per-instrument cost estimate: median spread in bps of price, preferring the
  // L2 spread (book-derived) and falling back to the bar spread.
  const bpsList: number[] = [];
  for (let i = 0; i < rawBars.length; i++) {
    const b = rawBars[i]!;
    const l2 = l2BySec.get(b.time);
    const sprPrice = l2 && l2.spread > 0 ? l2.spread : b.spread;
    if (b.close > 0 && sprPrice > 0) bpsList.push((sprPrice / b.close) * 10_000);
  }
  bpsList.sort((a, b) => a - b);
  const spreadBps = bpsList.length ? bpsList[Math.floor(bpsList.length / 2)]! : 2;

  return { symbol, bars, imbByTime, spreadBps, joined };
}

/**
 * Build the imbalance SignalFn for one instrument. It closes over the symbol's
 * time→imbalance Map (threaded because DryRunBar only carries close/volAnnual)
 * and over a recent imbalance history it accumulates from the bar `history`
 * (same-symbol, prior bars) to compute the adaptive z-score.
 *
 * Direction: bid-heavy book (imbalance high / z > +threshold) → LONG;
 * ask-heavy (imbalance low / z < −threshold) → SHORT. stop/target scale with
 * recent realized volatility (in price units, derived from bar.volAnnual).
 */
function makeImbalanceSignal(imbByTime: Map<number, number>): SignalFn {
  return (bar: DryRunBar, history: DryRunBar[]): DryRunSignal | null => {
    const imb = imbByTime.get(bar.time);
    if (imb === undefined) return null;

    // Recent imbalance window from prior bars of this symbol (lagged — excludes
    // the current bar's value from the baseline so the z-score is causal).
    const recent: number[] = [];
    for (let i = Math.max(0, history.length - IMB_LOOKBACK); i < history.length; i++) {
      const v = imbByTime.get(history[i]!.time);
      if (v !== undefined) recent.push(v);
    }

    let side: DryRunSignal["side"] | null = null;
    if (recent.length >= 10) {
      const m = mean(recent);
      const sd = std(recent);
      if (sd > 0) {
        const z = (imb - m) / sd;
        if (z > IMB_Z_THRESHOLD) side = "long";
        else if (z < -IMB_Z_THRESHOLD) side = "short";
      } else {
        if (imb > IMB_K) side = "long";
        else if (imb < -IMB_K) side = "short";
      }
    } else {
      // Cold start: fixed-threshold fallback.
      if (imb > IMB_K) side = "long";
      else if (imb < -IMB_K) side = "short";
    }
    if (!side) return null;

    // Volatility-derived stop/target in price units. volAnnual is annualized;
    // de-annualize to a per-bar (15-min) sigma, then scale to price.
    const perBarSigma = bar.volAnnual / Math.sqrt(M15_PER_YEAR);
    const movePrice = Math.max(bar.close * perBarSigma, bar.close * 1e-5);
    return {
      side,
      stopDistance: 2 * movePrice,
      targetDistance: 3 * movePrice,
    };
  };
}

interface Slice { ret: number; sharpe: number; maxDd: number; trades: number }
function runSlice(bars: DryRunBar[], signal: SignalFn, spreadBps: number, execution: "taker" | "maker"): Slice {
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

interface Agg { ret: number; sharpe: number; maxDd: number; trades: number; n: number; winInstr: number }
const emptyAgg = (): Agg => ({ ret: 0, sharpe: 0, maxDd: 0, trades: 0, n: 0, winInstr: 0 });

function main(): void {
  const loaded: Loaded[] = [];
  const skipped: string[] = [];
  for (const sym of TRADEABLE) {
    const l = load(sym);
    if (l) loaded.push(l);
    else skipped.push(sym);
  }

  console.log(
    `\n── imbalance-signal validation: ${loaded.length}/${TRADEABLE.length} instruments ` +
      `(L2-joined), IS(70%)/OOS(30%) ──\n`,
  );
  if (skipped.length) {
    console.log(`skipped (no L2 file / insufficient join — pending extraction): ${skipped.join(" ")}\n`);
  }
  if (loaded.length === 0) {
    console.log("No instruments had a usable L2 feed yet — harness is built and ran on 0 instruments.");
    console.log("Re-run once the background L2 extractor has populated data/momq/l2/<SYM>_M15.json.\n");
    return;
  }

  const fmt = (a: Agg) =>
    `ret ${((a.ret / a.n) * 100).toFixed(2).padStart(7)}%  sharpe ${(a.sharpe / a.n).toFixed(3).padStart(7)}  ` +
    `maxDD ${((a.maxDd / a.n) * 100).toFixed(1).padStart(5)}%  win ${a.winInstr}/${a.n}  trades ${(a.trades / a.n).toFixed(0)}`;

  const aggs: Record<string, Agg> = {
    "taker IS": emptyAgg(), "taker OOS": emptyAgg(), "maker IS": emptyAgg(), "maker OOS": emptyAgg(),
  };
  for (const { bars, imbByTime, spreadBps } of loaded) {
    const signal = makeImbalanceSignal(imbByTime);
    const cut = Math.floor(bars.length * 0.7);
    for (const exec of ["taker", "maker"] as const) {
      const slices: [string, Slice][] = [
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

  console.log("imbalanceZScore (bid-heavy → long, ask-heavy → short)");
  for (const [label, agg] of Object.entries(aggs)) console.log(`  ${label.padEnd(9)} ${fmt(agg)}`);
  console.log("");

  console.log("per-instrument join coverage:");
  for (const l of loaded) {
    console.log(`  ${l.symbol.padEnd(7)} bars ${String(l.bars.length).padStart(5)}  L2-joined ${String(l.joined).padStart(5)}  spreadBps ${l.spreadBps.toFixed(2)}`);
  }
  console.log("");

  console.log(
    "(avg per-instrument; 15-min Sharpe = the competition metric; costs = per-instrument median spread + 1bps slippage)",
  );
  console.log(
    "caveats: pre-competition month; single IS/OOS split; imbalance LAGGED to bar close (same-bar entry = optimistic upper bound).\n",
  );
}

main();
