/**
 * Internal Bar Strength (IBS) Cross-Sectional Ranker.
 *
 * Per-bar mean-reversion intensity:
 *   IBS = (Close - Low) / (High - Low)         in [0, 1]
 *
 *   IBS ≈ 1  → close at the high (bar is "rich"; reversion candidate down)
 *   IBS ≈ 0  → close at the low  (bar is "cheap"; reversion candidate up)
 *
 * Cross-sectional ranking buys bottom-decile (long basket) and sells
 * top-decile (short basket). Originally documented for ETF mean
 * reversion (Pagonidis, 2014); generalizes to any single-bar
 * universe.
 *
 * Distinct from:
 *   - `cross-sectional-momentum.ts`  (ranks by cumulative return; different
 *                                     direction, different lookback)
 *   - `streak-detector.ts`           (single-asset exhaustion over multiple
 *                                     bars; not a cross-sectional rank)
 *   - `vcp-contraction.ts`           (multi-bar volatility contraction pattern)
 *   - `volume-exhaustion.ts`         (volume-based, not price-position)
 *
 * Composes with:
 *   - `cross-sectional-momentum`     (IBS bottom-decile that is ALSO in the
 *                                     momentum long basket = high-quality
 *                                     dip-buy)
 *   - `regime-detection`             (IBS reversion works in range regimes,
 *                                     fails in trend regimes)
 *
 * Pure function. Caller supplies (high, low, close) tuples.
 */

export interface IbsBar {
  symbol: string;
  high: number;
  low: number;
  close: number;
}

export interface IbsCrossSectionalOptions {
  /** Top fraction by IBS (short candidates). Default 0.10. */
  topFraction?: number;
  /** Bottom fraction by IBS (long candidates). Default 0.10. */
  bottomFraction?: number;
  /** Minimum universe size for a verdict. Default 5. */
  minSymbols?: number;
  /**
   * Minimum bar range (high - low) required, as a fraction of close.
   * Defends against degenerate bars where IBS would be ill-defined.
   * Default 0 (no filter).
   */
  minRangeFraction?: number;
}

export type IbsPosition = "long" | "short" | "middle";

export interface RankedIbsAsset {
  symbol: string;
  ibs: number;
  rank: number;
  percentile: number;
  position: IbsPosition;
}

export type IbsVerdict =
  | "ranked"
  | "insufficient_data"
  | "degenerate_bars";

export interface IbsCrossSectionalResult {
  totalSymbols: number;
  validSymbols: number;
  ranked: RankedIbsAsset[];
  longBasket: string[];
  shortBasket: string[];
  middleBasket: string[];
  meanIbs: number;
  medianIbs: number;
  /** Spread between mean IBS of short basket (high) minus long basket (low). */
  ibsSpread: number;
  verdict: IbsVerdict;
  summary: string;
}

const DEFAULT_TOP_FRACTION = 0.10;
const DEFAULT_BOTTOM_FRACTION = 0.10;
const DEFAULT_MIN_SYMBOLS = 5;

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function rankIbsCrossSectional(
  bars: ReadonlyArray<IbsBar>,
  options: IbsCrossSectionalOptions = {},
): IbsCrossSectionalResult {
  const topFraction = options.topFraction ?? DEFAULT_TOP_FRACTION;
  const bottomFraction = options.bottomFraction ?? DEFAULT_BOTTOM_FRACTION;
  const minSymbols = options.minSymbols ?? DEFAULT_MIN_SYMBOLS;
  const minRangeFraction = options.minRangeFraction ?? 0;

  const valid: { symbol: string; ibs: number }[] = [];
  let degenerate = 0;
  for (const b of bars) {
    if (!Number.isFinite(b.high) || !Number.isFinite(b.low) || !Number.isFinite(b.close)) {
      degenerate++;
      continue;
    }
    const range = b.high - b.low;
    if (range <= 0) {
      degenerate++;
      continue;
    }
    if (b.close > 0 && range / b.close < minRangeFraction) {
      degenerate++;
      continue;
    }
    if (b.close < b.low || b.close > b.high) {
      degenerate++;
      continue;
    }
    const ibs = (b.close - b.low) / range;
    if (!Number.isFinite(ibs)) {
      degenerate++;
      continue;
    }
    valid.push({ symbol: b.symbol, ibs });
  }

  if (valid.length < minSymbols) {
    const verdict: IbsVerdict =
      degenerate > 0 && valid.length === 0 ? "degenerate_bars" : "insufficient_data";
    return {
      totalSymbols: bars.length,
      validSymbols: valid.length,
      ranked: [],
      longBasket: [],
      shortBasket: [],
      middleBasket: [],
      meanIbs: 0,
      medianIbs: 0,
      ibsSpread: 0,
      verdict,
      summary:
        verdict === "degenerate_bars"
          ? `All ${bars.length} bars degenerate (zero range or NaN).`
          : `Insufficient valid symbols (${valid.length} < ${minSymbols}; ${degenerate} degenerate).`,
    };
  }

  // Sort ascending by IBS (low = bottom = long candidates first)
  valid.sort((a, b) => a.ibs - b.ibs);

  const longCount = Math.max(1, Math.floor(valid.length * bottomFraction));
  const shortCount = Math.max(1, Math.floor(valid.length * topFraction));
  const effectiveLong = Math.min(longCount, Math.floor((valid.length - 1) / 2) || 1);
  const effectiveShort = Math.min(shortCount, Math.floor((valid.length - 1) / 2) || 1);

  const ranked: RankedIbsAsset[] = valid.map((v, i) => {
    const rank = i + 1;
    const percentile = rank / valid.length;
    let position: IbsPosition;
    if (rank <= effectiveLong) position = "long";
    else if (rank > valid.length - effectiveShort) position = "short";
    else position = "middle";
    return {
      symbol: v.symbol,
      ibs: parseFloat(v.ibs.toFixed(6)),
      rank,
      percentile: parseFloat(percentile.toFixed(4)),
      position,
    };
  });

  const longBasket = ranked.filter((r) => r.position === "long").map((r) => r.symbol);
  const shortBasket = ranked.filter((r) => r.position === "short").map((r) => r.symbol);
  const middleBasket = ranked.filter((r) => r.position === "middle").map((r) => r.symbol);

  const allIbs = valid.map((v) => v.ibs);
  const meanV = mean(allIbs);
  const medV = median(allIbs);
  const longMean = mean(ranked.filter((r) => r.position === "long").map((r) => r.ibs));
  const shortMean = mean(ranked.filter((r) => r.position === "short").map((r) => r.ibs));
  const spread = shortMean - longMean;

  return {
    totalSymbols: bars.length,
    validSymbols: valid.length,
    ranked,
    longBasket,
    shortBasket,
    middleBasket,
    meanIbs: parseFloat(meanV.toFixed(6)),
    medianIbs: parseFloat(medV.toFixed(6)),
    ibsSpread: parseFloat(spread.toFixed(6)),
    verdict: "ranked",
    summary:
      `Ranked ${valid.length} symbols by IBS. ` +
      `Long basket (oversold): ${longBasket.length} (mean IBS ${longMean.toFixed(3)}). ` +
      `Short basket (overbought): ${shortBasket.length} (mean IBS ${shortMean.toFixed(3)}). ` +
      `IBS spread: ${spread.toFixed(3)}.`,
  };
}

export function formatIbsCrossSectional(result: IbsCrossSectionalResult): string {
  const lines = [
    `IBS Cross-Sectional — ${result.verdict.toUpperCase()}`,
    "",
    `  Total symbols supplied: ${result.totalSymbols}`,
    `  Valid for ranking:      ${result.validSymbols}`,
    `  Mean IBS:               ${result.meanIbs.toFixed(3)}`,
    `  Median IBS:             ${result.medianIbs.toFixed(3)}`,
    `  IBS spread (short-long):${result.ibsSpread.toFixed(3)}`,
    "",
    `  Long basket (${result.longBasket.length}, low IBS):  ${result.longBasket.join(", ") || "—"}`,
    `  Short basket (${result.shortBasket.length}, high IBS): ${result.shortBasket.join(", ") || "—"}`,
  ];
  if (result.verdict === "ranked") {
    lines.push("");
    lines.push("Top 5 oversold (low IBS):");
    for (const r of result.ranked.slice(0, 5)) {
      lines.push(
        `  #${r.rank.toString().padStart(3)} ${r.symbol.padEnd(8)} IBS=${r.ibs.toFixed(3)} ${r.position}`,
      );
    }
    lines.push("Top 5 overbought (high IBS):");
    for (const r of result.ranked.slice(-5).reverse()) {
      lines.push(
        `  #${r.rank.toString().padStart(3)} ${r.symbol.padEnd(8)} IBS=${r.ibs.toFixed(3)} ${r.position}`,
      );
    }
  }
  lines.push("");
  lines.push(`Summary: ${result.summary}`);
  return lines.join("\n");
}
