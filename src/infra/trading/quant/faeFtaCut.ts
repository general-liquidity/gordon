/**
 * MAE/MFE Tracker + FTA Early-Cut Decision — TM1.
 *
 * "First Trouble Area" (FTA) is a price level on the way to the
 * stoploss, placed below the typical Maximum Adverse Excursion (MAE)
 * of historical winning trades. When the live trade's adverse
 * excursion exceeds the FTA, it's behaving worse than the average
 * winner — strong signal to cut early and take a smaller loss than
 * waiting for the full stoploss.
 *
 * Calibration: the FTA threshold should come from observed MAE
 * statistics of the strategy's winning trades. Gordon's backtest
 * engine tracks MAE/MFE per trade (see `core/backtesting/simulator.ts`);
 * the caller is expected to supply the empirically-derived FTA
 * threshold rather than this primitive guessing one.
 *
 * R-unit convention:
 *   Risk = |entry - stoploss|   (always positive)
 *   For BUY:  R = (currentPrice - entryPrice) / risk
 *   For SELL: R = (entryPrice - currentPrice) / risk
 *   Positive R = trade in profit; negative R = trade in loss.
 *
 *   MAE_R = most-negative R observed over priceHistory.
 *   MFE_R = most-positive R observed over priceHistory.
 *
 * FTA threshold parameter is a **positive magnitude** (e.g., 0.5
 * means "FTA at −0.5R"). Verdict transitions:
 *   currentR ≥ 0                              → hold (in profit)
 *   −ftaThresholdR < currentR < 0             → hold (within tolerance)
 *   currentR ≤ −ftaThresholdR                 → cut
 *
 * The caller decides whether to evaluate on candle close or intra-bar.
 * Per Spicy's rule, the typical pattern is: "1 candle closes through
 * the FTA → cut" — so callers should pass the most-recent closed-candle
 * close price, not the live tick price.
 *
 * Pedigree: prop-trading lore (Spicy 2025); concept of MAE/MFE goes
 * back to John Sweeney's work in the 1990s.
 *
 * Pure compute. No I/O.
 */

export const FAE_FTA_CUT_FLAG_ENV = "GORDON_FAE_FTA_CUT";

export function isFaeFtaCutEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[FAE_FTA_CUT_FLAG_ENV] === "1" || env[FAE_FTA_CUT_FLAG_ENV] === "true";
}

export type Side = "BUY" | "SELL";

export interface FaeFtaCutInput {
  entryPrice: number;
  stoplossPrice: number;
  /** Latest evaluation price (typically most-recent closed-candle close). */
  currentPrice: number;
  side: Side;
  /**
   * FTA threshold magnitude in R units (positive). E.g. 0.5 means
   * "cut if R ≤ −0.5". Calibrate from observed MAE of historical
   * winners; a common starting point is the 75th-percentile MAE of
   * winners or roughly 0.5R when MAE data is unavailable.
   */
  ftaThresholdR: number;
  /**
   * Optional price history during the trade (excluding entry tick;
   * each entry is a closed-candle close). Used to compute MAE_R and
   * MFE_R across the trade. If omitted, MAE/MFE = currentR only.
   */
  priceHistory?: ReadonlyArray<number>;
}

export interface FaeFtaCutResult {
  /** Risk per unit (|entry − stoploss|). */
  riskUnit: number;
  /** Current R: positive = profit, negative = loss. */
  currentR: number;
  /** Maximum Adverse Excursion in R (most-negative R observed). */
  maeR: number;
  /** Maximum Favorable Excursion in R (most-positive R observed). */
  mfeR: number;
  /** True if the FTA threshold has been crossed. */
  ftaCrossed: boolean;
  /** Trade verdict. */
  verdict: "hold" | "cut";
  reasoning: string;
}

function rOf(side: Side, entry: number, current: number, riskUnit: number): number {
  if (side === "BUY") return (current - entry) / riskUnit;
  return (entry - current) / riskUnit;
}

export function computeFaeFtaCut(input: FaeFtaCutInput): FaeFtaCutResult {
  if (!Number.isFinite(input.entryPrice) || input.entryPrice <= 0) {
    throw new Error("entryPrice must be > 0");
  }
  if (!Number.isFinite(input.stoplossPrice) || input.stoplossPrice <= 0) {
    throw new Error("stoplossPrice must be > 0");
  }
  if (!Number.isFinite(input.currentPrice) || input.currentPrice <= 0) {
    throw new Error("currentPrice must be > 0");
  }
  if (input.ftaThresholdR <= 0) {
    throw new Error("ftaThresholdR must be > 0 (magnitude of adverse R at which to cut)");
  }
  // Stoploss must be on the adverse side of entry.
  if (input.side === "BUY" && input.stoplossPrice >= input.entryPrice) {
    throw new Error("For BUY, stoplossPrice must be < entryPrice");
  }
  if (input.side === "SELL" && input.stoplossPrice <= input.entryPrice) {
    throw new Error("For SELL, stoplossPrice must be > entryPrice");
  }

  const riskUnit = Math.abs(input.entryPrice - input.stoplossPrice);
  const currentR = rOf(input.side, input.entryPrice, input.currentPrice, riskUnit);

  let maeR = currentR;
  let mfeR = currentR;
  if (input.priceHistory && input.priceHistory.length > 0) {
    for (const p of input.priceHistory) {
      const r = rOf(input.side, input.entryPrice, p, riskUnit);
      if (r < maeR) maeR = r;
      if (r > mfeR) mfeR = r;
    }
  }

  const ftaCrossed = currentR <= -input.ftaThresholdR;
  const verdict: "hold" | "cut" = ftaCrossed ? "cut" : "hold";

  const reasoning =
    `${input.side} entry=${input.entryPrice} SL=${input.stoplossPrice} ` +
    `current=${input.currentPrice}: R=${currentR.toFixed(3)} ` +
    `(MAE=${maeR.toFixed(3)}, MFE=${mfeR.toFixed(3)}), ` +
    `FTA=−${input.ftaThresholdR}R → ${verdict}${ftaCrossed ? " (FTA crossed)" : ""}.`;

  return { riskUnit, currentR, maeR, mfeR, ftaCrossed, verdict, reasoning };
}

export function faeFtaCutToPayload(result: FaeFtaCutResult): Record<string, unknown> {
  return {
    kind: "fae_fta_cut.computed",
    currentR: Number(result.currentR.toFixed(4)),
    maeR: Number(result.maeR.toFixed(4)),
    mfeR: Number(result.mfeR.toFixed(4)),
    ftaCrossed: result.ftaCrossed,
    verdict: result.verdict,
  };
}
