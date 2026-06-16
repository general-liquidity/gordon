#!/usr/bin/env bun
/**
 * Ensemble / signal-combination tester over the real Model to Market data
 * (data/momq/bars). The hypothesis under test: individually-weak, noisy signals
 * sometimes COMBINE into something tradeable — the classic weak-learner →
 * strong-learner ensemble premise (López de Prado AFML; reused here via
 * `src/core/alpha/ensemble-signal-combiner.ts`).
 *
 *   bun run scripts/research/ensemble-search.ts
 *
 * What it does:
 *   1. Defines 5 transparent, parameter-light base `SignalFn`s (RSI mean-reversion,
 *      momentum breakout, short-term reversal [reused from reversal-strategy.ts],
 *      MA-cross, Bollinger reversion). Each emits a per-bar directional vote.
 *   2. Builds ENSEMBLE signals that combine the base votes:
 *        (a) MAJORITY VOTE — fire only when ≥k of n agree on direction.
 *        (b) WEIGHTED ensemble via `combineEnsembleSignals` — equal weights, the
 *            agreement-gated verdict decides the trade (strong/weak_long/short).
 *      Stop/target come from recent realized vol. Conflict → flat.
 *   3. WALK-FORWARD validation (rolling IS/OOS folds, not one split) per instrument,
 *      through the cost-honest dry-run in BOTH maker and taker mode, across all 15
 *      tradeable instruments. Robustness (across-fold mean ± std) over a single split.
 *   4. Reports the ensemble's OOS return / 15-min Sharpe / maxDD / trades vs the BEST
 *      individual base signal, at a couple of agreement thresholds (≥2/5, ≥3/5).
 *
 * HONEST scope: one month of data, multiple ensemble configs tried (selection bias),
 * and the pre-competition window — INDICATIVE, not conclusive. Combining weak/noisy
 * signals usually does NOT manufacture edge, and the agreement filter cuts trade
 * count hard. The numbers are reported straight; if the ensemble beats its best
 * component OOS after costs it's FLAGGED with that caveat.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  runCompetitionDryRun,
  type DryRunBar,
  type SignalFn,
  type DryRunSignal,
} from "../../src/backtest/competition-dry-run.ts";
import { COMPETITION_RISK_AGGRESSIVE } from "../../src/core/risk-management/competition-risk-preset.ts";
import { reversalSignal } from "../../src/core/alpha/reversal-strategy.ts";
import {
  combineEnsembleSignals,
  type EnsembleSignal,
} from "../../src/core/alpha/ensemble-signal-combiner.ts";

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

// ───────────────────────────────────────────────────────────────────────────
// Base signals — transparent, parameter-light. Each is a full SignalFn (returns a
// DryRunSignal with vol-scaled stop/target), and ALSO exposes a pure directional
// VOTE in {-1, 0, +1} via `vote` so the ensemble can aggregate without re-running
// the sizing. The dry-run only ever consumes the SignalFn; `vote` feeds the ensemble.
// ───────────────────────────────────────────────────────────────────────────

interface BaseSignal {
  name: string;
  fn: SignalFn;
  /** Directional vote on the bar given its prior history: +1 long, −1 short, 0 flat. */
  vote: (bar: DryRunBar, hist: DryRunBar[]) => -1 | 0 | 1;
}

/** Per-bar realized-return stdev (fraction of price) for vol-scaled stops. */
function volFraction(closes: number[], lb: number): number {
  const rets: number[] = [];
  const start = Math.max(1, closes.length - lb);
  for (let i = start; i < closes.length; i++) {
    const prev = closes[i - 1]!;
    if (prev > 0) rets.push(closes[i]! / prev - 1);
  }
  return std(rets);
}

/** Wilder-ish RSI over the last `lb` closes. */
function rsi(closes: number[], lb: number): number {
  if (closes.length < lb + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - lb; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d >= 0) gains += d;
    else losses -= d;
  }
  if (gains + losses === 0) return 50;
  const rs = gains / (losses || 1e-9);
  return 100 - 100 / (1 + rs);
}

const stopTarget = (closes: number[], price: number): { stop: number; target: number } => {
  const vf = Math.max(volFraction(closes, SIG_LOOKBACK), 1e-6);
  const oneSigma = price * vf;
  return { stop: oneSigma * 2, target: oneSigma * 1.5 };
};

// 1) RSI mean-reversion: oversold (<30) → long, overbought (>70) → short.
const rsiMeanRev: BaseSignal = {
  name: "rsiMeanRev",
  vote: (bar, hist) => {
    if (hist.length < SIG_LOOKBACK) return 0;
    const c = hist.map((b) => b.close);
    const r = rsi(c, 14);
    if (r < 30) return 1;
    if (r > 70) return -1;
    return 0;
  },
  fn: (bar, hist) => {
    const v = rsiMeanRev.vote(bar, hist);
    if (v === 0) return null;
    const c = hist.map((b) => b.close);
    const st = stopTarget(c, bar.close);
    return { side: v === 1 ? "long" : "short", stopDistance: st.stop, targetDistance: st.target };
  },
};

// 2) Momentum breakout: close above lookback-high → long, below low → short.
const momentumBreakout: BaseSignal = {
  name: "momoBreakout",
  vote: (bar, hist) => {
    if (hist.length < SIG_LOOKBACK) return 0;
    const c = hist.slice(-SIG_LOOKBACK).map((b) => b.close);
    const hi = Math.max(...c);
    const lo = Math.min(...c);
    if (bar.close > hi) return 1;
    if (bar.close < lo) return -1;
    return 0;
  },
  fn: (bar, hist) => {
    const v = momentumBreakout.vote(bar, hist);
    if (v === 0) return null;
    const c = hist.map((b) => b.close);
    const st = stopTarget(c, bar.close);
    return { side: v === 1 ? "long" : "short", stopDistance: st.stop, targetDistance: st.target * 2 };
  },
};

// 3) Short-term reversal — reused from src/core/alpha/reversal-strategy.ts.
const reversal: BaseSignal = {
  name: "reversal",
  vote: (bar, hist) => {
    if (hist.length < SIG_LOOKBACK) return 0;
    const c = [...hist.map((b) => b.close), bar.close];
    const sig = reversalSignal(c, { lookback: 14, zThreshold: 1.0 });
    if (!sig) return 0;
    return sig.side === "long" ? 1 : -1;
  },
  fn: (bar, hist) => {
    if (hist.length < SIG_LOOKBACK) return null;
    const c = [...hist.map((b) => b.close), bar.close];
    const sig = reversalSignal(c, { lookback: 14, zThreshold: 1.0 });
    if (!sig) return null;
    return { side: sig.side, stopDistance: sig.stopDistance, targetDistance: sig.targetDistance };
  },
};

// 4) MA cross: fast SMA(5) above slow SMA(20) → long, below → short.
const maCross: BaseSignal = {
  name: "maCross",
  vote: (bar, hist) => {
    if (hist.length < SIG_LOOKBACK) return 0;
    const c = hist.map((b) => b.close);
    const fast = mean(c.slice(-5));
    const slow = mean(c.slice(-20));
    if (slow === 0) return 0;
    const gap = (fast - slow) / slow;
    if (gap > 1e-4) return 1;
    if (gap < -1e-4) return -1;
    return 0;
  },
  fn: (bar, hist) => {
    const v = maCross.vote(bar, hist);
    if (v === 0) return null;
    const c = hist.map((b) => b.close);
    const st = stopTarget(c, bar.close);
    return { side: v === 1 ? "long" : "short", stopDistance: st.stop, targetDistance: st.target };
  },
};

// 5) Bollinger reversion: close below lower band → long, above upper → short (2σ).
const bollReversion: BaseSignal = {
  name: "bollReversion",
  vote: (bar, hist) => {
    if (hist.length < SIG_LOOKBACK) return 0;
    const c = hist.slice(-SIG_LOOKBACK).map((b) => b.close);
    const m = mean(c);
    const sd = std(c);
    if (sd === 0) return 0;
    if (bar.close < m - 2 * sd) return 1;
    if (bar.close > m + 2 * sd) return -1;
    return 0;
  },
  fn: (bar, hist) => {
    const v = bollReversion.vote(bar, hist);
    if (v === 0) return null;
    const c = hist.map((b) => b.close);
    const st = stopTarget(c, bar.close);
    return { side: v === 1 ? "long" : "short", stopDistance: st.stop, targetDistance: st.target };
  },
};

const BASES: BaseSignal[] = [rsiMeanRev, momentumBreakout, reversal, maCross, bollReversion];

// ───────────────────────────────────────────────────────────────────────────
// Ensemble SignalFns.
// ───────────────────────────────────────────────────────────────────────────

/** Vol-scaled stop/target shared by both ensemble methods. */
function ensembleStopTarget(bar: DryRunBar, hist: DryRunBar[]): { stop: number; target: number } {
  const c = hist.map((b) => b.close);
  const st = stopTarget(c, bar.close);
  return { stop: st.stop, target: st.target };
}

/**
 * MAJORITY-VOTE ensemble: collect each base signal's vote, fire LONG/SHORT only when
 * the net agreement reaches `minAgree` votes in one direction AND the opposing side has
 * strictly fewer. Conflict / under-threshold → flat (null).
 */
function majorityEnsemble(minAgree: number): SignalFn {
  return (bar, hist) => {
    if (hist.length < SIG_LOOKBACK) return null;
    let longs = 0;
    let shorts = 0;
    for (const b of BASES) {
      const v = b.vote(bar, hist);
      if (v === 1) longs++;
      else if (v === -1) shorts++;
    }
    let side: "long" | "short" | null = null;
    if (longs >= minAgree && longs > shorts) side = "long";
    else if (shorts >= minAgree && shorts > longs) side = "short";
    if (!side) return null;
    const st = ensembleStopTarget(bar, hist);
    return { side, stopDistance: st.stop, targetDistance: st.target };
  };
}

/**
 * WEIGHTED ensemble via Gordon's `combineEnsembleSignals`. Each base vote becomes an
 * EnsembleSignal value in {−1,0,+1} (equal weight 1). The combiner's agreement-gated
 * verdict decides the trade: any *_long verdict → long, *_short → short; neutral /
 * disagreement / insufficient → flat. `agreementThreshold` maps the "≥k of n agree"
 * idea onto the combiner's agreement fraction.
 */
function weightedEnsemble(agreementThreshold: number, weakThreshold: number): SignalFn {
  return (bar, hist) => {
    if (hist.length < SIG_LOOKBACK) return null;
    const signals: EnsembleSignal[] = BASES.map((b) => ({
      id: b.name,
      value: b.vote(bar, hist),
      weight: 1,
    }));
    const r = combineEnsembleSignals(signals, {
      minSources: BASES.length,
      weakThreshold,
      strongThreshold: 0.6,
      agreementThreshold,
    });
    let side: "long" | "short" | null = null;
    if (r.verdict === "weak_long" || r.verdict === "strong_long") side = "long";
    else if (r.verdict === "weak_short" || r.verdict === "strong_short") side = "short";
    if (!side) return null;
    const st = ensembleStopTarget(bar, hist);
    return { side, stopDistance: st.stop, targetDistance: st.target };
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Walk-forward helper — rolling IS/OOS folds; returns per-fold OOS metrics + the
// across-fold mean/std. Robustness over a single 70/30 split. `runFn` scores ONE
// contiguous slice of bars and returns a scalar-bearing metric object.
// ───────────────────────────────────────────────────────────────────────────

export interface FoldMetric {
  ret: number;
  sharpe: number;
  maxDd: number;
  trades: number;
}

export interface WalkForwardResult {
  folds: FoldMetric[];
  mean: FoldMetric;
  std: FoldMetric;
}

/**
 * Split `bars` into `folds` rolling OOS windows. With an expanding train and a
 * fixed-fraction test, fold i trains on [0, splitᵢ) and tests on the next OOS block.
 * Here `runFn` is only handed the OOS slice (the dry-run is self-contained — no fit
 * step beyond the rolling lookbacks inside each SignalFn), so walk-forward = scoring
 * each OOS block independently and aggregating. That keeps each block a genuine,
 * non-overlapping out-of-sample window, which is the robustness property we want.
 */
export function walkForward(
  bars: DryRunBar[],
  runFn: (slice: DryRunBar[]) => FoldMetric,
  folds: number,
): WalkForwardResult {
  const k = Math.max(1, folds);
  const n = bars.length;
  // First 40% is always reserved as initial warm-up/in-sample; the trailing 60% is
  // chopped into `k` consecutive OOS blocks. Each block carries enough leading bars
  // for the rolling lookbacks (the slice starts SIG_LOOKBACK bars before the block).
  const oosStart = Math.floor(n * 0.4);
  const blockLen = Math.floor((n - oosStart) / k);
  const results: FoldMetric[] = [];
  for (let i = 0; i < k; i++) {
    const blockBegin = oosStart + i * blockLen;
    const blockEnd = i === k - 1 ? n : blockBegin + blockLen;
    const sliceBegin = Math.max(0, blockBegin - SIG_LOOKBACK - 1);
    const slice = bars.slice(sliceBegin, blockEnd);
    if (slice.length < SIG_LOOKBACK + 5) continue;
    results.push(runFn(slice));
  }
  const agg = (sel: (m: FoldMetric) => number) => results.map(sel);
  const mk = (f: (xs: number[]) => number): FoldMetric => ({
    ret: f(agg((m) => m.ret)),
    sharpe: f(agg((m) => m.sharpe)),
    maxDd: f(agg((m) => m.maxDd)),
    trades: f(agg((m) => m.trades)),
  });
  return { folds: results, mean: mk(mean), std: mk(std) };
}

// ───────────────────────────────────────────────────────────────────────────
// Scoring.
// ───────────────────────────────────────────────────────────────────────────

function scoreSlice(
  slice: DryRunBar[],
  signal: SignalFn,
  spreadBps: number,
  execution: "taker" | "maker",
): FoldMetric {
  const r = runCompetitionDryRun({
    bars: slice,
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

const FOLDS = 4;

interface ContestantOOS {
  ret: number;
  sharpe: number;
  maxDd: number;
  trades: number;
  /** Across-fold std of OOS Sharpe — robustness. */
  sharpeStd: number;
  instr: number;
}
const emptyOOS = (): ContestantOOS => ({ ret: 0, sharpe: 0, maxDd: 0, trades: 0, sharpeStd: 0, instr: 0 });

/** Aggregate walk-forward OOS across all instruments for one signal + execution. */
function evaluateContestant(
  loaded: { symbol: string; bars: DryRunBar[]; spreadBps: number }[],
  signal: SignalFn,
  execution: "taker" | "maker",
): ContestantOOS {
  const acc = emptyOOS();
  for (const { bars, spreadBps } of loaded) {
    const wf = walkForward(bars, (slice) => scoreSlice(slice, signal, spreadBps, execution), FOLDS);
    if (wf.folds.length === 0) continue;
    acc.ret += wf.mean.ret;
    acc.sharpe += wf.mean.sharpe;
    acc.maxDd += wf.mean.maxDd;
    acc.trades += wf.mean.trades;
    acc.sharpeStd += wf.std.sharpe;
    acc.instr += 1;
  }
  const d = acc.instr || 1;
  return {
    ret: acc.ret / d,
    sharpe: acc.sharpe / d,
    maxDd: acc.maxDd / d,
    trades: acc.trades / d,
    sharpeStd: acc.sharpeStd / d,
    instr: acc.instr,
  };
}

function fmt(o: ContestantOOS): string {
  return (
    `ret ${(o.ret * 100).toFixed(2).padStart(7)}%  ` +
    `sharpe ${o.sharpe.toFixed(3).padStart(7)} (±${o.sharpeStd.toFixed(3)})  ` +
    `maxDD ${(o.maxDd * 100).toFixed(1).padStart(5)}%  ` +
    `trades ${o.trades.toFixed(0).padStart(4)}`
  );
}

function main(): void {
  const loaded = TRADEABLE.map((s) => ({ symbol: s, ...(loadBars(s) ?? { bars: [], spreadBps: 0 }) })).filter(
    (x) => x.bars.length >= 100,
  );

  console.log(`\n${"═".repeat(78)}`);
  console.log(`  ENSEMBLE / SIGNAL-COMBINATION TESTER`);
  console.log(`  ${loaded.length}/${TRADEABLE.length} instruments · walk-forward ${FOLDS} OOS folds · maker+taker`);
  console.log(`  Honest caveat: 1 month of data, multiple configs tried, pre-competition window.`);
  console.log(`${"═".repeat(78)}\n`);

  for (const execution of ["taker", "maker"] as const) {
    console.log(`\n┌─ EXECUTION: ${execution.toUpperCase()} ${"─".repeat(60)}`);

    // 1) Individual base signals (the components we're trying to beat).
    console.log(`│`);
    console.log(`│  Base components (walk-forward OOS, avg across instruments):`);
    const baseResults: { name: string; oos: ContestantOOS }[] = [];
    for (const b of BASES) {
      const oos = evaluateContestant(loaded, b.fn, execution);
      baseResults.push({ name: b.name, oos });
      console.log(`│    ${b.name.padEnd(14)} ${fmt(oos)}`);
    }
    // Best individual base by OOS Sharpe (the competition's headline metric).
    const bestBySharpe = baseResults.reduce((a, b) => (b.oos.sharpe > a.oos.sharpe ? b : a));
    const bestByRet = baseResults.reduce((a, b) => (b.oos.ret > a.oos.ret ? b : a));
    console.log(`│`);
    console.log(`│  BEST individual — by Sharpe: ${bestBySharpe.name} (${bestBySharpe.oos.sharpe.toFixed(3)});  by return: ${bestByRet.name} (${(bestByRet.oos.ret * 100).toFixed(2)}%)`);

    // 2) Ensembles at a couple of agreement thresholds.
    console.log(`│`);
    console.log(`│  Ensembles (walk-forward OOS, avg across instruments):`);
    const ensembles: { name: string; fn: SignalFn }[] = [
      { name: "majority ≥2/5", fn: majorityEnsemble(2) },
      { name: "majority ≥3/5", fn: majorityEnsemble(3) },
      // weighted via combineEnsembleSignals. Neutral votes count as "agreeing", so the
      // agreement fraction rarely binds with binary votes — the lever that actually
      // changes behavior is the conviction (|composite|) floor. weak=0.2 fires on a net
      // 1-vote edge; weak=0.4 demands a net 2-vote edge (stricter, fewer trades).
      { name: "weighted w≥.2", fn: weightedEnsemble(0.6, 0.2) },
      { name: "weighted w≥.4", fn: weightedEnsemble(0.6, 0.4) },
    ];
    const ensResults: { name: string; oos: ContestantOOS }[] = [];
    for (const e of ensembles) {
      const oos = evaluateContestant(loaded, e.fn, execution);
      ensResults.push({ name: e.name, oos });
      console.log(`│    ${e.name.padEnd(14)} ${fmt(oos)}`);
    }

    // 3) Honest verdict — does ANY ensemble beat the best component OOS after costs?
    console.log(`│`);
    const beatsSharpe = ensResults.filter((e) => e.oos.sharpe > bestBySharpe.oos.sharpe + 1e-9);
    const beatsRet = ensResults.filter((e) => e.oos.ret > bestByRet.oos.ret + 1e-9);
    if (beatsSharpe.length === 0 && beatsRet.length === 0) {
      console.log(`│  VERDICT: NO ensemble beat the best individual component OOS (neither Sharpe nor return).`);
      console.log(`│           Combining these weak/noisy signals did NOT manufacture edge here — and the`);
      console.log(`│           agreement filter cut trade count vs the components. Expected result.`);
    } else {
      if (beatsSharpe.length) {
        const top = beatsSharpe.reduce((a, b) => (b.oos.sharpe > a.oos.sharpe ? b : a));
        console.log(`│  FLAG: "${top.name}" beat best component on OOS Sharpe (${top.oos.sharpe.toFixed(3)} vs ${bestBySharpe.oos.sharpe.toFixed(3)}).`);
      }
      if (beatsRet.length) {
        const top = beatsRet.reduce((a, b) => (b.oos.ret > a.oos.ret ? b : a));
        console.log(`│  FLAG: "${top.name}" beat best component on OOS return (${(top.oos.ret * 100).toFixed(2)}% vs ${(bestByRet.oos.ret * 100).toFixed(2)}%).`);
      }
      console.log(`│  CAVEAT: one month, multiple configs tried (selection bias), pre-competition window.`);
      console.log(`│          Treat as a hypothesis to re-test OOS on fresh data, NOT a confirmed edge.`);
    }
    console.log(`└${"─".repeat(74)}`);
  }
  console.log("");
}

if (import.meta.main) main();
