#!/usr/bin/env bun
/**
 * Cross-sectional Q-7 factor-model validation on the 5 COMPETITION CRYPTO via
 * INFORMATION COEFFICIENT — self-contained, no trading / dry-run.
 *
 *   bun run scripts/dev/momq-crypto-q7-validate.ts
 *
 * Distinct from momq-factor-validate.ts (15 instruments, price-only): this run
 * is crypto-ONLY and adds a GENUINELY-FETCHABLE factor the price-only run could
 * not — real perpetual FUNDING (Binance public history, fetched by
 * scripts/dev/fetch-crypto-funding.ts). So the composite here is:
 *     reversal   = z(−lookbackReturn)   (past losers tilt positive)
 *     volatility = residualVol           (high realized vol tilts positive)
 *     funding    = z(−fundingRate) ⊥ size,reversal  (crowded longs tilt NEGATIVE)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * HONEST DATA CONSTRAINT (printed in output too):
 *   • QUALITY + VALUE composites need historical on-chain active-address /
 *     valuation data over May–Jun 2026 — a PAID provider (Glassnode/CoinMetrics).
 *     Not freely fetchable for this window → left EMPTY (neutral 0 exposure).
 *   • SIZE is flat: free historical market-cap is rate-limited/optional, so
 *     marketCap is a CONSTANT (size factor ~drops out after orthogonalization).
 *   • FUNDING is real and free (Binance fapi/v1/fundingRate, 8h cadence).
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Question answered: does the (reversal+vol+funding) composite RANK the 5 crypto
 * so high-composite names earn higher FORWARD returns? Measured by Spearman rank
 * correlation (the IC) between composite and next-day return across the
 * cross-section at each daily rebalance, averaged — IS (first 70%) vs OOS (last
 * 30%). Also reports funding-only and reversal-only IC for attribution.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeCryptoFactorModel,
  type CryptoTokenInput,
} from "../../src/core/alpha/crypto-factor-model.ts";

const BARS_DIR = "data/momq/bars";
const FUNDING_DIR = "data/momq/funding";
const BARS_PER_DAY = 96; // 96 × 15-min bars = ~1 trading day
const LOOKBACK = BARS_PER_DAY; // reversal lookback ≈ 1 day
const FORWARD = BARS_PER_DAY; // forward-return horizon ≈ 1 day
const VOL_LOOKBACK = 20; // residual-vol window (bar-returns)
const REBALANCE_STEP = BARS_PER_DAY; // rebalance once per ~day

// The 5 competition crypto (comp symbols; BARUSD = HBAR).
const CRYPTO = ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "BARUSD"];

interface RawBar { time: number; close: number }
interface FundingPoint { time: number; fundingRate: number }

const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / (xs.length || 1);
const std = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((v) => (v - m) ** 2)));
};

interface SymbolData {
  symbol: string;
  bars: RawBar[];
  funding: FundingPoint[]; // ascending by time
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
    return { symbol, bars, funding };
  } catch {
    return null;
  }
}

/** Funding rate at-or-before the given epoch-sec (nearest prior observation).
 *  Funding[] is ascending. Falls back to the earliest if the time precedes all. */
function fundingAt(funding: FundingPoint[], epochSec: number): number {
  if (funding.length === 0) return 0;
  let lo = 0;
  let hi = funding.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (funding[mid]!.time <= epochSec) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (idx === -1) return funding[0]!.fundingRate; // before the series → earliest
  return funding[idx]!.fundingRate;
}

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

type ScoreVariant = "composite" | "funding" | "reversal";

function main(): void {
  const loaded = CRYPTO.map(loadSymbol).filter((x): x is SymbolData => x !== null);

  const withFunding = loaded.filter((d) => d.funding.length > 0).length;
  const minLen = Math.min(...loaded.map((d) => d.bars.length));

  const variants: ScoreVariant[] = ["composite", "funding", "reversal"];
  const icSeries: Record<ScoreVariant, number[]> = { composite: [], funding: [], reversal: [] };

  const firstT = LOOKBACK + VOL_LOOKBACK;
  const lastT = minLen - FORWARD - 1;
  const rebalanceTimes: number[] = [];
  for (let t = firstT; t <= lastT; t += REBALANCE_STEP) rebalanceTimes.push(t);

  for (const t of rebalanceTimes) {
    const inputs: CryptoTokenInput[] = [];
    const fundingRaw: number[] = []; // −fundingRate  (crowded longs = negative)
    const reversalRaw: number[] = []; // −lookbackReturn (loser = positive)
    const fwd: number[] = []; //         forward return

    for (const { symbol, bars, funding } of loaded) {
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

      inputs.push({
        symbol,
        lookbackReturn,
        residualVol,
        marketCap: 1, // constant → size factor ~flat (free historical mcap not fetched)
        fundingRate,
        // qualityMetrics / valuationRatios omitted → neutral (0) exposure (paid data)
      });
      fundingRaw.push(-fundingRate);
      reversalRaw.push(-lookbackReturn);
      fwd.push(cFwd / cNow - 1);
    }

    if (inputs.length < 3) continue;

    const model = computeCryptoFactorModel(inputs, { minTokens: 3 });
    if (!model) continue;

    const compBySym = new Map(model.tokens.map((tk) => [tk.symbol, tk.composite]));
    const composite = inputs.map((inp) => compBySym.get(inp.symbol) ?? 0);

    const scores: Record<ScoreVariant, number[]> = {
      composite,
      funding: fundingRaw,
      reversal: reversalRaw,
    };
    for (const v of variants) icSeries[v].push(spearman(scores[v], fwd));
  }

  // ── report ──
  console.log("\n══ Q-7 crypto factor IC validation — 5 competition crypto (data/momq) ══\n");
  console.log("FACTORS USED (genuinely fetchable for the window):");
  console.log("  • reversal   = z(−lookbackReturn)          [price]");
  console.log("  • volatility = residualVol ⊥ size          [price]");
  console.log("  • funding    = z(−fundingRate) ⊥ size,rev  [Binance public perp funding, 8h]");
  console.log("OMITTED (NOT freely fetchable for May–Jun 2026):");
  console.log("  • quality / value → EMPTY (neutral 0): need PAID on-chain (Glassnode/CoinMetrics).");
  console.log("  • size → FLAT: marketCap constant (free historical mcap rate-limited, not fetched).\n");

  const fundingTag = withFunding === loaded.length ? "all" : `${withFunding}/${loaded.length}`;
  console.log(`Crypto loaded: ${loaded.length}/${CRYPTO.length} (${loaded.map((d) => d.symbol).join(", ")})`);
  console.log(`With real funding: ${fundingTag}  |  aligned bars: ${minLen}`);
  console.log(
    `Rebalance: every ${REBALANCE_STEP} bars (~1 day)  |  lookback ${LOOKBACK}  forward ${FORWARD}  ` +
      `vol-window ${VOL_LOOKBACK}`,
  );
  console.log(`Rebalance steps: ${rebalanceTimes.length}  (IC sample size per variant ≤ this)\n`);

  const cut = Math.floor(icSeries.composite.length * 0.7);
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const fmt = (s: ICStats) =>
    `meanIC ${s.mean.toFixed(4).padStart(8)}  hit ${pct(s.hit).padStart(6)}  n=${s.n}`;

  console.log("variant         | full sample              | IS (first 70%)           | OOS (last 30%)");
  console.log("-".repeat(98));
  for (const v of variants) {
    const all = summarize(icSeries[v]);
    const is = summarize(icSeries[v].slice(0, cut));
    const oos = summarize(icSeries[v].slice(cut));
    const label =
      v === "composite" ? "composite(r+v+f)" : v === "funding" ? "funding-only   " : "reversal-only  ";
    console.log(`${label.padEnd(15)} | ${fmt(all).padEnd(24)} | ${fmt(is).padEnd(24)} | ${fmt(oos)}`);
  }

  console.log("\nReading: meanIC = avg Spearman rank-corr(score, forward return) across the cross-section;");
  console.log("         hit = share of rebalances with IC > 0. Positive + OOS-stable = cross-sectional edge.\n");
  console.log("CAVEATS — read before trusting any number:");
  console.log("  • 5-token cross-section is VERY THIN: Spearman over n=5 is extremely noisy (only 5! rank");
  console.log("    permutations) → meanIC is INDICATIVE ONLY, not a significance test.");
  console.log("  • quality + value factors OMITTED (the paper's two strongest, t=9.80 / t=8.91) — paid data.");
  console.log("  • ONE month, the PRE-COMPETITION window (not the live week); marketCap flat (no real size).");
  console.log("  • Funding mapped nearest-prior to each rebalance bar (8h cadence vs daily rebalance).\n");
}

main();
