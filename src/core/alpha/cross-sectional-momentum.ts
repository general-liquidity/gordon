/**
 * Cross-Sectional Momentum Ranker
 *
 * Given N assets + a lookback window, ranks them by return and
 * returns the top-P% (long basket) and bottom-P% (short basket).
 * This is the standard cross-sectional momentum primitive used in
 * quant strategies — Drogan (Starkiller) describes it as "if you
 * just knew nothing and bought top 20 percentile and shorted
 * bottom 20 percentile every week, you'd make a whole bunch of
 * money."
 *
 * Distinct from:
 *   - `reversal-timing.ts`    (pair-level time-series correlation
 *                              of reversals; not basket ranking)
 *   - `streak-detector.ts`    (single-asset direction streak;
 *                              not a relative-rank operation)
 *   - `smt-divergence.ts`     (cross-sectional sweep test;
 *                              level-anchored, not return-ranked)
 *   - `psp-detector.ts`       (cross-sectional same-bar close
 *                              direction divergence; binary)
 *   - `effective-n.ts`        (correlation-structure primitive)
 *
 * Composes with:
 *   - `streak-detector`       (filter the basket by per-asset
 *                              exhaustion verdict)
 *   - `analyze_vcp_contraction` + `classify_ma_proximity`
 *                              (refine the long basket by
 *                              setup-quality on each name)
 *   - `effective-n`            (effective-N of basket members
 *                              reveals over-concentration)
 *
 * Pure function. Caller supplies series prices; primitive doesn't
 * fetch market data.
 */

export interface AssetReturnSeries {
  symbol: string;
  /**
   * Closing prices ordered oldest → newest. The lookback uses
   * `prices[0]` as the start and `prices[prices.length - 1]` as the
   * end. Caller is responsible for ensuring all series are aligned
   * by time + length.
   */
  prices: ReadonlyArray<number>;
}

export interface CrossSectionalMomentumOptions {
  /**
   * Top fraction of the basket to mark as long candidates. Default
   * 0.20 (top 20 percentile per Drogan's framing).
   */
  topFraction?: number;
  /**
   * Bottom fraction to mark as short candidates. Default 0.20.
   */
  bottomFraction?: number;
  /**
   * Optional liquidity floor — symbols whose ending price is below
   * this are dropped before ranking. Default 0 (no filter).
   */
  minEndingPrice?: number;
  /**
   * Optional caller-supplied filter — symbols for which this returns
   * false are dropped before ranking. Lets caller apply liquidity /
   * market-cap / sector filters without re-implementing them here.
   */
  symbolFilter?: (symbol: string) => boolean;
  /**
   * Minimum number of valid symbols required for a verdict.
   * Default 5. Below this the primitive returns insufficient_data.
   */
  minSymbols?: number;
}

export type RankPosition = "long" | "short" | "middle";

export interface RankedAsset {
  symbol: string;
  returnFraction: number;
  rank: number;
  percentile: number;
  position: RankPosition;
}

export type MomentumVerdict = "ranked" | "insufficient_data" | "tied_returns_no_basket";

export interface CrossSectionalMomentumResult {
  totalSymbols: number;
  validSymbols: number;
  ranked: RankedAsset[];
  /** Symbols in the top-P% by return. */
  longBasket: string[];
  /** Symbols in the bottom-P% by return. */
  shortBasket: string[];
  /** Symbols in the middle (neither long nor short). */
  middleBasket: string[];
  /** Median return across the valid basket. */
  medianReturn: number;
  /** Mean return across the valid basket. */
  meanReturn: number;
  /**
   * Spread between mean of long basket and mean of short basket. This
   * is the "long top, short bottom" expected gross return assuming
   * the operator equal-weights within each basket.
   */
  longShortSpread: number;
  verdict: MomentumVerdict;
  summary: string;
}

const DEFAULT_TOP_FRACTION = 0.2;
const DEFAULT_BOTTOM_FRACTION = 0.2;
const DEFAULT_MIN_SYMBOLS = 5;

function returnOf(prices: ReadonlyArray<number>): number {
  if (prices.length < 2) return 0;
  const start = prices[0]!;
  const end = prices[prices.length - 1]!;
  if (start <= 0) return 0;
  return (end - start) / start;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

export function rankCrossSectionalMomentum(
  assets: ReadonlyArray<AssetReturnSeries>,
  options: CrossSectionalMomentumOptions = {},
): CrossSectionalMomentumResult {
  const topFraction = options.topFraction ?? DEFAULT_TOP_FRACTION;
  const bottomFraction = options.bottomFraction ?? DEFAULT_BOTTOM_FRACTION;
  const minPrice = options.minEndingPrice ?? 0;
  const minSymbols = options.minSymbols ?? DEFAULT_MIN_SYMBOLS;

  // Filter to valid series
  const valid: { symbol: string; ret: number; endingPrice: number }[] = [];
  for (const a of assets) {
    if (a.prices.length < 2) continue;
    const endingPrice = a.prices[a.prices.length - 1]!;
    if (endingPrice < minPrice) continue;
    if (options.symbolFilter && !options.symbolFilter(a.symbol)) continue;
    const ret = returnOf(a.prices);
    if (!Number.isFinite(ret)) continue;
    valid.push({ symbol: a.symbol, ret, endingPrice });
  }

  if (valid.length < minSymbols) {
    return {
      totalSymbols: assets.length,
      validSymbols: valid.length,
      ranked: [],
      longBasket: [],
      shortBasket: [],
      middleBasket: [],
      medianReturn: 0,
      meanReturn: 0,
      longShortSpread: 0,
      verdict: "insufficient_data",
      summary: `Insufficient valid symbols (${valid.length} < ${minSymbols}).`,
    };
  }

  // Sort by return descending (highest return = rank 1 = top)
  valid.sort((a, b) => b.ret - a.ret);

  const longCount = Math.max(1, Math.floor(valid.length * topFraction));
  const shortCount = Math.max(1, Math.floor(valid.length * bottomFraction));
  // Edge case: long + short overlap means baskets collide
  if (longCount + shortCount >= valid.length) {
    // Shrink baskets so they don't overlap
    const usable = Math.floor((valid.length - 1) / 2);
    if (usable === 0) {
      return {
        totalSymbols: assets.length,
        validSymbols: valid.length,
        ranked: [],
        longBasket: [],
        shortBasket: [],
        middleBasket: [],
        medianReturn: 0,
        meanReturn: 0,
        longShortSpread: 0,
        verdict: "tied_returns_no_basket",
        summary: "Basket fractions too large for the universe size.",
      };
    }
  }

  const effectiveLongCount = Math.min(longCount, Math.floor((valid.length - 1) / 2));
  const effectiveShortCount = Math.min(shortCount, Math.floor((valid.length - 1) / 2));

  const ranked: RankedAsset[] = valid.map((v, i) => {
    const rank = i + 1;
    const percentile = 1 - rank / valid.length;
    let position: RankPosition;
    if (rank <= effectiveLongCount) position = "long";
    else if (rank > valid.length - effectiveShortCount) position = "short";
    else position = "middle";
    return {
      symbol: v.symbol,
      returnFraction: parseFloat(v.ret.toFixed(6)),
      rank,
      percentile: parseFloat(percentile.toFixed(4)),
      position,
    };
  });

  const longBasket = ranked.filter((r) => r.position === "long").map((r) => r.symbol);
  const shortBasket = ranked.filter((r) => r.position === "short").map((r) => r.symbol);
  const middleBasket = ranked.filter((r) => r.position === "middle").map((r) => r.symbol);

  const allReturns = valid.map((v) => v.ret);
  const meanRet = mean(allReturns);
  const medianRet = median(allReturns);

  const longMean = mean(ranked.filter((r) => r.position === "long").map((r) => r.returnFraction));
  const shortMean = mean(ranked.filter((r) => r.position === "short").map((r) => r.returnFraction));
  const longShortSpread = longMean - shortMean;

  const verdict: MomentumVerdict = "ranked";
  const summary =
    `Ranked ${valid.length} symbols. ` +
    `Long basket: ${longBasket.length} (mean ret ${(longMean * 100).toFixed(2)}%). ` +
    `Short basket: ${shortBasket.length} (mean ret ${(shortMean * 100).toFixed(2)}%). ` +
    `Long-short spread: ${(longShortSpread * 100).toFixed(2)}%.`;

  return {
    totalSymbols: assets.length,
    validSymbols: valid.length,
    ranked,
    longBasket,
    shortBasket,
    middleBasket,
    medianReturn: parseFloat(medianRet.toFixed(6)),
    meanReturn: parseFloat(meanRet.toFixed(6)),
    longShortSpread: parseFloat(longShortSpread.toFixed(6)),
    verdict,
    summary,
  };
}

export function formatCrossSectionalMomentum(result: CrossSectionalMomentumResult): string {
  const lines = [
    `Cross-Sectional Momentum — ${result.verdict.toUpperCase()}`,
    "",
    `  Total symbols supplied: ${result.totalSymbols}`,
    `  Valid for ranking:      ${result.validSymbols}`,
    `  Median return:          ${(result.medianReturn * 100).toFixed(2)}%`,
    `  Mean return:            ${(result.meanReturn * 100).toFixed(2)}%`,
    `  Long-short spread:      ${(result.longShortSpread * 100).toFixed(2)}%`,
    "",
    `  Long basket (${result.longBasket.length}):  ${result.longBasket.join(", ") || "—"}`,
    `  Short basket (${result.shortBasket.length}): ${result.shortBasket.join(", ") || "—"}`,
  ];
  if (result.verdict === "ranked") {
    lines.push("");
    lines.push("Top 5 ranked:");
    for (const r of result.ranked.slice(0, 5)) {
      lines.push(
        `  #${r.rank.toString().padStart(3)} ${r.symbol.padEnd(8)} ${(r.returnFraction * 100).toFixed(2).padStart(7)}% ${r.position}`,
      );
    }
    lines.push("Bottom 5 ranked:");
    for (const r of result.ranked.slice(-5)) {
      lines.push(
        `  #${r.rank.toString().padStart(3)} ${r.symbol.padEnd(8)} ${(r.returnFraction * 100).toFixed(2).padStart(7)}% ${r.position}`,
      );
    }
  }
  lines.push("");
  lines.push(`Summary: ${result.summary}`);
  return lines.join("\n");
}
