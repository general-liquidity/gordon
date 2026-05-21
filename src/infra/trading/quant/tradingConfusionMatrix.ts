/**
 * Trading Confusion Matrix vs Oracle (GORDON_TRADING_CONFUSION_MATRIX).
 *
 * Given a strategy's actual position sequence {h_t} and an oracle's ideal
 * position sequence {ĥ_t} over the same period, computes the position-by-
 * position confusion matrix and decomposes the performance gap into
 * structural quadrants:
 *
 *   - long-when-should-long   (true positives)
 *   - long-when-should-short  (wrong direction)
 *   - short-when-should-long  (wrong direction)
 *   - short-when-should-short (true negatives)
 *
 * Plus precision, recall, F1, accuracy — borrowed from classification.
 * This is more diagnostic than a single Sharpe number: it reveals WHERE
 * the strategy is leaking alpha. "Precision 60% but recall 96%" means the
 * strategy goes long often enough but is too eager to go long during
 * down-periods — distinct from "precision 95% but recall 50%" which means
 * the strategy is too cautious and misses many genuine longs.
 *
 * Designed to pair with `optimalTradingOracle.ts` (G1): run that to get
 * {ĥ_t}, then feed both sequences here.
 *
 * Discretises positions via sign() → {-1, 0, +1}. Fractional sizes are
 * collapsed by sign intentionally — this primitive scores DIRECTION not
 * magnitude.
 *
 * Source: Giller, "Essays on Trading Strategy" (2023), Essay 6.3.9 — the
 * SPY example shows the "sign-of-alpha" strategy with accuracy 59.9%,
 * long precision 59.7%, long recall 96.4%, F1 73.7%.
 *
 * Pure compute. No I/O.
 */

export const TRADING_CONFUSION_MATRIX_FLAG_ENV = "GORDON_TRADING_CONFUSION_MATRIX";

export function isTradingConfusionMatrixEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env[TRADING_CONFUSION_MATRIX_FLAG_ENV] === "1" ||
    env[TRADING_CONFUSION_MATRIX_FLAG_ENV] === "true"
  );
}

export interface TradingConfusionMatrixInput {
  /** Actual strategy positions per period (any continuous values; sign is what counts). */
  actualPositions: ReadonlyArray<number>;
  /** Oracle positions per period (same length as actualPositions). */
  oraclePositions: ReadonlyArray<number>;
  /** Optional realised returns to compute alpha leakage (oraclePnL − actualPnL). */
  realisedReturns?: ReadonlyArray<number>;
}

export interface ConfusionCells {
  longLong: number;
  longFlat: number;
  longShort: number;
  flatLong: number;
  flatFlat: number;
  flatShort: number;
  shortLong: number;
  shortFlat: number;
  shortShort: number;
}

export interface TradingConfusionMatrixResult {
  totalPeriods: number;
  /** 3×3 cell counts indexed [actualDirection][oracleDirection]. */
  cells: ConfusionCells;
  /** Fraction of periods where direction agrees exactly (incl. flat-flat). */
  accuracy: number;
  longPrecision: number;
  longRecall: number;
  longF1: number;
  shortPrecision: number;
  shortRecall: number;
  shortF1: number;
  /** Σ ĥ_t × r_t − Σ h_t × r_t. Positive = strategy leaked alpha. Null if returns not provided. */
  alphaLeakage: number | null;
  reasoning: string;
}

function dir(x: number): -1 | 0 | 1 {
  if (x > 0) return 1;
  if (x < 0) return -1;
  return 0;
}

function safeRatio(num: number, den: number): number {
  return den > 0 ? num / den : 0;
}

export function computeTradingConfusionMatrix(
  input: TradingConfusionMatrixInput,
): TradingConfusionMatrixResult {
  const actual = input.actualPositions;
  const oracle = input.oraclePositions;
  if (actual.length !== oracle.length) {
    throw new Error(
      `position sequences must have equal length (actual=${actual.length}, oracle=${oracle.length})`,
    );
  }
  const T = actual.length;

  const cells: ConfusionCells = {
    longLong: 0,
    longFlat: 0,
    longShort: 0,
    flatLong: 0,
    flatFlat: 0,
    flatShort: 0,
    shortLong: 0,
    shortFlat: 0,
    shortShort: 0,
  };

  let agree = 0;
  for (let t = 0; t < T; t++) {
    const a = dir(actual[t]!);
    const o = dir(oracle[t]!);
    if (a === o) agree++;
    if (a === 1 && o === 1) cells.longLong++;
    else if (a === 1 && o === 0) cells.longFlat++;
    else if (a === 1 && o === -1) cells.longShort++;
    else if (a === 0 && o === 1) cells.flatLong++;
    else if (a === 0 && o === 0) cells.flatFlat++;
    else if (a === 0 && o === -1) cells.flatShort++;
    else if (a === -1 && o === 1) cells.shortLong++;
    else if (a === -1 && o === 0) cells.shortFlat++;
    else if (a === -1 && o === -1) cells.shortShort++;
  }

  const accuracy = T > 0 ? agree / T : 0;

  // Long-class metrics
  const actualLong = cells.longLong + cells.longFlat + cells.longShort;
  const oracleLong = cells.longLong + cells.flatLong + cells.shortLong;
  const longPrecision = safeRatio(cells.longLong, actualLong);
  const longRecall = safeRatio(cells.longLong, oracleLong);
  const longF1 = safeRatio(
    2 * longPrecision * longRecall,
    longPrecision + longRecall,
  );

  // Short-class metrics
  const actualShort = cells.shortLong + cells.shortFlat + cells.shortShort;
  const oracleShort = cells.longShort + cells.flatShort + cells.shortShort;
  const shortPrecision = safeRatio(cells.shortShort, actualShort);
  const shortRecall = safeRatio(cells.shortShort, oracleShort);
  const shortF1 = safeRatio(
    2 * shortPrecision * shortRecall,
    shortPrecision + shortRecall,
  );

  let alphaLeakage: number | null = null;
  if (input.realisedReturns !== undefined) {
    if (input.realisedReturns.length !== T) {
      throw new Error(
        `realisedReturns length ${input.realisedReturns.length} ≠ position length ${T}`,
      );
    }
    let actualPnL = 0;
    let oraclePnL = 0;
    for (let t = 0; t < T; t++) {
      actualPnL += actual[t]! * input.realisedReturns[t]!;
      oraclePnL += oracle[t]! * input.realisedReturns[t]!;
    }
    alphaLeakage = oraclePnL - actualPnL;
  }

  const reasoning =
    `T=${T}: accuracy=${(accuracy * 100).toFixed(1)}%, ` +
    `long P/R/F1=${(longPrecision * 100).toFixed(1)}/${(longRecall * 100).toFixed(1)}/${(longF1 * 100).toFixed(1)}, ` +
    `short P/R/F1=${(shortPrecision * 100).toFixed(1)}/${(shortRecall * 100).toFixed(1)}/${(shortF1 * 100).toFixed(1)}` +
    (alphaLeakage !== null ? `, alpha leakage=${alphaLeakage.toFixed(6)}` : "");

  return {
    totalPeriods: T,
    cells,
    accuracy,
    longPrecision,
    longRecall,
    longF1,
    shortPrecision,
    shortRecall,
    shortF1,
    alphaLeakage,
    reasoning,
  };
}

export function tradingConfusionMatrixToPayload(
  result: TradingConfusionMatrixResult,
): Record<string, unknown> {
  return {
    kind: "trading_confusion_matrix.computed",
    totalPeriods: result.totalPeriods,
    accuracy: Number(result.accuracy.toFixed(4)),
    longPrecision: Number(result.longPrecision.toFixed(4)),
    longRecall: Number(result.longRecall.toFixed(4)),
    longF1: Number(result.longF1.toFixed(4)),
    shortPrecision: Number(result.shortPrecision.toFixed(4)),
    shortRecall: Number(result.shortRecall.toFixed(4)),
    shortF1: Number(result.shortF1.toFixed(4)),
    alphaLeakage:
      result.alphaLeakage !== null ? Number(result.alphaLeakage.toFixed(8)) : null,
    cells: result.cells,
  };
}
