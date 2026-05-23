/**
 * Margin-of-Error Score
 *
 * Spicy's "Margin of Error" framing from the Crypto Screeners Guide
 * and Price Action Masterclass: a strategy's odds depend on how
 * IN-SYNC it is with the current environment (directional bias +
 * structural bias). Some environments are forgiving (high margin of
 * error → can take B-grade setups). Others demand precision (low
 * margin of error → only A+ setups).
 *
 * The articles spell out the 2-bias × strategy-direction × strategy-
 * type product as a cheat sheet. This primitive codifies that cheat
 * sheet as a function.
 *
 * Inputs:
 *   - directionalBias:  long-favoring  / short-favoring  / none
 *   - structuralBias:   trending       / ranging         / none
 *   - strategyDirection: long          / short
 *   - strategyType:     breakout       / mean_reversion
 *
 * Output:
 *   - rawScore in [-2, +2] integer aggregate
 *   - grade: A+ / A / B / C — operator-facing
 *   - recommendation: "take_aggressively" / "take_normally" /
 *                     "take_only_high_quality" / "skip"
 *
 * Pure function. Caller composes with risk classifier + position
 * sizer to dial position size up/down by grade.
 */

export type DirectionalBias = "long_favoring" | "short_favoring" | "none";
export type StructuralBias = "trending" | "ranging" | "none";
export type StrategyDirection = "long" | "short";
export type StrategyType = "breakout" | "mean_reversion";

export interface MarginOfErrorInput {
  directionalBias: DirectionalBias;
  structuralBias: StructuralBias;
  strategyDirection: StrategyDirection;
  strategyType: StrategyType;
}

export type TradeGrade = "A+" | "A" | "B" | "C";
export type MarginRecommendation =
  | "take_aggressively"
  | "take_normally"
  | "take_only_high_quality"
  | "skip";

export interface MarginOfErrorResult {
  directionalInSync: boolean;
  structuralInSync: boolean;
  rawScore: number;
  grade: TradeGrade;
  recommendation: MarginRecommendation;
  /** Suggested risk multiplier vs. baseline (1.0). */
  suggestedRiskMultiplier: number;
  summary: string;
}

function directionalInSync(bias: DirectionalBias, direction: StrategyDirection): boolean {
  if (bias === "long_favoring" && direction === "long") return true;
  if (bias === "short_favoring" && direction === "short") return true;
  return false;
}

function structuralInSync(bias: StructuralBias, type: StrategyType): boolean {
  if (bias === "trending" && type === "breakout") return true;
  if (bias === "ranging" && type === "mean_reversion") return true;
  return false;
}

function directionalOutOfSync(bias: DirectionalBias, direction: StrategyDirection): boolean {
  if (bias === "long_favoring" && direction === "short") return true;
  if (bias === "short_favoring" && direction === "long") return true;
  return false;
}

function structuralOutOfSync(bias: StructuralBias, type: StrategyType): boolean {
  if (bias === "trending" && type === "mean_reversion") return true;
  if (bias === "ranging" && type === "breakout") return true;
  return false;
}

function gradeFromScore(score: number): {
  grade: TradeGrade;
  recommendation: MarginRecommendation;
  multiplier: number;
} {
  if (score >= 2) {
    return { grade: "B", recommendation: "take_aggressively", multiplier: 2.0 };
  }
  if (score === 1) {
    return { grade: "A", recommendation: "take_normally", multiplier: 1.0 };
  }
  if (score === 0) {
    return { grade: "A", recommendation: "take_only_high_quality", multiplier: 0.75 };
  }
  if (score === -1) {
    return { grade: "A+", recommendation: "take_only_high_quality", multiplier: 0.5 };
  }
  return { grade: "C", recommendation: "skip", multiplier: 0 };
}

export function computeMarginOfError(input: MarginOfErrorInput): MarginOfErrorResult {
  const dirIn = directionalInSync(input.directionalBias, input.strategyDirection);
  const dirOut = directionalOutOfSync(input.directionalBias, input.strategyDirection);
  const strIn = structuralInSync(input.structuralBias, input.strategyType);
  const strOut = structuralOutOfSync(input.structuralBias, input.strategyType);

  let rawScore = 0;
  if (dirIn) rawScore += 1;
  if (dirOut) rawScore -= 1;
  if (strIn) rawScore += 1;
  if (strOut) rawScore -= 1;

  const { grade, recommendation, multiplier } = gradeFromScore(rawScore);

  const summary =
    `Directional ${dirIn ? "in-sync" : dirOut ? "OUT-of-sync" : "neutral"}, ` +
    `structural ${strIn ? "in-sync" : strOut ? "OUT-of-sync" : "neutral"}. ` +
    `Score ${rawScore >= 0 ? "+" : ""}${rawScore} → grade ${grade} → ${recommendation} ` +
    `(${multiplier.toFixed(2)}× baseline risk).`;

  return {
    directionalInSync: dirIn,
    structuralInSync: strIn,
    rawScore,
    grade,
    recommendation,
    suggestedRiskMultiplier: multiplier,
    summary,
  };
}

export function formatMarginOfError(result: MarginOfErrorResult): string {
  const lines = [
    `Margin-of-Error — ${result.grade}`,
    "",
    `  Directional in-sync: ${result.directionalInSync ? "yes" : "no"}`,
    `  Structural in-sync:  ${result.structuralInSync ? "yes" : "no"}`,
    `  Raw score: ${result.rawScore >= 0 ? "+" : ""}${result.rawScore} (range −2..+2)`,
    `  Grade: ${result.grade}`,
    `  Recommendation: ${result.recommendation}`,
    `  Suggested risk multiplier: ${result.suggestedRiskMultiplier.toFixed(2)}×`,
    "",
    `Summary: ${result.summary}`,
  ];
  return lines.join("\n");
}
