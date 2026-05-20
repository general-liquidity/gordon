/**
 * Market Breadth Directional Bias — TM3.
 *
 * Computes the directional bias of a universe of symbols by counting
 * the fraction with positive vs negative returns over a recent
 * window. Classifies the day as bullish, bearish, or balanced based
 * on configurable thresholds.
 *
 *   "Most coins severely down on the day" → bearish bias
 *   "Most coins evenly distributed" → balanced
 *   "Most coins insanely up" → bullish bias
 *
 * The majority of trading days are balanced — directional bias is the
 * minority case but valuable when present.
 *
 * Operator pattern (Spicy 2025): if bias is balanced, only take
 * high-quality setups in either direction. If bias is directional,
 * lower-quality setups in the bias direction become acceptable; the
 * counter-bias direction requires extra-high quality.
 *
 * Pedigree: classic equity-market breadth analysis (advance/decline
 * line) adapted for crypto perp universe.
 *
 * Pure compute. No I/O.
 */

export const MARKET_BREADTH_BIAS_FLAG_ENV = "GORDON_MARKET_BREADTH_BIAS";

export function isMarketBreadthBiasEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env[MARKET_BREADTH_BIAS_FLAG_ENV] === "1" ||
    env[MARKET_BREADTH_BIAS_FLAG_ENV] === "true"
  );
}

export interface MarketBreadthBiasInput {
  /** Recent returns, one per symbol in the chosen universe (e.g. fractional 24h returns). */
  returns: ReadonlyArray<number>;
  /**
   * Minimum fraction of symbols that must be positive to call the
   * market bullish. Default 0.70.
   */
  bullishThreshold?: number;
  /**
   * Minimum fraction of symbols that must be negative to call the
   * market bearish. Default 0.70.
   */
  bearishThreshold?: number;
  /**
   * Returns below this magnitude count as flat (neither positive nor
   * negative). Default 0 (any non-zero return counts).
   */
  flatThreshold?: number;
}

export type BreadthBias = "bullish" | "bearish" | "balanced";

export interface MarketBreadthBiasResult {
  positiveCount: number;
  negativeCount: number;
  flatCount: number;
  total: number;
  positiveFraction: number;
  negativeFraction: number;
  meanReturn: number;
  medianReturn: number;
  bias: BreadthBias;
  reasoning: string;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

const DEFAULT_BULL = 0.70;
const DEFAULT_BEAR = 0.70;

export function computeMarketBreadthBias(
  input: MarketBreadthBiasInput,
): MarketBreadthBiasResult {
  if (input.returns.length === 0) {
    throw new Error("returns must not be empty");
  }
  const bullThreshold = input.bullishThreshold ?? DEFAULT_BULL;
  const bearThreshold = input.bearishThreshold ?? DEFAULT_BEAR;
  const flatMag = input.flatThreshold ?? 0;
  if (bullThreshold <= 0 || bullThreshold > 1) {
    throw new Error("bullishThreshold must be in (0, 1]");
  }
  if (bearThreshold <= 0 || bearThreshold > 1) {
    throw new Error("bearishThreshold must be in (0, 1]");
  }
  if (flatMag < 0) {
    throw new Error("flatThreshold must be ≥ 0");
  }

  let positiveCount = 0;
  let negativeCount = 0;
  let flatCount = 0;
  let sum = 0;
  for (const r of input.returns) {
    if (!Number.isFinite(r)) {
      throw new Error(`returns contains non-finite value: ${r}`);
    }
    sum += r;
    if (Math.abs(r) <= flatMag) {
      flatCount++;
    } else if (r > 0) {
      positiveCount++;
    } else {
      negativeCount++;
    }
  }
  const total = input.returns.length;
  const positiveFraction = positiveCount / total;
  const negativeFraction = negativeCount / total;
  const meanReturn = sum / total;
  const medianReturn = median([...input.returns]);

  let bias: BreadthBias = "balanced";
  if (positiveFraction >= bullThreshold) bias = "bullish";
  else if (negativeFraction >= bearThreshold) bias = "bearish";

  const reasoning =
    `Breadth over ${total} symbols: ${positiveCount} up, ${negativeCount} down, ${flatCount} flat ` +
    `(${(positiveFraction * 100).toFixed(1)}% positive vs ${(negativeFraction * 100).toFixed(1)}% negative, ` +
    `mean=${meanReturn.toFixed(4)}, median=${medianReturn.toFixed(4)}) ` +
    `→ ${bias} (thresholds: bull≥${bullThreshold}, bear≥${bearThreshold}).`;

  return {
    positiveCount,
    negativeCount,
    flatCount,
    total,
    positiveFraction,
    negativeFraction,
    meanReturn,
    medianReturn,
    bias,
    reasoning,
  };
}

export function marketBreadthBiasToPayload(
  result: MarketBreadthBiasResult,
): Record<string, unknown> {
  return {
    kind: "market_breadth_bias.computed",
    bias: result.bias,
    total: result.total,
    positiveFraction: Number(result.positiveFraction.toFixed(4)),
    negativeFraction: Number(result.negativeFraction.toFixed(4)),
    meanReturn: Number(result.meanReturn.toFixed(6)),
    medianReturn: Number(result.medianReturn.toFixed(6)),
  };
}
