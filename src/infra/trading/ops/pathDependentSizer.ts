/**
 * Path-dependent position sizer (GORDON_PATH_DEPENDENT_SIZER).
 *
 * Port of Ryan Wright's Type I/II/III tier system from Ch 9 + the Sizing
 * Matrix from Ch 16 Protocol 5. Wright credits Brent Donnelly's path-
 * dependent model in Alpha Trader.
 *
 * Core mechanic: position size is the OUTPUT of three independent inputs,
 * never the input itself. The trader picks the tier (setup quality), the
 * sizer applies path-dependent math (anti-Martingale built into the
 * formula via YTD profits in the variable component), and the performance
 * state modulates final size.
 *
 *   Type I  (standard):       1% of adjusted RC
 *   Type II (high-conviction): 3% initial RC + 10% YTD profits, capped at 5% adjusted RC
 *   Type III (fat pitch):     5-8% adjusted RC, only if YTD > 0
 *
 * Performance-state multipliers from Ch 16 Protocol 5:
 *   cold (DD >3% or 3+ losses of 5): only Type II/III at 0.5×, Type I blocked
 *   neutral:                          I=0.75×, II=1.0×, III=1.5×
 *   hot   (within 1% of peak, 3+ wins of 5): I=1.0×, II=1.5×, III=2.0×
 *
 * Distinct from `confluenceScorer.ts` (which grades setup quality on a
 * normalized confluence count) and `riskClassifier.ts` (which is a safety
 * gate). This module turns "what tier is this trade + what state am I in"
 * into "how many units do I buy/sell," and refuses Type I trades when cold.
 *
 * Anti-Martingale is structural, not behavioural: the Type II variable
 * component (10% YTD) is automatically zero or negative in drawdown, so
 * the formula itself forces defense. You cannot size up to make it back.
 */

export const PATH_DEPENDENT_SIZER_FLAG_ENV = "GORDON_PATH_DEPENDENT_SIZER";

export function isPathDependentSizerEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env[PATH_DEPENDENT_SIZER_FLAG_ENV] === "1" ||
    env[PATH_DEPENDENT_SIZER_FLAG_ENV] === "true"
  );
}

export type TradeTier = "I" | "II" | "III";
export type PerformanceState = "cold" | "neutral" | "hot";

export interface SizingInput {
  /** Initial risk capital fixed at the start of the trading year. */
  initialRiskCapital: number;
  /** Realized P&L from start of year to now. Can be negative. */
  ytdPnL: number;
  tier: TradeTier;
  performanceState: PerformanceState;
  /** Entry price. Sign-agnostic. */
  entryPrice: number;
  /** Invalidation level. The sizer only uses |entry - stop|. */
  stopPrice: number;
  /**
   * Optional override for the Type III base percentage. Wright gives a
   * 5-8% band depending on volatility tolerance; default to the floor.
   */
  typeIIIBasePct?: number;
}

export type RejectionReason =
  | "cold_state_blocks_type_i"
  | "type_iii_requires_positive_ytd"
  | "zero_stop_distance"
  | "non_positive_risk_capital";

export type CapReason = "none" | "type_ii_cap" | "absolute_cap";

export interface SizingResult {
  adjustedRiskCapital: number;
  /** Dollar risk from tier formula, before state multiplier or caps. */
  tierDollarRisk: number;
  /** Performance-state multiplier (0 means rejection). */
  stateMultiplier: number;
  /** Final dollar risk after multiplier + caps. */
  finalDollarRisk: number;
  /** Position size in instrument units (shares, contracts, coins). */
  positionUnits: number;
  cappedBy: CapReason;
  rejected: boolean;
  rejectionReason?: RejectionReason;
}

const TYPE_I_BASE_PCT = 0.01;
const TYPE_II_BASE_PCT = 0.03;
const TYPE_II_VARIABLE_PCT = 0.10;
const TYPE_II_CAP_PCT = 0.05;
const TYPE_III_DEFAULT_BASE_PCT = 0.05;
const ABSOLUTE_CAP_PCT = 0.05; // 5% adjusted RC hard ceiling per Wright

const STATE_MULTIPLIERS: Record<PerformanceState, Record<TradeTier, number>> = {
  cold: { I: 0, II: 0.5, III: 0.5 },
  neutral: { I: 0.75, II: 1.0, III: 1.5 },
  hot: { I: 1.0, II: 1.5, III: 2.0 },
};

function reject(reason: RejectionReason, adjustedRiskCapital: number): SizingResult {
  return {
    adjustedRiskCapital,
    tierDollarRisk: 0,
    stateMultiplier: 0,
    finalDollarRisk: 0,
    positionUnits: 0,
    cappedBy: "none",
    rejected: true,
    rejectionReason: reason,
  };
}

export function sizePosition(input: SizingInput): SizingResult {
  if (input.initialRiskCapital <= 0) {
    return reject("non_positive_risk_capital", input.initialRiskCapital);
  }

  const adjustedRiskCapital = input.initialRiskCapital + input.ytdPnL;
  const stopDistance = Math.abs(input.entryPrice - input.stopPrice);

  if (stopDistance === 0) {
    return reject("zero_stop_distance", adjustedRiskCapital);
  }
  if (input.performanceState === "cold" && input.tier === "I") {
    return reject("cold_state_blocks_type_i", adjustedRiskCapital);
  }
  if (input.tier === "III" && input.ytdPnL <= 0) {
    return reject("type_iii_requires_positive_ytd", adjustedRiskCapital);
  }

  let tierDollarRisk: number;
  let cappedBy: CapReason = "none";

  switch (input.tier) {
    case "I":
      tierDollarRisk = adjustedRiskCapital * TYPE_I_BASE_PCT;
      break;
    case "II": {
      const base = input.initialRiskCapital * TYPE_II_BASE_PCT;
      const variable = Math.max(0, input.ytdPnL) * TYPE_II_VARIABLE_PCT;
      const raw = base + variable;
      const cap = adjustedRiskCapital * TYPE_II_CAP_PCT;
      tierDollarRisk = Math.min(raw, cap);
      if (raw > cap) cappedBy = "type_ii_cap";
      break;
    }
    case "III":
      tierDollarRisk = adjustedRiskCapital * (input.typeIIIBasePct ?? TYPE_III_DEFAULT_BASE_PCT);
      break;
  }

  const stateMultiplier = STATE_MULTIPLIERS[input.performanceState][input.tier];
  let finalDollarRisk = tierDollarRisk * stateMultiplier;

  const absoluteCap = adjustedRiskCapital * ABSOLUTE_CAP_PCT;
  if (finalDollarRisk > absoluteCap) {
    finalDollarRisk = absoluteCap;
    cappedBy = "absolute_cap";
  }

  return {
    adjustedRiskCapital,
    tierDollarRisk,
    stateMultiplier,
    finalDollarRisk,
    positionUnits: finalDollarRisk / stopDistance,
    cappedBy,
    rejected: false,
  };
}

export interface PerformanceStateInput {
  /** Current equity vs the year-to-date peak, as a fraction (peak=1.0). */
  equityFractionOfPeak: number;
  /** Last 5 trade outcomes, most recent first. */
  recentTradeResults: ReadonlyArray<"win" | "loss">;
}

/**
 * Classify performance state from the heuristics in Ch 16 Protocol 5.
 * `cold`: drawdown >3% from peak, OR 3+ losses in last 5.
 * `hot`:  within 1% of peak, AND 3+ wins in last 5.
 * else `neutral`.
 */
export function classifyPerformanceState(input: PerformanceStateInput): PerformanceState {
  const drawdown = 1 - input.equityFractionOfPeak;
  const last5 = input.recentTradeResults.slice(0, 5);
  const losses = last5.filter((r) => r === "loss").length;
  const wins = last5.filter((r) => r === "win").length;

  if (drawdown > 0.03 || losses >= 3) return "cold";
  if (drawdown <= 0.01 && wins >= 3) return "hot";
  return "neutral";
}

export function sizingToPayload(result: SizingResult): Record<string, unknown> {
  return {
    kind: "path_dependent_sizer.sized",
    adjustedRiskCapital: result.adjustedRiskCapital,
    tierDollarRisk: result.tierDollarRisk,
    finalDollarRisk: result.finalDollarRisk,
    positionUnits: result.positionUnits,
    stateMultiplier: result.stateMultiplier,
    cappedBy: result.cappedBy,
    rejected: result.rejected,
    rejectionReason: result.rejectionReason,
  };
}
