/**
 * Cross-Sectional Crypto Factor Backtest — long the top-ranked coins, short the
 * bottom, rebalanced. THE canonical portfolio-level crypto edge our single-
 * instrument alpha-search structurally cannot see (alpha-search scores each
 * instrument in isolation; this ranks ACROSS the universe each rebalance bar).
 *
 * What it does:
 *   1. Align all symbols on common timestamps.
 *   2. At each rebalance bar: compute a per-symbol signal (past-N return for
 *      momentum; short-window return for reversal), rank cross-sectionally,
 *      form a dollar-neutral long/short book (long top-k, short bottom-k, equal
 *      weight) AND a long-only-top-k book. Optionally inverse-vol weight.
 *   3. Hold for the rebalance period, mark portfolio return each bar net of
 *      turnover cost (round-trip spread charged on |Δweight| per rebalance).
 *   4. Sweep a param grid; for each config IS(70%)/OOS(30%) split; rank by OOS
 *      per-bar Sharpe; PSR + deflated-Sharpe on pooled OOS returns with
 *      effectiveTrials = grid size (the multiple-testing correction).
 *
 * Reuses Gordon's ranking primitives (`rankCrossSectionalMomentum`,
 * `sizeCrossSectionalContrarian`) and its anti-overfitting infra
 * (`deflatedSharpeRatio` / `probabilisticSharpeRatio`), matching the honesty
 * pattern in `scripts/research/searches/alpha-search.ts`: the best raw Sharpe is upward-
 * biased by selection, so a config only "clears the bar" at DSR > 0.95.
 *
 * Run:  bun run scripts/research/scans/cross-sectional-scan.ts
 *
 * Pure data + Gordon primitives. Reads the committed crypto-extended momq bars.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { availableParallelism } from "node:os";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

import {
  rankCrossSectionalMomentum,
  type AssetReturnSeries,
} from "../../../src/core/alpha/cross-sectional-momentum.ts";
import {
  sizeCrossSectionalContrarian,
  type ContrarianAsset,
} from "../../../src/core/alpha/cross-sectional-contrarian.ts";
import {
  deflatedSharpeRatio,
  probabilisticSharpeRatio,
} from "../../../src/infra/trading/ops/backtestCredibility.ts";

// ── Config ──────────────────────────────────────────────────────────────────

// Default scope = the committed crypto-extended bars. Override the data dir to
// re-run on a different committed universe (e.g. the stable momq competition bars
// for parity tests) without touching code:
//   XSCAN_DATA_DIR=data/momq/bars bun run scripts/research/scans/cross-sectional-scan.ts
const DATA_DIR = join(process.cwd(), process.env.XSCAN_DATA_DIR ?? join("data", "momq", "crypto-extended"));

// The 5 names that actually transfer to the Model-to-Market competition.
const TRADEABLE = ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "BARUSD"];

// The momq crypto-extended bars carry spread=0 (no quoted-spread series). A
// cross-sectional book has HIGH turnover, so a zero-cost backtest is dishonest.
// Per-symbol cost = median(spread/close × 1e4) bps from the data; when that is 0
// (this dataset) we floor it at a realistic crypto round-trip taker cost so
// turnover is actually penalised. Stated plainly in the header each run.
const COST_FLOOR_BPS: Record<string, number> = { "1d": 8, "1h": 8 };

// IS/OOS split on the time axis (per the brief: 70/30).
const IS_FRAC = 0.7;

// ── Raw bar shapes ──────────────────────────────────────────────────────────

interface RawBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  spread: number;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1]! + s[m]!) / 2 : s[m]!;
}

// ── Loaded, time-aligned universe ───────────────────────────────────────────

interface LoadedSymbol {
  symbol: string;
  /** close keyed by epoch-seconds time. */
  closeByTime: Map<number, number>;
  medianSpreadBps: number;
}

function loadSymbol(symbol: string, tf: string): LoadedSymbol | null {
  const path = join(DATA_DIR, `${symbol}_${tf}.json`);
  if (!existsSync(path)) return null;
  const raw = readJson<RawBar[]>(path).filter(
    (b) => Number.isFinite(b.close) && b.close > 0,
  );
  if (raw.length < 60) return null;

  const closeByTime = new Map<number, number>();
  for (const b of raw) closeByTime.set(b.time, b.close);

  const spreadBps = raw
    .map((b) => (Number.isFinite(b.spread) && b.close > 0 ? (b.spread / b.close) * 10_000 : 0))
    .filter((x) => x > 0);
  const medianSpreadBps = median(spreadBps);

  return { symbol, closeByTime, medianSpreadBps };
}

interface AlignedUniverse {
  symbols: string[];
  /** times[t] = epoch-seconds of bar t (intersection across all symbols). */
  times: number[];
  /** closes[s][t] = close of symbol s at bar t. */
  closes: number[][];
  /** per-symbol round-trip cost in bps (median spread, floored). */
  costBps: number[];
}

function alignUniverse(symbols: string[], tf: string): AlignedUniverse | null {
  const loaded: LoadedSymbol[] = [];
  for (const sym of symbols) {
    const l = loadSymbol(sym, tf);
    if (l) loaded.push(l);
  }
  if (loaded.length < 2) return null;

  // Common timestamps = intersection of all symbols' bar times.
  let common: number[] = [...loaded[0]!.closeByTime.keys()];
  for (let li = 1; li < loaded.length; li++) {
    const keys = loaded[li]!.closeByTime;
    common = common.filter((t) => keys.has(t));
  }
  const times = common.sort((a, b) => a - b);
  if (times.length < 60) return null;

  const floor = COST_FLOOR_BPS[tf] ?? 8;
  const closes: number[][] = [];
  const costBps: number[] = [];
  for (const l of loaded) {
    closes.push(times.map((t) => l.closeByTime.get(t)!));
    costBps.push(Math.max(l.medianSpreadBps, floor));
  }

  return { symbols: loaded.map((l) => l.symbol), times, closes, costBps };
}

// ── Strategy params ─────────────────────────────────────────────────────────

type Side = "momentum" | "reversal";
type Book = "long_short" | "long_only";
type Weighting = "equal" | "vol_scaled";

interface Config {
  lookback: number; // signal window in bars
  rebalance: number; // holding / rebalance period in bars
  k: number; // top-k long, bottom-k short
  book: Book;
  weighting: Weighting;
  side: Side;
}

function buildGrid(): Config[] {
  const lookbacks = [7, 14, 30, 60, 90];
  const rebalances = [1, 5, 10];
  const ks = [1, 2, 3];
  const books: Book[] = ["long_short", "long_only"];
  const weightings: Weighting[] = ["equal", "vol_scaled"];
  const sides: Side[] = ["momentum", "reversal"];

  const grid: Config[] = [];
  for (const side of sides)
    for (const lookback of lookbacks)
      for (const rebalance of rebalances)
        for (const k of ks)
          for (const book of books)
            for (const weighting of weightings)
              grid.push({ lookback, rebalance, k, book, weighting, side });
  return grid;
}

// ── Weight construction at a rebalance bar ──────────────────────────────────

/**
 * Recent per-bar realized vol (sample std of step returns) over the last
 * `window` bars ending at bar `t` (inclusive), for inverse-vol weighting.
 */
function recentVol(closes: number[], t: number, window: number): number {
  const start = Math.max(1, t - window + 1);
  const rets: number[] = [];
  for (let i = start; i <= t; i++) {
    const prev = closes[i - 1]!;
    if (prev > 0) rets.push(closes[i]! / prev - 1);
  }
  if (rets.length < 2) return 0;
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  let acc = 0;
  for (const r of rets) acc += (r - m) ** 2;
  return Math.sqrt(acc / (rets.length - 1));
}

/**
 * Target weights at rebalance bar `t` using lookback prices ending at `t`.
 * Returns a per-symbol weight vector (index-aligned to `uni.symbols`).
 * Dollar-neutral for long_short (Σw = 0, Σ|w| = 1); gross-1 long for long_only.
 */
function targetWeights(uni: AlignedUniverse, t: number, cfg: Config): number[] {
  const N = uni.symbols.length;
  const weights = new Array<number>(N).fill(0);
  const lbStart = t - cfg.lookback;
  if (lbStart < 0) return weights;

  if (cfg.side === "reversal" && cfg.book === "long_short" && cfg.weighting === "vol_scaled") {
    // Use Gordon's continuous contrarian sizer directly (inverse-sigma, dollar-
    // neutral). It demeans cross-sectionally and inverse-vol weights — exactly
    // the short-term-reversal book — so we reuse it rather than re-derive.
    const assets: ContrarianAsset[] = uni.symbols.map((sym, i) => ({
      symbol: sym,
      prices: uni.closes[i]!.slice(lbStart, t + 1),
    }));
    const res = sizeCrossSectionalContrarian(assets, {
      volatilityWeighting: "inverse_sigma",
      minSymbols: 3,
    });
    if (res.verdict !== "weighted") return weights;
    const idx = new Map(uni.symbols.map((s, i) => [s, i]));
    for (const w of res.weights) weights[idx.get(w.symbol)!] = w.weight;
    return weights;
  }

  // Rank cross-sectionally by lookback return. For reversal we invert the rank
  // (buy losers / short winners); for momentum we keep it (buy winners).
  const assets: AssetReturnSeries[] = uni.symbols.map((sym, i) => ({
    symbol: sym,
    prices: uni.closes[i]!.slice(lbStart, t + 1),
  }));
  const ranked = rankCrossSectionalMomentum(assets, { minSymbols: 3 });
  if (ranked.verdict !== "ranked") return weights;

  // ranked.ranked is sorted best-return first. Pick top-k / bottom-k.
  const order = ranked.ranked.map((r) => r.symbol);
  const idx = new Map(uni.symbols.map((s, i) => [s, i]));
  const k = Math.min(cfg.k, Math.floor(order.length / (cfg.book === "long_short" ? 2 : 1)));
  if (k < 1) return weights;

  const winners = order.slice(0, k); // highest lookback return
  const losers = order.slice(order.length - k); // lowest lookback return

  const longNames = cfg.side === "momentum" ? winners : losers;
  const shortNames = cfg.side === "momentum" ? losers : winners;

  const volOf = (sym: string): number => {
    if (cfg.weighting === "equal") return 1;
    const v = recentVol(uni.closes[idx.get(sym)!]!, t, cfg.lookback);
    return v > 1e-6 ? 1 / v : 0;
  };

  if (cfg.book === "long_only") {
    const raw = longNames.map((s) => volOf(s));
    const sum = raw.reduce((a, b) => a + b, 0);
    if (sum <= 0) return weights;
    longNames.forEach((s, i) => (weights[idx.get(s)!] = raw[i]! / sum));
    return weights;
  }

  // long_short, dollar-neutral, gross 1 (long side 0.5, short side 0.5).
  const longRaw = longNames.map((s) => volOf(s));
  const shortRaw = shortNames.map((s) => volOf(s));
  const longSum = longRaw.reduce((a, b) => a + b, 0);
  const shortSum = shortRaw.reduce((a, b) => a + b, 0);
  if (longSum <= 0 || shortSum <= 0) return weights;
  longNames.forEach((s, i) => (weights[idx.get(s)!]! += 0.5 * (longRaw[i]! / longSum)));
  shortNames.forEach((s, i) => (weights[idx.get(s)!]! -= 0.5 * (shortRaw[i]! / shortSum)));
  return weights;
}

// ── Backtest one config over a [t0, t1) bar range ───────────────────────────

interface BacktestResult {
  /** per-bar portfolio returns (net of turnover cost). */
  barReturns: number[];
  /** sum of per-rebalance turnover (Σ|Δw|), for reporting. */
  totalTurnover: number;
  rebalances: number;
}

/**
 * Walk the bar range CAUSALLY. At a decision bar `t` the signal is computed from
 * prices through close[t]; those weights can only earn the NEXT bar's return
 * (t → t+1). We never book the t-1 → t return on a book that used close[t] to
 * pick its names — that would be look-ahead. So: decide at `t`, hold, and mark
 * the realized t → t+1 return; recompute on the rebalance cadence.
 *
 * Cost convention: a |Δw| change in a symbol's weight crosses the half-spread
 * twice over the position's life (in + out), so we charge the full per-symbol
 * round-trip spread (costBps) on |Δw|, as a drag on the bar the new book first
 * earns (t → t+1).
 */
function backtest(uni: AlignedUniverse, cfg: Config, t0: number, t1: number): BacktestResult {
  const N = uni.symbols.length;
  let weights = new Array<number>(N).fill(0);
  const barReturns: number[] = [];
  let totalTurnover = 0;
  let rebalances = 0;

  // Warmup: need lookback history before the first decision.
  const firstDecision = Math.max(t0, cfg.lookback);

  // Decide at bar t (using data through close[t]); earn the t → t+1 return.
  for (let t = firstDecision; t < t1 - 1; t++) {
    let costDrag = 0;
    if ((t - firstDecision) % cfg.rebalance === 0) {
      const target = targetWeights(uni, t, cfg);
      let turnover = 0;
      for (let s = 0; s < N; s++) {
        const dw = Math.abs(target[s]! - weights[s]!);
        turnover += dw;
        costDrag += dw * (uni.costBps[s]! / 10_000);
      }
      weights = target;
      totalTurnover += turnover;
      rebalances++;
    }
    // Realized next-bar return (t → t+1) on the currently held book.
    barReturns.push(portfolioBarReturn(uni, weights, t + 1) - costDrag);
  }

  return { barReturns, totalTurnover, rebalances };
}

/** Book return from bar t-1 to bar t given held weights. */
function portfolioBarReturn(uni: AlignedUniverse, weights: number[], t: number): number {
  let r = 0;
  for (let s = 0; s < uni.symbols.length; s++) {
    const w = weights[s]!;
    if (w === 0) continue;
    const prev = uni.closes[s]![t - 1]!;
    if (prev > 0) r += w * (uni.closes[s]![t]! / prev - 1);
  }
  return r;
}

// ── Metrics ─────────────────────────────────────────────────────────────────

function nonAnnualizedSharpe(rets: number[]): number {
  if (rets.length < 2) return 0;
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  let acc = 0;
  for (const r of rets) acc += (r - m) ** 2;
  const sd = Math.sqrt(acc / (rets.length - 1));
  return sd > 0 ? m / sd : 0;
}

function totalReturn(rets: number[]): number {
  let eq = 1;
  for (const r of rets) eq *= 1 + r;
  return eq - 1;
}

function maxDrawdown(rets: number[]): number {
  let eq = 1;
  let peak = 1;
  let mdd = 0;
  for (const r of rets) {
    eq *= 1 + r;
    if (eq > peak) peak = eq;
    const dd = peak > 0 ? (eq - peak) / peak : 0;
    if (dd < mdd) mdd = dd;
  }
  return mdd;
}

// ── Result rows ─────────────────────────────────────────────────────────────

interface ResultRow {
  cfg: Config;
  oosSharpe: number; // non-annualized per-bar Sharpe (competition metric)
  oosSharpeAnnual: number;
  oosReturnPct: number;
  maxDrawdownPct: number;
  avgTurnover: number; // per-rebalance Σ|Δw|
  psr: number;
  dsr: number;
  observedSharpeAnnual: number;
  expectedMaxNullSharpe: number;
  verdict: "PASS" | "marginal" | "FAIL";
}

function classify(r: Omit<ResultRow, "verdict">): ResultRow["verdict"] {
  if (r.oosSharpe > 0 && r.dsr > 0.95 && r.psr > 0.95) return "PASS";
  if (r.oosSharpe > 0 && (r.psr > 0.9 || r.dsr > 0.5)) return "marginal";
  return "FAIL";
}

function cfgLabel(c: Config): string {
  const w = c.weighting === "vol_scaled" ? "volw" : "eqw";
  const b = c.book === "long_short" ? "LS" : "LO";
  return `${c.side.slice(0, 3)}/lb${c.lookback}/rb${c.rebalance}/k${c.k}/${b}/${w}`;
}

function fmt(x: number, d = 3): string {
  return Number.isFinite(x) ? x.toFixed(d) : "n/a";
}

function periodsPerYearFor(tf: string): number {
  return tf === "1d" ? 365 : tf === "1h" ? 365 * 24 : 365 * 24 * 4;
}

// ── Score a slice of the grid (the parallelizable unit of work) ──────────────

/**
 * Score the configs at `configIdxs` (indices into `buildGrid()`) on the aligned
 * universe `uni`. Independent per config; `effectiveTrials` is the full grid
 * size, passed in so sharding does NOT change the deflated-Sharpe correction.
 * Workers and the serial path call this identically.
 */
function scoreConfigSlice(
  uni: AlignedUniverse,
  tf: string,
  configIdxs: number[],
  effectiveTrials: number,
): ResultRow[] {
  const periodsPerYear = periodsPerYearFor(tf);
  const grid = buildGrid();
  const isEnd = Math.floor(uni.times.length * IS_FRAC);

  const rows: ResultRow[] = [];
  for (const ci of configIdxs) {
    const cfg = grid[ci]!;
    const oos = backtest(uni, cfg, isEnd, uni.times.length);
    if (oos.barReturns.length < 10) continue;
    const psr = probabilisticSharpeRatio(oos.barReturns, 0, periodsPerYear);
    const dsr = deflatedSharpeRatio(oos.barReturns, effectiveTrials, periodsPerYear);
    const base: Omit<ResultRow, "verdict"> = {
      cfg,
      oosSharpe: nonAnnualizedSharpe(oos.barReturns),
      oosSharpeAnnual: nonAnnualizedSharpe(oos.barReturns) * Math.sqrt(periodsPerYear),
      oosReturnPct: totalReturn(oos.barReturns) * 100,
      maxDrawdownPct: maxDrawdown(oos.barReturns) * 100,
      avgTurnover: oos.rebalances > 0 ? oos.totalTurnover / oos.rebalances : 0,
      psr: psr.psr,
      dsr: dsr.dsr,
      observedSharpeAnnual: dsr.observedSharpe,
      expectedMaxNullSharpe: dsr.expectedMaxSharpeUnderNull,
    };
    rows.push({ ...base, verdict: classify(base) });
  }
  return rows;
}

// ── Worker entry: rebuild the universe from disk, score a config-slice ───────
//
// Workers re-read the bar files (cheap, ~ms/file) and rebuild the aligned
// universe rather than receiving the cloned price panel across the thread
// boundary. They then score only their assigned config indices.
if (!isMainThread && parentPort) {
  const { symbols, tf, configIdxs, effectiveTrials } = workerData as {
    symbols: string[];
    tf: string;
    configIdxs: number[];
    effectiveTrials: number;
  };
  const uni = alignUniverse(symbols, tf);
  parentPort.postMessage(uni ? scoreConfigSlice(uni, tf, configIdxs, effectiveTrials) : []);
}

/** Fan the grid out across worker threads — one config-shard per worker. */
function runShardedConfigs(
  symbols: string[],
  tf: string,
  nConfigs: number,
  effectiveTrials: number,
): Promise<ResultRow[]> {
  const nWorkers = Math.max(1, Math.min(availableParallelism(), nConfigs));
  // Round-robin config indices across workers — configs cost roughly the same
  // (same universe, same OOS length), so round-robin is even enough.
  const chunks: number[][] = Array.from({ length: nWorkers }, () => []);
  for (let ci = 0; ci < nConfigs; ci++) chunks[ci % nWorkers]!.push(ci);

  return Promise.all(
    chunks.map(
      (configIdxs) =>
        new Promise<ResultRow[]>((resolve, reject) => {
          const w = new Worker(new URL(import.meta.url), {
            workerData: { symbols, tf, configIdxs, effectiveTrials },
          });
          w.once("message", (rows: ResultRow[]) => {
            resolve(rows);
            void w.terminate();
          });
          w.once("error", reject);
        }),
    ),
  ).then((perChunk) => perChunk.flat());
}

// ── One pass: sweep grid on a universe + TF, print the verdict block ─────────

async function runPass(label: string, symbols: string[], tf: string): Promise<void> {
  console.log("=".repeat(82));
  console.log(`PASS: ${label}  (TF=${tf})`);
  console.log("=".repeat(82));

  const uni = alignUniverse(symbols, tf);
  if (!uni) {
    console.log("Insufficient aligned data for this universe/TF.\n");
    return;
  }

  const periodsPerYear = periodsPerYearFor(tf);
  const grid = buildGrid();
  const effectiveTrials = grid.length;

  const isEnd = Math.floor(uni.times.length * IS_FRAC);

  // Passive baseline: equal-weight buy-and-hold of the universe over OOS.
  const baselineReturns: number[] = [];
  for (let t = isEnd + 1; t < uni.times.length; t++) {
    let r = 0;
    for (let s = 0; s < uni.symbols.length; s++) {
      const prev = uni.closes[s]![t - 1]!;
      if (prev > 0) r += (1 / uni.symbols.length) * (uni.closes[s]![t]! / prev - 1);
    }
    baselineReturns.push(r);
  }
  const baselineSharpe = nonAnnualizedSharpe(baselineReturns);
  const baselineRet = totalReturn(baselineReturns);

  console.log(`Symbols (${uni.symbols.length})   : ${uni.symbols.join(", ")}`);
  console.log(`Aligned bars       : ${uni.times.length}  (IS ${isEnd} / OOS ${uni.times.length - isEnd})`);
  console.log(`Cost (bps, median) : ${uni.costBps.map((c) => c.toFixed(0)).join(",")}  ` +
    `[spread=0 in data → floored at ${COST_FLOOR_BPS[tf]}bps round-trip; turnover IS charged]`);
  console.log(`Grid configs       : ${grid.length}  (effectiveTrials for deflated bar)`);
  console.log(`Passive baseline   : equal-weight buy&hold OOS Sharpe ${fmt(baselineSharpe, 3)}, total ret ${(baselineRet * 100).toFixed(1)}%`);

  // Fan the grid sweep across worker threads — each config is independent and
  // effectiveTrials is fixed, so sharding is exact. Opt out with XSCAN_SERIAL=1.
  const serial = process.env.XSCAN_SERIAL === "1" || grid.length <= 1;
  const nWorkers = serial ? 1 : Math.min(availableParallelism(), grid.length);
  console.log(`Parallelism        : ${serial ? "serial (1 core)" : `${nWorkers} workers / ${availableParallelism()} cores, ${grid.length} configs`}`);
  console.log("");

  const allIdxs = Array.from({ length: grid.length }, (_v, i) => i);
  const rows: ResultRow[] = serial
    ? scoreConfigSlice(uni, tf, allIdxs, effectiveTrials)
    : await runShardedConfigs(uni.symbols, tf, grid.length, effectiveTrials);

  const verdictRank = { PASS: 0, marginal: 1, FAIL: 2 } as const;
  rows.sort((a, b) => {
    if (verdictRank[a.verdict] !== verdictRank[b.verdict]) return verdictRank[a.verdict] - verdictRank[b.verdict];
    if (b.dsr !== a.dsr) return b.dsr - a.dsr;
    if (b.oosSharpe !== a.oosSharpe) return b.oosSharpe - a.oosSharpe;
    // Deterministic final tie-break so the ranked table is independent of the
    // order rows were collected in (serial loop vs sharded-worker concatenation).
    return cfgLabel(a.cfg).localeCompare(cfgLabel(b.cfg));
  });

  const passes = rows.filter((r) => r.verdict === "PASS");
  const marginals = rows.filter((r) => r.verdict === "marginal");

  console.log(`Configs evaluated  : ${rows.length}`);
  console.log(`Expected-max Sharpe under null (annualized, ${effectiveTrials} trials): ${fmt(rows[0]?.expectedMaxNullSharpe ?? 0, 2)}`);
  console.log("");

  const TOP = 15;
  console.log(`TOP ${TOP} CONFIGS (verdict → deflated Sharpe → OOS Sharpe)`);
  console.log("-".repeat(82));
  console.log([
    "config".padEnd(30),
    "oosSh".padStart(7),
    "rawShA".padStart(7),
    "ret%".padStart(7),
    "mdd%".padStart(7),
    "turn".padStart(6),
    "PSR".padStart(5),
    "DSR".padStart(5),
    "verdict".padStart(8),
  ].join(" "));
  for (const r of rows.slice(0, TOP)) {
    console.log([
      cfgLabel(r.cfg).padEnd(30),
      fmt(r.oosSharpe, 3).padStart(7),
      fmt(r.observedSharpeAnnual, 2).padStart(7),
      fmt(r.oosReturnPct, 1).padStart(7),
      fmt(r.maxDrawdownPct, 1).padStart(7),
      fmt(r.avgTurnover, 2).padStart(6),
      fmt(r.psr, 2).padStart(5),
      fmt(r.dsr, 2).padStart(5),
      r.verdict.padStart(8),
    ].join(" "));
  }
  console.log("");

  console.log("VERDICT");
  console.log("-".repeat(82));
  console.log(`${passes.length}/${rows.length} configs CLEARED the deflated bar (DSR>0.95 & PSR>0.95 & OOS Sharpe>0).`);
  console.log(`${marginals.length}/${rows.length} configs were 'marginal' (positive OOS + decent PSR/DSR, below the bar).`);
  const best = rows[0];
  if (best) {
    console.log(`Best config        : ${cfgLabel(best.cfg)} — OOS Sharpe ${fmt(best.oosSharpe, 3)}, ` +
      `annualized ${fmt(best.observedSharpeAnnual, 2)}, DSR ${fmt(best.dsr, 3)}, PSR ${fmt(best.psr, 3)}, ret ${fmt(best.oosReturnPct, 1)}%`);
  }
  const bestActiveSharpe = rows.length ? Math.max(...rows.map((r) => r.oosSharpe)) : 0;
  if (baselineSharpe >= bestActiveSharpe) {
    console.log(`HONEST NOTE        : passive equal-weight buy&hold (OOS Sharpe ${fmt(baselineSharpe, 3)}) ` +
      `BEATS or ties the best active book (${fmt(bestActiveSharpe, 3)}). The cross-section adds nothing here.`);
  } else {
    console.log(`Active vs passive  : best active OOS Sharpe ${fmt(bestActiveSharpe, 3)} > passive ${fmt(baselineSharpe, 3)}.`);
  }
  console.log("");
}

// ── Main ────────────────────────────────────────────────────────────────────

function fullUniverse(tf: string): string[] {
  const suffix = `_${tf}.json`;
  return readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(suffix))
    .map((f) => f.slice(0, -suffix.length))
    .sort();
}

async function main(): Promise<void> {
  console.log("#".repeat(82));
  console.log("# CROSS-SECTIONAL CRYPTO FACTOR BACKTEST");
  console.log("# long top-k / short bottom-k, rebalanced — momentum & reversal, LS & LO.");
  console.log("# Ranking: rankCrossSectionalMomentum / sizeCrossSectionalContrarian.");
  console.log("# Rigor: PSR + deflated-Sharpe (trials = grid size), IS70/OOS30, cost on turnover.");
  console.log("#".repeat(82));
  console.log("");

  // Timeframes to sweep. Defaults to the crypto-extended 1d/1h; override for a
  // dataset with different bar suffixes (e.g. the M15-only momq competition bars
  // for parity tests): XSCAN_TFS=M15 XSCAN_DATA_DIR=data/momq/bars bun run ...
  const tfs = (process.env.XSCAN_TFS ?? "1d,1h").split(",").map((s) => s.trim()).filter(Boolean);

  for (const tf of tfs) {
    await runPass("FULL UNIVERSE", fullUniverse(tf), tf);
  }
  // The 5-name competition-tradeable cross-section (what actually transfers).
  for (const tf of tfs) {
    await runPass("5-NAME COMPETITION-TRADEABLE", TRADEABLE, tf);
  }
}

if (isMainThread) void main();
