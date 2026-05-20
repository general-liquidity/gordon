/**
 * Multi-Indicator Divergence Consensus (GORDON_DIVERGENCE_CONSENSUS).
 *
 * Cross-indicator divergence aggregator. Consumes per-indicator divergence
 * verdicts (bullish / bearish / hidden / none, with strength 0–1) and
 * produces a weighted-consensus direction. The output flags whether
 * multiple indicators agree — a single-indicator divergence is noisy;
 * a 4-of-6 consensus across RSI / MACD / Stoch / CCI / Momentum / OBV
 * is a meaningfully higher-conviction signal.
 *
 * Composes with Gordon's existing per-indicator divergence detectors
 * (`core/indicators/divergence.ts`, `divergenceIndex.ts`, the various
 * tier-2 divergence strategies). Doesn't compute divergences itself;
 * consumes their verdicts.
 *
 * Pure compute. No I/O.
 */

export const DIVERGENCE_CONSENSUS_FLAG_ENV = "GORDON_DIVERGENCE_CONSENSUS";

export function isDivergenceConsensusEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env[DIVERGENCE_CONSENSUS_FLAG_ENV] === "1" ||
    env[DIVERGENCE_CONSENSUS_FLAG_ENV] === "true"
  );
}

export type DivergenceVerdict =
  | "regular_bullish"
  | "regular_bearish"
  | "hidden_bullish"
  | "hidden_bearish"
  | "none";

export interface IndicatorDivergence {
  /** Free-form indicator name for traceability. */
  indicator: string;
  verdict: DivergenceVerdict;
  /** 0–1 confidence in this single-indicator verdict. */
  strength: number;
  /** Optional weight; defaults to 1.0. Use 2.0 for high-conviction indicators. */
  weight?: number;
}

export interface DivergenceConsensusInput {
  indicators: ReadonlyArray<IndicatorDivergence>;
  /** Minimum weighted-vote share for a direction to win consensus. Default 0.6 (60%). */
  consensusThreshold?: number;
  /** Minimum count of agreeing indicators. Default 2. */
  minAgreeingCount?: number;
}

export type DivergenceConsensusDirection =
  | "bullish"
  | "bearish"
  | "mixed"
  | "none";

export interface DivergenceConsensusResult {
  direction: DivergenceConsensusDirection;
  /** "regular" or "hidden" — what kind of consensus this is, if any. */
  flavor: "regular" | "hidden" | "mixed" | "none";
  /** Weighted-strength sum of the agreeing camp / total weighted vote. */
  agreement: number;
  bullishWeight: number;
  bearishWeight: number;
  bullishCount: number;
  bearishCount: number;
  hiddenBullishCount: number;
  hiddenBearishCount: number;
  contributingIndicators: string[];
  dissentingIndicators: string[];
  reasoning: string;
}

const DEFAULT_CONSENSUS_THRESHOLD = 0.6;
const DEFAULT_MIN_AGREEING = 2;

function isBullishVerdict(v: DivergenceVerdict): boolean {
  return v === "regular_bullish" || v === "hidden_bullish";
}

function isBearishVerdict(v: DivergenceVerdict): boolean {
  return v === "regular_bearish" || v === "hidden_bearish";
}

function isHiddenVerdict(v: DivergenceVerdict): boolean {
  return v === "hidden_bullish" || v === "hidden_bearish";
}

export function computeDivergenceConsensus(
  input: DivergenceConsensusInput,
): DivergenceConsensusResult {
  const threshold = input.consensusThreshold ?? DEFAULT_CONSENSUS_THRESHOLD;
  const minAgreeing = input.minAgreeingCount ?? DEFAULT_MIN_AGREEING;
  const indicators = input.indicators ?? [];

  let bullishWeight = 0;
  let bearishWeight = 0;
  let bullishCount = 0;
  let bearishCount = 0;
  let hiddenBullishCount = 0;
  let hiddenBearishCount = 0;
  let regularBullishCount = 0;
  let regularBearishCount = 0;
  const bullishNames: string[] = [];
  const bearishNames: string[] = [];
  const inactive: string[] = [];

  for (const ind of indicators) {
    if (ind.verdict === "none") {
      inactive.push(ind.indicator);
      continue;
    }
    const w = (ind.weight ?? 1.0) * Math.max(0, Math.min(1, ind.strength));
    if (isBullishVerdict(ind.verdict)) {
      bullishWeight += w;
      bullishCount++;
      bullishNames.push(ind.indicator);
      if (isHiddenVerdict(ind.verdict)) hiddenBullishCount++;
      else regularBullishCount++;
    } else if (isBearishVerdict(ind.verdict)) {
      bearishWeight += w;
      bearishCount++;
      bearishNames.push(ind.indicator);
      if (isHiddenVerdict(ind.verdict)) hiddenBearishCount++;
      else regularBearishCount++;
    }
  }

  const totalWeight = bullishWeight + bearishWeight;
  let direction: DivergenceConsensusDirection;
  let agreement: number;
  let contributingIndicators: string[];
  let dissentingIndicators: string[];

  if (totalWeight === 0) {
    direction = "none";
    agreement = 0;
    contributingIndicators = [];
    dissentingIndicators = inactive;
  } else {
    const bullShare = bullishWeight / totalWeight;
    const bearShare = bearishWeight / totalWeight;
    if (bullShare >= threshold && bullishCount >= minAgreeing) {
      direction = "bullish";
      agreement = bullShare;
      contributingIndicators = bullishNames;
      dissentingIndicators = bearishNames;
    } else if (bearShare >= threshold && bearishCount >= minAgreeing) {
      direction = "bearish";
      agreement = bearShare;
      contributingIndicators = bearishNames;
      dissentingIndicators = bullishNames;
    } else {
      direction = "mixed";
      agreement = Math.max(bullShare, bearShare);
      contributingIndicators = [...bullishNames, ...bearishNames];
      dissentingIndicators = [];
    }
  }

  let flavor: DivergenceConsensusResult["flavor"];
  if (direction === "bullish") {
    flavor = hiddenBullishCount > regularBullishCount ? "hidden" : "regular";
  } else if (direction === "bearish") {
    flavor = hiddenBearishCount > regularBearishCount ? "hidden" : "regular";
  } else if (direction === "mixed") {
    flavor = "mixed";
  } else {
    flavor = "none";
  }

  const reasoning =
    `${bullishCount} bullish (w=${bullishWeight.toFixed(2)}), ` +
    `${bearishCount} bearish (w=${bearishWeight.toFixed(2)}); ` +
    `${inactive.length} silent; consensus → ${direction}` +
    (direction !== "none" ? ` (${(agreement * 100).toFixed(0)}% agreement, flavor=${flavor})` : "");

  return {
    direction,
    flavor,
    agreement,
    bullishWeight,
    bearishWeight,
    bullishCount,
    bearishCount,
    hiddenBullishCount,
    hiddenBearishCount,
    contributingIndicators,
    dissentingIndicators,
    reasoning,
  };
}

export function divergenceConsensusToPayload(
  result: DivergenceConsensusResult,
): Record<string, unknown> {
  return {
    kind: "divergence_consensus.computed",
    direction: result.direction,
    flavor: result.flavor,
    agreement: Number(result.agreement.toFixed(3)),
    bullishCount: result.bullishCount,
    bearishCount: result.bearishCount,
    contributingIndicators: result.contributingIndicators,
  };
}
