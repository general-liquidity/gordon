/**
 * FIP (Frog-in-the-Pan) Momentum Quality Scorer.
 *
 * Premise (Frazzini–Quan–Israel–Moskowitz, ca. 2014; popularized by
 * "Quantitative Momentum" Gray & Vogel): two assets with identical
 * 50% YoY returns are NOT equally good momentum trades. The one that
 * got there via smooth daily accumulation (more positive days than
 * negative) is structurally different from the one that got there via
 * a single 30%-spike day plus mostly flat behavior. Smooth diffusion
 * of positive information correlates with continuation; spiky returns
 * tend to mean-revert.
 *
 * The FIP statistic captures path smoothness:
 *
 *   FIP = sign(total_return) × (N_negative_days − N_positive_days) / T
 *
 *   - More NEGATIVE FIP → smoother momentum (more positive days for an
 *     uptrend, more negative days for a downtrend). The frog stayed in
 *     the pan as the water gradually heated.
 *   - More POSITIVE FIP → spikier momentum (return concentrated in a
 *     few big bars). The frog noticed and is about to jump.
 *
 * Distinct from:
 *   - `cross-sectional-momentum.ts`  (ranks by TOTAL RETURN only — no
 *                                     path-smoothness axis)
 *   - `streak-detector.ts`           (current-streak length, not the
 *                                     positive-vs-negative-day fraction
 *                                     over a lookback)
 *   - `signal-recency-reweighting`   (signal-performance decay, not
 *                                     path quality of the return itself)
 *
 * Composes with:
 *   - `cross-sectional-momentum`     (two-stage screen: rank by return,
 *                                     filter by FIP quality)
 *   - `institutional-footprint`      (LV27 — chart-level accumulation;
 *                                     FIP is the return-series complement)
 *   - `walkForwardIc`                (decay of FIP-quality momentum is
 *                                     measurable separately)
 *
 * Pure function. Pedigree: Frazzini–Quan–Israel–Moskowitz "The Frog in
 * the Pan"; Gray & Vogel *Quantitative Momentum*.
 */

export interface FipAsset {
  symbol: string;
  /** Daily returns oldest → newest, as fractions (0.01 = 1%). */
  dailyReturns: ReadonlyArray<number>;
}

export interface FipMomentumOptions {
  /**
   * Lookback in days for FIP + total return. Default uses the full
   * supplied series. If specified, the most-recent N days are used.
   */
  lookbackDays?: number;
  /**
   * Tolerance below which a daily return is classified "zero day"
   * rather than positive or negative. Default 0 (any non-zero counts).
   */
  zeroTolerance?: number;
  /**
   * Threshold for FIP quality verdict.
   *   FIP ≤ −smoothFipThreshold      → smooth_momentum
   *   |FIP| < smoothFipThreshold     → mixed_momentum
   *   FIP ≥ smoothFipThreshold       → spiky_momentum
   * Default 0.10.
   */
  smoothFipThreshold?: number;
  /**
   * Top fraction by total return considered for "high-quality momentum"
   * filtering. Default 0.20 (top quintile).
   */
  topReturnFraction?: number;
  /**
   * Minimum sample size (days with finite returns) required per asset.
   * Default 20.
   */
  minSampleSize?: number;
  /**
   * Minimum number of assets in input for a cross-sectional verdict.
   * Default 3.
   */
  minAssets?: number;
}

export type FipQuality = "smooth_momentum" | "mixed_momentum" | "spiky_momentum" | "no_direction";

export interface FipAssetResult {
  symbol: string;
  totalReturn: number;
  positiveDays: number;
  negativeDays: number;
  zeroDays: number;
  sampleSize: number;
  fip: number;
  fipQuality: FipQuality;
  /** 1-indexed rank by total return descending. */
  returnRank: number;
  /** 0..1 percentile of return (1 = top). */
  returnPercentile: number;
  /** True iff in top topReturnFraction AND FIP ≤ −smoothFipThreshold. */
  isHighQualityMomentum: boolean;
}

export type FipVerdict =
  | "quality_momentum_found"
  | "weak_quality_momentum"
  | "no_directional_momentum"
  | "insufficient_data";

export interface FipMomentumResult {
  totalAssets: number;
  validAssets: number;
  lookbackUsed: number;
  topReturnFraction: number;
  smoothFipThreshold: number;
  perAsset: FipAssetResult[];
  /** Symbols passing both top-return filter AND smooth-FIP filter. */
  highQualityMomentum: string[];
  /** Symbols in top-return filter but with spiky FIP. */
  spikyTopReturn: string[];
  verdict: FipVerdict;
  summary: string;
}

const DEFAULT_ZERO_TOL = 0;
const DEFAULT_SMOOTH_THRESHOLD = 0.1;
const DEFAULT_TOP_RETURN_FRACTION = 0.2;
const DEFAULT_MIN_SAMPLE = 20;
const DEFAULT_MIN_ASSETS = 3;

function compoundReturn(returns: ReadonlyArray<number>): number {
  let acc = 1;
  for (const r of returns) {
    if (!Number.isFinite(r)) continue;
    acc *= 1 + r;
  }
  return acc - 1;
}

function classifyFip(fip: number, threshold: number, totalReturn: number): FipQuality {
  if (totalReturn === 0 || !Number.isFinite(totalReturn)) return "no_direction";
  if (fip <= -threshold) return "smooth_momentum";
  if (fip >= threshold) return "spiky_momentum";
  return "mixed_momentum";
}

export function scoreFipMomentum(
  assets: ReadonlyArray<FipAsset>,
  options: FipMomentumOptions = {},
): FipMomentumResult {
  const zeroTol = options.zeroTolerance ?? DEFAULT_ZERO_TOL;
  const smoothThreshold = options.smoothFipThreshold ?? DEFAULT_SMOOTH_THRESHOLD;
  const topFraction = options.topReturnFraction ?? DEFAULT_TOP_RETURN_FRACTION;
  const minSample = options.minSampleSize ?? DEFAULT_MIN_SAMPLE;
  const minAssets = options.minAssets ?? DEFAULT_MIN_ASSETS;

  const valid: Array<{
    symbol: string;
    returns: number[];
    totalReturn: number;
    positiveDays: number;
    negativeDays: number;
    zeroDays: number;
    sampleSize: number;
    fip: number;
  }> = [];

  for (const a of assets) {
    const seriesAll = a.dailyReturns.filter((r) => Number.isFinite(r));
    const series =
      options.lookbackDays !== undefined && options.lookbackDays > 0
        ? seriesAll.slice(-options.lookbackDays)
        : seriesAll;
    if (series.length < minSample) continue;

    const totalReturn = compoundReturn(series);
    let pos = 0;
    let neg = 0;
    let zero = 0;
    for (const r of series) {
      if (r > zeroTol) pos++;
      else if (r < -zeroTol) neg++;
      else zero++;
    }
    const T = series.length;
    const fip = totalReturn === 0 ? 0 : Math.sign(totalReturn) * ((neg - pos) / T);
    valid.push({
      symbol: a.symbol,
      returns: series.slice(),
      totalReturn,
      positiveDays: pos,
      negativeDays: neg,
      zeroDays: zero,
      sampleSize: T,
      fip,
    });
  }

  if (valid.length < minAssets) {
    return {
      totalAssets: assets.length,
      validAssets: valid.length,
      lookbackUsed: options.lookbackDays ?? 0,
      topReturnFraction: topFraction,
      smoothFipThreshold: smoothThreshold,
      perAsset: [],
      highQualityMomentum: [],
      spikyTopReturn: [],
      verdict: "insufficient_data",
      summary: `Insufficient valid assets (${valid.length} < ${minAssets}).`,
    };
  }

  // Sort by total return descending
  valid.sort((a, b) => b.totalReturn - a.totalReturn);
  const topCount = Math.max(1, Math.floor(valid.length * topFraction));

  const perAsset: FipAssetResult[] = valid.map((v, idx) => {
    const returnRank = idx + 1;
    const returnPercentile = 1 - idx / valid.length;
    const fipQuality = classifyFip(v.fip, smoothThreshold, v.totalReturn);
    const isTopReturn = returnRank <= topCount;
    const isSmooth = fipQuality === "smooth_momentum";
    return {
      symbol: v.symbol,
      totalReturn: parseFloat(v.totalReturn.toFixed(6)),
      positiveDays: v.positiveDays,
      negativeDays: v.negativeDays,
      zeroDays: v.zeroDays,
      sampleSize: v.sampleSize,
      fip: parseFloat(v.fip.toFixed(6)),
      fipQuality,
      returnRank,
      returnPercentile: parseFloat(returnPercentile.toFixed(4)),
      isHighQualityMomentum: isTopReturn && isSmooth,
    };
  });

  const highQualityMomentum = perAsset.filter((p) => p.isHighQualityMomentum).map((p) => p.symbol);
  const spikyTopReturn = perAsset
    .filter((p) => p.returnRank <= topCount && p.fipQuality === "spiky_momentum")
    .map((p) => p.symbol);

  // Direction check: any positive-return assets in the top bucket?
  const topReturnAssets = perAsset.slice(0, topCount);
  const positiveDirectional = topReturnAssets.filter((p) => p.totalReturn > 0).length;

  let verdict: FipVerdict;
  if (positiveDirectional === 0) {
    verdict = "no_directional_momentum";
  } else if (highQualityMomentum.length > 0) {
    verdict = "quality_momentum_found";
  } else {
    verdict = "weak_quality_momentum";
  }

  const summary =
    verdict === "quality_momentum_found"
      ? `QUALITY MOMENTUM — ${highQualityMomentum.length}/${topCount} top-return assets have smooth FIP: ${highQualityMomentum.slice(0, 5).join(", ")}${highQualityMomentum.length > 5 ? ", …" : ""}`
      : verdict === "weak_quality_momentum"
        ? `WEAK QUALITY — top-return assets exist but FIP is spiky (${spikyTopReturn.length} spiky / ${topCount} top). Returns likely concentrated in few big bars; sustainability suspect.`
        : verdict === "no_directional_momentum"
          ? `NO DIRECTIONAL MOMENTUM — no positive-return assets in the top-return bucket.`
          : `Insufficient data.`;

  return {
    totalAssets: assets.length,
    validAssets: valid.length,
    lookbackUsed: options.lookbackDays ?? valid[0]?.sampleSize ?? 0,
    topReturnFraction: topFraction,
    smoothFipThreshold: smoothThreshold,
    perAsset,
    highQualityMomentum,
    spikyTopReturn,
    verdict,
    summary,
  };
}

export function formatFipMomentum(result: FipMomentumResult): string {
  const lines = [
    `FIP Momentum Quality — ${result.verdict.toUpperCase()}`,
    "",
    `  Total / valid assets:    ${result.totalAssets} / ${result.validAssets}`,
    `  Lookback used:           ${result.lookbackUsed}`,
    `  Top-return fraction:     ${(result.topReturnFraction * 100).toFixed(0)}%`,
    `  Smooth-FIP threshold:    ±${result.smoothFipThreshold.toFixed(3)}`,
    `  High-quality momentum:   ${result.highQualityMomentum.length} (${result.highQualityMomentum.slice(0, 8).join(", ") || "—"})`,
    `  Spiky top-return:        ${result.spikyTopReturn.length} (${result.spikyTopReturn.slice(0, 8).join(", ") || "—"})`,
    "",
    `  Top assets by return:`,
  ];
  for (const p of result.perAsset.slice(0, 8)) {
    const tag = p.isHighQualityMomentum
      ? "[HQ]"
      : p.fipQuality === "spiky_momentum"
        ? "[sp]"
        : "[..]";
    lines.push(
      `    ${tag} ${p.symbol.padEnd(10)} ret=${(p.totalReturn * 100).toFixed(2).padStart(7)}%  ` +
        `fip=${p.fip.toFixed(3).padStart(6)}  ${p.fipQuality}  (+${p.positiveDays}/-${p.negativeDays}/0${p.zeroDays})`,
    );
  }
  lines.push("");
  lines.push(`Summary: ${result.summary}`);
  return lines.join("\n");
}
