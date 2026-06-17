#!/usr/bin/env bun
/**
 * Metals microstructure probe — the one place an order-book signal is REAL.
 *
 * Verified on our own L2 extract: FX-major depth in the Model to Market parquet is
 * STATIC (imbalance ≡ 0, ≤18 distinct values/month) → un-backtestable; but METALS
 * (XAUUSD, XAGUSD) have genuinely varying depth (imbalance std 0.079 / 0.022, ~2080
 * distinct values). Silver is also the strongest momentum lead from the systematic
 * sweep. This probe isolates the two metals (no FX dilution), reports PER-INSTRUMENT,
 * and tests three fixed-param angles under TAKER (the only Cypher-executable mode):
 *
 *   1. imbalance  — bid-heavy book → long, ask-heavy → short (rolling z-score).
 *   2. momentum   — close vs close[t-L]; the M15 sweep's strongest family on XAG.
 *   3. combined   — momentum DIRECTION, entered ONLY when the book imbalance agrees
 *                   (the intersection of the two independent leads).
 *
 *   bun run scripts/research/scans/metals-microstructure-probe.ts
 *
 * Honest scope: one month, single IS(70%)/OOS(30%) split, FIXED params shown as a
 * full grid (no best-of cherry-pick). Imbalance is lagged to bar close, so same-bar
 * entry is an optimistic upper bound. Live depth "may change once real trading
 * starts" (organisers) — a positive here is a LEAD to re-test live, not a deployable
 * edge. A negative cleanly closes the microstructure question.
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

const BARS_DIR = "data/momq/bars";
const L2_DIR = "data/momq/l2";
const M15_PER_YEAR = 24 * 4 * 365;
const VOL_LOOKBACK = 20;
const IMB_LOOKBACK = 48;

// The instruments with LIVE order-book depth in this dataset.
const METALS = ["XAUUSD", "XAGUSD"];

// Fixed param grids (shown in full — no best-of selection).
const MOM_LOOKBACKS = [12, 24, 48];
const IMB_Z = 1.0;
const COMBINED_IMB_Z = 0.5; // looser book gate when momentum already sets direction.

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
  imbByTime: Map<number, number>;
  closeByTime: Map<number, number>;
  spreadBps: number;
  joined: number;
}

function load(symbol: string): Loaded | null {
  let rawBars: RawBar[];
  let rawL2: RawL2[];
  try {
    rawBars = JSON.parse(readFileSync(join(BARS_DIR, `${symbol}_M15.json`), "utf8")) as RawBar[];
    rawL2 = JSON.parse(readFileSync(join(L2_DIR, `${symbol}_M15.json`), "utf8")) as RawL2[];
  } catch {
    return null;
  }
  if (rawBars.length < 100 || rawL2.length === 0) return null;

  const l2BySec = new Map<number, RawL2>();
  for (const row of rawL2) l2BySec.set(row.time, row);

  const bars: DryRunBar[] = [];
  const imbByTime = new Map<number, number>();
  const closeByTime = new Map<number, number>();
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
    closeByTime.set(timeMs, b.close);
    const l2 = l2BySec.get(b.time);
    if (l2 && Number.isFinite(l2.imbalance)) {
      imbByTime.set(timeMs, l2.imbalance);
      joined++;
    }
  }
  if (joined < 50) return null;

  const bpsList: number[] = [];
  for (let i = 0; i < rawBars.length; i++) {
    const b = rawBars[i]!;
    const l2 = l2BySec.get(b.time);
    const sprPrice = l2 && l2.spread > 0 ? l2.spread : b.spread;
    if (b.close > 0 && sprPrice > 0) bpsList.push((sprPrice / b.close) * 10_000);
  }
  bpsList.sort((a, b) => a - b);
  const spreadBps = bpsList.length ? bpsList[Math.floor(bpsList.length / 2)]! : 2;

  return { symbol, bars, imbByTime, closeByTime, spreadBps, joined };
}

/** Vol-scaled stop/target in price units from the bar's annualized vol. */
function stops(bar: DryRunBar): { stopDistance: number; targetDistance: number } {
  const perBarSigma = bar.volAnnual / Math.sqrt(M15_PER_YEAR);
  const movePrice = Math.max(bar.close * perBarSigma, bar.close * 1e-5);
  return { stopDistance: 2 * movePrice, targetDistance: 3 * movePrice };
}

/** Causal rolling imbalance z-score (excludes the current bar from the baseline). */
function imbZScore(bar: DryRunBar, history: DryRunBar[], imbByTime: Map<number, number>): number | null {
  const imb = imbByTime.get(bar.time);
  if (imb === undefined) return null;
  const recent: number[] = [];
  for (let i = Math.max(0, history.length - IMB_LOOKBACK); i < history.length; i++) {
    const v = imbByTime.get(history[i]!.time);
    if (v !== undefined) recent.push(v);
  }
  if (recent.length < 10) return null;
  const sd = std(recent);
  if (sd === 0) return null;
  return (imb - mean(recent)) / sd;
}

function makeImbalanceSignal(imbByTime: Map<number, number>): SignalFn {
  return (bar, history): DryRunSignal | null => {
    const z = imbZScore(bar, history, imbByTime);
    if (z === null) return null;
    const side = z > IMB_Z ? "long" : z < -IMB_Z ? "short" : null;
    if (!side) return null;
    return { side, ...stops(bar) };
  };
}

function makeMomentumSignal(lookback: number): SignalFn {
  return (bar, history): DryRunSignal | null => {
    if (history.length < lookback) return null;
    const past = history[history.length - lookback]!.close;
    if (past <= 0) return null;
    const ret = bar.close / past - 1;
    if (ret === 0) return null;
    return { side: ret > 0 ? "long" : "short", ...stops(bar) };
  };
}

/** Momentum direction, taken ONLY when the book imbalance agrees (same sign). */
function makeCombinedSignal(lookback: number, imbByTime: Map<number, number>): SignalFn {
  return (bar, history): DryRunSignal | null => {
    if (history.length < lookback) return null;
    const past = history[history.length - lookback]!.close;
    if (past <= 0) return null;
    const ret = bar.close / past - 1;
    if (ret === 0) return null;
    const z = imbZScore(bar, history, imbByTime);
    if (z === null) return null;
    const momLong = ret > 0;
    const bookLong = z > COMBINED_IMB_Z;
    const bookShort = z < -COMBINED_IMB_Z;
    if (momLong && bookLong) return { side: "long", ...stops(bar) };
    if (!momLong && bookShort) return { side: "short", ...stops(bar) };
    return null;
  };
}

interface Slice { ret: number; sharpe: number; maxDd: number; trades: number }
function runSlice(bars: DryRunBar[], signal: SignalFn, spreadBps: number): Slice {
  const r = runCompetitionDryRun({
    bars,
    signal,
    startingEquity: 1_000_000,
    periodsPerYear: M15_PER_YEAR,
    riskParams: COMPETITION_RISK_AGGRESSIVE,
    execution: "taker",
    costs: { spreadBps, slippageBps: 1 },
  });
  return {
    ret: r.competition.returnPct,
    sharpe: r.competition.sharpe15m,
    maxDd: r.competition.maxDrawdownPct,
    trades: r.tradeCount,
  };
}

function fmt(s: Slice): string {
  return (
    `ret ${(s.ret * 100).toFixed(2).padStart(7)}%  sh15m ${s.sharpe.toFixed(3).padStart(7)}  ` +
    `maxDD ${(s.maxDd * 100).toFixed(1).padStart(5)}%  trades ${String(s.trades).padStart(3)}`
  );
}

function main(): void {
  const loaded = METALS.map(load).filter((l): l is Loaded => l !== null);
  console.log("\n".padEnd(1) + "═".repeat(86));
  console.log("METALS MICROSTRUCTURE PROBE — XAU/XAG, live order-book depth, TAKER, IS(70%)/OOS(30%)");
  console.log("═".repeat(86));
  if (loaded.length === 0) {
    console.log("No metals L2 available. Re-run after extraction.\n");
    return;
  }

  for (const inst of loaded) {
    const cut = Math.floor(inst.bars.length * 0.7);
    const isBars = inst.bars.slice(0, cut);
    const oosBars = inst.bars.slice(cut);
    console.log(
      `\n${inst.symbol}  (bars ${inst.bars.length}, L2-joined ${inst.joined}, spreadBps ${inst.spreadBps.toFixed(2)})`,
    );

    const strategies: [string, SignalFn][] = [
      ["imbalance z>1.0", makeImbalanceSignal(inst.imbByTime)],
      ...MOM_LOOKBACKS.map(
        (l) => [`momentum L=${l}`, makeMomentumSignal(l)] as [string, SignalFn],
      ),
      ...MOM_LOOKBACKS.map(
        (l) => [`combined L=${l}+book`, makeCombinedSignal(l, inst.imbByTime)] as [string, SignalFn],
      ),
    ];

    for (const [name, sig] of strategies) {
      const is = runSlice(isBars, sig, inst.spreadBps);
      const oos = runSlice(oosBars, sig, inst.spreadBps);
      const survives = oos.ret > 0 && oos.sharpe > 0 && Math.sign(is.ret) === Math.sign(oos.ret);
      console.log(`  ${name.padEnd(20)} IS  ${fmt(is)}`);
      console.log(`  ${"".padEnd(20)} OOS ${fmt(oos)}  ${survives ? "← positive+consistent OOS" : ""}`);
    }
  }

  console.log("\n" + "─".repeat(86));
  console.log(
    "Honest scope: one month, single IS/OOS split, FIXED params (full grid shown, no best-of pick).",
  );
  console.log(
    "Imbalance lagged to close = optimistic. Live depth may change once real trading starts (organisers):",
  );
  console.log("a positive here is a LEAD to re-test live, NOT a deployable edge.\n");
}

main();
