#!/usr/bin/env bun
/**
 * Cointegration pairs scan + spread backtest — the untested strategy class.
 *
 * Our single-instrument directional alpha-search found nothing past the deflated
 * bar. Pairs trading is a different class: dollar-neutral spread trades have
 * near-zero directional beta → low drawdown → strong on the competition's
 * Drawdown/Sharpe ranks and survival (the controllable edges in a luck-dominated
 * return tournament). And several tradeable instruments are plausibly cointegrated
 * (XAU/XAG, FX crosses, BTC/ETH).
 *
 * For every pair in a directory it runs the FULL cointegration gauntlet using
 * Gordon's own primitives — Engle-Granger BOTH directions, Johansen (symmetric),
 * OU half-life in a tradeable range, Hurst(spread) < 0.5 — then, for pairs that
 * pass, backtests the OU z-score spread strategy IS(70%)/OOS(30%) after costs with
 * a cost-calibrated minimum entry z-score. Ranks survivors by OOS Sharpe.
 *
 * Spread math (LOG prices): S = ln(p1) − β·ln(p2) − α. Then ΔS_t = r1_t − β·r2_t
 * (log returns), which IS the per-bar P&L of a position long 1 of p1 and short β
 * of p2 — exactly the dollar-β-weighted dollar-neutral pair. So position×ΔS is the
 * honest spread return, with no spread-pct-change-through-zero pathology.
 *
 *   bun run scripts/research/pairs-scan.ts                       # FX/metals, comp M15
 *   ALPHA_BARS_DIR=data/momq/crypto-extended ALPHA_TF=1d bun run scripts/research/pairs-scan.ts
 *
 * Honest scope: cointegration over one window is INDICATIVE; the IS/OOS split is the
 * real test of whether the relationship (and the edge) holds out of sample.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { availableParallelism } from "node:os";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

import { testCointegration } from "../../src/infra/trading/quant/cointegration.ts";
import { johansenTest } from "../../src/infra/trading/quant/johansen.ts";
import { calibrateOU, minimumEntryZScore, effectiveEntryZ } from "../../src/infra/trading/quant/ouCalibration.ts";

const BARS_DIR = join(process.cwd(), process.env.ALPHA_BARS_DIR ?? join("data", "momq", "bars"));
const TF = process.env.ALPHA_TF ?? "M15";
// Optional comma-separated symbol filter (default: all in the dir). For the comp,
// restrict to the 15 tradeable instruments via PAIRS_SYMBOLS.
const WANTED = new Set((process.env.PAIRS_SYMBOLS ?? "").split(",").map((s) => s.trim()).filter(Boolean));

const DESIRED_ENTRY_Z = 2.0;
const EXIT_FRACTION = 0.5; // exit at half the (effective) entry z.
const IS_FRAC = 0.7;
// Half-life tradeable band in BARS. Default is generous: revert faster than half the
// sample but slower than a handful of bars (signal-to-noise floor).
const HL_MIN = Number(process.env.PAIRS_HL_MIN ?? 3);

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
  if (clean.length < 120) return null;
  const timeToClose = new Map<number, number>();
  for (const b of clean) timeToClose.set(b.time, b.close);
  const bps = clean.filter((b) => b.spread > 0).map((b) => (b.spread / b.close) * 10_000);
  return { symbol, timeToClose, times: clean.map((b) => b.time), spreadBps: bps.length ? median(bps) : 1 };
}

/** Common-timestamp aligned close arrays for two series (chronological). */
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

/** Hurst exponent of a level series via the lag-diff dispersion method. <0.5 = mean-reverting. */
function hurstOfSpread(series: number[], maxLag = 50): number {
  const logLag: number[] = [];
  const logTau: number[] = [];
  const top = Math.min(maxLag, Math.floor(series.length / 2));
  for (let lag = 2; lag < top; lag++) {
    const diffs: number[] = [];
    for (let i = lag; i < series.length; i++) diffs.push(series[i]! - series[i - lag]!);
    logLag.push(Math.log(lag));
    logTau.push(Math.log(Math.max(std(diffs), 1e-12)));
  }
  if (logLag.length < 3) return 0.5;
  // slope of log(tau) vs log(lag) = Hurst exponent.
  const mx = mean(logLag);
  const my = mean(logTau);
  let num = 0;
  let den = 0;
  for (let i = 0; i < logLag.length; i++) {
    num += (logLag[i]! - mx) * (logTau[i]! - my);
    den += (logLag[i]! - mx) ** 2;
  }
  return den > 0 ? num / den : 0.5;
}

interface PairResult {
  a: string;
  b: string;
  n: number;
  beta: number;
  halfLife: number;
  hurst: number;
  ouStd: number;
  egBoth: boolean;
  johansen: boolean;
  entryZ: number;
  minZ: number;
  isSharpe: number;
  oosSharpe: number;
  isRet: number;
  oosRet: number;
  oosMaxDd: number;
  oosTrades: number;
}

/** Rolling z-score of the spread with a half-life-proportional lookback. */
function rollingZ(spread: number[], lookback: number): number[] {
  const z = new Array<number>(spread.length).fill(NaN);
  for (let i = lookback; i < spread.length; i++) {
    const w = spread.slice(i - lookback, i);
    const m = mean(w);
    const sd = std(w);
    z[i] = sd > 0 ? (spread[i]! - m) / sd : 0;
  }
  return z;
}

/** Backtest the spread z-score strategy on a slice; returns per-bar return series. */
function backtestSlice(
  spread: number[],
  lookback: number,
  entryZ: number,
  exitZ: number,
  costFraction: number,
): { rets: number[]; trades: number } {
  const z = rollingZ(spread, lookback);
  const rets: number[] = [];
  let pos = 0; // +1 long spread, -1 short spread, 0 flat
  let trades = 0;
  for (let i = lookback + 1; i < spread.length; i++) {
    const prevPos = pos;
    const zi = z[i]!;
    if (!Number.isNaN(zi)) {
      if (pos === 0) {
        if (zi > entryZ) pos = -1; // spread rich → short it
        else if (zi < -entryZ) pos = 1; // spread cheap → long it
      } else if (pos === -1 && zi < exitZ) pos = 0;
      else if (pos === 1 && zi > -exitZ) pos = 0;
    }
    // P&L from the position held INTO this bar (prevPos) over ΔS_t.
    const dS = spread[i]! - spread[i - 1]!;
    const gross = prevPos * dS;
    const cost = Math.abs(pos - prevPos) * costFraction;
    rets.push(gross - cost);
    if (pos !== prevPos) trades++;
  }
  return { rets, trades };
}

const sharpe = (rets: number[]) => {
  const sd = std(rets);
  return sd > 0 ? mean(rets) / sd : 0;
};
function maxDrawdown(rets: number[]): number {
  let eq = 1;
  let peak = 1;
  let mdd = 0;
  for (const r of rets) {
    eq *= 1 + r;
    peak = Math.max(peak, eq);
    mdd = Math.min(mdd, eq / peak - 1);
  }
  return mdd;
}

function evaluatePair(a: Series, b: Series): PairResult | null {
  const { p1, p2 } = align(a, b);
  const n = p1.length;
  if (n < 150) return null;
  const lp1 = p1.map(Math.log);
  const lp2 = p2.map(Math.log);

  // Engle-Granger BOTH directions (a genuine relationship confirms either ordering).
  const egAB = testCointegration(lp1, lp2);
  const egBA = testCointegration(lp2, lp1);
  const egBoth = egAB.cointegrated && egBA.cointegrated;

  // Johansen (symmetric, order-independent).
  const joh = johansenTest(lp1, lp2);

  // Spread from the EG hedge ratio (a-on-b): S = ln p1 − β ln p2 − α.
  const beta = egAB.hedgeRatio;
  const alpha = egAB.intercept;
  const spread = lp1.map((v, i) => v - beta * lp2[i]! - alpha);

  const ou = calibrateOU(spread, 1, { minHalfLife: HL_MIN, maxHalfLife: n });
  const hurst = hurstOfSpread(spread);
  const halfLife = ou.halfLife;

  const tradeable = Number.isFinite(halfLife) && halfLife >= HL_MIN && halfLife <= n * 0.5;
  // Gate: must pass Johansen AND EG-both AND mean-reverting (Hurst<0.5) AND tradeable HL.
  if (!(joh.cointegrated && egBoth && hurst < 0.5 && tradeable)) {
    return {
      a: a.symbol, b: b.symbol, n, beta, halfLife, hurst, ouStd: ou.ouStd,
      egBoth, johansen: joh.cointegrated, entryZ: NaN, minZ: NaN,
      isSharpe: NaN, oosSharpe: NaN, isRet: NaN, oosRet: NaN, oosMaxDd: NaN, oosTrades: 0,
    };
  }

  const lookback = Math.min(250, Math.max(20, Math.round(2.5 * halfLife)));
  const costFraction = (a.spreadBps + b.spreadBps) / 10_000; // both legs, one side.
  const minZ = minimumEntryZScore(ou.ouStd, a.spreadBps + b.spreadBps);
  const entryZ = effectiveEntryZ(DESIRED_ENTRY_Z, minZ);
  const exitZ = entryZ * EXIT_FRACTION;

  const cut = Math.floor(n * IS_FRAC);
  const is = backtestSlice(spread.slice(0, cut), lookback, entryZ, exitZ, costFraction);
  const oos = backtestSlice(spread.slice(cut), lookback, entryZ, exitZ, costFraction);

  return {
    a: a.symbol, b: b.symbol, n, beta, halfLife, hurst, ouStd: ou.ouStd,
    egBoth, johansen: joh.cointegrated, entryZ, minZ,
    isSharpe: sharpe(is.rets), oosSharpe: sharpe(oos.rets),
    isRet: is.rets.reduce((s, r) => s + r, 0), oosRet: oos.rets.reduce((s, r) => s + r, 0),
    oosMaxDd: maxDrawdown(oos.rets), oosTrades: oos.trades,
  };
}

/** One unit of work: a single (i, j) symbol pair, referenced by name. */
interface PairUnit {
  a: string;
  b: string;
}

/**
 * Score a list of pairs. Each pair is independent and `evaluatePair` is pure given
 * its two series, so a worker scores its slice in isolation and the main thread
 * concatenates (no merge-time recompute). Series are loaded from disk and cached
 * per worker — cheap (~ms/file) and avoids cloning large close maps across threads,
 * so we shard at PAIR granularity: C(N,2) pairs split evenly across cores.
 */
function computeResultsForPairs(units: PairUnit[]): PairResult[] {
  const cache = new Map<string, Series | null>();
  const load = (sym: string): Series | null => {
    let s = cache.get(sym);
    if (s === undefined) {
      s = loadSeries(sym);
      cache.set(sym, s);
    }
    return s;
  };

  const results: PairResult[] = [];
  for (const { a, b } of units) {
    const sa = load(a);
    const sb = load(b);
    if (!sa || !sb) continue;
    const r = evaluatePair(sa, sb);
    if (r) results.push(r);
  }
  return results;
}

// ── Worker entry: score a pair-slice, post the results back ─────────────────
if (!isMainThread && parentPort) {
  const { units } = workerData as { units: PairUnit[] };
  parentPort.postMessage(computeResultsForPairs(units));
}

/** Fan the pair list out across worker threads — one pool, the whole box. */
function runShardedPairs(units: PairUnit[]): Promise<PairResult[]> {
  const nWorkers = Math.max(1, Math.min(availableParallelism(), units.length));
  // Load balance by per-pair cost (combined bar-count): caller passes units sorted
  // heaviest-first, and we round-robin them across workers (LPT). This spreads the
  // few expensive big-pair evaluations evenly instead of piling them into one worker.
  const chunks: PairUnit[][] = Array.from({ length: nWorkers }, () => []);
  units.forEach((unit, i) => chunks[i % nWorkers]!.push(unit));

  return Promise.all(
    chunks.map(
      (chunk) =>
        new Promise<PairResult[]>((resolve, reject) => {
          const w = new Worker(new URL(import.meta.url), {
            workerData: { units: chunk },
          });
          w.once("message", (results: PairResult[]) => {
            resolve(results);
            void w.terminate();
          });
          w.once("error", reject);
        }),
    ),
  ).then((perChunk) => perChunk.flat());
}

async function main(): Promise<void> {
  let symbols = readdirSync(BARS_DIR)
    .filter((f) => f.endsWith(`_${TF}.json`))
    .map((f) => f.slice(0, -(`_${TF}.json`).length))
    .sort();
  if (WANTED.size) symbols = symbols.filter((s) => WANTED.has(s));

  const series = symbols.map(loadSeries).filter((s): s is Series => s !== null);

  console.log("=".repeat(82));
  console.log("COINTEGRATION PAIRS SCAN — Johansen + EG(both) + Hurst<0.5 + OU half-life, IS/OOS backtest");
  console.log("=".repeat(82));
  console.log(`Dir/TF        : ${process.env.ALPHA_BARS_DIR ?? "data/momq/bars"} / ${TF}`);
  console.log(`Symbols       : ${series.length} (${series.map((s) => s.symbol).join(", ")})`);
  console.log(`Pairs to test : ${(series.length * (series.length - 1)) / 2}`);

  // Flatten to the (i<j) pair list. Record each pair's original serial position so
  // the sharded results can be restored to serial order before ranking — making the
  // parallel output byte-identical to the serial loop (downstream sorts aren't
  // guaranteed stable on ties). Bar-count per symbol drives heaviest-first ordering.
  const bars = new Map(series.map((s) => [s.symbol, s.times.length]));
  const allUnits: { unit: PairUnit; order: number }[] = [];
  let order = 0;
  for (let i = 0; i < series.length; i++) {
    for (let j = i + 1; j < series.length; j++) {
      allUnits.push({ unit: { a: series[i]!.symbol, b: series[j]!.symbol }, order: order++ });
    }
  }
  const serialOrder = new Map(allUnits.map(({ unit, order }) => [`${unit.a} ${unit.b}`, order]));

  const serial = process.env.ALPHA_SERIAL === "1" || allUnits.length <= 1;
  const nWorkers = serial ? 1 : Math.min(availableParallelism(), allUnits.length);
  console.log(`Parallelism   : ${serial ? "serial (1 core)" : `${nWorkers} workers / ${availableParallelism()} cores, ${allUnits.length} pairs`}`);
  console.log("");

  let results: PairResult[];
  if (serial) {
    results = computeResultsForPairs(allUnits.map((u) => u.unit));
  } else {
    // Heaviest-first by combined bar-count so the round-robin shard is proper LPT.
    const ordered = [...allUnits].sort(
      (x, y) =>
        (bars.get(y.unit.a)! + bars.get(y.unit.b)!) - (bars.get(x.unit.a)! + bars.get(x.unit.b)!),
    );
    results = await runShardedPairs(ordered.map((u) => u.unit));
    // Restore serial order so ranking ties resolve identically to the serial run.
    results.sort((x, y) => serialOrder.get(`${x.a} ${x.b}`)! - serialOrder.get(`${y.a} ${y.b}`)!);
  }

  const cointegrated = results.filter((r) => r.johansen && r.egBoth);
  const tradeable = results.filter((r) => Number.isFinite(r.oosSharpe));
  console.log(`Cointegrated pairs (Johansen + EG both directions) : ${cointegrated.length}`);
  console.log(`...also mean-reverting + tradeable half-life (backtested) : ${tradeable.length}`);
  console.log("");

  // All cointegrated pairs (the relationship map), sorted by half-life.
  console.log("COINTEGRATED PAIRS (Johansen ∧ EG-both)");
  console.log("-".repeat(82));
  console.log(["pair".padEnd(20), "beta".padStart(8), "halfLife".padStart(9), "hurst".padStart(7), "backtested".padStart(11)].join(" "));
  for (const r of [...cointegrated].sort((x, y) => x.halfLife - y.halfLife)) {
    console.log([
      `${r.a}/${r.b}`.padEnd(20),
      r.beta.toFixed(3).padStart(8),
      (Number.isFinite(r.halfLife) ? r.halfLife.toFixed(1) : "inf").padStart(9),
      r.hurst.toFixed(3).padStart(7),
      (Number.isFinite(r.oosSharpe) ? "yes" : "no (HL/Hurst)").padStart(11),
    ].join(" "));
  }
  console.log("");

  if (tradeable.length) {
    tradeable.sort((x, y) => y.oosSharpe - x.oosSharpe);
    console.log("BACKTESTED PAIRS — ranked by OOS spread Sharpe (per-bar, after both-leg costs)");
    console.log("-".repeat(82));
    console.log(
      ["pair".padEnd(18), "HL".padStart(6), "entryZ".padStart(7), "isSh".padStart(7), "oosSh".padStart(7), "oosRet".padStart(8), "oosDD".padStart(7), "trd".padStart(4)].join(" "),
    );
    for (const r of tradeable) {
      console.log([
        `${r.a}/${r.b}`.padEnd(18),
        r.halfLife.toFixed(0).padStart(6),
        r.entryZ.toFixed(2).padStart(7),
        r.isSharpe.toFixed(3).padStart(7),
        r.oosSharpe.toFixed(3).padStart(7),
        `${(r.oosRet * 100).toFixed(1)}%`.padStart(8),
        `${(r.oosMaxDd * 100).toFixed(1)}%`.padStart(7),
        String(r.oosTrades).padStart(4),
      ].join(" "));
    }
    console.log("");
    const consistent = tradeable.filter((r) => r.isSharpe > 0 && r.oosSharpe > 0);
    console.log("=".repeat(82));
    console.log("VERDICT");
    console.log("=".repeat(82));
    console.log(`${consistent.length}/${tradeable.length} backtested pairs have BOTH positive IS and positive OOS spread Sharpe.`);
    if (consistent.length) {
      console.log("Leads (positive IS+OOS — re-test on more data, watch with the rolling-coint monitor):");
      for (const r of consistent.slice(0, 8)) {
        console.log(`  • ${r.a}/${r.b} — OOS Sharpe ${r.oosSharpe.toFixed(3)}, OOS ret ${(r.oosRet * 100).toFixed(1)}%, HL ${r.halfLife.toFixed(0)} bars, ${r.oosTrades} trades`);
      }
    } else {
      console.log("No pair held a positive spread Sharpe out of sample after costs — same honest null as");
      console.log("the directional search. Cointegration over this window did not translate into OOS edge.");
    }
  } else {
    console.log("No pair cleared all gates (Johansen + EG-both + Hurst<0.5 + tradeable half-life).");
  }
  console.log("");
}

if (isMainThread) void main();
