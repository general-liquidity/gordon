#!/usr/bin/env bun
/**
 * CROSS-SECTIONAL contrarian edge validation over the real Model to Market data
 * (data/momq/bars).
 *
 * This is the CORRECT read of the reversal evidence. `momq-reversal-validate.ts`
 * tested a PER-SYMBOL time-series z-band (each instrument vs its own recent mean)
 * — that already failed. The cross-sectional construct is different: at each
 * rebalance, rank ALL instruments by their recent return, then bet that the
 * relative LOSERS rebound and the relative WINNERS fade — long the bottom-K,
 * short the top-K, ACROSS the universe. This is the dispersion-mean-reversion the
 * literature actually documents.
 *
 *   bun run scripts/dev/momq/momq-cross-sectional-validate.ts
 *
 * Construction (the cross-sectional signal threaded through the per-symbol dry-run):
 *   1. Load all 15 tradeable instruments; align to the intersection of timestamps.
 *   2. Every REBALANCE_BARS (~96 M15 = 1 day): rank instruments by trailing
 *      LOOKBACK-bar return. Bottom-K (biggest losers) → LONG, top-K (biggest
 *      winners) → SHORT, K = ⌊N/3⌋. Record (time → side) per symbol; the side
 *      holds until the next rebalance.
 *   3. Run EACH instrument through `runCompetitionDryRun` with a SignalFn closing
 *      over its (time → side) map (fires the assigned side with vol-derived
 *      stop/target; flat otherwise), in BOTH taker and maker, IS(70%)/OOS(30%).
 *   4. Also report the cross-sectional Information Coefficient — Spearman rank
 *      correlation of the contrarian score (= −trailing return) vs the realized
 *      forward 1-day return — IS/OOS, for attribution.
 *   5. Honest caveats below.
 *
 * On `src/core/alpha/cross-sectional-contrarian.ts`: that primitive emits
 * CONTINUOUS dollar-neutral weights (wi ∝ −R̃_i/σ), not the discrete per-symbol
 * LONG/SHORT side the dry-run's SignalFn consumes. Its ranking semantics (demean
 * the cross-section, contrarian = −deviation) are reused conceptually here, but
 * the bottom-K/top-K bucketing is computed inline so it maps onto the one-side-
 * per-symbol dry-run interface. (Bucketing is the discrete cousin of that module's
 * continuous weighting — same sign convention, quantile membership not magnitude.)
 *
 * Honest scope: ONE month of data + a SINGLE IS/OOS split is INDICATIVE, not
 * conclusive — and this is the pre-competition window, not the live week.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  runCompetitionDryRun,
  type DryRunBar,
  type SignalFn,
} from "../../../src/backtest/competition-dry-run.ts";
import { COMPETITION_RISK_AGGRESSIVE } from "../../../src/core/risk-management/competition-risk-preset.ts";

const DIR = "data/momq/bars";
const M15_PER_YEAR = 24 * 4 * 365;
const VOL_LOOKBACK = 20;
const REBALANCE_BARS = 96; // ~1 day of M15
const LOOKBACK_BARS = 96; // trailing-return window for the cross-sectional rank
const STOP_MULT = 2.0; // stop = STOP_MULT × recent per-bar σ (in price)
const TARGET_MULT = 1.5; // target = TARGET_MULT × recent per-bar σ

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

type Side = "long" | "short";

interface Loaded {
  symbol: string;
  bars: DryRunBar[]; // time in ms
  closeByTime: Map<number, number>; // ms → close
  spreadBps: number;
}

/** Load a symbol's bars → DryRunBar[] with a rolling realized-vol estimate per bar. */
function loadBars(symbol: string): Loaded | null {
  let raw: RawBar[];
  try {
    raw = JSON.parse(readFileSync(join(DIR, `${symbol}_M15.json`), "utf8")) as RawBar[];
  } catch {
    return null;
  }
  if (raw.length < 100) return null;
  const closeByTime = new Map<number, number>();
  const bars: DryRunBar[] = raw.map((b, i) => {
    const start = Math.max(1, i - VOL_LOOKBACK + 1);
    const rets: number[] = [];
    for (let j = start; j <= i; j++) {
      const prev = raw[j - 1]!.close;
      if (prev > 0) rets.push(raw[j]!.close / prev - 1);
    }
    const volAnnual = Math.max(1e-4, std(rets) * Math.sqrt(M15_PER_YEAR));
    const timeMs = b.time * 1000;
    closeByTime.set(timeMs, b.close);
    return { symbol, time: timeMs, close: b.close, volAnnual };
  });
  const bpsList = raw.filter((b) => b.close > 0 && b.spread > 0).map((b) => (b.spread / b.close) * 10_000);
  bpsList.sort((a, b) => a - b);
  const spreadBps = bpsList.length ? bpsList[Math.floor(bpsList.length / 2)]! : 2;
  return { symbol, bars, closeByTime, spreadBps };
}

/** Per-bar realized σ in PRICE units at a given time, from a window of closes ending at that time. */
function priceSigmaAt(closes: number[]): number {
  if (closes.length < 2) return 0;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1]! > 0) rets.push(closes[i]! / closes[i - 1]! - 1);
  }
  const lastClose = closes[closes.length - 1]!;
  return std(rets) * lastClose;
}

/**
 * Build the per-symbol (time → side) assignment maps from the cross-sectional
 * ranks, plus the IS/OOS Information Coefficient series.
 *
 * Walks the COMMON timeline (intersection of all symbols' timestamps). At each
 * rebalance index r: each symbol's trailing return over LOOKBACK_BARS on the
 * common grid is ranked; bottom-K → long, top-K → short. The contrarian score
 * (= −trailingReturn) is paired with the realized forward 1-rebalance return for
 * the IC. Sides apply from this rebalance time until the next.
 */
function buildCrossSectional(loaded: Loaded[], commonTimes: number[]): {
  sideMaps: Map<string, Map<number, Side>>;
  icPairs: { time: number; scoreRanks: number[]; fwdRanks: number[] }[];
} {
  const N = loaded.length;
  const K = Math.max(1, Math.floor(N / 3));
  // close-on-common-grid per symbol (aligned arrays, index = position in commonTimes)
  const grid: number[][] = loaded.map((l) => commonTimes.map((t) => l.closeByTime.get(t)!));

  const sideMaps = new Map<string, Map<number, Side>>();
  for (const l of loaded) sideMaps.set(l.symbol, new Map<number, Side>());
  const icPairs: { time: number; scoreRanks: number[]; fwdRanks: number[] }[] = [];

  for (let r = LOOKBACK_BARS; r < commonTimes.length; r += REBALANCE_BARS) {
    const t = commonTimes[r]!;
    // trailing return over LOOKBACK_BARS ending at r
    const trailing: number[] = grid.map((g) => {
      const past = g[r - LOOKBACK_BARS]!;
      const now = g[r]!;
      return past > 0 ? now / past - 1 : 0;
    });
    // contrarian score = −trailing (high score = biggest loser = most-long)
    const score = trailing.map((x) => -x);

    // rank instruments by trailing return: ascending → index 0 = biggest loser
    const order = trailing
      .map((v, i) => ({ v, i }))
      .sort((a, b) => a.v - b.v);
    const longSet = new Set(order.slice(0, K).map((o) => o.i)); // losers
    const shortSet = new Set(order.slice(N - K).map((o) => o.i)); // winners

    for (let i = 0; i < N; i++) {
      const sym = loaded[i]!.symbol;
      if (longSet.has(i)) sideMaps.get(sym)!.set(t, "long");
      else if (shortSet.has(i)) sideMaps.get(sym)!.set(t, "short");
    }

    // forward return over the next rebalance window (for IC) — needs r+REBALANCE_BARS
    const rf = r + REBALANCE_BARS;
    if (rf < commonTimes.length) {
      const fwd: number[] = grid.map((g) => {
        const now = g[r]!;
        const later = g[rf]!;
        return now > 0 ? later / now - 1 : 0;
      });
      icPairs.push({ time: t, scoreRanks: rankVector(score), fwdRanks: rankVector(fwd) });
    }
  }
  return { sideMaps, icPairs };
}

/** Average-rank vector (1..N) for Spearman; ties share the mean rank. */
function rankVector(xs: number[]): number[] {
  const idx = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1]!.v === idx[i]!.v) j++;
    const avg = (i + j) / 2 + 1; // 1-based mean rank for the tie group
    for (let k = i; k <= j; k++) ranks[idx[k]!.i] = avg;
    i = j + 1;
  }
  return ranks;
}

/** Pearson correlation of two equal-length rank vectors == Spearman ρ. */
function spearman(aRanks: number[], bRanks: number[]): number {
  const n = aRanks.length;
  if (n < 2) return 0;
  const ma = mean(aRanks);
  const mb = mean(bRanks);
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    const da = aRanks[i]! - ma;
    const db = bRanks[i]! - mb;
    cov += da * db; va += da * da; vb += db * db;
  }
  if (va <= 0 || vb <= 0) return 0;
  return cov / Math.sqrt(va * vb);
}

/**
 * SignalFn closing over a symbol's (time → side) map. On a bar whose time has an
 * assigned side AND the symbol is flat, fire that side with a vol-derived
 * stop/target. The dry-run holds one position per symbol until stop/target/reverse,
 * so the side acts as a fresh entry trigger each rebalance.
 */
function makeCrossSectionalSignal(sideByTime: Map<number, Side>): SignalFn {
  return (bar, hist) => {
    const side = sideByTime.get(bar.time);
    if (!side) return null;
    const closes = hist.map((b) => b.close);
    closes.push(bar.close);
    if (closes.length < VOL_LOOKBACK) return null;
    const window = closes.slice(-VOL_LOOKBACK);
    const sigma = priceSigmaAt(window);
    if (!(sigma > 0)) return null;
    return {
      side,
      stopDistance: STOP_MULT * sigma,
      targetDistance: TARGET_MULT * sigma,
    };
  };
}

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
  const loaded = TRADEABLE.map((s) => loadBars(s)).filter((x): x is Loaded => x !== null && x.bars.length >= 100);
  console.log(`\n── CROSS-SECTIONAL contrarian validation: ${loaded.length}/${TRADEABLE.length} instruments, IS(70%)/OOS(30%) ──\n`);
  console.log(
    `construction: rank universe by trailing ${LOOKBACK_BARS}-bar return every ${REBALANCE_BARS} bars (~1d); ` +
    `bottom-${Math.max(1, Math.floor(loaded.length / 3))} LONG, top-${Math.max(1, Math.floor(loaded.length / 3))} SHORT\n`,
  );

  // Common timeline = intersection of all symbols' timestamps.
  let common: number[] = loaded[0]!.bars.map((b) => b.time);
  for (const l of loaded.slice(1)) {
    const set = l.closeByTime;
    common = common.filter((t) => set.has(t));
  }
  common.sort((a, b) => a - b);
  console.log(`common aligned timeline: ${common.length} bars (intersection across ${loaded.length} instruments)\n`);

  const { sideMaps, icPairs } = buildCrossSectional(loaded, common);

  // ── Per-instrument dry-run, per (execution × slice) ──
  const fmt = (a: Agg) =>
    `ret ${((a.ret / a.n) * 100).toFixed(2).padStart(7)}%  sharpe ${(a.sharpe / a.n).toFixed(3).padStart(7)}  ` +
    `maxDD ${((a.maxDd / a.n) * 100).toFixed(1).padStart(5)}%  win ${a.winInstr}/${a.n}  trades ${(a.trades / a.n).toFixed(0)}`;

  const aggs: Record<string, Agg> = {
    "taker IS": emptyAgg(), "taker OOS": emptyAgg(), "maker IS": emptyAgg(), "maker OOS": emptyAgg(),
  };
  for (const l of loaded) {
    const signal = makeCrossSectionalSignal(sideMaps.get(l.symbol)!);
    const cut = Math.floor(l.bars.length * 0.7);
    for (const exec of ["taker", "maker"] as const) {
      const slices: [string, ReturnType<typeof runSlice>][] = [
        [`${exec} IS`, runSlice(l.bars.slice(0, cut), signal, l.spreadBps, exec)],
        [`${exec} OOS`, runSlice(l.bars.slice(cut), signal, l.spreadBps, exec)],
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
  console.log("dry-run (cross-sectional sides → per-symbol money path):");
  for (const [label, agg] of Object.entries(aggs)) console.log(`  ${label.padEnd(9)} ${fmt(agg)}`);
  console.log("");

  // ── Cross-sectional Information Coefficient (Spearman: −trailing-ret vs fwd-ret) ──
  // IC is split IS/OOS on the SAME 70/30 boundary of the common timeline.
  const icCut = common[Math.floor(common.length * 0.7)] ?? Infinity;
  const icIS: number[] = [];
  const icOOS: number[] = [];
  for (const p of icPairs) {
    const ic = spearman(p.scoreRanks, p.fwdRanks);
    if (!Number.isFinite(ic)) continue;
    (p.time < icCut ? icIS : icOOS).push(ic);
  }
  const meanIC = (xs: number[]) => (xs.length ? mean(xs) : 0);
  const icMeanIS = meanIC(icIS);
  const icMeanOOS = meanIC(icOOS);
  // IC information ratio (mean / std of per-rebalance ICs) — stability of the signal.
  const icIR = (xs: number[]) => (xs.length > 1 && std(xs) > 0 ? mean(xs) / std(xs) : 0);
  console.log("cross-sectional IC (Spearman ρ of contrarian score = −trailing-ret vs forward 1-day return):");
  console.log(`  IS   mean IC ${icMeanIS.toFixed(4).padStart(8)}  IR ${icIR(icIS).toFixed(3).padStart(7)}  (${icIS.length} rebalances)`);
  console.log(`  OOS  mean IC ${icMeanOOS.toFixed(4).padStart(8)}  IR ${icIR(icOOS).toFixed(3).padStart(7)}  (${icOOS.length} rebalances)`);
  console.log("  (positive IC ⇒ contrarian score predicts forward return ⇒ losers rebound / winners fade as constructed)\n");

  console.log("(avg per-instrument; 15-min Sharpe = the competition metric; costs = per-instrument median spread + 1bps slippage)");
  console.log("CAVEATS:");
  console.log("  • A 15-name cross-section is THIN — K=5 per leg means ranks are coarse and one outlier swings a bucket.");
  console.log("  • ONE pre-competition month of data + a SINGLE IS/OOS split is INDICATIVE, not conclusive.");
  console.log("  • Mixed asset classes (FX / metals / crypto) in one cross-section: dispersion is driven by class beta, not idiosyncratic reversal.");
  console.log("  • The IC uses non-overlapping forward windows but a thin sample → wide error bars on the mean.\n");
}

main();
