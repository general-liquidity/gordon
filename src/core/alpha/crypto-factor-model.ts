/**
 * Crypto factor model (QuantNest-7 / Q-7).
 *
 * Port of "Crypto Has Fundamentals: A Seven-Factor Model for Digital Asset
 * Returns" (Babayeva & Aliyev, 2026). Given a cross-section of tokens, computes
 * z-scored, orthogonalized STYLE-factor exposures plus a composite expected-
 * return tilt. Pure: the caller supplies the cross-section (returns, mcap,
 * residual vol, funding, and the on-chain quality/value inputs).
 *
 * Six style factors (the market factor is the common universe component — a
 * ~unit tilt on every token — so it is not a cross-sectional exposure here):
 *   - size       z(−ln mcap); small = positive. (Insignificant after vol in the
 *                paper — "a volatility premium in disguise" — kept as a ⊥ control.)
 *   - reversal   z(−lookbackReturn); past losers = positive (t=6.19).
 *   - volatility residual vol ⊥ size; HIGH vol = positive. Crypto INVERTS the
 *                equity low-vol anomaly (high-vol tokens outperform).
 *   - quality    composite of on-chain activity metrics ⊥ size; genuine usage =
 *                positive. The paper's strongest predictor (t=9.80).
 *   - value      composite of mcap/network-output valuation ratios ⊥ size;
 *                CHEAP (low ratio) = positive (t=8.91).
 *   - funding    perp funding ⊥ size, reversal; CONTRARIAN — crowded longs
 *                (high funding) = negative (t=6.74, near-orthogonal to all else).
 *
 * Every exposure is oriented so that POSITIVE means higher expected return, so
 * the composite is directly a cross-sectional ranking signal.
 *
 * Note on breadth: cross-sectional factors need a populated universe. Over a tiny
 * cross-section (e.g. a 5-token competition crypto set) treat the exposures as
 * per-token features, not a long-short book.
 */

import { populationStd, zScore, linearRegression } from "../stats/index.ts";

export type StyleFactor = "size" | "reversal" | "volatility" | "quality" | "value" | "funding";

export const STYLE_FACTORS: StyleFactor[] = [
  "size",
  "reversal",
  "volatility",
  "quality",
  "value",
  "funding",
];

export interface CryptoTokenInput {
  symbol: string;
  /** Lookback return for the reversal factor (decimal, e.g. 21-day return). */
  lookbackReturn: number;
  /** Lagged market capitalization (USD, > 0). */
  marketCap: number;
  /** Idiosyncratic / residual volatility (any consistent scale, ≥ 0). */
  residualVol: number;
  /** Perpetual funding rate (decimal; positive = longs pay shorts = bullish crowding). */
  fundingRate: number;
  /** On-chain activity metrics for the QUALITY composite (higher = more genuine
   *  usage): e.g. [activeAddresses, economicValueTransferred, txThroughput, fees].
   *  Omit/empty when on-chain data is unavailable → neutral quality exposure. */
  qualityMetrics?: number[];
  /** On-chain valuation RATIOS for the VALUE composite (mcap / network-output;
   *  higher = MORE expensive): e.g. [mcapPerActiveAddr, mcapPerTxVolume, …].
   *  Omit/empty when unavailable → neutral value exposure. */
  valuationRatios?: number[];
}

export interface TokenFactorScore {
  symbol: string;
  exposures: Record<StyleFactor, number>;
  /** Weighted sum of oriented exposures — the cross-sectional expected-return tilt. */
  composite: number;
  /** Whether on-chain quality/value inputs were present for this token. */
  hasOnChain: boolean;
}

export interface CryptoFactorModelResult {
  tokens: TokenFactorScore[]; // sorted by composite, descending
  weights: Record<StyleFactor, number>;
  n: number;
}

export interface CryptoFactorModelOptions {
  /** Composite weights per factor. Default: 1 for each significant style factor,
   *  0 for size (a control, insignificant after the vol orthogonalization). */
  weights?: Partial<Record<StyleFactor, number>>;
  /** Minimum tokens for a meaningful cross-section (default 3). Below this → null. */
  minTokens?: number;
}

const DEFAULT_WEIGHTS: Record<StyleFactor, number> = {
  size: 0,
  reversal: 1,
  volatility: 1,
  quality: 1,
  value: 1,
  funding: 1,
};

const mean = (xs: number[]): number => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0);

/** Cross-sectional z-score over the masked entries; unmasked → 0 (neutral).
 *  std 0 → all masked entries 0. */
function zscoreMasked(values: number[], mask: boolean[]): number[] {
  const idx = values.map((_, i) => i).filter((i) => mask[i]);
  const present = idx.map((i) => values[i]!);
  const m = mean(present);
  const sd = populationStd(present);
  const out = new Array(values.length).fill(0);
  if (sd === 0) return out;
  for (const i of idx) out[i] = zScore(values[i]!, m, sd);
  return out;
}

/** Residual of y on x (simple OLS with intercept) over masked entries; unmasked → 0.
 *  Removes the linear component of `x` from `y` so the result is ⊥ x in the
 *  cross-section. var(x)=0 → y centered (passthrough of the masked mean-removed y). */
function residualizeMasked(y: number[], x: number[], mask: boolean[]): number[] {
  const idx = y.map((_, i) => i).filter((i) => mask[i]);
  const ys = idx.map((i) => y[i]!);
  const xs = idx.map((i) => x[i]!);
  let { slope, intercept } = linearRegression(xs, ys);
  // var(x)=0 makes the OLS slope undefined; fall back to a flat fit
  // (mean-removed passthrough), matching the prior varx===0 branch.
  if (!Number.isFinite(slope)) {
    slope = 0;
    intercept = mean(ys);
  }
  const out = new Array(y.length).fill(0);
  for (let k = 0; k < idx.length; k++) {
    out[idx[k]!] = ys[k]! - (intercept + slope * xs[k]!);
  }
  return out;
}

/** Mean of per-metric cross-sectional z-scores → one composite per token.
 *  Tokens whose metric arrays are empty are masked out (neutral). */
function onChainComposite(rows: (number[] | undefined)[]): {
  composite: number[];
  mask: boolean[];
} {
  const mask = rows.map((r) => Array.isArray(r) && r.length > 0);
  const width = Math.max(0, ...rows.map((r) => (r && mask.length ? r.length : 0)));
  const composite = new Array(rows.length).fill(0);
  if (width === 0) return { composite, mask };
  // z-score each metric column across the present tokens, then average per token.
  const perTokenSum = new Array(rows.length).fill(0);
  const perTokenCount = new Array(rows.length).fill(0);
  for (let col = 0; col < width; col++) {
    const colVals = rows.map((r) => (r && col < r.length ? r[col]! : 0));
    const colMask = rows.map((r, i) => mask[i] === true && Array.isArray(r) && col < r.length);
    const z = zscoreMasked(colVals, colMask);
    for (let i = 0; i < rows.length; i++) {
      if (colMask[i]) {
        perTokenSum[i] += z[i];
        perTokenCount[i] += 1;
      }
    }
  }
  for (let i = 0; i < rows.length; i++) {
    composite[i] = perTokenCount[i] > 0 ? perTokenSum[i] / perTokenCount[i] : 0;
  }
  return { composite, mask };
}

export function computeCryptoFactorModel(
  tokens: CryptoTokenInput[],
  opts: CryptoFactorModelOptions = {},
): CryptoFactorModelResult | null {
  const minTokens = opts.minTokens ?? 3;
  if (tokens.length < minTokens) return null;
  const weights = { ...DEFAULT_WEIGHTS, ...opts.weights };
  const all = tokens.map(() => true);

  // size: small-cap positive.
  const size = zscoreMasked(
    tokens.map((t) => -Math.log(Math.max(t.marketCap, Number.EPSILON))),
    all,
  );
  // reversal: past losers positive (negated lookback return).
  const reversal = zscoreMasked(
    tokens.map((t) => -t.lookbackReturn),
    all,
  );
  // volatility: high-vol positive (crypto premium), ⊥ size.
  const volatility = residualizeMasked(
    zscoreMasked(
      tokens.map((t) => t.residualVol),
      all,
    ),
    size,
    all,
  );

  // quality: genuine on-chain usage positive, ⊥ size. Neutral where data is absent.
  const q = onChainComposite(tokens.map((t) => t.qualityMetrics));
  const quality = residualizeMasked(zscoreMasked(q.composite, q.mask), size, q.mask);

  // value: cheap (low mcap/output ratio) positive → negate the valuation composite, ⊥ size.
  const v = onChainComposite(tokens.map((t) => t.valuationRatios));
  const value = residualizeMasked(
    zscoreMasked(
      v.composite.map((x) => -x),
      v.mask,
    ),
    size,
    v.mask,
  );

  // funding: contrarian (high funding = crowded longs = negative), ⊥ size then reversal.
  const fundingBase = zscoreMasked(
    tokens.map((t) => -t.fundingRate),
    all,
  );
  const funding = residualizeMasked(residualizeMasked(fundingBase, size, all), reversal, all);

  const factorVecs: Record<StyleFactor, number[]> = {
    size,
    reversal,
    volatility,
    quality,
    value,
    funding,
  };

  const scored: TokenFactorScore[] = tokens.map((t, i) => {
    const exposures = {} as Record<StyleFactor, number>;
    let composite = 0;
    for (const f of STYLE_FACTORS) {
      exposures[f] = factorVecs[f][i]!;
      composite += (weights[f] ?? 0) * exposures[f];
    }
    return {
      symbol: t.symbol,
      exposures,
      composite,
      hasOnChain: (q.mask[i] ?? false) || (v.mask[i] ?? false),
    };
  });

  scored.sort((a, b) => b.composite - a.composite);
  return { tokens: scored, weights, n: tokens.length };
}
