/**
 * Give-Back Stop (GORDON_GIVE_BACK_STOP).
 *
 * Port of Ch 8 from Wright. The dopamine trap: traders up big lose
 * judgment quality and donate the win back via "house money" sizing.
 * Solution: hard rule that the day's flat-out stop tracks 50% of the
 * intraday high-water mark.
 *
 * The 50% rule: if you're up $10,000, you're flattened the moment you
 * give back $5,000. Position-sizing-decay extension: as P&L extends
 * past 2σ from average daily win, max position size DECREASES instead
 * of increases.
 *
 * Pure compute. State is held by caller (daily HWM + current equity).
 * Composes with WW2 absorbingBarrier — give-back is a soft soft barrier
 * that triggers a flatten, not a broker liquidation.
 */

import { flagEnv } from "../../config/flagResolver.ts";

export const GIVE_BACK_STOP_FLAG_ENV = "GORDON_GIVE_BACK_STOP";

export function isGiveBackStopEnabled(
  env: NodeJS.ProcessEnv = flagEnv(),
): boolean {
  // Default-on protective gate: absence = enabled. Explicit "0"/"false" opts out.
  const raw = env[GIVE_BACK_STOP_FLAG_ENV];
  return raw !== "0" && raw !== "false";
}

export type GiveBackState = "ok" | "warn" | "triggered";

export interface GiveBackInput {
  /** Equity at start of session. */
  sessionStartEquityUsd: number;
  /** Highest equity reached during the session. */
  sessionHighWaterMarkUsd: number;
  /** Current equity. */
  currentEquityUsd: number;
  /** Fraction of session-high P&L allowed to give back. Default 0.5. */
  giveBackFraction?: number;
  /** Optional: trader's avg daily win in USD, for outlier-territory detection. */
  averageDailyWinUsd?: number;
  /** Optional: stddev of daily wins. Used with avgDailyWin for 2σ check. */
  dailyWinStddevUsd?: number;
}

export interface GiveBackResult {
  state: GiveBackState;
  sessionPnlUsd: number;
  sessionHighWaterPnlUsd: number;
  /** Equity floor below which the operator must flatten. */
  giveBackFloorUsd: number;
  /** Multiplier to apply to next position size (≤ 1.0). */
  positionSizeMultiplier: number;
  inOutlierTerritory: boolean;
  reason: string;
}

const DEFAULT_FRACTION = 0.5;
const OUTLIER_SIGMA = 2;
const OUTLIER_SIZE_MULT = 0.5;
const WARN_BAND = 0.25; // warn once we've given back >25% of HWM PnL

export function evaluateGiveBack(input: GiveBackInput): GiveBackResult {
  const fraction = input.giveBackFraction ?? DEFAULT_FRACTION;
  const sessionPnl = input.currentEquityUsd - input.sessionStartEquityUsd;
  const hwmPnl = input.sessionHighWaterMarkUsd - input.sessionStartEquityUsd;
  const giveBackFloor = input.sessionStartEquityUsd + hwmPnl * (1 - fraction);

  const inOutlier =
    input.averageDailyWinUsd !== undefined &&
    input.dailyWinStddevUsd !== undefined &&
    input.dailyWinStddevUsd > 0
      ? hwmPnl > input.averageDailyWinUsd + OUTLIER_SIGMA * input.dailyWinStddevUsd
      : false;

  if (hwmPnl <= 0) {
    return {
      state: "ok",
      sessionPnlUsd: sessionPnl,
      sessionHighWaterPnlUsd: hwmPnl,
      giveBackFloorUsd: giveBackFloor,
      positionSizeMultiplier: 1.0,
      inOutlierTerritory: false,
      reason: "No session high-water profit yet — rule dormant",
    };
  }

  if (input.currentEquityUsd <= giveBackFloor) {
    return {
      state: "triggered",
      sessionPnlUsd: sessionPnl,
      sessionHighWaterPnlUsd: hwmPnl,
      giveBackFloorUsd: giveBackFloor,
      positionSizeMultiplier: 0,
      inOutlierTerritory: inOutlier,
      reason: `Current equity $${input.currentEquityUsd.toFixed(0)} ≤ give-back floor $${giveBackFloor.toFixed(0)} — flatten and stop`,
    };
  }

  const givenBack = input.sessionHighWaterMarkUsd - input.currentEquityUsd;
  const givenBackFraction = hwmPnl > 0 ? givenBack / hwmPnl : 0;
  const sizeMult = inOutlier ? OUTLIER_SIZE_MULT : 1.0;

  if (givenBackFraction >= WARN_BAND) {
    return {
      state: "warn",
      sessionPnlUsd: sessionPnl,
      sessionHighWaterPnlUsd: hwmPnl,
      giveBackFloorUsd: giveBackFloor,
      positionSizeMultiplier: sizeMult,
      inOutlierTerritory: inOutlier,
      reason: `Given back ${(givenBackFraction * 100).toFixed(0)}% of session HWM PnL — approaching floor`,
    };
  }

  return {
    state: "ok",
    sessionPnlUsd: sessionPnl,
    sessionHighWaterPnlUsd: hwmPnl,
    giveBackFloorUsd: giveBackFloor,
    positionSizeMultiplier: sizeMult,
    inOutlierTerritory: inOutlier,
    reason: inOutlier
      ? `Outlier territory (HWM PnL >2σ above average) — position size halved`
      : `Session PnL preserved within give-back band`,
  };
}

export function giveBackToPayload(result: GiveBackResult): Record<string, unknown> {
  return {
    kind: "give_back_stop.evaluated",
    state: result.state,
    sessionPnl: Number(result.sessionPnlUsd.toFixed(2)),
    hwmPnl: Number(result.sessionHighWaterPnlUsd.toFixed(2)),
    floor: Number(result.giveBackFloorUsd.toFixed(2)),
    sizeMultiplier: result.positionSizeMultiplier,
    outlier: result.inOutlierTerritory,
  };
}
