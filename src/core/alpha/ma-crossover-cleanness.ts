/**
 * MA-Crossover Cleanness Classifier — Koroush AK / ZCT MA Indicator.
 *
 * Computes a Smoothed Moving Average (SMMA, Wilder's smoothing) over
 * close prices and counts how many times price crosses the MA across
 * the lookback. Combined with the MA's terminal slope, classifies the
 * trend as clean / messy / chop and maps to an edge activation
 * (momentum-favorable / mean-reversion-favorable / mixed).
 *
 * Koroush AK's cross-counting rules (ZCT 2025 MA masterclass):
 *   1. Every cross counts, including wicks. If a candle's [low, high]
 *      range crosses the MA from the prior bar's side, count it.
 *   2. Brief touches that immediately reverse still count.
 *   3. Start counting after structure breaks, not during consolidation.
 *      (Caller-supplied `startBarIndex` if they want this; default counts
 *      everything in the window.)
 *
 * Default thresholds:
 *   - 0–3 crosses + trending MA = clean_trend  → momentum_favorable
 *   - 4–6 crosses + trending MA = messy_trend  → mixed
 *   - 7+ crosses OR sideways MA = chop         → mean_reversion_favorable
 *
 * SMMA recurrence (Wilder):
 *   SMMA[N-1] = mean(close[0..N-1])              (seed with simple SMA)
 *   SMMA[i]   = (SMMA[i-1] * (N-1) + close[i]) / N
 *
 * Distinct from:
 *   - `infra/trading/quant/meanCrossingFrequency.ts` (Sarmento-Horta
 *     pairs eligibility; counts zero-crossings of a series for half-life
 *     diagnostics — different purpose, different rules)
 *   - `ma-proximity.ts` (single-bar MA-touching for stop-distance R:R
 *     classification, not multi-bar cross-rate)
 *   - `streak-detector.ts` (same-direction-bar streak, not MA-relative)
 *
 * Composes with:
 *   - `volume-pattern-edge` (LV32)         (volume confirms which edge
 *                                            is active alongside trend
 *                                            cleanness)
 *   - `institutional-footprint` (LV27)     (clean_trend + accumulation
 *                                            signature aligns)
 *   - `level-freshness` (LV2)              (fresh level + clean_trend =
 *                                            high-quality breakout)
 *
 * Pure function over OHLC bars.
 */

export interface MaCrossoverBar {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface MaCrossoverOptions {
  /** SMMA length. Default 30 (ZCT convention). */
  maLength?: number;
  /**
   * If supplied, start counting crosses from this bar index (inclusive)
   * — Koroush's "start after structure breaks, not during consolidation".
   * Default 0 (count from earliest bar where SMMA is defined).
   */
  startBarIndex?: number;
  /**
   * Slope window (bars from end) used to classify MA direction. Default 10.
   */
  slopeWindow?: number;
  /**
   * Minimum |SMMA slope| / SMMA terminal, expressed as fraction PER BAR,
   * for the MA to count as trending. Default 0.0005 (0.05%/bar).
   */
  trendingSlopeThreshold?: number;
  /** Crosses ≤ this count + trending MA = clean. Default 3. */
  cleanCrossCeiling?: number;
  /** Crosses ≤ this count + trending MA = messy. Default 6. */
  messyCrossCeiling?: number;
}

export type MaDirection = "trending_up" | "trending_down" | "sideways";

export type TrendCleanness = "clean_trend" | "messy_trend" | "chop";

export type EdgeActivation =
  | "momentum_favorable"
  | "mean_reversion_favorable"
  | "mixed"
  | "insufficient_data";

export interface MaCrossoverResult {
  totalBars: number;
  maLength: number;
  smmaSeries: number[];
  crossCount: number;
  /** Bar indices where a cross was recorded. */
  crossIndices: number[];
  maDirection: MaDirection;
  /** SMMA slope (price units per bar) over the slope window. */
  smmaSlope: number;
  /** Slope as fraction of terminal SMMA value. */
  slopeFraction: number;
  cleanness: TrendCleanness;
  edgeActivation: EdgeActivation;
  /** 0..1 score: higher = cleaner trend. */
  cleannessScore: number;
  summary: string;
}

const DEFAULT_MA_LENGTH = 30;
const DEFAULT_SLOPE_WINDOW = 10;
const DEFAULT_TRENDING_SLOPE = 0.0005;
const DEFAULT_CLEAN_CEIL = 3;
const DEFAULT_MESSY_CEIL = 6;

function computeSmma(closes: ReadonlyArray<number>, length: number): number[] {
  const out: number[] = new Array(closes.length).fill(NaN);
  if (closes.length < length) return out;
  let seed = 0;
  for (let i = 0; i < length; i++) seed += closes[i]!;
  seed = seed / length;
  out[length - 1] = seed;
  for (let i = length; i < closes.length; i++) {
    const prev = out[i - 1]!;
    out[i] = (prev * (length - 1) + closes[i]!) / length;
  }
  return out;
}

function insufficient(reason: string, bars: number, length: number): MaCrossoverResult {
  return {
    totalBars: bars,
    maLength: length,
    smmaSeries: [],
    crossCount: 0,
    crossIndices: [],
    maDirection: "sideways",
    smmaSlope: 0,
    slopeFraction: 0,
    cleanness: "chop",
    edgeActivation: "insufficient_data",
    cleannessScore: 0,
    summary: reason,
  };
}

export function classifyMaCrossoverCleanness(
  bars: ReadonlyArray<MaCrossoverBar>,
  options: MaCrossoverOptions = {},
): MaCrossoverResult {
  const maLength = options.maLength ?? DEFAULT_MA_LENGTH;
  const slopeWindow = options.slopeWindow ?? DEFAULT_SLOPE_WINDOW;
  const trendingSlope = options.trendingSlopeThreshold ?? DEFAULT_TRENDING_SLOPE;
  const cleanCeil = options.cleanCrossCeiling ?? DEFAULT_CLEAN_CEIL;
  const messyCeil = options.messyCrossCeiling ?? DEFAULT_MESSY_CEIL;

  if (bars.length < maLength + slopeWindow) {
    return insufficient(
      `Insufficient bars (${bars.length} < ${maLength + slopeWindow}).`,
      bars.length,
      maLength,
    );
  }
  if (cleanCeil >= messyCeil) {
    return insufficient("cleanCrossCeiling must be < messyCrossCeiling.", bars.length, maLength);
  }

  const closes = bars.map((b) => b.close);
  const smma = computeSmma(closes, maLength);

  const startIdx = Math.max(maLength, options.startBarIndex ?? 0);
  if (startIdx >= bars.length - 1) {
    return insufficient(
      `startBarIndex ${startIdx} leaves <2 bars to count crosses.`,
      bars.length,
      maLength,
    );
  }

  // Cross detection: for each bar i ≥ startIdx with a defined SMMA, determine
  // whether the bar's [low, high] range crossed the MA from the prior bar's
  // dominant side. A wick poke that briefly tags the MA counts. Brief touches
  // that reverse still count (we don't dedupe consecutive crosses; each bar
  // is at most one cross relative to the prior bar's "side").
  let crossCount = 0;
  const crossIndices: number[] = [];
  // Compute prior-bar "side" relative to its SMMA from the close.
  let priorSide: "above" | "below" | "on" = "on";
  if (!Number.isNaN(smma[startIdx - 1]!) && bars[startIdx - 1]!.close > smma[startIdx - 1]!) {
    priorSide = "above";
  } else if (
    !Number.isNaN(smma[startIdx - 1]!) &&
    bars[startIdx - 1]!.close < smma[startIdx - 1]!
  ) {
    priorSide = "below";
  }

  for (let i = startIdx; i < bars.length; i++) {
    const ma = smma[i]!;
    if (Number.isNaN(ma)) continue;
    const b = bars[i]!;
    // Did the bar cross the MA? Wick-inclusive: bar crossed if its
    // [low, high] range straddles the MA from the prior side.
    let crossedThisBar = false;
    if (priorSide === "above") {
      // Need bar to dip to or below the MA
      if (b.low <= ma) crossedThisBar = true;
    } else if (priorSide === "below") {
      // Need bar to rise to or above the MA
      if (b.high >= ma) crossedThisBar = true;
    } else {
      // priorSide unknown: classify but don't count
    }
    if (crossedThisBar) {
      crossCount++;
      crossIndices.push(i);
    }
    // Update priorSide based on this bar's close
    if (b.close > ma) priorSide = "above";
    else if (b.close < ma) priorSide = "below";
    // else priorSide unchanged
  }

  // MA direction from terminal slope
  const endIdx = bars.length - 1;
  const slopeStartIdx = endIdx - slopeWindow + 1;
  const smmaTerminal = smma[endIdx]!;
  const smmaSlopeStart = smma[slopeStartIdx]!;
  const slope = (smmaTerminal - smmaSlopeStart) / slopeWindow;
  const slopeFraction = smmaTerminal > 0 ? slope / smmaTerminal : 0;
  let maDirection: MaDirection;
  if (slopeFraction > trendingSlope) maDirection = "trending_up";
  else if (slopeFraction < -trendingSlope) maDirection = "trending_down";
  else maDirection = "sideways";

  const isTrending = maDirection !== "sideways";
  let cleanness: TrendCleanness;
  if (maDirection === "sideways" || crossCount > messyCeil) cleanness = "chop";
  else if (crossCount <= cleanCeil) cleanness = "clean_trend";
  else cleanness = "messy_trend";

  let edgeActivation: EdgeActivation;
  if (cleanness === "clean_trend") edgeActivation = "momentum_favorable";
  else if (cleanness === "chop") edgeActivation = "mean_reversion_favorable";
  else edgeActivation = "mixed";

  // Score: invert cross-rate, weight by trending slope
  const normalisedCross = Math.min(1, crossCount / (messyCeil + 4));
  const slopeScore = Math.min(1, Math.abs(slopeFraction) / (trendingSlope * 4));
  const cleannessScore = parseFloat(
    Math.max(0, (1 - normalisedCross) * 0.5 + slopeScore * 0.5).toFixed(4),
  );

  const summary =
    `${edgeActivation.toUpperCase()} — ${crossCount} cross${crossCount === 1 ? "" : "es"} on ` +
    `SMMA(${maLength}); MA ${maDirection.replace("_", " ")} ` +
    `(slope ${(slopeFraction * 100).toFixed(3)}%/bar). Cleanness: ${cleanness}. ` +
    `${isTrending && cleanness === "clean_trend" ? "Edge for momentum strategies." : ""}` +
    `${cleanness === "chop" ? "Edge for mean-reversion strategies." : ""}`;

  return {
    totalBars: bars.length,
    maLength,
    smmaSeries: smma.map((v) => (Number.isNaN(v) ? 0 : parseFloat(v.toFixed(6)))),
    crossCount,
    crossIndices,
    maDirection,
    smmaSlope: parseFloat(slope.toFixed(8)),
    slopeFraction: parseFloat(slopeFraction.toFixed(8)),
    cleanness,
    edgeActivation,
    cleannessScore,
    summary: summary.trim(),
  };
}

export function formatMaCrossoverCleanness(result: MaCrossoverResult): string {
  const lines = [
    `MA-Crossover Cleanness — ${result.edgeActivation.toUpperCase()} (score ${result.cleannessScore.toFixed(2)})`,
    "",
    `  Bars supplied:       ${result.totalBars}`,
    `  SMMA length:         ${result.maLength}`,
    `  Cross count:         ${result.crossCount}`,
    `  MA direction:        ${result.maDirection}`,
    `  SMMA slope/bar:      ${result.smmaSlope.toExponential(3)} (${(result.slopeFraction * 100).toFixed(3)}%)`,
    `  Cleanness:           ${result.cleanness}`,
    `  Cross indices:       ${result.crossIndices.slice(0, 10).join(", ")}${result.crossIndices.length > 10 ? ", …" : ""}`,
    "",
    `Summary: ${result.summary}`,
  ];
  return lines.join("\n");
}
