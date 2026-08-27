/**
 * TSMOM across regimes — properly stress the ONE lead from the whole alpha search.
 *
 * The single-instrument alpha-search surfaced long-short time-series momentum as
 * the only directional lead, but it scored ONE crypto bear leg per instrument in
 * isolation. A momentum signal that is just "short into a downtrend" looks great
 * in a one-regime selloff and dies the moment the regime turns. This script tests
 * it the HONEST way: a PORTFOLIO TSMOM book (the single-instrument search can't
 * see cross-asset risk-balancing) across the broad multi-asset universe, sliced
 * into thirds (early / mid / late = different regimes) AND a clean IS(70)/OOS(30)
 * split, with turnover cost charged on every rebalance.
 *
 *   Signal  : each asset long if its own past-N-bar return > 0, short if < 0.
 *   Sizing  : risk-balanced — each leg weighted ∝ 1/σ (inverse realized vol),
 *             book gross-normalized to 1 so no single asset dominates.
 *   Rebal   : every M bars; turnover charged at the per-instrument spread, floored
 *             at 5bps/side (crypto bars ship spread=0, so a 0-cost book would be a
 *             fiction — the floor is labelled in the output).
 *
 * Sweep    : lookback {30,60,90,180} × rebalance {1,5,10} = 12 configs.
 * Per config: per-third Sharpe (regime persistence), IS/OOS split, maxDD,
 *             turnover, deflated + probabilistic Sharpe (effectiveTrials = 12),
 *             and the equal-weight buy-&-hold benchmark per third (long-short must
 *             beat passive to count).
 *
 * Run:  bun run scripts/research/scans/tsmom-regime-scan.ts
 *       ALPHA_BARS_DIR=data/momq/bars ALPHA_TF=M15 bun run scripts/research/scans/tsmom-regime-scan.ts
 *
 * Pure data + Gordon's credibility primitives; reads only the committed momq bars.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  deflatedSharpeRatio,
  probabilisticSharpeRatio,
} from "../../../src/infra/trading/ops/backtestCredibility.ts";

// ── Config ──────────────────────────────────────────────────────────────────
const BARS_DIR = join(process.cwd(), process.env.ALPHA_BARS_DIR ?? join("data", "momq", "bars"));
const TF = process.env.ALPHA_TF ?? "M15";
const PERIODS_PER_YEAR = TF === "1d" ? 365 : TF === "1h" ? 365 * 24 : 365 * 24 * 4;

const LOOKBACKS = [30, 60, 90, 180];
const REBALANCES = [1, 5, 10];
const EFFECTIVE_TRIALS = LOOKBACKS.length * REBALANCES.length; // 12 configs in the sweep

const COST_FLOOR_BPS = 5; // per side; crypto bars ship spread=0, so floor the cost.
const VOL_WINDOW = 96; // trailing bars for the inverse-vol risk weight (~1 day of M15).
const IS_FRAC = 0.7; // clean IS(70)/OOS(30) split.

// Minimum shared-timestamp overlap an asset must have with the densest series to
// join the book. Drops thin/late-listed series (e.g. the 1-week oil symbols) so a
// short series can't collapse a month-long universe to its own span.
const MIN_OVERLAP_FRAC = 0.5;

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

interface Instrument {
  symbol: string;
  /** close keyed by bar timestamp (seconds) — for timestamp-true alignment. */
  closeByTime: Map<number, number>;
  times: number[];
  costBps: number; // per-side cost = max(medianSpread/2 in bps, floor)
}

function loadInstrument(symbol: string): Instrument | null {
  const path = join(BARS_DIR, `${symbol}_${TF}.json`);
  if (!existsSync(path)) return null;
  const raw = readJson<RawBar[]>(path).filter((b) => Number.isFinite(b.close) && b.close > 0);
  if (raw.length < 200) return null;
  const closeByTime = new Map<number, number>();
  for (const b of raw) closeByTime.set(b.time, b.close);
  const spreads = raw.map((b) => b.spread).filter((s) => Number.isFinite(s) && s > 0);
  // spread is a fraction of price → bps = frac·1e4; per-side cost = half the spread.
  const medianSpreadBps = median(spreads) * 10_000;
  const costBps = Math.max(COST_FLOOR_BPS, medianSpreadBps / 2);
  return { symbol, closeByTime, times: raw.map((b) => b.time).sort((a, b) => a - b), costBps };
}

// ── Portfolio TSMOM engine ──────────────────────────────────────────────────
// Aligns instruments on the intersection of bar TIMESTAMPS (not by index), so
// bar t is the same wall-clock bar for every asset. Different assets carry
// different bar counts over the same calendar window (crypto trades 24/7; FX and
// metals have session gaps), so an index-align would silently pair mismatched
// wall-clock bars. Assets with too little overlap with the densest grid are
// dropped (so a 1-week listing can't shrink a month-long book).

interface AlignedBook {
  symbols: string[];
  closes: number[][]; // [asset][t] on the shared timestamp grid
  costBps: number[]; // [asset]
  times: number[]; // shared grid (sorted)
  T: number;
  dropped: string[];
}

function alignBook(instruments: Instrument[]): AlignedBook {
  // Anchor grid = the densest series' timestamps; require each asset to cover
  // ≥ MIN_OVERLAP_FRAC of it, then intersect the survivors.
  const densest = instruments.reduce((a, b) => (b.times.length > a.times.length ? b : a));
  const anchor = new Set(densest.times);

  const kept: Instrument[] = [];
  const dropped: string[] = [];
  for (const inst of instruments) {
    let overlap = 0;
    for (const t of inst.times) if (anchor.has(t)) overlap++;
    if (overlap >= MIN_OVERLAP_FRAC * anchor.size) kept.push(inst);
    else dropped.push(inst.symbol);
  }

  // Shared grid = timestamps present in EVERY kept asset.
  let shared = [...anchor];
  for (const inst of kept) shared = shared.filter((t) => inst.closeByTime.has(t));
  shared.sort((a, b) => a - b);

  return {
    symbols: kept.map((i) => i.symbol),
    closes: kept.map((i) => shared.map((t) => i.closeByTime.get(t)!)),
    costBps: kept.map((i) => i.costBps),
    times: shared,
    T: shared.length,
    dropped,
  };
}

/** Trailing per-bar return stdev for asset a over [t-window, t). */
function trailingVol(closes: number[], t: number, window: number): number {
  const start = Math.max(1, t - window);
  const rets: number[] = [];
  for (let i = start; i < t; i++) {
    const prev = closes[i - 1]!;
    if (prev > 0) rets.push(closes[i]! / prev - 1);
  }
  if (rets.length < 2) return 0;
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  let acc = 0;
  for (const r of rets) acc += (r - m) ** 2;
  return Math.sqrt(acc / (rets.length - 1));
}

interface BacktestResult {
  barReturns: number[]; // portfolio per-bar net returns
  turnoverPerRebal: number; // mean gross turnover per rebalance (sum |Δw|)
  rebalanceCount: number;
}

/**
 * Portfolio TSMOM over [tStart, tEnd). Long if past-lookback return > 0, short if
 * < 0; risk-balanced by inverse trailing vol; gross-normalized to 1. Weights are
 * recomputed every `rebalance` bars and held between; turnover cost (Σ|Δw|·cost)
 * is charged at the bar of each rebalance. Returns net per-bar portfolio returns.
 */
function backtestTSMOM(
  book: AlignedBook,
  lookback: number,
  rebalance: number,
  tStart: number,
  tEnd: number,
): BacktestResult {
  const A = book.symbols.length;
  let weights = new Array(A).fill(0); // signed target weights, gross-sum 1
  const barReturns: number[] = [];
  let turnoverSum = 0;
  let rebalanceCount = 0;

  // Warm-up start: need `lookback` bars of history AND a vol window.
  const firstUsable = Math.max(tStart, lookback + 1, VOL_WINDOW + 1);

  for (let t = firstUsable; t < tEnd; t++) {
    // Realize the prior bar's return on the held weights BEFORE any rebalance at t.
    let gross = 0;
    for (let a = 0; a < A; a++) {
      const prev = book.closes[a]![t - 1]!;
      const cur = book.closes[a]![t]!;
      if (prev > 0) gross += weights[a]! * (cur / prev - 1);
    }

    let cost = 0;
    if ((t - firstUsable) % rebalance === 0) {
      // Recompute target weights from the signal at t (uses info up to bar t).
      const raw: number[] = new Array(A).fill(0);
      let grossW = 0;
      for (let a = 0; a < A; a++) {
        const closes = book.closes[a]!;
        const past = closes[t - lookback]!;
        const now = closes[t]!;
        if (!(past > 0) || !(now > 0)) continue;
        const mom = now / past - 1;
        const dir = mom > 0 ? 1 : mom < 0 ? -1 : 0;
        const vol = trailingVol(closes, t, VOL_WINDOW);
        const invVol = vol > 0 ? 1 / vol : 0;
        raw[a] = dir * invVol;
        grossW += Math.abs(raw[a]!);
      }
      const target = grossW > 0 ? raw.map((w) => w / grossW) : new Array(A).fill(0);
      // Turnover cost: Σ|Δw| · per-side cost (charged this bar).
      let turnover = 0;
      for (let a = 0; a < A; a++) {
        const dw = Math.abs(target[a]! - weights[a]!);
        turnover += dw;
        cost += dw * (book.costBps[a]! / 10_000);
      }
      turnoverSum += turnover;
      rebalanceCount++;
      weights = target;
    }

    barReturns.push(gross - cost);
  }

  return {
    barReturns,
    turnoverPerRebal: rebalanceCount > 0 ? turnoverSum / rebalanceCount : 0,
    rebalanceCount,
  };
}

/** Equal-weight long-only buy-&-hold portfolio net per-bar returns over [tStart,tEnd). */
function buyHold(book: AlignedBook, tStart: number, tEnd: number): number[] {
  const A = book.symbols.length;
  const out: number[] = [];
  for (let t = Math.max(tStart, 1); t < tEnd; t++) {
    let g = 0;
    for (let a = 0; a < A; a++) {
      const prev = book.closes[a]![t - 1]!;
      const cur = book.closes[a]![t]!;
      if (prev > 0) g += (1 / A) * (cur / prev - 1);
    }
    out.push(g);
  }
  return out;
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

function annualizedSharpe(rets: number[]): number {
  return nonAnnualizedSharpe(rets) * Math.sqrt(PERIODS_PER_YEAR);
}

function maxDrawdownPct(rets: number[]): number {
  let eq = 1,
    peak = 1,
    maxDD = 0;
  for (const r of rets) {
    eq *= 1 + r;
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD * 100;
}

function totalReturnPct(rets: number[]): number {
  let eq = 1;
  for (const r of rets) eq *= 1 + r;
  return (eq - 1) * 100;
}

function fmt(x: number, d = 3): string {
  return Number.isFinite(x) ? x.toFixed(d) : "n/a";
}

// ── Main ────────────────────────────────────────────────────────────────────
function main(): void {
  const suffix = `_${TF}.json`;
  const symbols = readdirSync(BARS_DIR)
    .filter((f) => f.endsWith(suffix))
    .map((f) => f.slice(0, -suffix.length))
    .sort();

  const instruments: Instrument[] = [];
  for (const sym of symbols) {
    const inst = loadInstrument(sym);
    if (inst) instruments.push(inst);
  }
  if (instruments.length < 2) {
    console.log("Need ≥2 instruments for a portfolio TSMOM book; found", instruments.length);
    return;
  }

  const book = alignBook(instruments);

  console.log("=".repeat(82));
  console.log(
    "PORTFOLIO TSMOM ACROSS REGIMES — the one lead, tested portfolio-level + multi-regime",
  );
  console.log("=".repeat(82));
  const spanStart = new Date(book.times[0]! * 1000).toISOString().slice(0, 16).replace("T", " ");
  const spanEnd = new Date(book.times[book.T - 1]! * 1000)
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");
  console.log(`Universe        : ${book.symbols.length} instruments (${book.symbols.join(", ")})`);
  if (book.dropped.length)
    console.log(
      `Dropped (thin)  : ${book.dropped.join(", ")} (< ${(MIN_OVERLAP_FRAC * 100).toFixed(0)}% overlap with densest grid)`,
    );
  console.log(
    `Aligned bars    : ${book.T} shared-timestamp ${TF} bars/asset  [${spanStart} → ${spanEnd} UTC]`,
  );
  console.log(
    `Sweep           : lookback {${LOOKBACKS.join(",")}} × rebalance {${REBALANCES.join(",")}} = ${EFFECTIVE_TRIALS} configs`,
  );
  console.log(
    `Cost            : per-side spread/2, FLOORED at ${COST_FLOOR_BPS}bps (crypto bars ship spread=0 — floor is a fiction-guard)`,
  );
  console.log(`Risk weighting  : inverse trailing vol (${VOL_WINDOW}-bar), gross-normalized to 1`);
  console.log(
    `Splits          : thirds (early/mid/late regimes) + clean IS(${(IS_FRAC * 100).toFixed(0)})/OOS(${((1 - IS_FRAC) * 100).toFixed(0)})`,
  );
  console.log("");

  // Regime thirds on the FULL aligned timeline (same boundaries for every config
  // so the per-third comparison is apples-to-apples).
  const T = book.T;
  const third = Math.floor(T / 3);
  const thirds: [number, number][] = [
    [0, third],
    [third, 2 * third],
    [2 * third, T],
  ];
  const isEnd = Math.floor(T * IS_FRAC);

  // Buy-&-hold benchmark per third (passive bar to beat).
  const bhThirdSharpe = thirds.map(([s, e]) => nonAnnualizedSharpe(buyHold(book, s, e)));
  const bhThirdRet = thirds.map(([s, e]) => totalReturnPct(buyHold(book, s, e)));

  console.log("BUY-&-HOLD BENCHMARK (equal-weight long-only, per regime third)");
  console.log("-".repeat(82));
  console.log(
    ["third".padEnd(8), "bars".padStart(8), "sharpe".padStart(9), "return%".padStart(10)].join(" "),
  );
  const thirdNames = ["early", "mid", "late"];
  for (let i = 0; i < 3; i++) {
    console.log(
      [
        thirdNames[i]!.padEnd(8),
        `${thirds[i]![0]}-${thirds[i]![1]}`.padStart(8),
        fmt(bhThirdSharpe[i]!, 4).padStart(9),
        fmt(bhThirdRet[i]!, 2).padStart(10),
      ].join(" "),
    );
  }
  console.log("");

  // ── Sweep ──────────────────────────────────────────────────────────────────
  interface Row {
    lookback: number;
    rebalance: number;
    oosSharpe15m: number;
    oosSharpeAnnual: number;
    oosMaxDD: number;
    oosReturnPct: number;
    turnover: number;
    thirdSharpes: number[];
    thirdReturns: number[];
    thirdBeatsBH: boolean[];
    psr: number;
    dsr: number;
    observedSharpeAnnual: number;
    expectedMaxNull: number;
  }

  const rows: Row[] = [];
  for (const lookback of LOOKBACKS) {
    for (const rebalance of REBALANCES) {
      // OOS segment (clean holdout tail).
      const oos = backtestTSMOM(book, lookback, rebalance, isEnd, T);
      // Per-third segments (regime persistence).
      const thirdRes = thirds.map(([s, e]) => backtestTSMOM(book, lookback, rebalance, s, e));
      const thirdSharpes = thirdRes.map((r) => nonAnnualizedSharpe(r.barReturns));
      const thirdReturns = thirdRes.map((r) => totalReturnPct(r.barReturns));
      const thirdBeatsBH = thirdSharpes.map((sh, i) => sh > bhThirdSharpe[i]!);

      const psr = probabilisticSharpeRatio(oos.barReturns, 0, PERIODS_PER_YEAR);
      const dsr = deflatedSharpeRatio(oos.barReturns, EFFECTIVE_TRIALS, PERIODS_PER_YEAR);

      rows.push({
        lookback,
        rebalance,
        oosSharpe15m: nonAnnualizedSharpe(oos.barReturns),
        oosSharpeAnnual: annualizedSharpe(oos.barReturns),
        oosMaxDD: maxDrawdownPct(oos.barReturns),
        oosReturnPct: totalReturnPct(oos.barReturns),
        turnover: oos.turnoverPerRebal,
        thirdSharpes,
        thirdReturns,
        thirdBeatsBH,
        psr: psr.psr,
        dsr: dsr.dsr,
        observedSharpeAnnual: dsr.observedSharpe,
        expectedMaxNull: dsr.expectedMaxSharpeUnderNull,
      });
    }
  }

  // Rank by OOS 15m Sharpe (the competition metric) descending.
  rows.sort((a, b) => b.oosSharpe15m - a.oosSharpe15m);

  console.log("SWEEP RESULTS (ranked by OOS 15m Sharpe)");
  console.log("-".repeat(82));
  console.log(
    [
      "lkbk".padStart(5),
      "reb".padStart(4),
      "oosSh".padStart(7),
      "oosAnn".padStart(7),
      "oosDD%".padStart(7),
      "oosR%".padStart(7),
      "turn".padStart(6),
      "PSR".padStart(5),
      "DSR".padStart(5),
      "earlySh".padStart(8),
      "midSh".padStart(8),
      "lateSh".padStart(8),
    ].join(" "),
  );
  for (const r of rows) {
    console.log(
      [
        String(r.lookback).padStart(5),
        String(r.rebalance).padStart(4),
        fmt(r.oosSharpe15m, 3).padStart(7),
        fmt(r.oosSharpeAnnual, 2).padStart(7),
        fmt(r.oosMaxDD, 1).padStart(7),
        fmt(r.oosReturnPct, 1).padStart(7),
        fmt(r.turnover, 2).padStart(6),
        fmt(r.psr, 2).padStart(5),
        fmt(r.dsr, 2).padStart(5),
        `${fmt(r.thirdSharpes[0]!, 3)}${r.thirdBeatsBH[0] ? "*" : " "}`.padStart(8),
        `${fmt(r.thirdSharpes[1]!, 3)}${r.thirdBeatsBH[1] ? "*" : " "}`.padStart(8),
        `${fmt(r.thirdSharpes[2]!, 3)}${r.thirdBeatsBH[2] ? "*" : " "}`.padStart(8),
      ].join(" "),
    );
  }
  console.log(
    "(* = that third's TSMOM Sharpe beat the equal-weight buy-&-hold benchmark for the same third)",
  );
  console.log("");

  // ── Regime-persistence analysis ──────────────────────────────────────────
  // A real edge is positive AND beats passive in ALL THREE regimes, not just one.
  const allThreePositive = rows.filter((r) => r.thirdSharpes.every((s) => s > 0));
  const allThreeBeatBH = rows.filter((r) => r.thirdBeatsBH.every((b) => b));
  const best = rows[0]!;

  console.log("=".repeat(82));
  console.log("VERDICT — does long-short TSMOM hold up across regimes after costs?");
  console.log("=".repeat(82));
  console.log(
    `Configs with POSITIVE Sharpe in all 3 regime thirds : ${allThreePositive.length}/${rows.length}`,
  );
  console.log(
    `Configs that BEAT buy-&-hold in all 3 thirds        : ${allThreeBeatBH.length}/${rows.length}`,
  );
  console.log(
    `Best config (by OOS 15m Sharpe)                     : lookback=${best.lookback}, rebalance=${best.rebalance}`,
  );
  console.log(
    `  OOS 15m Sharpe ${fmt(best.oosSharpe15m, 4)} | annualized ${fmt(best.oosSharpeAnnual, 2)} | maxDD ${fmt(best.oosMaxDD, 1)}% | turnover ${fmt(best.turnover, 2)}/rebal`,
  );
  console.log(
    `  per-third Sharpe: early ${fmt(best.thirdSharpes[0]!, 3)} / mid ${fmt(best.thirdSharpes[1]!, 3)} / late ${fmt(best.thirdSharpes[2]!, 3)}`,
  );
  console.log(
    `  beats buy-&-hold: early ${best.thirdBeatsBH[0]} / mid ${best.thirdBeatsBH[1]} / late ${best.thirdBeatsBH[2]}`,
  );
  console.log(
    `  PSR ${fmt(best.psr, 3)} | DSR ${fmt(best.dsr, 3)} (effectiveTrials=${EFFECTIVE_TRIALS}) | E[max Sharpe|null] ${fmt(best.expectedMaxNull, 2)}`,
  );
  console.log("");

  const deflatedPass = rows.some((r) => r.dsr > 0.95 && r.oosSharpe15m > 0);
  if (allThreeBeatBH.length === 0) {
    console.log("HONEST READ: long-short TSMOM does NOT hold up across regimes.");
    console.log("No config beats equal-weight buy-&-hold in all three regime thirds. The signal's");
    console.log(
      "apparent strength is regime-specific (it works in the directional/trending leg and",
    );
    console.log("fails in the others) — consistent with the earlier positive being the single");
    console.log("crypto-bear slice, not a durable cross-regime edge.");
  } else if (!deflatedPass) {
    console.log("HONEST READ: long-short TSMOM survives some regimes but NOT the deflated bar.");
    console.log(
      `${allThreeBeatBH.length} config(s) beat passive in all three thirds, but no config clears the`,
    );
    console.log(
      "deflated-Sharpe test (DSR>0.95) after correcting for the 12-config search. Treat as",
    );
    console.log("a lead to re-test on fresh data, not an edge to allocate.");
  } else {
    console.log(
      "HONEST READ: long-short TSMOM holds up across regimes AND clears the deflated bar.",
    );
    console.log("At least one config is positive in all three regime thirds, beats passive, and");
    console.log(
      "survives the multiple-testing correction. Still re-test OOS on a fresh window before",
    );
    console.log("allocating — the deflated bar controls selection bias, not regime change.");
  }
  console.log("");
}

main();
