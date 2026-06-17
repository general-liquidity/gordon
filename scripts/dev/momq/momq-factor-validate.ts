#!/usr/bin/env bun
/**
 * Cross-sectional factor-model validation over the real Model-to-Market data
 * (data/momq/bars) via INFORMATION COEFFICIENT — self-contained, no trading /
 * dry-run.
 *
 *   bun run scripts/dev/momq/momq-factor-validate.ts
 *
 * Question answered: does the Q-7 composite (computeCryptoFactorModel) RANK the
 * 15 tradeable instruments such that high-composite names earn higher FORWARD
 * returns? Measured by Spearman rank correlation (the IC) between composite and
 * next-period return across the cross-section, at each daily rebalance, averaged
 * — split IS (first 70% of rebalances) vs OOS (last 30%). A positive, OOS-stable
 * IC = a genuine cross-sectional edge.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * HONEST DATA CONSTRAINT (printed in output too): the Syphonix parquet is
 * PRICE-ONLY. There is NO on-chain quality/value, NO funding rate, and
 * market-cap is meaningless for FX/metals. So only PRICE-BASED factors are
 * computable here:
 *     reversal   = z(−lookbackReturn)   (past losers tilt positive)
 *     volatility = residualVol           (high realized vol tilts positive)
 * qualityMetrics / valuationRatios are left empty (→ neutral 0 exposure),
 * fundingRate = 0, and marketCap is a constant (so the size factor is ~flat and
 * drops out after orthogonalization). The composite therefore reflects
 * reversal + residual-vol ONLY. The full Q-7 (quality / value / funding) needs
 * external on-chain + derivatives data — a FOLLOW-UP, not validated here.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeCryptoFactorModel,
  type CryptoTokenInput,
} from "../../../src/core/alpha/crypto-factor-model.ts";

const DIR = "data/momq/bars";
const BARS_PER_DAY = 96; // 96 × 15-min bars = ~1 trading day
const LOOKBACK = BARS_PER_DAY; // reversal lookback ≈ 1 day
const FORWARD = BARS_PER_DAY; // forward-return horizon ≈ 1 day
const VOL_LOOKBACK = 20; // residual-vol window (bar-returns)
const REBALANCE_STEP = BARS_PER_DAY; // rebalance once per ~day

// The 15 competition-tradeable instruments (FX majors + gold/silver + 5 crypto).
const TRADEABLE = [
  "EURUSD", "GBPUSD", "USDCHF", "USDJPY", "USDCAD", "AUDUSD", "EURGBP", "EURCHF",
  "XAUUSD", "XAGUSD", "BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "BARUSD",
];

interface RawBar { time: number; close: number }

const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / (xs.length || 1);
const std = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((v) => (v - m) ** 2)));
};

function loadCloses(symbol: string): number[] | null {
  try {
    const raw = JSON.parse(readFileSync(join(DIR, `${symbol}_M15.json`), "utf8")) as RawBar[];
    if (raw.length < LOOKBACK + FORWARD + VOL_LOOKBACK + 2) return null;
    return raw.map((b) => b.close);
  } catch {
    return null;
  }
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

/** Three score variants per cross-section, all oriented so higher = bullish. */
type ScoreVariant = "composite" | "reversal" | "vol";

function main(): void {
  const loaded = TRADEABLE.map((s) => ({ symbol: s, closes: loadCloses(s) }))
    .filter((x): x is { symbol: string; closes: number[] } => x.closes !== null);

  // Align to a common length so every rebalance covers the same cross-section.
  const minLen = Math.min(...loaded.map((x) => x.closes.length));

  const variants: ScoreVariant[] = ["composite", "reversal", "vol"];
  const icSeries: Record<ScoreVariant, number[]> = { composite: [], reversal: [], vol: [] };

  // First rebalance needs LOOKBACK+VOL_LOOKBACK history; last needs FORWARD ahead.
  const firstT = LOOKBACK + VOL_LOOKBACK;
  const lastT = minLen - FORWARD - 1;

  const rebalanceTimes: number[] = [];
  for (let t = firstT; t <= lastT; t += REBALANCE_STEP) rebalanceTimes.push(t);

  for (const t of rebalanceTimes) {
    const inputs: CryptoTokenInput[] = [];
    const reversalRaw: number[] = []; // −lookbackReturn  (loser = positive)
    const volRaw: number[] = []; //      residualVol     (high vol = positive)
    const fwd: number[] = []; //         forward return

    for (const { symbol, closes } of loaded) {
      const cNow = closes[t]!;
      const cPast = closes[t - LOOKBACK]!;
      const cFwd = closes[t + FORWARD]!;
      if (!(cNow > 0) || !(cPast > 0) || !(cFwd > 0)) continue;

      const lookbackReturn = cNow / cPast - 1;
      const rets: number[] = [];
      for (let j = t - VOL_LOOKBACK + 1; j <= t; j++) {
        const prev = closes[j - 1]!;
        if (prev > 0) rets.push(closes[j]! / prev - 1);
      }
      const residualVol = std(rets);

      inputs.push({
        symbol,
        lookbackReturn,
        residualVol,
        marketCap: 1, // constant → size factor ~flat (meaningless for FX/metals)
        fundingRate: 0, // no derivatives data in the price-only parquet
        // qualityMetrics / valuationRatios omitted → neutral (0) exposure
      });
      reversalRaw.push(-lookbackReturn);
      volRaw.push(residualVol);
      fwd.push(cFwd / cNow - 1);
    }

    if (inputs.length < 3) continue;

    const model = computeCryptoFactorModel(inputs, { minTokens: 3 });
    if (!model) continue;

    // Re-align composite back to the inputs order (model sorts desc by composite).
    const compBySym = new Map(model.tokens.map((tk) => [tk.symbol, tk.composite]));
    const composite = inputs.map((inp) => compBySym.get(inp.symbol) ?? 0);

    const scores: Record<ScoreVariant, number[]> = {
      composite,
      reversal: reversalRaw,
      vol: volRaw,
    };
    for (const v of variants) icSeries[v].push(spearman(scores[v], fwd));
  }

  // ── report ──
  console.log("\n══ Cross-sectional factor IC validation — Model-to-Market (data/momq/bars) ══\n");
  console.log("HONEST DATA CONSTRAINT: the Syphonix parquet is PRICE-ONLY.");
  console.log("  • NO on-chain quality/value, NO funding rate, market-cap meaningless for FX/metals.");
  console.log("  • Only price-based factors used: reversal (−lookbackReturn) + residual-vol.");
  console.log("  • quality/value → neutral 0, funding 0, marketCap constant (size ~flat).");
  console.log("  • Full Q-7 (quality/value/funding) needs external on-chain + derivatives data — FOLLOW-UP.\n");

  console.log(`Instruments: ${loaded.length}/${TRADEABLE.length}  |  aligned bars: ${minLen}`);
  console.log(
    `Rebalance: every ${REBALANCE_STEP} bars (~1 day)  |  lookback ${LOOKBACK}  forward ${FORWARD}  ` +
      `vol-window ${VOL_LOOKBACK}`,
  );
  console.log(`Rebalance steps: ${rebalanceTimes.length}  (IC sample size per variant ≤ this)\n`);

  const cut = Math.floor(icSeries.composite.length * 0.7);
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const fmt = (s: ICStats) =>
    `meanIC ${s.mean.toFixed(4).padStart(8)}  hit ${pct(s.hit).padStart(6)}  n=${s.n}`;

  console.log("variant       | full sample              | IS (first 70%)           | OOS (last 30%)");
  console.log("-".repeat(96));
  for (const v of variants) {
    const all = summarize(icSeries[v]);
    const is = summarize(icSeries[v].slice(0, cut));
    const oos = summarize(icSeries[v].slice(cut));
    const label = v === "composite" ? "composite(Q-7)" : v === "reversal" ? "reversal-only " : "resid-vol-only";
    console.log(`${label.padEnd(13)} | ${fmt(all).padEnd(24)} | ${fmt(is).padEnd(24)} | ${fmt(oos)}`);
  }

  console.log("\nReading: meanIC = avg Spearman rank-corr(score, forward return) across the cross-section;");
  console.log("         hit = share of rebalances with IC > 0. Positive + OOS-stable = cross-sectional edge.\n");
  console.log("CAVEATS: 15-instrument cross-section is THIN (Spearman noisy at n≈15); ONE month of data;");
  console.log("         price-only factors (reversal + vol, not full Q-7); this is the PRE-COMPETITION window,");
  console.log("         not the live week. Treat as INDICATIVE, not conclusive.\n");
}

main();
