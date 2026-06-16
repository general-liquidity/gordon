/**
 * Cross-sectional factor-composite + funding-carry backtest.
 *
 * Two UNTESTED alpha classes, run cost-honest with deflated-Sharpe rigor on
 * Gordon's committed crypto bars:
 *
 *   (A) Multi-factor composite — reuses Gordon's REAL Q-7 factor model
 *       (`computeCryptoFactorModel`). At each rebalance it scores the cross-
 *       section of coins, ranks by the composite tilt, and forms a dollar-
 *       neutral long-short book (long top, short bottom). Swept over rebalance
 *       cadence × factor-weighting × book-style on 1d (~3yr) and 1h.
 *
 *   (B) Funding carry — cross-sectional rank by perp funding rate; short the
 *       highest-positive-funding coins (receive funding), long the lowest /
 *       negative. PRICE P&L is included (carry bears price risk). Limited to the
 *       ~1-month window where funding exists, on the 5 coins that have it.
 *
 * ── HONEST DATA LIMITS (read before believing any number) ────────────────────
 *
 *   • SPREAD IS ZERO in this dataset. The committed crypto-extended/momq bars
 *     ship `spread: 0` for every bar, so a per-symbol median-spread cost is 0 —
 *     which is NOT honest. We therefore charge a FIXED per-side cost floor
 *     (default 5 bps/side; override COST_BPS_PER_SIDE) on turnover. This is an
 *     ASSUMPTION, not data-derived. Real crypto perp taker cost on majors is
 *     ~1–5 bps/side; on small-caps it's worse. Treat the cost as conservative-ish
 *     for majors, optimistic for the tail.
 *
 *   • FACTORS WE CAN POPULATE: reversal (price), volatility (price). funding is
 *     populated ONLY inside the ~1-month window where funding files exist (else
 *     neutralized to 0 → effectively omitted on the 3yr scan). size needs market
 *     cap, quality/value need on-chain — we have NONE of these for 3yr, so they
 *     are OMITTED (weight 0). The composite here is reversal(+volatility[+funding
 *     in-window]). This is a faithful SUBSET of Q-7, not the full model.
 *
 *   • FUNDING CARRY is ~1 month × 5 coins = ~30 daily steps. A single IS/OOS
 *     split on that is BARELY powered — it is INDICATIVE, not a result. We report
 *     it and say so. Note: the COMPETITION venue (Cypher/MT5) has NO perp funding
 *     to collect, so carry is a "does Gordon have real alpha at all" probe, not a
 *     deployable competition strategy.
 *
 * Run:
 *   bun run scripts/research/factor-carry-scan.ts
 *   COST_BPS_PER_SIDE=2 bun run scripts/research/factor-carry-scan.ts
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  computeCryptoFactorModel,
  STYLE_FACTORS,
  type CryptoTokenInput,
  type StyleFactor,
} from "../../src/core/alpha/crypto-factor-model.ts";
import {
  deflatedSharpeRatio,
  probabilisticSharpeRatio,
} from "../../src/infra/trading/ops/backtestCredibility.ts";

// ── Config ──────────────────────────────────────────────────────────────────

const EXTENDED_DIR = join(process.cwd(), "data", "momq", "crypto-extended");
const FUNDING_DIR = join(process.cwd(), "data", "momq", "funding");

/** Fixed per-side cost in bps charged on turnover (see DATA LIMITS — spread=0). */
const COST_BPS_PER_SIDE = Number(process.env.COST_BPS_PER_SIDE ?? 5);

/** Lookback (bars) for the reversal + residual-vol factor inputs. */
const REVERSAL_LOOKBACK = Number(process.env.REVERSAL_LOOKBACK ?? 21);
const VOL_LOOKBACK = Number(process.env.VOL_LOOKBACK ?? 21);

/** Long/short basket size — top-K and bottom-K of the ranked cross-section. */
const BASKET_K = Number(process.env.BASKET_K ?? 4);

const IS_FRAC = 0.5; // first half in-sample, back half OOS.

// ── Raw bar shape (crypto-extended / momq) ──────────────────────────────────

interface RawBar {
  time: number; // seconds epoch
  open: number;
  high: number;
  low: number;
  close: number;
  spread: number; // fraction of price — ZERO in this dataset (see DATA LIMITS).
}
interface FundingPoint {
  time: number; // seconds epoch, 8-hourly
  fundingRate: number; // decimal per 8h interval
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0;
}
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1]! + s[m]!) / 2 : s[m]!;
}
function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let acc = 0;
  for (const x of xs) acc += (x - m) ** 2;
  return Math.sqrt(acc / (xs.length - 1));
}
function nonAnnualizedSharpe(rets: number[]): number {
  if (rets.length < 2) return 0;
  const s = std(rets);
  return s > 0 ? mean(rets) / s : 0;
}
function fmt(x: number, d = 3): string {
  return Number.isFinite(x) ? x.toFixed(d) : "n/a";
}

// ── Symbol loading ──────────────────────────────────────────────────────────

interface Series {
  symbol: string;
  times: number[]; // seconds epoch, ascending
  closes: number[];
  medianSpreadBps: number; // 0 in this dataset; kept for transparency.
}

function loadSeries(symbol: string, tf: string): Series | null {
  const path = join(EXTENDED_DIR, `${symbol}_${tf}.json`);
  if (!existsSync(path)) return null;
  const raw = readJson<RawBar[]>(path).filter((b) => Number.isFinite(b.close) && b.close > 0);
  if (raw.length < 60) return null;
  const spreads = raw.map((b) => b.spread).filter((s) => Number.isFinite(s) && s > 0);
  return {
    symbol,
    times: raw.map((b) => b.time),
    closes: raw.map((b) => b.close),
    medianSpreadBps: median(spreads) * 10_000,
  };
}

function symbolsForTf(tf: string): string[] {
  const suffix = `_${tf}.json`;
  return readdirSync(EXTENDED_DIR)
    .filter((f) => f.endsWith(suffix))
    .map((f) => f.slice(0, -suffix.length))
    .sort();
}

// ── A panel of aligned series (intersection of timestamps) ──────────────────

interface Panel {
  symbols: string[];
  times: number[]; // common timestamps, ascending
  /** close[symbolIdx][timeIdx] */
  closes: number[][];
}

/** Build a panel on the intersection of timestamps across all series. */
function buildPanel(series: Series[]): Panel {
  if (series.length === 0) return { symbols: [], times: [], closes: [] };
  // Intersection of times.
  let common = new Set<number>(series[0]!.times);
  for (const s of series.slice(1)) {
    const here = new Set(s.times);
    common = new Set([...common].filter((t) => here.has(t)));
  }
  const times = [...common].sort((a, b) => a - b);
  const timeIdx = new Map(times.map((t, i) => [t, i]));
  const closes: number[][] = series.map((s) => {
    const row = new Array<number>(times.length).fill(NaN);
    for (let i = 0; i < s.times.length; i++) {
      const ti = timeIdx.get(s.times[i]!);
      if (ti !== undefined) row[ti] = s.closes[i]!;
    }
    return row;
  });
  return { symbols: series.map((s) => s.symbol), times, closes };
}

// ── Factor composite backtest ───────────────────────────────────────────────

type Weighting = "rev+vol" | "rev-only" | "vol-only";
type Book = "long-short" | "long-only";

interface FactorConfig {
  rebalance: number;
  weighting: Weighting;
  book: Book;
}

function weightsFor(w: Weighting): Partial<Record<StyleFactor, number>> {
  // size/quality/value/funding are OMITTED on the 3yr scan (no data) → weight 0.
  const base: Partial<Record<StyleFactor, number>> = {
    size: 0,
    quality: 0,
    value: 0,
    funding: 0,
    reversal: 0,
    volatility: 0,
  };
  if (w === "rev+vol") return { ...base, reversal: 1, volatility: 1 };
  if (w === "rev-only") return { ...base, reversal: 1 };
  return { ...base, volatility: 1 };
}

interface FactorRun {
  barReturns: number[]; // per-bar portfolio returns (cost-charged)
  trades: number; // total rebalance legs (turnover events)
  meanGrossExposure: number; // sanity: ~ 2*K for long-short, K for long-only
}

/**
 * Cost-honest cross-sectional factor backtest over a panel.
 *
 * At each rebalance bar t we score the cross-section via the REAL Q-7 model on a
 * lookback window ending at t, rank by composite, and hold a dollar-neutral
 * (long-short) or long-only basket of the top/bottom K until the next rebalance.
 * Returns are realized on the held weights bar-by-bar; turnover between
 * rebalances is charged COST_BPS_PER_SIDE per unit of weight changed.
 */
function runFactorBacktest(panel: Panel, cfg: FactorConfig): FactorRun {
  const { symbols, closes } = panel;
  const nSym = symbols.length;
  const nT = panel.times.length;
  const lookback = Math.max(REVERSAL_LOOKBACK, VOL_LOOKBACK);
  if (nT < lookback + 5 || nSym < 2 * BASKET_K + 1) {
    return { barReturns: [], trades: 0, meanGrossExposure: 0 };
  }

  const costPerSide = COST_BPS_PER_SIDE / 10_000;
  let weights = new Array<number>(nSym).fill(0); // current per-symbol weight
  const barReturns: number[] = [];
  let trades = 0;
  const grossExposures: number[] = [];

  for (let t = lookback; t < nT - 1; t++) {
    // Rebalance on cadence.
    if ((t - lookback) % cfg.rebalance === 0) {
      const inputs: CryptoTokenInput[] = [];
      const validSym: number[] = [];
      for (let s = 0; s < nSym; s++) {
        const c = closes[s]!;
        const cT = c[t];
        const cPrev = c[t - REVERSAL_LOOKBACK];
        if (!Number.isFinite(cT) || !Number.isFinite(cPrev) || cPrev! <= 0) continue;
        // Reversal input: lookback return over REVERSAL_LOOKBACK bars.
        const lookbackReturn = cT! / cPrev! - 1;
        // Residual-vol input: std of bar log-returns over VOL_LOOKBACK.
        const rets: number[] = [];
        for (let k = t - VOL_LOOKBACK + 1; k <= t; k++) {
          const a = c[k - 1];
          const b = c[k];
          if (Number.isFinite(a) && Number.isFinite(b) && a! > 0 && b! > 0) {
            rets.push(Math.log(b! / a!));
          }
        }
        if (rets.length < 3) continue;
        inputs.push({
          symbol: symbols[s]!,
          lookbackReturn,
          residualVol: std(rets),
          // marketCap unavailable → constant placeholder; size weight is 0 so it
          // never enters the composite (size z-scores to ~0 on a constant anyway).
          marketCap: 1,
          // funding unavailable on the 3yr scan → 0; funding weight is 0 here.
          fundingRate: 0,
        });
        validSym.push(s);
      }

      const model = computeCryptoFactorModel(inputs, {
        weights: weightsFor(cfg.weighting),
        minTokens: 2 * BASKET_K + 1,
      });

      const newWeights = new Array<number>(nSym).fill(0);
      if (model) {
        const order = model.tokens; // sorted by composite desc
        const symToIdx = new Map(symbols.map((sym, i) => [sym, i]));
        const k = Math.min(BASKET_K, Math.floor(order.length / (cfg.book === "long-short" ? 2 : 1)));
        if (k >= 1) {
          if (cfg.book === "long-short") {
            // Long top k (dollar-neutral): +1/k each long, -1/k each short.
            for (let i = 0; i < k; i++) {
              const si = symToIdx.get(order[i]!.symbol);
              if (si !== undefined) newWeights[si] = 0.5 / k;
            }
            for (let i = 0; i < k; i++) {
              const si = symToIdx.get(order[order.length - 1 - i]!.symbol);
              if (si !== undefined) newWeights[si] = -0.5 / k;
            }
          } else {
            for (let i = 0; i < k; i++) {
              const si = symToIdx.get(order[i]!.symbol);
              if (si !== undefined) newWeights[si] = 1 / k;
            }
          }
        }
      }

      // Charge turnover cost on the weight change.
      let turnover = 0;
      for (let s = 0; s < nSym; s++) turnover += Math.abs(newWeights[s]! - weights[s]!);
      if (turnover > 0) trades++;
      // Cost is applied to the first bar's return below via a one-off drag.
      const costDrag = turnover * costPerSide;
      weights = newWeights;

      // Realize next-bar return net of cost drag.
      barReturns.push(portfolioBarReturn(closes, weights, t) - costDrag);
      grossExposures.push(weights.reduce((a, w) => a + Math.abs(w), 0));
    } else {
      barReturns.push(portfolioBarReturn(closes, weights, t));
      grossExposures.push(weights.reduce((a, w) => a + Math.abs(w), 0));
    }
  }

  return {
    barReturns,
    trades,
    meanGrossExposure: mean(grossExposures),
  };
}

/** Weighted next-bar simple return: sum_s w_s * (close[t+1]/close[t] - 1). */
function portfolioBarReturn(closes: number[][], weights: number[], t: number): number {
  let r = 0;
  for (let s = 0; s < weights.length; s++) {
    const w = weights[s]!;
    if (w === 0) continue;
    const c = closes[s]!;
    const c0 = c[t];
    const c1 = c[t + 1];
    if (Number.isFinite(c0) && Number.isFinite(c1) && c0! > 0) r += w * (c1! / c0! - 1);
  }
  return r;
}

// ── Factor sweep driver ─────────────────────────────────────────────────────

interface FactorResultRow {
  cfg: FactorConfig;
  trades: number;
  grossExp: number;
  isReturnPct: number;
  oosReturnPct: number;
  oosSharpe: number; // per-bar OOS Sharpe
  oosSharpeAnnual: number;
  psr: number;
  dsr: number;
  observedSharpeAnnual: number;
  expectedMaxNullSharpe: number;
  verdict: "PASS" | "marginal" | "FAIL";
}

function cumReturnPct(rets: number[]): number {
  let eq = 1;
  for (const r of rets) eq *= 1 + r;
  return (eq - 1) * 100;
}

function classify(oosSharpe: number, psr: number, dsr: number): FactorResultRow["verdict"] {
  if (oosSharpe > 0 && dsr > 0.95 && psr > 0.95) return "PASS";
  if (oosSharpe > 0 && (psr > 0.9 || dsr > 0.5)) return "marginal";
  return "FAIL";
}

function runFactorSweep(panel: Panel, periodsPerYear: number, label: string): void {
  const rebalances = [1, 5, 10];
  const weightings: Weighting[] = ["rev+vol", "rev-only", "vol-only"];
  const books: Book[] = ["long-short", "long-only"];
  const configs: FactorConfig[] = [];
  for (const rebalance of rebalances)
    for (const weighting of weightings)
      for (const book of books) configs.push({ rebalance, weighting, book });

  const effectiveTrials = configs.length;
  const rows: FactorResultRow[] = [];

  for (const cfg of configs) {
    const run = runFactorBacktest(panel, cfg);
    if (run.barReturns.length < 20) continue;
    const isEnd = Math.floor(run.barReturns.length * IS_FRAC);
    const isRets = run.barReturns.slice(0, isEnd);
    const oosRets = run.barReturns.slice(isEnd);
    if (oosRets.length < 10) continue;

    const psr = probabilisticSharpeRatio(oosRets, 0, periodsPerYear);
    const dsr = deflatedSharpeRatio(oosRets, effectiveTrials, periodsPerYear);
    rows.push({
      cfg,
      trades: run.trades,
      grossExp: run.meanGrossExposure,
      isReturnPct: cumReturnPct(isRets),
      oosReturnPct: cumReturnPct(oosRets),
      oosSharpe: nonAnnualizedSharpe(oosRets),
      oosSharpeAnnual: psr.observedSharpe,
      psr: psr.psr,
      dsr: dsr.dsr,
      observedSharpeAnnual: dsr.observedSharpe,
      expectedMaxNullSharpe: dsr.expectedMaxSharpeUnderNull,
      verdict: classify(nonAnnualizedSharpe(oosRets), psr.psr, dsr.dsr),
    });
  }

  const rank = { PASS: 0, marginal: 1, FAIL: 2 } as const;
  rows.sort((a, b) => (rank[a.verdict] !== rank[b.verdict] ? rank[a.verdict] - rank[b.verdict] : b.dsr - a.dsr));

  console.log("=".repeat(86));
  console.log(`FACTOR COMPOSITE SWEEP — ${label}`);
  console.log("=".repeat(86));
  console.log(`Universe           : ${panel.symbols.length} coins (${panel.symbols.join(", ")})`);
  console.log(`Aligned bars       : ${panel.times.length} (common timestamps)`);
  console.log(`Factors populated  : reversal, volatility   |   OMITTED: size, quality, value, funding (no data)`);
  console.log(`Cost               : ${COST_BPS_PER_SIDE} bps/side on turnover (spread=0 in data → fixed floor, ASSUMPTION)`);
  console.log(`Basket             : top/bottom ${BASKET_K}   |   IS/OOS split ${(IS_FRAC * 100).toFixed(0)}/${((1 - IS_FRAC) * 100).toFixed(0)}`);
  console.log(`Configs (trials)   : ${effectiveTrials}   |   periods/yr ${periodsPerYear}`);
  console.log(`E[max null Sharpe] : ${fmt(rows[0]?.expectedMaxNullSharpe ?? 0, 2)} (annualized, ${effectiveTrials} trials)`);
  console.log("");

  const head = [
    "reb".padStart(3),
    "weighting".padEnd(9),
    "book".padEnd(11),
    "trd".padStart(4),
    "isRet%".padStart(8),
    "oosRet%".padStart(8),
    "oosSh".padStart(7),
    "oosShA".padStart(7),
    "PSR".padStart(5),
    "DSR".padStart(5),
    "verdict".padStart(8),
  ].join(" ");
  console.log(head);
  console.log("-".repeat(86));
  for (const r of rows) {
    console.log(
      [
        String(r.cfg.rebalance).padStart(3),
        r.cfg.weighting.padEnd(9),
        r.cfg.book.padEnd(11),
        String(r.trades).padStart(4),
        fmt(r.isReturnPct, 2).padStart(8),
        fmt(r.oosReturnPct, 2).padStart(8),
        fmt(r.oosSharpe, 3).padStart(7),
        fmt(r.oosSharpeAnnual, 2).padStart(7),
        fmt(r.psr, 2).padStart(5),
        fmt(r.dsr, 2).padStart(5),
        r.verdict.padStart(8),
      ].join(" "),
    );
  }
  console.log("");

  const passes = rows.filter((r) => r.verdict === "PASS");
  const marginals = rows.filter((r) => r.verdict === "marginal");
  if (passes.length > 0) {
    console.log(`${passes.length} config(s) CLEARED the deflated bar (DSR>0.95, PSR>0.95, OOS Sharpe>0).`);
  } else {
    console.log("NOTHING cleared the deflated bar.");
    if (marginals.length > 0) {
      console.log(`${marginals.length} config(s) marginal (positive OOS Sharpe, partial credibility) — leads, not edges.`);
    }
  }
  console.log("");
}

// ── Funding carry ───────────────────────────────────────────────────────────

interface FundingSeries {
  symbol: string;
  times: number[]; // seconds, 8-hourly
  rates: number[];
}

function loadFunding(symbol: string): FundingSeries | null {
  const path = join(FUNDING_DIR, `${symbol}_funding.json`);
  if (!existsSync(path)) return null;
  const raw = readJson<FundingPoint[]>(path).filter((p) => Number.isFinite(p.fundingRate));
  if (raw.length < 10) return null;
  return { symbol, times: raw.map((p) => p.time), rates: raw.map((p) => p.fundingRate) };
}

/**
 * Funding-carry backtest over the ~1-month window.
 *
 * Funding is 8-hourly; we rebalance per funding interval. At each interval we
 * rank coins by funding rate, SHORT the top-K highest-positive (you RECEIVE
 * funding when short a positive-funding perp) and LONG the bottom-K lowest /
 * negative. We hold to the next funding interval. The carry leg credits the
 * funding (sign: short positive-funding coin earns +rate; long negative-funding
 * coin earns -rate = +|rate|). The price leg marks the position over the
 * interval using the nearest price bars bracketing the two funding stamps.
 *
 * Reports carry-only and carry+price. ~1 month × ≤5 coins = INDICATIVE only.
 */
function runFundingCarry(): void {
  const fundingSymbols = ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "BARUSD"];
  const funds: FundingSeries[] = [];
  for (const s of fundingSymbols) {
    const f = loadFunding(s);
    if (f) funds.push(f);
  }

  // Price series (1h gives the tightest bracketing of 8-hourly funding stamps).
  const prices = new Map<string, Series>();
  for (const f of funds) {
    const s = loadSeries(f.symbol, "1h") ?? loadSeries(f.symbol, "1d");
    if (s) prices.set(f.symbol, s);
  }

  // Common funding timestamps across all funding symbols.
  let common = funds.length ? new Set<number>(funds[0]!.times) : new Set<number>();
  for (const f of funds.slice(1)) {
    const here = new Set(f.times);
    common = new Set([...common].filter((t) => here.has(t)));
  }
  const stamps = [...common].sort((a, b) => a - b);

  const rateAt = new Map<string, Map<number, number>>();
  for (const f of funds) rateAt.set(f.symbol, new Map(f.times.map((t, i) => [t, f.rates[i]!])));

  // Price at-or-before a timestamp (last bar with time <= ts).
  function priceAt(sym: string, ts: number): number | null {
    const s = prices.get(sym);
    if (!s) return null;
    let lo = 0;
    let hi = s.times.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (s.times[mid]! <= ts) {
        best = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (best < 0) return null;
    // Reject if the nearest bar is more than 8h stale (no usable mark).
    if (ts - s.times[best]! > 8 * 3600) return null;
    return s.closes[best]!;
  }

  const costPerSide = COST_BPS_PER_SIDE / 10_000;
  const k = Math.min(2, Math.floor(funds.length / 2)); // 5 coins → short top-2, long bottom-2

  const carryOnly: number[] = [];
  const carryPlusPrice: number[] = [];
  const priceOnly: number[] = [];
  let intervals = 0;

  for (let i = 0; i < stamps.length - 1; i++) {
    const t0 = stamps[i]!;
    const t1 = stamps[i + 1]!;
    // Rank coins by funding rate at t0.
    const ranked = funds
      .map((f) => ({ sym: f.symbol, rate: rateAt.get(f.symbol)!.get(t0) }))
      .filter((x): x is { sym: string; rate: number } => Number.isFinite(x.rate))
      .sort((a, b) => b.rate - a.rate); // highest funding first
    if (ranked.length < 2 * k) continue;

    const shorts = ranked.slice(0, k).map((x) => x.sym); // highest positive funding → short (receive)
    const longs = ranked.slice(ranked.length - k).map((x) => x.sym); // lowest/negative → long

    let carry = 0;
    let price = 0;
    let usableLegs = 0;
    const w = 1 / (2 * k); // equal weight, gross = 1

    for (const sym of shorts) {
      const rate = rateAt.get(sym)!.get(t0)!;
      carry += w * rate; // short receives the (positive) funding
      const p0 = priceAt(sym, t0);
      const p1 = priceAt(sym, t1);
      if (p0 !== null && p1 !== null && p0 > 0) {
        price += w * -(p1 / p0 - 1); // short price P&L
        usableLegs++;
      }
    }
    for (const sym of longs) {
      const rate = rateAt.get(sym)!.get(t0)!;
      carry += w * -rate; // long pays funding (so -rate; negative rate → +|rate|)
      const p0 = priceAt(sym, t0);
      const p1 = priceAt(sym, t1);
      if (p0 !== null && p1 !== null && p0 > 0) {
        price += w * (p1 / p0 - 1); // long price P&L
        usableLegs++;
      }
    }

    // Turnover cost belongs to the TRADING (price) leg, not to the funding
    // accrual. carry-only is the raw funding capture (what you'd receive if the
    // book were already on); the cost is charged once against the combined book.
    // (Charging full taker cost against carry-only alone is degenerate: the cost
    // dwarfs the ~1e-5 funding and manufactures a giant-magnitude Sharpe from a
    // near-constant drag — an artifact, not a result.)
    const cost = 1.0 * costPerSide;
    carryOnly.push(carry);
    priceOnly.push(price);
    carryPlusPrice.push(carry + price - cost);
    intervals++;
  }

  // Funding is 8-hourly → 3 intervals/day → 365*3 per year.
  const periodsPerYear = 365 * 3;

  console.log("=".repeat(86));
  console.log("FUNDING CARRY — INDICATIVE ONLY (data-limited)");
  console.log("=".repeat(86));
  console.log(`Funding coins      : ${funds.map((f) => f.symbol).join(", ")}  (${funds.length} of universe)`);
  console.log(`Funding window     : ${new Date((stamps[0] ?? 0) * 1000).toISOString().slice(0, 10)} → ${new Date((stamps[stamps.length - 1] ?? 0) * 1000).toISOString().slice(0, 10)}`);
  console.log(`Funding intervals  : ${intervals} (8-hourly)  ≈ ${(intervals / 3).toFixed(0)} days`);
  console.log(`Book               : short top-${k} funding / long bottom-${k}, equal weight, gross 1.0`);
  console.log(`Cost               : ${COST_BPS_PER_SIDE} bps/side on turnover`);
  console.log("");
  console.log("⚠  ~1 month × ≤5 coins. A single IS/OOS split here is BARELY powered. The numbers");
  console.log("   below are INDICATIVE, not a result. DSR uses effectiveTrials=1 (no grid was swept");
  console.log("   for carry) — but the SAMPLE itself is too short for the Sharpe to be credible.");
  console.log("   The competition venue has NO perp funding to collect; this is a 'real-alpha' probe.");
  console.log("");

  const report = (name: string, rets: number[]) => {
    if (rets.length < 10) {
      console.log(`  ${name.padEnd(16)}: too few intervals (${rets.length}) for a Sharpe.`);
      return;
    }
    const totalRet = cumReturnPct(rets);
    const sh = nonAnnualizedSharpe(rets);
    const psr = probabilisticSharpeRatio(rets, 0, periodsPerYear);
    // IS/OOS split for the honest "barely powered" check.
    const isEnd = Math.floor(rets.length * IS_FRAC);
    const oos = rets.slice(isEnd);
    const oosSh = nonAnnualizedSharpe(oos);
    const oosPsr = oos.length >= 10 ? probabilisticSharpeRatio(oos, 0, periodsPerYear).psr : NaN;
    console.log(
      `  ${name.padEnd(16)}: totalRet ${fmt(totalRet, 3)}%  perIntSharpe ${fmt(sh, 3)}  ` +
        `annSharpe ${fmt(psr.observedSharpe, 2)}  PSR ${fmt(psr.psr, 2)}  ||  ` +
        `OOS(${oos.length}) Sharpe ${fmt(oosSh, 3)} PSR ${fmt(oosPsr, 2)}`,
    );
  };

  console.log("Result (per-interval returns, cost-charged):");
  report("carry-only", carryOnly);
  report("price-only", priceOnly);
  report("carry+price", carryPlusPrice);
  console.log("");
  console.log("Honest read: with ~30 days the OOS leg is ~15 intervals — far below the minimum");
  console.log("track-record length for ANY of these Sharpes to be statistically distinguishable");
  console.log("from zero. Report the sign/magnitude as a curiosity; do not allocate on it.");
  console.log("");
}

// ── Main ────────────────────────────────────────────────────────────────────

function main(): void {
  console.log("#".repeat(86));
  console.log("# CRYPTO FACTOR-COMPOSITE + FUNDING-CARRY BACKTEST");
  console.log("# Reuses Gordon's Q-7 factor model + deflated-Sharpe credibility infra.");
  console.log("#".repeat(86));
  console.log("");
  console.log("DATA-LIMIT BANNER:");
  console.log("  • spread=0 in the committed bars → cost is a FIXED assumption, not data-derived.");
  console.log("  • Factor scan populates reversal+volatility ONLY; size/quality/value/funding omitted.");
  console.log("  • Funding carry is ~1 month × ≤5 coins → INDICATIVE, not powered.");
  console.log("");

  // (A) Factor composite — 1d (~3yr) then 1h.
  for (const tf of ["1d", "1h"]) {
    const syms = symbolsForTf(tf);
    const series: Series[] = [];
    for (const s of syms) {
      const ld = loadSeries(s, tf);
      if (ld) series.push(ld);
    }
    const panel = buildPanel(series);
    const periodsPerYear = tf === "1d" ? 365 : 365 * 24;
    if (panel.times.length < 60) {
      console.log(`FACTOR COMPOSITE — ${tf}: insufficient aligned bars (${panel.times.length}). Skipped.\n`);
      continue;
    }
    runFactorSweep(panel, periodsPerYear, `${tf} (${panel.symbols.length} coins, ${panel.times.length} aligned bars)`);
  }

  // (B) Funding carry.
  runFundingCarry();

  // Sanity check that STYLE_FACTORS is the surface we expect (guards against a
  // silent model refactor changing the factor set under us).
  const expected = ["size", "reversal", "volatility", "quality", "value", "funding"];
  const ok = STYLE_FACTORS.length === expected.length && STYLE_FACTORS.every((f, i) => f === expected[i]);
  if (!ok) console.log(`WARNING: STYLE_FACTORS drifted from expected set: ${STYLE_FACTORS.join(",")}`);
}

if (import.meta.main) main();
