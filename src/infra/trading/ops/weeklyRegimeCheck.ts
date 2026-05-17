/**
 * Weekly Regime Check (GORDON_WEEKLY_REGIME_CHECK).
 *
 * Port of Ch 16 Protocol 4 from Ryan Wright. Translates Gordon's existing
 * 6-value regime classifier (trending_up / trending_down / ranging /
 * volatile / quiet / breakout) plus a volatility level into Wright's
 * 4-quadrant operator-facing classification:
 *
 *   quiet_trend     — strong direction, low vol — easy mode for trend-following
 *   volatile_trend  — strong direction, high vol — trend works but size down
 *   quiet_range     — no direction, low vol — mean-reversion shines
 *   volatile_chop   — no direction, high vol — best trade is no trade
 *
 * Each quadrant prescribes:
 *   - sizing multiplier (cuts to 0.25-1.0× of base)
 *   - which strategy families to favor and which to avoid
 *
 * Distinct from `regimeClassifier` (which produces Gordon's 6-value enum
 * from market metrics) — this is the operator-facing translation layer.
 * Pure compute, no state. Designed to be called weekly per Wright's
 * Sunday-routine cadence, but works on any input frequency.
 */

import type { MarketRegime } from "../../../core/regime/types.ts";

export const WEEKLY_REGIME_CHECK_FLAG_ENV = "GORDON_WEEKLY_REGIME_CHECK";

export function isWeeklyRegimeCheckEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env[WEEKLY_REGIME_CHECK_FLAG_ENV] === "1" ||
    env[WEEKLY_REGIME_CHECK_FLAG_ENV] === "true"
  );
}

export type Quadrant = "quiet_trend" | "volatile_trend" | "quiet_range" | "volatile_chop";
export type VolatilityLevel = "low" | "normal" | "elevated" | "crisis";

export type StrategyFamily =
  | "trend_momentum"
  | "mean_reversion"
  | "breakout_range"
  | "carry"
  | "volatility_premium";

export interface QuadrantPrescription {
  quadrant: Quadrant;
  sizingMultiplier: number;
  favored: StrategyFamily[];
  avoided: StrategyFamily[];
  guidance: string;
}

const QUADRANT_TABLE: Record<Quadrant, Omit<QuadrantPrescription, "quadrant">> = {
  quiet_trend: {
    sizingMultiplier: 1.0,
    favored: ["trend_momentum"],
    avoided: ["mean_reversion"],
    guidance:
      "Easy mode for trend-following. Take full size on trend trades, avoid mean-reversion plays.",
  },
  volatile_trend: {
    sizingMultiplier: 0.6,
    favored: ["trend_momentum", "breakout_range"],
    avoided: ["mean_reversion"],
    guidance:
      "Trend trades work but size down 25-50%. Expect slippage and gaps; widen stops or accept smaller positions.",
  },
  quiet_range: {
    sizingMultiplier: 0.75,
    favored: ["mean_reversion", "carry", "volatility_premium"],
    avoided: ["trend_momentum"],
    guidance:
      "Mean-reversion shines. Fade extremes. Reduce trend exposure. Be patient — the regime won't last.",
  },
  volatile_chop: {
    sizingMultiplier: 0.3,
    favored: [],
    avoided: ["trend_momentum", "mean_reversion", "breakout_range"],
    guidance:
      "Worst possible environment for directional strategies. Best trade is often no trade. Consider sitting in cash until regime clarifies.",
  },
};

export interface RegimeCheckInput {
  regime: MarketRegime;
  volatility: VolatilityLevel;
}

export interface RegimeCheckResult extends QuadrantPrescription {
  regime: MarketRegime;
  volatility: VolatilityLevel;
}

const TRENDING_REGIMES: ReadonlySet<MarketRegime> = new Set([
  "trending_up",
  "trending_down",
  "breakout",
]);

function classifyQuadrant(input: RegimeCheckInput): Quadrant {
  const trending = TRENDING_REGIMES.has(input.regime);
  const lowVol = input.volatility === "low" || input.volatility === "normal";

  if (trending && lowVol) return "quiet_trend";
  if (trending && !lowVol) return "volatile_trend";
  if (input.regime === "quiet") return "quiet_range";
  if (input.regime === "ranging" && lowVol) return "quiet_range";
  if (input.regime === "volatile") return "volatile_chop";
  return "volatile_chop";
}

export function evaluateRegimeCheck(input: RegimeCheckInput): RegimeCheckResult {
  const quadrant = classifyQuadrant(input);
  return {
    ...QUADRANT_TABLE[quadrant],
    quadrant,
    regime: input.regime,
    volatility: input.volatility,
  };
}

/**
 * Map raw market metrics (VIX equivalent or ATR percentile) to a
 * volatility level. Wright's bands from Ch 16:
 *   < 15  → low (quiet)
 *   15-25 → normal
 *   25-35 → elevated
 *   > 35  → crisis
 */
export function classifyVolatilityLevel(volIndex: number): VolatilityLevel {
  if (volIndex < 15) return "low";
  if (volIndex < 25) return "normal";
  if (volIndex < 35) return "elevated";
  return "crisis";
}

export function formatRegimeCheck(result: RegimeCheckResult): string {
  const lines: string[] = [];
  lines.push(
    `Regime: ${result.regime} / vol ${result.volatility} → ${result.quadrant} (size × ${result.sizingMultiplier})`,
  );
  if (result.favored.length > 0) lines.push(`  Favored: ${result.favored.join(", ")}`);
  if (result.avoided.length > 0) lines.push(`  Avoided: ${result.avoided.join(", ")}`);
  lines.push(`  ${result.guidance}`);
  return lines.join("\n");
}

export function regimeCheckToPayload(result: RegimeCheckResult): Record<string, unknown> {
  return {
    kind: "weekly_regime_check.classified",
    regime: result.regime,
    volatility: result.volatility,
    quadrant: result.quadrant,
    sizingMultiplier: result.sizingMultiplier,
  };
}
