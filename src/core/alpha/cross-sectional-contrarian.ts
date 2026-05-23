/**
 * Cross-Sectional Contrarian Sizer.
 *
 * Given N assets and their recent returns over a lookback, compute
 * dollar-neutral position weights that bet on mean-reversion of
 * each instrument toward the cross-sectional market average:
 *
 *   R_m = (1/N) Σ R_i                              market-index avg
 *   R̃_i = R_i - R_m                                demeaned return
 *   w_i ∝ -R̃_i  / σ_i^p,   p ∈ {0, 1, 2}          contrarian weight
 *
 * Normalization: Σ |w_i| = 1  (gross-1 portfolio).
 *
 * The strategy is automatically dollar-neutral when expected
 * returns are demeaned: Σ w_i ≈ 0 modulo the volatility weighting.
 * This primitive enforces the dollar-neutral constraint exactly via
 * a final centering step.
 *
 * Inverse of `cross-sectional-momentum.ts` — that primitive ranks
 * winners (long) and losers (short); this one shorts winners and
 * buys losers, sized continuously by deviation magnitude rather than
 * by quantile membership.
 *
 * Distinct from:
 *   - `cross-sectional-momentum.ts`  (same direction-of-deviation, opposite
 *                                     sign, quantile-bucketed not continuous)
 *   - `wipeout-cap-sizer.ts`         (single-position bankroll cap; not a
 *                                     cross-sectional weighting)
 *   - `portfolio-optimizer.ts`       (mean-variance with covariance matrix;
 *                                     this is the diagonal-Σ shortcut)
 *
 * Composes with:
 *   - `regime-detection`             (contrarian works in range regimes,
 *                                     fails catastrophically in trend
 *                                     regimes — gate this primitive)
 *   - `effective-n`                  (sector clustering reduces effective N
 *                                     of the basket; the strategy is risky
 *                                     when names move together)
 *
 * Pure function. Caller supplies symbol + lookback prices.
 */

export interface ContrarianAsset {
  symbol: string;
  /** Closing prices ordered oldest → newest. */
  prices: ReadonlyArray<number>;
}

export type VolatilityWeighting = "none" | "inverse_sigma" | "inverse_sigma_squared";

export interface CrossSectionalContrarianOptions {
  /**
   * How to scale the contrarian signal by per-asset historical volatility.
   *   "none"                  — wi ∝ -R̃_i           (Kakushadze-Serur §10.3 Eq. 470)
   *   "inverse_sigma"         — wi ∝ -R̃_i / σ_i
   *   "inverse_sigma_squared" — wi ∝ -R̃_i / σ_i^2   (mean-variance optimal under
   *                                                  diagonal covariance assumption)
   * Default: "inverse_sigma".
   */
  volatilityWeighting?: VolatilityWeighting;
  /**
   * Minimum number of assets for a verdict. Below this returns
   * insufficient_data. Default 3.
   */
  minSymbols?: number;
  /**
   * Maximum absolute weight per asset (post-normalization). Defends
   * against single-name concentration when one symbol's return is a
   * far outlier. Default 0.30 (i.e., no name can be more than 30% of
   * gross book).
   */
  maxAbsoluteWeight?: number;
  /**
   * Floor on σ_i used in the denominator, as a fraction. Defends
   * against degenerate (near-zero-vol) assets that would blow up the
   * inverse-sigma weighting. Default 1e-4.
   */
  minSigma?: number;
}

export type ContrarianVerdict =
  | "weighted"
  | "insufficient_data"
  | "no_dispersion"
  | "degenerate_volatility";

export interface ContrarianWeight {
  symbol: string;
  returnFraction: number;
  demeanedReturn: number;
  volatility: number;
  rawSignal: number;
  weight: number;
  side: "long" | "short" | "flat";
}

export interface CrossSectionalContrarianResult {
  totalSymbols: number;
  validSymbols: number;
  marketReturn: number;
  meanReturn: number;
  returnDispersion: number;
  weights: ContrarianWeight[];
  longBookGross: number;
  shortBookGross: number;
  netExposure: number;
  /**
   * Sum of absolute weights post-normalization. Should be ≈ 1 when
   * verdict is "weighted".
   */
  grossExposure: number;
  verdict: ContrarianVerdict;
  summary: string;
}

const DEFAULT_MIN_SYMBOLS = 3;
const DEFAULT_MAX_ABS_WEIGHT = 0.30;
const DEFAULT_MIN_SIGMA = 1e-4;

function pctReturn(prices: ReadonlyArray<number>): number {
  if (prices.length < 2) return 0;
  const start = prices[0]!;
  const end = prices[prices.length - 1]!;
  if (start <= 0) return 0;
  return (end - start) / start;
}

function returnSeries(prices: ReadonlyArray<number>): number[] {
  const out: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1]!;
    const cur = prices[i]!;
    if (prev <= 0) continue;
    out.push((cur - prev) / prev);
  }
  return out;
}

function sampleStd(values: number[]): number {
  if (values.length < 2) return 0;
  const m = values.reduce((s, v) => s + v, 0) / values.length;
  let ss = 0;
  for (const v of values) ss += (v - m) * (v - m);
  return Math.sqrt(ss / (values.length - 1));
}

export function sizeCrossSectionalContrarian(
  assets: ReadonlyArray<ContrarianAsset>,
  options: CrossSectionalContrarianOptions = {},
): CrossSectionalContrarianResult {
  const weighting = options.volatilityWeighting ?? "inverse_sigma";
  const minSymbols = options.minSymbols ?? DEFAULT_MIN_SYMBOLS;
  const maxAbs = options.maxAbsoluteWeight ?? DEFAULT_MAX_ABS_WEIGHT;
  const minSigma = options.minSigma ?? DEFAULT_MIN_SIGMA;

  const valid: { symbol: string; ret: number; sigma: number }[] = [];
  for (const a of assets) {
    if (a.prices.length < 2) continue;
    const r = pctReturn(a.prices);
    if (!Number.isFinite(r)) continue;
    const stepReturns = returnSeries(a.prices);
    const sigma = sampleStd(stepReturns);
    valid.push({ symbol: a.symbol, ret: r, sigma });
  }

  if (valid.length < minSymbols) {
    return {
      totalSymbols: assets.length,
      validSymbols: valid.length,
      marketReturn: 0,
      meanReturn: 0,
      returnDispersion: 0,
      weights: [],
      longBookGross: 0,
      shortBookGross: 0,
      netExposure: 0,
      grossExposure: 0,
      verdict: "insufficient_data",
      summary: `Insufficient valid symbols (${valid.length} < ${minSymbols}).`,
    };
  }

  const marketReturn = valid.reduce((s, v) => s + v.ret, 0) / valid.length;
  const demeaned = valid.map((v) => v.ret - marketReturn);
  const dispersion = sampleStd(demeaned);

  if (dispersion === 0) {
    return {
      totalSymbols: assets.length,
      validSymbols: valid.length,
      marketReturn: parseFloat(marketReturn.toFixed(6)),
      meanReturn: parseFloat(marketReturn.toFixed(6)),
      returnDispersion: 0,
      weights: [],
      longBookGross: 0,
      shortBookGross: 0,
      netExposure: 0,
      grossExposure: 0,
      verdict: "no_dispersion",
      summary: "All assets returned identically — no contrarian signal.",
    };
  }

  // Raw contrarian signal per asset
  const raw: number[] = valid.map((v, i) => {
    const sigma = Math.max(v.sigma, minSigma);
    const sign = -demeaned[i]!;
    if (weighting === "none") return sign;
    if (weighting === "inverse_sigma") return sign / sigma;
    return sign / (sigma * sigma);
  });

  // Guard against all-zero (degenerate)
  const sumAbs = raw.reduce((s, v) => s + Math.abs(v), 0);
  if (sumAbs === 0 || !Number.isFinite(sumAbs)) {
    return {
      totalSymbols: assets.length,
      validSymbols: valid.length,
      marketReturn: parseFloat(marketReturn.toFixed(6)),
      meanReturn: parseFloat(marketReturn.toFixed(6)),
      returnDispersion: parseFloat(dispersion.toFixed(6)),
      weights: [],
      longBookGross: 0,
      shortBookGross: 0,
      netExposure: 0,
      grossExposure: 0,
      verdict: "degenerate_volatility",
      summary: "Signal magnitudes collapsed to zero (all-σ degenerate).",
    };
  }

  // Normalize so Σ|w_i| = 1
  let weights = raw.map((v) => v / sumAbs);

  // Enforce dollar-neutrality exactly: subtract the mean weight from
  // each, then re-normalize gross to 1. The continuous demeaning of
  // R_i already approximately yields dollar-neutrality; this step
  // corrects for the asymmetry introduced by per-asset σ-scaling.
  const meanW = weights.reduce((s, v) => s + v, 0) / weights.length;
  weights = weights.map((v) => v - meanW);
  const sumAbs2 = weights.reduce((s, v) => s + Math.abs(v), 0);
  if (sumAbs2 > 0) weights = weights.map((v) => v / sumAbs2);

  // Apply per-asset cap iteratively. After clipping a weight to ±cap,
  // its magnitude is FIXED; redistribute the freed gross among
  // not-yet-clipped weights proportional to their current magnitude.
  // Then re-mean-center the unclipped subset to preserve dollar-neutrality
  // approximately. Accept gross ≤ 1 when caps bind hard.
  const clipped = new Array<boolean>(weights.length).fill(false);
  for (let iter = 0; iter < 10; iter++) {
    let newlyClipped = false;
    for (let i = 0; i < weights.length; i++) {
      if (!clipped[i] && Math.abs(weights[i]!) > maxAbs) {
        weights[i] = Math.sign(weights[i]!) * maxAbs;
        clipped[i] = true;
        newlyClipped = true;
      }
    }
    if (!newlyClipped) break;

    // Recompute target gross for the unclipped portion.
    const clippedGross = weights.reduce(
      (s, v, i) => s + (clipped[i] ? Math.abs(v) : 0),
      0,
    );
    const remainingTarget = Math.max(0, 1 - clippedGross);
    const unclippedGross = weights.reduce(
      (s, v, i) => s + (clipped[i] ? 0 : Math.abs(v)),
      0,
    );
    if (unclippedGross > 0 && remainingTarget > 0) {
      const scale = remainingTarget / unclippedGross;
      for (let i = 0; i < weights.length; i++) {
        if (!clipped[i]) weights[i] = weights[i]! * scale;
      }
    }
    // Re-mean-center only the unclipped subset
    const unclippedIdx = clipped
      .map((c, i) => (c ? -1 : i))
      .filter((i) => i >= 0);
    if (unclippedIdx.length > 0) {
      const meanU =
        unclippedIdx.reduce((s, i) => s + weights[i]!, 0) / unclippedIdx.length;
      for (const i of unclippedIdx) weights[i] = weights[i]! - meanU;
    }
  }

  const result: ContrarianWeight[] = valid.map((v, i) => {
    const w = weights[i]!;
    return {
      symbol: v.symbol,
      returnFraction: parseFloat(v.ret.toFixed(6)),
      demeanedReturn: parseFloat(demeaned[i]!.toFixed(6)),
      volatility: parseFloat(v.sigma.toFixed(6)),
      rawSignal: parseFloat(raw[i]!.toFixed(6)),
      weight: parseFloat(w.toFixed(6)),
      side: w > 1e-8 ? "long" : w < -1e-8 ? "short" : "flat",
    };
  });

  const longBookGross = result.filter((r) => r.side === "long").reduce((s, r) => s + r.weight, 0);
  const shortBookGross = result
    .filter((r) => r.side === "short")
    .reduce((s, r) => s + Math.abs(r.weight), 0);
  const netExposure = result.reduce((s, r) => s + r.weight, 0);
  const grossExposure = result.reduce((s, r) => s + Math.abs(r.weight), 0);

  return {
    totalSymbols: assets.length,
    validSymbols: valid.length,
    marketReturn: parseFloat(marketReturn.toFixed(6)),
    meanReturn: parseFloat(marketReturn.toFixed(6)),
    returnDispersion: parseFloat(dispersion.toFixed(6)),
    weights: result,
    longBookGross: parseFloat(longBookGross.toFixed(6)),
    shortBookGross: parseFloat(shortBookGross.toFixed(6)),
    netExposure: parseFloat(netExposure.toFixed(6)),
    grossExposure: parseFloat(grossExposure.toFixed(6)),
    verdict: "weighted",
    summary:
      `Sized ${result.length} contrarian positions. ` +
      `Long gross ${(longBookGross * 100).toFixed(1)}%, short gross ${(shortBookGross * 100).toFixed(1)}%, ` +
      `net ${(netExposure * 100).toFixed(2)}% (dollar-neutral target). ` +
      `Market return ${(marketReturn * 100).toFixed(2)}%, dispersion ${(dispersion * 100).toFixed(2)}%.`,
  };
}

export function formatCrossSectionalContrarian(
  result: CrossSectionalContrarianResult,
): string {
  const lines = [
    `Cross-Sectional Contrarian — ${result.verdict.toUpperCase()}`,
    "",
    `  Total symbols supplied: ${result.totalSymbols}`,
    `  Valid for sizing:       ${result.validSymbols}`,
    `  Market return:          ${(result.marketReturn * 100).toFixed(2)}%`,
    `  Return dispersion:      ${(result.returnDispersion * 100).toFixed(2)}%`,
    `  Long gross:             ${(result.longBookGross * 100).toFixed(2)}%`,
    `  Short gross:            ${(result.shortBookGross * 100).toFixed(2)}%`,
    `  Net exposure:           ${(result.netExposure * 100).toFixed(2)}%`,
    `  Gross exposure:         ${(result.grossExposure * 100).toFixed(2)}%`,
  ];
  if (result.verdict === "weighted") {
    const sorted = [...result.weights].sort((a, b) => b.weight - a.weight);
    lines.push("");
    lines.push("Largest LONGs (buy the losers):");
    for (const w of sorted.slice(0, 5)) {
      if (w.side !== "long") break;
      lines.push(
        `  ${w.symbol.padEnd(8)} w=${(w.weight * 100).toFixed(2)}% (ret ${(w.returnFraction * 100).toFixed(2)}%, σ ${(w.volatility * 100).toFixed(2)}%)`,
      );
    }
    lines.push("Largest SHORTs (sell the winners):");
    for (const w of sorted.slice(-5).reverse()) {
      if (w.side !== "short") break;
      lines.push(
        `  ${w.symbol.padEnd(8)} w=${(w.weight * 100).toFixed(2)}% (ret ${(w.returnFraction * 100).toFixed(2)}%, σ ${(w.volatility * 100).toFixed(2)}%)`,
      );
    }
  }
  lines.push("");
  lines.push(`Summary: ${result.summary}`);
  return lines.join("\n");
}
