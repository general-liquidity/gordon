#!/usr/bin/env bun
/**
 * FULL cross-sectional Q-7 factor-model validation on the 5 COMPETITION CRYPTO
 * via INFORMATION COEFFICIENT — now with MORE factors genuinely populated.
 *
 *   bun run scripts/dev/momq/momq-crypto-q7-full-validate.ts
 *
 * Strengthens momq-crypto-q7-validate.ts (price + funding only) by adding REAL
 * free-tier CoinGecko market data (scripts/dev/data/fetch-crypto-marketdata.ts):
 *
 *   reversal      = z(−lookbackReturn)              [price]
 *   volatility    = residualVol ⊥ size              [price]
 *   funding       = z(−fundingRate) ⊥ size,reversal [Binance public perp funding]
 *   size          = z(−ln mcap)  ← REAL market cap   [CoinGecko free historical]
 *   quality-PROXY = volume / marketCap (turnover)    [CoinGecko free historical]
 *
 * ────────────────────────────────────────────────────────────────────────────
 * HONEST DATA CONSTRAINTS (printed in output too):
 *   • The QUALITY factor here is a VOLUME-TURNOVER PROXY (volume / marketCap),
 *     NOT the paper's on-chain genuine-usage quality (active addresses, economic
 *     value transferred, fees), which needs a PAID provider (Glassnode/CoinMetrics)
 *     for this window. Turnover is a liquidity/attention signal — it is fed through
 *     the model's `qualityMetrics` channel, but it is a PROXY, read it as such.
 *   • VALUE is still OMITTED (empty valuationRatios → neutral 0): the paper's
 *     mcap/network-output ratios also need paid on-chain data.
 *   • SIZE is now REAL: CoinGecko historical market_caps over the window.
 *   • FUNDING is real and free (Binance fapi, 8h cadence); 0 + noted if missing.
 *   • Window is the PRE-COMPETITION month (2026-05-11 … 2026-06-10), not live week.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Question: does the composite RANK the 5 crypto so high-composite names earn
 * higher FORWARD 1-day returns? Measured by Spearman IC (composite vs next-day
 * return) across the 5-token cross-section at each ~daily rebalance, averaged —
 * IS (first 70%) vs OOS (last 30%). Per-factor IC reported for attribution.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeCryptoFactorModel,
  STYLE_FACTORS,
  type StyleFactor,
  type CryptoTokenInput,
} from "../../../src/core/alpha/crypto-factor-model.ts";

const BARS_DIR = "data/momq/bars";
const FUNDING_DIR = "data/momq/funding";
const MARKETDATA_DIR = "data/momq/marketdata";
const BARS_PER_DAY = 96; // 96 × 15-min bars = ~1 trading day
const LOOKBACK = BARS_PER_DAY; // reversal lookback ≈ 1 day
const FORWARD = BARS_PER_DAY; // forward-return horizon ≈ 1 day
const VOL_LOOKBACK = 20; // residual-vol window (bar-returns)
const REBALANCE_STEP = BARS_PER_DAY; // rebalance once per ~day

// The 5 competition crypto (comp symbols; BARUSD = HBAR).
const CRYPTO = ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "BARUSD"];

interface RawBar { time: number; close: number }
interface FundingPoint { time: number; fundingRate: number }
interface MarketPoint { time: number; marketCap: number; volume: number }

const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / (xs.length || 1);
const std = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((v) => (v - m) ** 2)));
};

interface SymbolData {
  symbol: string;
  bars: RawBar[];
  funding: FundingPoint[]; // ascending by time
  market: MarketPoint[]; // ascending by time
}

function loadSymbol(symbol: string): SymbolData | null {
  try {
    const bars = JSON.parse(readFileSync(join(BARS_DIR, `${symbol}_M15.json`), "utf8")) as RawBar[];
    if (bars.length < LOOKBACK + FORWARD + VOL_LOOKBACK + 2) return null;
    let funding: FundingPoint[] = [];
    try {
      funding = JSON.parse(readFileSync(join(FUNDING_DIR, `${symbol}_funding.json`), "utf8")) as FundingPoint[];
    } catch {
      funding = [];
    }
    let market: MarketPoint[] = [];
    try {
      market = JSON.parse(readFileSync(join(MARKETDATA_DIR, `${symbol}.json`), "utf8")) as MarketPoint[];
    } catch {
      market = [];
    }
    return { symbol, bars, funding, market };
  } catch {
    return null;
  }
}

/** Generic nearest-at-or-before lookup over an ascending {time}-keyed series.
 *  Falls back to the earliest point if the query precedes the whole series. */
function nearestPrior<T extends { time: number }>(series: T[], epochSec: number): T | null {
  if (series.length === 0) return null;
  let lo = 0;
  let hi = series.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid]!.time <= epochSec) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return idx === -1 ? series[0]! : series[idx]!;
}

const fundingAt = (funding: FundingPoint[], epochSec: number): number =>
  nearestPrior(funding, epochSec)?.fundingRate ?? 0;

/** Spearman rank correlation = Pearson on the ranks (average ranks for ties). */
function ranks(xs: number[]): number[] {
  const order = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const r = new Array<number>(xs.length);
  let k = 0;
  while (k < order.length) {
    let j = k;
    while (j + 1 < order.length && order[j + 1]!.v === order[k]!.v) j++;
    const avgRank = (k + j) / 2 + 1; // 1-based average rank over the tie block
    for (let t = k; t <= j; t++) r[order[t]!.i] = avgRank;
    k = j + 1;
  }
  return r;
}

function pearson(a: number[], b: number[]): number {
  const ma = mean(a);
  const mb = mean(b);
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < a.length; i++) {
    cov += (a[i]! - ma) * (b[i]! - mb);
    va += (a[i]! - ma) ** 2;
    vb += (b[i]! - mb) ** 2;
  }
  if (va === 0 || vb === 0) return 0;
  return cov / Math.sqrt(va * vb);
}

const spearman = (a: number[], b: number[]): number => pearson(ranks(a), ranks(b));

interface ICStats { mean: number; hit: number; n: number }
function summarize(ics: number[]): ICStats {
  const valid = ics.filter((x) => Number.isFinite(x));
  if (valid.length === 0) return { mean: 0, hit: 0, n: 0 };
  return {
    mean: mean(valid),
    hit: valid.filter((x) => x > 0).length / valid.length,
    n: valid.length,
  };
}

// composite + each oriented style factor exposure (as the model emits them).
type ScoreVariant = "composite" | StyleFactor;
const VARIANTS: ScoreVariant[] = ["composite", ...STYLE_FACTORS];

function main(): void {
  const loaded = CRYPTO.map(loadSymbol).filter((x): x is SymbolData => x !== null);

  const withFunding = loaded.filter((d) => d.funding.length > 0).length;
  const withMarket = loaded.filter((d) => d.market.length > 0).length;
  const minLen = Math.min(...loaded.map((d) => d.bars.length));

  const icSeries: Record<ScoreVariant, number[]> = Object.fromEntries(
    VARIANTS.map((v) => [v, [] as number[]]),
  ) as Record<ScoreVariant, number[]>;

  const firstT = LOOKBACK + VOL_LOOKBACK;
  const lastT = minLen - FORWARD - 1;
  const rebalanceTimes: number[] = [];
  for (let t = firstT; t <= lastT; t += REBALANCE_STEP) rebalanceTimes.push(t);

  for (const t of rebalanceTimes) {
    const inputs: CryptoTokenInput[] = [];
    const fwd: number[] = []; // forward return, aligned to inputs

    for (const { symbol, bars, funding, market } of loaded) {
      const cNow = bars[t]!.close;
      const cPast = bars[t - LOOKBACK]!.close;
      const cFwd = bars[t + FORWARD]!.close;
      if (!(cNow > 0) || !(cPast > 0) || !(cFwd > 0)) continue;

      const lookbackReturn = cNow / cPast - 1;
      const rets: number[] = [];
      for (let j = t - VOL_LOOKBACK + 1; j <= t; j++) {
        const prev = bars[j - 1]!.close;
        if (prev > 0) rets.push(bars[j]!.close / prev - 1);
      }
      const residualVol = std(rets);
      const fundingRate = fundingAt(funding, bars[t]!.time);

      // REAL market cap (nearest daily/hourly at-or-before this bar). Fallback to
      // 1 (size ~flat) only when the symbol has no CoinGecko data at all.
      const md = nearestPrior(market, bars[t]!.time);
      const marketCap = md && md.marketCap > 0 ? md.marketCap : 1;

      // QUALITY PROXY: volume / marketCap = turnover. A liquidity/attention signal
      // standing in for the paper's on-chain genuine-usage quality (paid data).
      // Fed through qualityMetrics; left empty (neutral) when no market data.
      const qualityMetrics =
        md && md.marketCap > 0 && md.volume >= 0 ? [md.volume / md.marketCap] : undefined;

      inputs.push({
        symbol,
        lookbackReturn,
        residualVol,
        marketCap,
        fundingRate,
        qualityMetrics,
        // valuationRatios omitted → neutral (0) value exposure (paid on-chain data)
      });
      fwd.push(cFwd / cNow - 1);
    }

    if (inputs.length < 3) continue;

    // size weight ON here so its IC is attributable; default model weight is 0.
    const model = computeCryptoFactorModel(inputs, {
      minTokens: 3,
      weights: { size: 1 },
    });
    if (!model) continue;

    const bySym = new Map(model.tokens.map((tk) => [tk.symbol, tk]));
    const aligned = inputs.map((inp) => bySym.get(inp.symbol)!);

    icSeries.composite.push(spearman(aligned.map((tk) => tk.composite), fwd));
    for (const f of STYLE_FACTORS) {
      icSeries[f].push(spearman(aligned.map((tk) => tk.exposures[f]), fwd));
    }
  }

  // ── report ──
  console.log("\n══ Q-7 crypto FULL factor IC validation — 5 competition crypto (data/momq) ══\n");
  console.log("FACTORS POPULATED (genuinely fetchable, free, for the window):");
  console.log("  • reversal     = z(−lookbackReturn)             [price]");
  console.log("  • volatility   = residualVol ⊥ size             [price]");
  console.log("  • funding      = z(−fundingRate) ⊥ size,rev     [Binance public perp funding]");
  console.log("  • size         = z(−ln mcap)  ← REAL market cap [CoinGecko free historical]");
  console.log("  • quality(PROXY)= z(volume/marketCap turnover) ⊥ size  [CoinGecko — TURNOVER, not on-chain usage]");
  console.log("OMITTED (NOT freely fetchable for May–Jun 2026):");
  console.log("  • value → EMPTY (neutral 0): mcap/network-output ratios need PAID on-chain data.");
  console.log("  • TRUE quality (active addrs / econ value / fees) → approximated by turnover proxy above.\n");

  const tag = (k: number) => (k === loaded.length ? "all" : `${k}/${loaded.length}`);
  console.log(`Crypto loaded: ${loaded.length}/${CRYPTO.length} (${loaded.map((d) => d.symbol).join(", ")})`);
  console.log(`With real funding: ${tag(withFunding)}  |  with real market data: ${tag(withMarket)}  |  aligned bars: ${minLen}`);
  console.log(
    `Rebalance: every ${REBALANCE_STEP} bars (~1 day)  |  lookback ${LOOKBACK}  forward ${FORWARD}  vol-window ${VOL_LOOKBACK}`,
  );
  console.log(`Rebalance steps: ${rebalanceTimes.length}  (IC sample size per variant ≤ this)\n`);

  const cut = Math.floor(icSeries.composite.length * 0.7);
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const fmt = (s: ICStats) =>
    `meanIC ${s.mean.toFixed(4).padStart(8)}  hit ${pct(s.hit).padStart(6)}  n=${s.n}`;

  const LABELS: Record<ScoreVariant, string> = {
    composite: "composite",
    size: "  size(REAL)",
    reversal: "  reversal",
    volatility: "  volatility",
    quality: "  quality-PROXY",
    value: "  value(empty)",
    funding: "  funding",
  };

  console.log("variant         | full sample              | IS (first 70%)           | OOS (last 30%)");
  console.log("-".repeat(98));
  for (const v of VARIANTS) {
    const all = summarize(icSeries[v]);
    const is = summarize(icSeries[v].slice(0, cut));
    const oos = summarize(icSeries[v].slice(cut));
    console.log(`${LABELS[v].padEnd(15)} | ${fmt(all).padEnd(24)} | ${fmt(is).padEnd(24)} | ${fmt(oos)}`);
  }

  console.log("\nReading: meanIC = avg Spearman rank-corr(score, forward 1-day return) across the cross-section;");
  console.log("         hit = share of rebalances with IC > 0. Positive + OOS-stable = cross-sectional edge.\n");
  console.log("CAVEATS — read before trusting any number:");
  console.log("  • n=5 cross-section is VERY THIN: Spearman over 5 names is extremely noisy (only 5! rank");
  console.log("    permutations) → every meanIC is INDICATIVE ONLY, not a significance test.");
  console.log("  • quality here is a VOLUME-TURNOVER PROXY (volume/marketCap), NOT the paper's on-chain");
  console.log("    genuine-usage quality (t=9.80) — that needs PAID active-address / fee data.");
  console.log("  • VALUE factor still OMITTED (paper's t=8.91 predictor) — empty valuationRatios.");
  console.log("  • ONE month, the PRE-COMPETITION window (not the live week).");
  console.log("  • size/quality market data is daily/hourly mapped nearest-prior to each 15-min rebalance bar.\n");
}

main();
