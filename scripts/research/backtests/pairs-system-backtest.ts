#!/usr/bin/env bun
/**
 * Integrated Pairs-System Backtest — the Best-Sharpe competition vehicle.
 *
 * Drives the full 5-layer `runPairsSystem` (cointegration select → Kalman dynamic
 * spread → OU calibration → cost-calibrated z → OU-proportional sizing → rolling-
 * coint regime gate) over a broad crypto universe, then aggregates the selected
 * pairs into ONE dollar-neutral spread BOOK.
 *
 * Why this book matters for our goal: a dollar-neutral spread has near-zero
 * directional beta, so the equity curve is SMOOTH (low variance) by construction.
 * Many lowly-correlated pairs = breadth → higher Sharpe per the Fundamental Law of
 * Active Management (IR = IC·√breadth). So we report the metrics that decide the
 * Best-Sharpe rank: per-bar Sharpe, equity-curve SMOOTHNESS (return std / curve
 * roughness), max drawdown, and trade count — NOT raw return.
 *
 * Spread P&L (LOG prices): position_t · ΔS_t where S is the Kalman spread and
 * position is the system's signed OU-proportional allocation HELD INTO bar t. That
 * is exactly the dollar-β-weighted dollar-neutral pair return — no through-zero
 * pathology. Costs: crypto spread=0 in the data → floor 5 bps both legs, charged on
 * |Δallocation| (turnover-honest, so re-sizing pays too).
 *
 *   ALPHA_BARS_DIR=data/momq/crypto-extended ALPHA_TF=1d bun run scripts/research/backtests/pairs-system-backtest.ts
 *
 * IS(70)/OOS(30): the cointegration relationship and the edge must hold OUT of
 * sample. The honest verdict reports the AGGREGATED book's OOS Sharpe + smoothness.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { availableParallelism } from "node:os";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

import { runPairsSystem } from "../../../src/infra/trading/quant/pairsSystem.ts";

const BARS_DIR = join(process.cwd(), process.env.ALPHA_BARS_DIR ?? join("data", "momq", "crypto-extended"));
const TF = process.env.ALPHA_TF ?? "1d";
const WANTED = new Set((process.env.PAIRS_SYMBOLS ?? "").split(",").map((s) => s.trim()).filter(Boolean));

const IS_FRAC = 0.7;
const COST_BPS_FLOOR = Number(process.env.PAIRS_COST_BPS ?? 5); // both legs, one side.
const DESIRED_ENTRY_Z = 2.0;
// Slow Kalman delta: stable structural pairs (see pairsSystem note). A faster delta
// whitens the spread and kills the tradeable half-life. Override via PAIRS_KALMAN_DELTA.
const KALMAN_DELTA = Number(process.env.PAIRS_KALMAN_DELTA ?? 1e-7);
const MIN_OBS = 200;

interface RawBar { time: number; close: number; spread: number }
interface Series { symbol: string; timeToClose: Map<number, number>; times: number[]; spreadBps: number }

const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / (xs.length || 1);
const std = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1));
};
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

function loadSeries(symbol: string): Series | null {
  const path = join(BARS_DIR, `${symbol}_${TF}.json`);
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, "utf8")) as RawBar[];
  const clean = raw.filter((b) => Number.isFinite(b.close) && b.close > 0);
  if (clean.length < MIN_OBS) return null;
  const timeToClose = new Map<number, number>();
  for (const b of clean) timeToClose.set(b.time, b.close);
  const bps = clean.filter((b) => b.spread > 0).map((b) => (b.spread / b.close) * 10_000);
  return { symbol, timeToClose, times: clean.map((b) => b.time), spreadBps: bps.length ? median(bps) : 0 };
}

/** Common-timestamp aligned close arrays (chronological). */
function align(a: Series, b: Series): { p1: number[]; p2: number[] } {
  const p1: number[] = [];
  const p2: number[] = [];
  for (const t of a.times) {
    const c2 = b.timeToClose.get(t);
    if (c2 !== undefined) {
      p1.push(a.timeToClose.get(t)!);
      p2.push(c2);
    }
  }
  return { p1, p2 };
}

const sharpe = (rets: number[]) => {
  const sd = std(rets);
  return sd > 0 ? mean(rets) / sd : 0;
};
function maxDrawdown(rets: number[]): number {
  // Additive equity (sum of per-bar spread returns — the curve we rank for smoothness).
  let eq = 0;
  let peak = 0;
  let mdd = 0;
  for (const r of rets) {
    eq += r;
    peak = Math.max(peak, eq);
    mdd = Math.min(mdd, eq - peak);
  }
  return mdd;
}
/**
 * Curve ROUGHNESS = std of the equity-curve second difference, normalized by the
 * curve's range. Lower = smoother (a straight line has 0). This is the direct
 * "is the curve smooth?" metric, complementary to Sharpe.
 */
function curveRoughness(rets: number[]): number {
  const eq: number[] = [];
  let c = 0;
  for (const r of rets) { c += r; eq.push(c); }
  if (eq.length < 3) return 0;
  const d2: number[] = [];
  for (let i = 2; i < eq.length; i++) d2.push(eq[i]! - 2 * eq[i - 1]! + eq[i - 2]!);
  const range = Math.max(...eq) - Math.min(...eq);
  return range > 0 ? std(d2) / range : 0;
}

/**
 * Per-bar spread P&L from the system's signed allocation over the whole series,
 * then split IS/OOS. Position held INTO bar t is allocation[t-1]; ΔS_t is the
 * Kalman-spread change. Turnover cost on |Δallocation|.
 */
function pnlFromSystem(
  allocation: number[],
  spread: number[],
  costFraction: number,
): number[] {
  const rets: number[] = [];
  for (let i = 1; i < spread.length; i++) {
    const prev = allocation[i - 1]!;
    const dS = spread[i]! - spread[i - 1]!;
    const gross = prev * dS;
    const turnover = Math.abs(allocation[i]! - allocation[i - 1]!);
    rets.push(gross - turnover * costFraction);
  }
  return rets;
}

interface PairBacktest {
  a: string;
  b: string;
  n: number;
  halfLife: number;
  hurst: number;
  entryZ: number;
  isSharpe: number;
  oosSharpe: number;
  oosRet: number;
  oosMaxDd: number;
  oosRoughness: number;
  oosTrades: number;
  /** Aligned per-bar OOS return series (for portfolio aggregation). */
  oosRets: number[];
  /** OOS slice start index in the aligned series (for time-aligned portfolio sum). */
  oosStart: number;
  times: number[];
}

function evaluatePair(a: Series, b: Series): PairBacktest | null {
  const { p1, p2 } = align(a, b);
  const n = p1.length;
  if (n < MIN_OBS) return null;

  const costBps = COST_BPS_FLOOR + Math.max(0, a.spreadBps) + Math.max(0, b.spreadBps);
  const sys = runPairsSystem(p1, p2, {
    costBps,
    desiredEntryZ: DESIRED_ENTRY_Z,
    kalmanDelta: KALMAN_DELTA,
    maxFraction: 1.0,
  });
  if (!sys.selection.selected) return null;

  const allocation = sys.bars.map((x) => x.allocation);
  const spread = sys.bars.map((x) => x.spread);
  const costFraction = costBps / 10_000;

  // IS/OOS split on the bar index. Backtest each slice independently using the
  // already-computed full-series positions (the system is causal — z and regime use
  // only trailing data — so slicing the realized position/spread is honest).
  const cut = Math.floor(n / 1 * IS_FRAC);
  const isRets = pnlFromSystem(allocation.slice(0, cut), spread.slice(0, cut), costFraction);
  const oosRets = pnlFromSystem(allocation.slice(cut), spread.slice(cut), costFraction);

  // Build aligned timestamp list for the OOS slice (for portfolio time-alignment).
  const alignedTimes: number[] = [];
  for (const t of a.times) if (b.timeToClose.has(t)) alignedTimes.push(t);

  let trades = 0;
  for (let i = cut + 1; i < allocation.length; i++) {
    const wasFlat = Math.abs(allocation[i - 1]!) < 1e-12;
    const isFlat = Math.abs(allocation[i]!) < 1e-12;
    if (wasFlat !== isFlat) trades++;
  }

  return {
    a: a.symbol, b: b.symbol, n,
    halfLife: sys.selection.halfLife, hurst: sys.selection.hurst, entryZ: sys.entryZ,
    isSharpe: sharpe(isRets), oosSharpe: sharpe(oosRets),
    oosRet: oosRets.reduce((s, r) => s + r, 0),
    oosMaxDd: maxDrawdown(oosRets), oosRoughness: curveRoughness(oosRets), oosTrades: trades,
    oosRets, oosStart: cut, times: alignedTimes,
  };
}

// ── parallel sharding (pair granularity, per pairs-scan.ts pattern) ──
interface PairUnit { a: string; b: string }

function computeForPairs(units: PairUnit[]): PairBacktest[] {
  const cache = new Map<string, Series | null>();
  const load = (sym: string): Series | null => {
    let s = cache.get(sym);
    if (s === undefined) { s = loadSeries(sym); cache.set(sym, s); }
    return s;
  };
  const out: PairBacktest[] = [];
  for (const { a, b } of units) {
    const sa = load(a); const sb = load(b);
    if (!sa || !sb) continue;
    const r = evaluatePair(sa, sb);
    if (r) out.push(r);
  }
  return out;
}

if (!isMainThread && parentPort) {
  const { units } = workerData as { units: PairUnit[] };
  parentPort.postMessage(computeForPairs(units));
}

function runSharded(units: PairUnit[]): Promise<PairBacktest[]> {
  const nWorkers = Math.max(1, Math.min(availableParallelism(), units.length));
  const chunks: PairUnit[][] = Array.from({ length: nWorkers }, () => []);
  units.forEach((u, i) => chunks[i % nWorkers]!.push(u));
  return Promise.all(
    chunks.map((chunk) => new Promise<PairBacktest[]>((resolve, reject) => {
      const w = new Worker(new URL(import.meta.url), { workerData: { units: chunk } });
      w.once("message", (r: PairBacktest[]) => { resolve(r); void w.terminate(); });
      w.once("error", reject);
    })),
  ).then((perChunk) => perChunk.flat());
}

/**
 * Aggregate selected pairs into ONE equal-weight dollar-neutral book by summing
 * per-bar OOS returns on a COMMON timestamp grid (a pair contributes 0 on bars it
 * has no data for). Equal-weight average across the pairs ACTIVE on each bar — the
 * breadth that lifts Sharpe (IR = IC·√breadth).
 */
function aggregatePortfolio(pairs: PairBacktest[]): { rets: number[]; nBars: number } {
  if (!pairs.length) return { rets: [], nBars: 0 };
  // Map each pair's OOS returns onto its OOS timestamps (rets[i] is the return
  // realized at oos-aligned bar i+1, i.e. timestamp times[oosStart + i + 1]).
  const byTime = new Map<number, number[]>();
  for (const p of pairs) {
    for (let i = 0; i < p.oosRets.length; i++) {
      const t = p.times[p.oosStart + i + 1];
      if (t === undefined) continue;
      const arr = byTime.get(t) ?? [];
      arr.push(p.oosRets[i]!);
      byTime.set(t, arr);
    }
  }
  const sortedTimes = [...byTime.keys()].sort((a, b) => a - b);
  const rets = sortedTimes.map((t) => {
    const vals = byTime.get(t)!;
    return vals.reduce((s, v) => s + v, 0) / vals.length; // equal-weight active pairs
  });
  return { rets, nBars: rets.length };
}

async function main(): Promise<void> {
  let symbols = readdirSync(BARS_DIR)
    .filter((f) => f.endsWith(`_${TF}.json`))
    .map((f) => f.slice(0, -(`_${TF}.json`).length))
    .sort();
  if (WANTED.size) symbols = symbols.filter((s) => WANTED.has(s));

  const series = symbols.map(loadSeries).filter((s): s is Series => s !== null);

  console.log("=".repeat(86));
  console.log("INTEGRATED PAIRS-SYSTEM BACKTEST — 5-layer (coint→Kalman→OU→cost-z→sizing→monitor)");
  console.log("=".repeat(86));
  console.log(`Dir/TF        : ${process.env.ALPHA_BARS_DIR ?? "data/momq/crypto-extended"} / ${TF}`);
  console.log(`Symbols       : ${series.length}`);
  console.log(`Pairs to test : ${(series.length * (series.length - 1)) / 2}`);
  console.log(`Kalman delta  : ${KALMAN_DELTA}   Cost floor: ${COST_BPS_FLOOR} bps   Entry z (desired): ${DESIRED_ENTRY_Z}`);

  const allUnits: PairUnit[] = [];
  for (let i = 0; i < series.length; i++)
    for (let j = i + 1; j < series.length; j++)
      allUnits.push({ a: series[i]!.symbol, b: series[j]!.symbol });

  const serial = process.env.ALPHA_SERIAL === "1" || allUnits.length <= 1;
  const nWorkers = serial ? 1 : Math.min(availableParallelism(), allUnits.length);
  console.log(`Parallelism   : ${serial ? "serial" : `${nWorkers} workers / ${availableParallelism()} cores`}`);
  console.log("");

  const bars = new Map(series.map((s) => [s.symbol, s.times.length]));
  let results: PairBacktest[];
  if (serial) {
    results = computeForPairs(allUnits);
  } else {
    const ordered = [...allUnits].sort(
      (x, y) => (bars.get(y.a)! + bars.get(y.b)!) - (bars.get(x.a)! + bars.get(x.b)!),
    );
    results = await runSharded(ordered);
  }

  // Stable order for reporting.
  results.sort((x, y) => (x.a + x.b).localeCompare(y.a + y.b));

  console.log(`Selected pairs (passed Johansen + EG-both + Hurst<0.5 + tradeable HL): ${results.length}`);
  console.log("");

  if (!results.length) {
    console.log("No pair cleared the full selection gauntlet on this universe/TF.");
    return;
  }

  const ranked = [...results].sort((x, y) => y.oosSharpe - x.oosSharpe);
  console.log("PER-PAIR — ranked by OOS spread Sharpe (per-bar, after costs)");
  console.log("-".repeat(86));
  console.log(
    ["pair".padEnd(20), "HL".padStart(5), "hurst".padStart(6), "eZ".padStart(5),
     "isSh".padStart(7), "oosSh".padStart(7), "oosRet".padStart(8), "oosDD".padStart(8),
     "rough".padStart(7), "trd".padStart(4)].join(" "),
  );
  for (const r of ranked) {
    console.log([
      `${r.a}/${r.b}`.padEnd(20),
      r.halfLife.toFixed(0).padStart(5),
      r.hurst.toFixed(2).padStart(6),
      r.entryZ.toFixed(2).padStart(5),
      r.isSharpe.toFixed(3).padStart(7),
      r.oosSharpe.toFixed(3).padStart(7),
      r.oosRet.toFixed(4).padStart(8),
      r.oosMaxDd.toFixed(4).padStart(8),
      r.oosRoughness.toFixed(3).padStart(7),
      String(r.oosTrades).padStart(4),
    ].join(" "));
  }
  console.log("");

  // ── Aggregated portfolio (the Best-Sharpe vehicle) ──
  const port = aggregatePortfolio(results);
  const portSharpe = sharpe(port.rets);
  const portRet = port.rets.reduce((s, r) => s + r, 0);
  const portDd = maxDrawdown(port.rets);
  const portRough = curveRoughness(port.rets);
  const portStd = std(port.rets);

  // Annualized Sharpe (1d bars → √365). Per-bar Sharpe is the raw ranking metric.
  const ann = portSharpe * Math.sqrt(365);

  const consistent = results.filter((r) => r.isSharpe > 0 && r.oosSharpe > 0);
  const meanPairOosSharpe = mean(results.map((r) => r.oosSharpe));

  console.log("=".repeat(86));
  console.log("AGGREGATED PAIRS BOOK (equal-weight, dollar-neutral) — OUT OF SAMPLE");
  console.log("=".repeat(86));
  console.log(`Pairs in book            : ${results.length}  (${consistent.length} with BOTH IS>0 and OOS>0)`);
  console.log(`Portfolio OOS bars       : ${port.nBars}`);
  console.log(`Per-bar Sharpe           : ${portSharpe.toFixed(4)}   (annualized ≈ ${ann.toFixed(2)})`);
  console.log(`Mean per-PAIR OOS Sharpe : ${meanPairOosSharpe.toFixed(4)}   → book Sharpe should EXCEED this (breadth)`);
  console.log(`Per-bar return std       : ${portStd.toExponential(3)}   (curve variance — lower = smoother)`);
  console.log(`Curve roughness          : ${portRough.toFixed(4)}   (std of 2nd-diff / range; 0 = straight line)`);
  console.log(`Cumulative OOS return    : ${portRet.toFixed(4)}  (log-spread units)`);
  console.log(`Max drawdown             : ${portDd.toFixed(4)}  (additive equity units)`);
  console.log("");
  console.log("=".repeat(86));
  console.log("VERDICT");
  console.log("=".repeat(86));
  const positive = portRet > 0;
  const smooth = portSharpe > 0.05;
  const breadthLift = portSharpe > meanPairOosSharpe;
  if (positive && smooth) {
    console.log(`VIABLE low-variance Best-Sharpe vehicle: aggregated OOS per-bar Sharpe ${portSharpe.toFixed(3)} `);
    console.log(`(annualized ≈ ${ann.toFixed(2)}), positive cumulative return, max DD ${portDd.toFixed(4)}.`);
  } else if (positive) {
    console.log(`MARGINAL: positive OOS return but per-bar Sharpe ${portSharpe.toFixed(3)} is thin — low variance`);
    console.log(`but not a strong Sharpe signal. The smoothness (DD ${portDd.toFixed(4)}) is the real asset here.`);
  } else {
    console.log(`NOT VIABLE as a return source: cumulative OOS return ${portRet.toFixed(4)} ≤ 0. But the curve`);
    console.log(`IS low-variance (std ${portStd.toExponential(2)}, DD ${portDd.toFixed(4)}) — a flat-ish dollar-neutral book.`);
  }
  console.log(`Breadth lift: book Sharpe ${breadthLift ? "EXCEEDS" : "does NOT exceed"} mean per-pair Sharpe ` +
    `(${portSharpe.toFixed(3)} vs ${meanPairOosSharpe.toFixed(3)}) — ${breadthLift ? "diversification working as the Fundamental Law predicts." : "pairs too correlated / too few to diversify."}`);
  console.log("");
}

if (isMainThread) void main();
