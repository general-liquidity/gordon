/**
 * Manipulation Context Classifier (GORDON_MANIPULATION_CONTEXT).
 *
 * Thin classifier on top of MS1 microstructureToxicity. Maps continuous
 * toxicity score + driver components into a discrete trade-decision
 * context with a recommended posture for the pre-trade chain.
 *
 *   quiet     → no microstructure adjustment; trade normally
 *   elevated  → downgrade tier one level, log cautionary observation
 *   active    → refuse new orders or force size reduction; structured
 *               observation flagged for review
 *
 * Plugs into WW15 marginalParticipantClassifier as a new driver kind
 * (`microstructure_toxicity`) and into MS7 preTradeMicrostructureGate
 * as the decision-bearing signal.
 */

import type { ToxicityResult, ToxicityRegime } from "./microstructureToxicity.ts";

export const MANIPULATION_CONTEXT_FLAG_ENV = "GORDON_MANIPULATION_CONTEXT";

export function isManipulationContextEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env[MANIPULATION_CONTEXT_FLAG_ENV] === "1" ||
    env[MANIPULATION_CONTEXT_FLAG_ENV] === "true"
  );
}

export type TradePosture = "trade_normal" | "size_down" | "refuse";

export interface ManipulationContextResult {
  regime: ToxicityRegime;
  posture: TradePosture;
  sizeMultiplier: number;
  shouldRefuse: boolean;
  dominantDriver: string | null;
  toxicityScore: number;
  reasoning: string;
}

const POSTURE_MAP: Record<ToxicityRegime, { posture: TradePosture; sizeMult: number; refuse: boolean }> = {
  quiet: { posture: "trade_normal", sizeMult: 1.0, refuse: false },
  elevated: { posture: "size_down", sizeMult: 0.5, refuse: false },
  active: { posture: "refuse", sizeMult: 0, refuse: true },
};

function pickDominantDriver(t: ToxicityResult): string | null {
  const entries = [
    ["manufacturedImbalance", t.components.manufacturedImbalance],
    ["touchDynamics", t.components.touchDynamics],
    ["crossVenueDivergence", t.components.crossVenueDivergence],
    ["displayedHalfLife", t.components.displayedHalfLife],
    ["depthTurnover", t.components.depthTurnover],
  ] as Array<[string, number]>;
  let bestName: string | null = null;
  let bestVal = 0;
  for (const [name, val] of entries) {
    if (val > bestVal) {
      bestVal = val;
      bestName = name;
    }
  }
  return bestVal > 0.1 ? bestName : null;
}

export function classifyManipulationContext(toxicity: ToxicityResult): ManipulationContextResult {
  const map = POSTURE_MAP[toxicity.regime];
  const dominant = pickDominantDriver(toxicity);
  const reasoning =
    map.posture === "trade_normal"
      ? `Microstructure quiet (score ${toxicity.score.toFixed(2)}) — trade normally`
      : map.posture === "size_down"
        ? `Microstructure elevated (score ${toxicity.score.toFixed(2)}, dominant: ${dominant ?? "mixed"}) — size down by 50%`
        : `Active manipulation regime (score ${toxicity.score.toFixed(2)}, dominant: ${dominant ?? "mixed"}) — refuse new orders`;

  return {
    regime: toxicity.regime,
    posture: map.posture,
    sizeMultiplier: map.sizeMult,
    shouldRefuse: map.refuse,
    dominantDriver: dominant,
    toxicityScore: toxicity.score,
    reasoning,
  };
}

export function manipulationContextToPayload(
  result: ManipulationContextResult,
): Record<string, unknown> {
  return {
    kind: "manipulation_context.classified",
    regime: result.regime,
    posture: result.posture,
    sizeMultiplier: result.sizeMultiplier,
    shouldRefuse: result.shouldRefuse,
    dominantDriver: result.dominantDriver,
    toxicityScore: Number(result.toxicityScore.toFixed(3)),
  };
}
