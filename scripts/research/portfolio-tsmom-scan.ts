/**
 * Portfolio-level TSMOM + risk-allocation backtest.
 *
 * Gordon's `alpha-search.ts` tests one symbol at a time, so it is structurally
 * BLIND to the "managed futures" edge, which is a PORTFOLIO property:
 *
 *   1. TSMOM (time-series momentum) — each asset long/short by the sign of its
 *      OWN trailing return; the book's edge comes from the cross-asset average
 *      of many trend bets, not any single instrument.
 *   2. Vol-targeting — scale the WHOLE book to a fixed annualized vol so the
 *      Sharpe isn't dominated by a few high-vol names or by a vol regime shift.
 *   3. Inverse-vol / risk-parity — weight by 1/recent-vol so each asset
 *      contributes equal risk, not equal dollars.
 *
 * This file builds those portfolios over the 3yr extended crypto history and
 * asks the only question that matters: do they beat EQUAL-WEIGHT BUY-AND-HOLD
 * out-of-sample AFTER costs? Crypto trended up over much of the window, so a
 * long-biased book looks good on beta alone — the long-SHORT TSMOM (which
 * strips beta) and the active-minus-passive delta are what isolate real skill.
 *
 * Rigor: IS(70%)/OOS(30%) split, deflated-Sharpe (DSR>0.95) and PSR on pooled
 * OOS per-bar returns, with effectiveTrials = grid size (the multiple-testing
 * correction). Uses Gordon's own `backtestCredibility.ts` primitives and the
 * `vol-target-sizer.ts` book-level vol scaler.
 *
 * Run:   bun run scripts/research/portfolio-tsmom-scan.ts
 *        PORT_TF=1h bun run scripts/research/portfolio-tsmom-scan.ts
 *
 * Pure data + Gordon primitives. Reads only the committed extended bars.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { availableParallelism } from "node:os";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

import {
  deflatedSharpeRatio,
  probabilisticSharpeRatio,
} from "../../src/infra/trading/ops/backtestCredibility.ts";
import { sizeWithVolTarget } from "../../src/core/alpha/vol-target-sizer.ts";

// ── Config ──────────────────────────────────────────────────────────────────

// Default scope = the committed crypto-extended bars. Override the data dir to
// re-run on a different committed universe (e.g. the stable momq competition
// bars for parity tests) without touching code:
//   PORT_DATA_DIR=data/momq/bars PORT_TF=M15 bun run scripts/research/portfolio-tsmom-scan.ts
const DATA_DIR = join(process.cwd(), process.env.PORT_DATA_DIR ?? join("data", "momq", "crypto-extended"));
const TF = process.env.PORT_TF ?? "1d"; // 1d | 1h | M15
const PERIODS_PER_YEAR = TF === "1d" ? 365 : TF === "1h" ? 365 * 24 : 365 * 24 * 4;
const IS_FRAC = 0.7; // first 70% in-sample, back 30% out-of-sample.

// Crypto carries real spread even when this dataset records spread=0. Charging
// zero turnover cost would flatter every active (high-turnover) strategy and
// make the active-vs-passive comparison dishonest. So: cost = the data-implied
// per-symbol median spread, FLOORED at a conservative crypto taker spread. We
// report the data-implied spread separately so the floor is transparent.
const MIN_SPREAD_BPS = Number(process.env.PORT_MIN_SPREAD_BPS ?? 5); // 5bps half-spread floor.
const TARGET_ANNUAL_VOL = 0.15; // 15% book vol target for the vol-targeted variants.

// ── Raw bars ─────────────────────────────────────────────────────────────────

interface RawBar {
  time: number; // seconds
  open: number;
  high: number;
  low: number;
  close: number;
  spread?: number; // fraction of price (0 in this dataset)
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

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let acc = 0;
  for (const x of xs) acc += (x - m) ** 2;
  return Math.sqrt(acc / (xs.length - 1));
}

interface SymbolData {
  symbol: string;
  /** close keyed by timestamp (seconds). */
  closeByTime: Map<number, number>;
  medianSpreadBps: number;
}

function loadSymbol(symbol: string): SymbolData | null {
  const path = join(DATA_DIR, `${symbol}_${TF}.json`);
  if (!existsSync(path)) return null;
  const raw = readJson<RawBar[]>(path).filter((b) => Number.isFinite(b.close) && b.close > 0);
  if (raw.length < 60) return null;

  const closeByTime = new Map<number, number>();
  for (const b of raw) closeByTime.set(b.time, b.close);

  const spreadsBps = raw
    .map((b) => (Number.isFinite(b.spread) && b.spread! > 0 ? b.spread! * 10_000 : NaN))
    .filter((s) => Number.isFinite(s)) as number[];
  const dataSpreadBps = spreadsBps.length ? median(spreadsBps) : 0;

  return { symbol, closeByTime, medianSpreadBps: dataSpreadBps };
}

// ── Aligned panel ────────────────────────────────────────────────────────────

interface Panel {
  symbols: string[];
  times: number[]; // sorted union timestamps
  /** close[t][s] — NaN when symbol s has no bar at time t. */
  close: number[][];
  /** per-symbol effective spread cost (bps) used to charge turnover. */
  spreadBps: number[];
  /** data-implied spread (bps) before flooring — for reporting. */
  dataSpreadBps: number[];
}

function buildPanel(symData: SymbolData[]): Panel {
  const symbols = symData.map((d) => d.symbol);
  const timeSet = new Set<number>();
  for (const d of symData) for (const t of d.closeByTime.keys()) timeSet.add(t);
  const times = [...timeSet].sort((a, b) => a - b);

  const close: number[][] = times.map((t) =>
    symData.map((d) => d.closeByTime.get(t) ?? NaN),
  );
  const dataSpreadBps = symData.map((d) => d.medianSpreadBps);
  const spreadBps = dataSpreadBps.map((s) => Math.max(s, MIN_SPREAD_BPS));

  return { symbols, times, close, spreadBps, dataSpreadBps };
}

// ── Per-asset return + vol panels (derived once) ─────────────────────────────

interface Derived {
  /** ret[t][s] = close[t]/close[t-1] - 1, NaN if either close missing. */
  ret: number[][];
  /** active[t][s] = symbol s has a usable return at bar t (used for weighting). */
  active: boolean[][];
  nT: number;
  nS: number;
}

function deriveReturns(panel: Panel): Derived {
  const nT = panel.times.length;
  const nS = panel.symbols.length;
  const ret: number[][] = Array.from({ length: nT }, () => new Array(nS).fill(NaN));
  const active: boolean[][] = Array.from({ length: nT }, () => new Array(nS).fill(false));

  for (let s = 0; s < nS; s++) {
    for (let t = 1; t < nT; t++) {
      const prev = panel.close[t - 1]![s]!;
      const cur = panel.close[t]![s]!;
      if (Number.isFinite(prev) && prev > 0 && Number.isFinite(cur) && cur > 0) {
        ret[t]![s] = cur / prev - 1;
        active[t]![s] = true;
      }
    }
  }
  return { ret, active, nT, nS };
}

// ── Strategy weight computation ──────────────────────────────────────────────

type Style = "ls_tsmom" | "lo_tsmom" | "inverse_vol" | "buyhold";

interface Config {
  style: Style;
  lookback: number; // bars used for the trend signal / vol estimate
  rebalance: number; // recompute target weights every M bars
  volTarget: boolean; // scale the whole book to TARGET_ANNUAL_VOL
  id: string;
}

/** Trailing return over `lookback` bars ending at t-1 (no look-ahead). */
function trailingReturn(close: number[][], t: number, s: number, lookback: number): number {
  const i0 = t - lookback;
  if (i0 < 0) return NaN;
  const p0 = close[i0]![s]!;
  const p1 = close[t - 1]![s]!; // signal uses info up to the prior close
  if (!Number.isFinite(p0) || p0 <= 0 || !Number.isFinite(p1) || p1 <= 0) return NaN;
  return p1 / p0 - 1;
}

/** Trailing realized vol (per-bar stddev) over `lookback` returns ending at t-1. */
function trailingVol(ret: number[][], t: number, s: number, lookback: number): number {
  const rs: number[] = [];
  for (let i = t - lookback; i < t; i++) {
    if (i < 1) continue;
    const r = ret[i]![s]!;
    if (Number.isFinite(r)) rs.push(r);
  }
  if (rs.length < 3) return NaN;
  return std(rs);
}

/**
 * Compute target weights at bar t for the given style, using only information
 * available through bar t-1. Returns a per-symbol weight array (NaN/0 for
 * inactive symbols). Weights are NOT yet vol-target-scaled — that is applied to
 * the whole book afterward.
 *
 * Risk-balancing: every style normalizes by inverse trailing vol so each
 * position contributes ~equal risk (equal-vol-contribution book), which is the
 * standard managed-futures construction. Gross long-only books are scaled to
 * sum(|w|)=1; long-short books are scaled to sum(|w|)=1 (dollar-neutral-ish in
 * risk space, beta-stripped by the long/short signs).
 */
function targetWeights(
  panel: Panel,
  der: Derived,
  cfg: Config,
  t: number,
): number[] {
  const nS = der.nS;
  const w = new Array(nS).fill(0);

  if (cfg.style === "buyhold") {
    // Equal-weight across active symbols, long-only, no signal, no vol scaling.
    const act: number[] = [];
    for (let s = 0; s < nS; s++) if (der.active[t]![s]) act.push(s);
    if (act.length === 0) return w;
    for (const s of act) w[s] = 1 / act.length;
    return w;
  }

  // Risk weight = 1 / trailing vol (equal-risk contribution), gated by signal.
  const raw: number[] = new Array(nS).fill(0);
  for (let s = 0; s < nS; s++) {
    if (!der.active[t]![s]) continue;
    const vol = trailingVol(der.ret, t, s, cfg.lookback);
    if (!Number.isFinite(vol) || vol <= 0) continue;
    const invVol = 1 / vol;

    if (cfg.style === "inverse_vol") {
      raw[s] = invVol; // long-only passive-ish risk parity, no momentum gate.
    } else {
      const mom = trailingReturn(panel.close, t, s, cfg.lookback);
      if (!Number.isFinite(mom)) continue;
      if (cfg.style === "ls_tsmom") {
        raw[s] = Math.sign(mom) * invVol; // long winners, short losers.
      } else {
        // lo_tsmom: long only the up-trending names, equal-risk among them.
        raw[s] = mom > 0 ? invVol : 0;
      }
    }
  }

  const gross = raw.reduce((a, v) => a + Math.abs(v), 0);
  if (gross <= 0) return w;
  for (let s = 0; s < nS; s++) w[s] = raw[s]! / gross; // sum(|w|) = 1.
  return w;
}

// ── Portfolio backtest ───────────────────────────────────────────────────────

interface BTResult {
  /** per-bar portfolio returns (net of cost) over the full series. */
  barReturns: number[];
  /** per-bar turnover (sum |Δw|) — for cost + reporting. */
  turnover: number[];
  /** index in barReturns where OOS begins. */
  oosStart: number;
}

/**
 * Single forward pass. At each bar t we hold the weights decided at the last
 * rebalance (using info through t-1), realize ret[t]·w, then on rebalance bars
 * recompute target weights and charge turnover cost on the weight change.
 *
 * Cost model: per symbol, |Δw_s| × spread_s bps, charged on the rebalance bar.
 * For vol-targeted books the book multiplier scales weights, so the re-
 * leveraging shows up in |Δw| — which is the honest cost of vol-targeting.
 */
function runBacktest(panel: Panel, der: Derived, cfg: Config): BTResult {
  const nT = der.nT;
  const nS = der.nS;
  const barReturns: number[] = [];
  const turnoverSeries: number[] = [];
  const spreadFrac = panel.spreadBps.map((b) => b / 10_000);

  let heldWeights = new Array(nS).fill(0); // weights currently held (post-scaling).
  // warmup so trailing windows are valid: need lookback bars of returns.
  const warmup = cfg.lookback + 2;

  for (let t = warmup; t < nT; t++) {
    // 1) realize today's return on weights held from prior rebalance.
    let portRet = 0;
    for (let s = 0; s < nS; s++) {
      const r = der.ret[t]![s]!;
      if (Number.isFinite(r)) portRet += heldWeights[s]! * r;
    }

    // 2) rebalance? recompute target, vol-scale, charge per-symbol cost.
    let turn = 0;
    let cost = 0;
    const isRebal = (t - warmup) % cfg.rebalance === 0;
    if (isRebal) {
      let target = targetWeights(panel, der, cfg, t);

      if (cfg.volTarget && cfg.style !== "buyhold") {
        // Book-level vol: realized per-bar vol of the target book over the
        // trailing window, annualized; scale via Gordon's vol-target sizer.
        const bookVolAnn = bookTrailingVol(der, target, t, cfg.lookback) * Math.sqrt(PERIODS_PER_YEAR);
        if (Number.isFinite(bookVolAnn) && bookVolAnn > 0) {
          const sized = sizeWithVolTarget(
            { targetAnnualVol: TARGET_ANNUAL_VOL, currentAnnualVol: bookVolAnn, currentNotionalFraction: 1 },
            { leverageCap: 3, leverageFloor: 0, noTradeBandPct: 0 },
          );
          const mult = sized.clippedMultiplier > 0 ? sized.clippedMultiplier : 1;
          target = target.map((x) => x * mult);
        }
      }

      for (let s = 0; s < nS; s++) {
        const dw = Math.abs(target[s]! - heldWeights[s]!);
        turn += dw;
        cost += dw * spreadFrac[s]!; // |Δw_s| × half-spread fraction.
      }
      heldWeights = target;
    }

    barReturns.push(portRet - cost);
    turnoverSeries.push(turn);
  }

  const oosStart = Math.floor(barReturns.length * IS_FRAC);
  return { barReturns, turnover: turnoverSeries, oosStart };
}

/** Per-bar vol of the (unscaled) target book over the trailing window. */
function bookTrailingVol(der: Derived, weights: number[], t: number, lookback: number): number {
  const rs: number[] = [];
  for (let i = t - lookback; i < t; i++) {
    if (i < 1) continue;
    let r = 0;
    let any = false;
    for (let s = 0; s < der.nS; s++) {
      const rr = der.ret[i]![s]!;
      if (Number.isFinite(rr) && weights[s] !== 0) {
        r += weights[s]! * rr;
        any = true;
      }
    }
    if (any) rs.push(r);
  }
  if (rs.length < 3) return NaN;
  return std(rs);
}

// ── Metrics ──────────────────────────────────────────────────────────────────

function sharpeNonAnn(rets: number[]): number {
  if (rets.length < 2) return 0;
  const m = mean(rets);
  const sd = std(rets);
  return sd > 0 ? m / sd : 0;
}

function maxDrawdown(rets: number[]): number {
  let eq = 1;
  let peak = 1;
  let mdd = 0;
  for (const r of rets) {
    eq *= 1 + r;
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak;
    if (dd > mdd) mdd = dd;
  }
  return mdd;
}

function totalReturn(rets: number[]): number {
  let eq = 1;
  for (const r of rets) eq *= 1 + r;
  return eq - 1;
}

// ── Driver ────────────────────────────────────────────────────────────────────

function buildGrid(): Config[] {
  const lookbacks = [14, 30, 60, 90, 180];
  const rebalances = [1, 5, 10, 20];
  const styles: Style[] = ["ls_tsmom", "lo_tsmom", "inverse_vol"];
  const volTargets = [false, true];

  const grid: Config[] = [];
  for (const style of styles) {
    for (const lookback of lookbacks) {
      for (const rebalance of rebalances) {
        for (const volTarget of volTargets) {
          grid.push({
            style,
            lookback,
            rebalance,
            volTarget,
            id: `${style}|lb${lookback}|rb${rebalance}|vt${volTarget ? 1 : 0}`,
          });
        }
      }
    }
  }
  // Buy-and-hold benchmark: one config per lookback-irrelevant — we add a single
  // passive bench (lookback only sets warmup; use the shortest so it spans the
  // most data). It is NOT part of the active grid trial count.
  return grid;
}

interface Row {
  cfg: Config;
  oosSharpeBar: number;
  oosSharpeAnn: number;
  oosTotalRet: number;
  oosMaxDD: number;
  oosTurnoverPerBar: number;
  oosReturns: number[];
  psr: number;
  dsr: number;
  observedSharpeAnn: number;
}

function scoreConfig(panel: Panel, der: Derived, cfg: Config, trials: number): Row {
  const bt = runBacktest(panel, der, cfg);
  const oos = bt.barReturns.slice(bt.oosStart);
  const oosTurn = bt.turnover.slice(bt.oosStart);

  const sBar = sharpeNonAnn(oos);
  const psr = probabilisticSharpeRatio(oos, 0, PERIODS_PER_YEAR);
  const dsr = deflatedSharpeRatio(oos, trials, PERIODS_PER_YEAR);

  return {
    cfg,
    oosSharpeBar: sBar,
    oosSharpeAnn: sBar * Math.sqrt(PERIODS_PER_YEAR),
    oosTotalRet: totalReturn(oos),
    oosMaxDD: maxDrawdown(oos),
    oosTurnoverPerBar: mean(oosTurn),
    oosReturns: oos,
    psr: psr.psr,
    dsr: dsr.dsr,
    observedSharpeAnn: dsr.observedSharpe,
  };
}

function fmt(x: number, d = 3): string {
  return Number.isFinite(x) ? x.toFixed(d) : "n/a";
}

/** Rebuild the aligned panel + derived returns from disk (worker + main share this). */
function loadPanel(): { panel: Panel; der: Derived } {
  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith(`_${TF}.json`));
  const symbols = files.map((f) => f.slice(0, -`_${TF}.json`.length)).sort();

  const symData: SymbolData[] = [];
  for (const sym of symbols) {
    const d = loadSymbol(sym);
    if (d) symData.push(d);
  }

  const panel = buildPanel(symData);
  const der = deriveReturns(panel);
  return { panel, der };
}

/**
 * Score the configs at `configIdxs` (indices into `buildGrid()`). Each config is
 * independent and `trials` is the full grid size, so sharding does NOT change the
 * deflated-Sharpe correction. Worker + serial path call this identically.
 */
function scoreConfigSlice(panel: Panel, der: Derived, configIdxs: number[], trials: number): Row[] {
  const grid = buildGrid();
  return configIdxs.map((ci) => scoreConfig(panel, der, grid[ci]!, trials));
}

// ── Worker entry: rebuild the panel from disk, score a config-slice ──────────
//
// Workers re-read the bar files (cheap) and rebuild the aligned panel rather than
// receiving the cloned price panel across the thread boundary, then score only
// their assigned config indices.
if (!isMainThread && parentPort) {
  const { configIdxs, trials } = workerData as { configIdxs: number[]; trials: number };
  const { panel, der } = loadPanel();
  parentPort.postMessage(scoreConfigSlice(panel, der, configIdxs, trials));
}

/** Fan the grid out across worker threads — one config-shard per worker. */
function runShardedConfigs(nConfigs: number, trials: number): Promise<Row[]> {
  const nWorkers = Math.max(1, Math.min(availableParallelism(), nConfigs));
  // Round-robin config indices across workers — configs cost roughly the same
  // (same panel, same OOS length), so round-robin is even enough.
  const chunks: number[][] = Array.from({ length: nWorkers }, () => []);
  for (let ci = 0; ci < nConfigs; ci++) chunks[ci % nWorkers]!.push(ci);

  return Promise.all(
    chunks.map(
      (configIdxs) =>
        new Promise<Row[]>((resolve, reject) => {
          const w = new Worker(new URL(import.meta.url), {
            workerData: { configIdxs, trials },
          });
          w.once("message", (rows: Row[]) => {
            resolve(rows);
            void w.terminate();
          });
          w.once("error", reject);
        }),
    ),
  ).then((perChunk) => perChunk.flat());
}

async function main(): Promise<void> {
  const { panel, der } = loadPanel();

  const grid = buildGrid();
  const trials = grid.length; // deflated-Sharpe trial count = active grid size.

  // Passive benchmark (NOT counted in trials; it is the bar to beat).
  const benchCfg: Config = { style: "buyhold", lookback: 14, rebalance: 20, volTarget: false, id: "buyhold_eqw" };
  const bench = scoreConfig(panel, der, benchCfg, trials);

  console.log("=".repeat(82));
  console.log(`PORTFOLIO TSMOM + RISK-ALLOCATION BACKTEST — ${TF} extended crypto`);
  console.log("=".repeat(82));
  console.log(`Symbols           : ${panel.symbols.length} (${panel.symbols.join(", ")})`);
  console.log(`Aligned bars      : ${panel.times.length} (union grid; per-asset active when it has data)`);
  console.log(`Period            : ${new Date(panel.times[0]! * 1000).toISOString().slice(0, 10)} → ${new Date(panel.times.at(-1)! * 1000).toISOString().slice(0, 10)}`);
  console.log(`IS/OOS            : ${(IS_FRAC * 100).toFixed(0)}% / ${((1 - IS_FRAC) * 100).toFixed(0)}%`);
  console.log(`Active grid (trials): ${trials} configs`);
  console.log(`periodsPerYear    : ${PERIODS_PER_YEAR}`);
  const dataSpread = median(panel.dataSpreadBps);
  console.log(`Spread (data-implied median): ${fmt(dataSpread, 2)} bps — FLOORED to ${MIN_SPREAD_BPS} bps for cost (dataset records spread=0)`);
  console.log(`Vol target (vt=1 configs): ${(TARGET_ANNUAL_VOL * 100).toFixed(0)}% annualized`);

  // Fan the grid sweep across worker threads — each config is independent and
  // trials is fixed, so sharding is exact. Opt out with PORT_SERIAL=1.
  const serial = process.env.PORT_SERIAL === "1" || grid.length <= 1;
  const nWorkers = serial ? 1 : Math.min(availableParallelism(), grid.length);
  console.log(`Parallelism       : ${serial ? "serial (1 core)" : `${nWorkers} workers / ${availableParallelism()} cores, ${grid.length} configs`}`);
  console.log("");

  const allIdxs = Array.from({ length: grid.length }, (_v, i) => i);
  const rows: Row[] = serial
    ? scoreConfigSlice(panel, der, allIdxs, trials)
    : await runShardedConfigs(grid.length, trials);

  // Rank by OOS bar Sharpe.
  rows.sort((a, b) => {
    if (b.oosSharpeBar !== a.oosSharpeBar) return b.oosSharpeBar - a.oosSharpeBar;
    // Deterministic final tie-break so the ranked table is independent of the
    // order rows were collected in (serial loop vs sharded-worker concatenation).
    return a.cfg.id.localeCompare(b.cfg.id);
  });

  // ── Honesty: active vs passive, side by side ──
  console.log("PASSIVE BENCHMARK (the bar every active strategy must beat OOS, after costs)");
  console.log("-".repeat(82));
  console.log(
    `equal-weight buy&hold : OOS barSharpe ${fmt(bench.oosSharpeBar, 4)}  annSharpe ${fmt(bench.oosSharpeAnn, 2)}  ` +
      `totRet ${fmt(bench.oosTotalRet * 100, 1)}%  maxDD ${fmt(bench.oosMaxDD * 100, 1)}%`,
  );
  console.log("");

  // ── Top configs ──
  const TOP = 20;
  console.log(`TOP ${TOP} ACTIVE CONFIGS (ranked by OOS per-bar Sharpe — the competition metric)`);
  console.log("-".repeat(82));
  console.log(
    [
      "config".padEnd(26),
      "oosBarSh".padStart(9),
      "oosAnnSh".padStart(9),
      "totRet%".padStart(8),
      "maxDD%".padStart(7),
      "turn/bar".padStart(9),
      "PSR".padStart(5),
      "DSR".padStart(5),
      "beatBH".padStart(7),
    ].join(" "),
  );
  for (const r of rows.slice(0, TOP)) {
    const beat = r.oosSharpeBar > bench.oosSharpeBar ? "yes" : "no";
    console.log(
      [
        r.cfg.id.padEnd(26),
        fmt(r.oosSharpeBar, 4).padStart(9),
        fmt(r.oosSharpeAnn, 2).padStart(9),
        fmt(r.oosTotalRet * 100, 1).padStart(8),
        fmt(r.oosMaxDD * 100, 1).padStart(7),
        fmt(r.oosTurnoverPerBar, 3).padStart(9),
        fmt(r.psr, 2).padStart(5),
        fmt(r.dsr, 2).padStart(5),
        beat.padStart(7),
      ].join(" "),
    );
  }
  console.log("");

  // ── Per-style summary ──
  console.log("PER-STYLE SUMMARY (best OOS bar-Sharpe in each family, vs buy&hold)");
  console.log("-".repeat(82));
  for (const style of ["ls_tsmom", "lo_tsmom", "inverse_vol"] as Style[]) {
    const fam = rows.filter((r) => r.cfg.style === style);
    const best = fam.reduce((a, b) => (b.oosSharpeBar > a.oosSharpeBar ? b : a));
    const nBeat = fam.filter((r) => r.oosSharpeBar > bench.oosSharpeBar).length;
    console.log(
      `${style.padEnd(13)} best ${best.cfg.id.padEnd(22)} oosBarSh ${fmt(best.oosSharpeBar, 4)}  ` +
        `annSh ${fmt(best.oosSharpeAnn, 2)}  DSR ${fmt(best.dsr, 2)}  | ${nBeat}/${fam.length} configs beat buy&hold OOS`,
    );
  }
  console.log("");

  // ── Deflated-Sharpe verdict ──
  const cleared = rows.filter((r) => r.dsr > 0.95 && r.oosSharpeBar > 0);
  const marginal = rows.filter((r) => r.dsr > 0.5 && r.dsr <= 0.95 && r.oosSharpeBar > 0);
  const expMaxNull = (() => {
    const d = deflatedSharpeRatio(rows[0]!.oosReturns, trials, PERIODS_PER_YEAR);
    return d.expectedMaxSharpeUnderNull;
  })();

  console.log("=".repeat(82));
  console.log("DEFLATED-SHARPE VERDICT");
  console.log("=".repeat(82));
  console.log(`Expected-max Sharpe under null (annualized, ${trials} trials): ${fmt(expMaxNull, 2)}`);
  console.log(`Configs clearing DSR>0.95 (deflated bar): ${cleared.length}`);
  console.log(`Configs marginal (0.5<DSR<=0.95, positive OOS): ${marginal.length}`);
  console.log("");

  if (cleared.length > 0) {
    console.log("CLEARED THE DEFLATED BAR:");
    for (const r of cleared.slice(0, 10)) {
      console.log(
        `  • ${r.cfg.id} — OOS barSharpe ${fmt(r.oosSharpeBar, 4)}, annSharpe ${fmt(r.oosSharpeAnn, 2)}, ` +
          `DSR ${fmt(r.dsr, 3)}, PSR ${fmt(r.psr, 3)}, beatBH ${r.oosSharpeBar > bench.oosSharpeBar ? "yes" : "NO"}`,
      );
    }
  } else {
    console.log("NOTHING cleared the deflated bar (DSR>0.95).");
  }
  console.log("");

  // ── The skill question ──
  const best = rows[0]!;
  const lsBest = rows.filter((r) => r.cfg.style === "ls_tsmom").reduce((a, b) => (b.oosSharpeBar > a.oosSharpeBar ? b : a));
  const nBeatBH = rows.filter((r) => r.oosSharpeBar > bench.oosSharpeBar).length;

  console.log("=".repeat(82));
  console.log("ACTIVE vs PASSIVE — IS THE PORTFOLIO EDGE REAL?");
  console.log("=".repeat(82));
  console.log(`Equal-weight buy&hold OOS bar-Sharpe : ${fmt(bench.oosSharpeBar, 4)} (ann ${fmt(bench.oosSharpeAnn, 2)})`);
  console.log(`Best ACTIVE config OOS bar-Sharpe    : ${fmt(best.oosSharpeBar, 4)} (${best.cfg.id})`);
  console.log(`Best LONG-SHORT TSMOM (beta-stripped) : ${fmt(lsBest.oosSharpeBar, 4)} (${lsBest.cfg.id}), DSR ${fmt(lsBest.dsr, 2)}`);
  console.log(`Active configs beating buy&hold OOS  : ${nBeatBH}/${rows.length}`);
  console.log(`Best active − passive (bar-Sharpe Δ) : ${fmt(best.oosSharpeBar - bench.oosSharpeBar, 4)}`);
  console.log("");
}

if (isMainThread) void main();
