/**
 * Microstructure Toxicity Scorer (GORDON_MICROSTRUCTURE_TOXICITY).
 *
 * Composite roll-up of the L2-buildable detectors:
 *
 *   - manufactured imbalance (MS4)  — manufacturedImbalance.ts
 *   - touch dynamics (MS5)          — touchDynamics.ts
 *   - cross-venue divergence (MS3)  — crossVenueDivergence.ts
 *
 * Plus two own metrics computable from depth snapshots:
 *
 *   - displayed liquidity half-life (median time until size at a price
 *     level disappears)
 *   - depth turnover ratio (added-or-cancelled size / executed size)
 *
 * Outputs a continuous toxicity score in [0, 1] plus a discrete regime
 * (quiet / elevated / active manipulation) consumed by MS2
 * manipulationContext. Plugs into the pre-trade chain (MS7) and into
 * WW15 marginalParticipantClassifier as a new driver kind.
 */

import type { ImbalanceResult } from "./manufacturedImbalance.ts";
import type { TouchDynamicsResult } from "./touchDynamics.ts";
import type { DivergenceResult } from "./crossVenueDivergence.ts";

export interface LevelLifecycle {
  /** Time the size first appeared at the level. */
  appearedAt: number;
  /** Time the size disappeared (or undefined if still present). */
  disappearedAt?: number;
  /** Whether the disappearance was a fill (false = cancel/modify away). */
  filledBeforeRemoval?: boolean;
}

export interface ToxicityInput {
  manufacturedImbalance?: ImbalanceResult;
  touchDynamics?: TouchDynamicsResult;
  crossVenueDivergence?: DivergenceResult;
  /** Per-level lifecycle events to compute displayed half-life. */
  levelLifecycles?: ReadonlyArray<LevelLifecycle>;
  /** Optional executed volume + total added+cancelled size for turnover ratio. */
  executedVolume?: number;
  addedPlusCancelledSize?: number;
  /** Threshold for "active" regime. Default 0.65. */
  activeThreshold?: number;
  /** Threshold for "elevated" regime. Default 0.4. */
  elevatedThreshold?: number;
}

export type ToxicityRegime = "quiet" | "elevated" | "active";

export interface ToxicityResult {
  score: number;
  regime: ToxicityRegime;
  components: {
    manufacturedImbalance: number;
    touchDynamics: number;
    crossVenueDivergence: number;
    displayedHalfLife: number;
    depthTurnover: number;
  };
  displayedHalfLifeMs: number;
  depthTurnoverRatio: number;
  reasoning: string;
}

const DEFAULT_ACTIVE = 0.65;
const DEFAULT_ELEVATED = 0.4;

function manufacturedScore(r: ImbalanceResult | undefined): number {
  if (!r) return 0;
  if (r.verdict === "manufactured") return Math.min(1, r.confidence + 0.3);
  if (r.verdict === "suspicious") return r.confidence;
  return 0;
}

function touchScore(r: TouchDynamicsResult | undefined): number {
  if (!r) return 0;
  return r.compositeScore;
}

function divergenceScore(r: DivergenceResult | undefined): number {
  if (!r) return 0;
  if (!r.anyAlert) return Math.min(0.2, r.maxObservedDivergence * 50);
  return Math.min(1, r.maxObservedDivergence * 200);
}

function displayedHalfLifeScore(lifecycles: ReadonlyArray<LevelLifecycle> | undefined): {
  score: number;
  halfLifeMs: number;
} {
  if (!lifecycles || lifecycles.length === 0) return { score: 0, halfLifeMs: 0 };
  const cancelLifetimes: number[] = [];
  for (const l of lifecycles) {
    if (l.disappearedAt === undefined) continue;
    if (l.filledBeforeRemoval) continue;
    cancelLifetimes.push(l.disappearedAt - l.appearedAt);
  }
  if (cancelLifetimes.length === 0) return { score: 0, halfLifeMs: 0 };
  cancelLifetimes.sort((a, b) => a - b);
  const median = cancelLifetimes[Math.floor(cancelLifetimes.length / 2)]!;
  // Short half-life = toxic. Sub-100ms median → score 1; > 5s → score 0.
  let score = 0;
  if (median < 100) score = 1;
  else if (median < 500) score = 0.7;
  else if (median < 2000) score = 0.4;
  else if (median < 5000) score = 0.2;
  return { score, halfLifeMs: median };
}

function depthTurnoverScore(
  addedCancelled: number | undefined,
  executed: number | undefined,
): {
  score: number;
  ratio: number;
} {
  if (addedCancelled === undefined || executed === undefined) return { score: 0, ratio: 0 };
  if (executed <= 0) return { score: addedCancelled > 0 ? 1 : 0, ratio: Number.POSITIVE_INFINITY };
  const ratio = addedCancelled / executed;
  // Healthy market makers have ratios in the 5-20x range. >100x is toxic.
  let score = 0;
  if (ratio > 200) score = 1;
  else if (ratio > 100) score = 0.8;
  else if (ratio > 50) score = 0.5;
  else if (ratio > 20) score = 0.2;
  return { score, ratio };
}

export function scoreMicrostructureToxicity(input: ToxicityInput): ToxicityResult {
  const mi = manufacturedScore(input.manufacturedImbalance);
  const td = touchScore(input.touchDynamics);
  const cv = divergenceScore(input.crossVenueDivergence);
  const hl = displayedHalfLifeScore(input.levelLifecycles);
  const dt = depthTurnoverScore(input.addedPlusCancelledSize, input.executedVolume);

  // Weights sum to 1.0
  const score = mi * 0.25 + td * 0.2 + cv * 0.2 + hl.score * 0.2 + dt.score * 0.15;

  const activeT = input.activeThreshold ?? DEFAULT_ACTIVE;
  const elevatedT = input.elevatedThreshold ?? DEFAULT_ELEVATED;
  let regime: ToxicityRegime = "quiet";
  if (score >= activeT) regime = "active";
  else if (score >= elevatedT) regime = "elevated";

  const drivers: string[] = [];
  if (mi > 0.3) drivers.push(`manufactured imbalance (${mi.toFixed(2)})`);
  if (td > 0.3) drivers.push(`touch dynamics (${td.toFixed(2)})`);
  if (cv > 0.3) drivers.push(`cross-venue divergence (${cv.toFixed(2)})`);
  if (hl.score > 0.3) drivers.push(`short half-life ${hl.halfLifeMs.toFixed(0)}ms`);
  if (dt.score > 0.3) drivers.push(`turnover ${dt.ratio.toFixed(0)}x`);

  const reasoning =
    drivers.length === 0
      ? `score ${score.toFixed(2)} — no driver above threshold`
      : `score ${score.toFixed(2)} — ${drivers.join("; ")}`;

  return {
    score,
    regime,
    components: {
      manufacturedImbalance: mi,
      touchDynamics: td,
      crossVenueDivergence: cv,
      displayedHalfLife: hl.score,
      depthTurnover: dt.score,
    },
    displayedHalfLifeMs: hl.halfLifeMs,
    depthTurnoverRatio: dt.ratio,
    reasoning,
  };
}

export function toxicityToPayload(result: ToxicityResult): Record<string, unknown> {
  return {
    kind: "microstructure_toxicity.scored",
    score: Number(result.score.toFixed(3)),
    regime: result.regime,
    displayedHalfLifeMs: Number(result.displayedHalfLifeMs.toFixed(0)),
    depthTurnoverRatio: Number.isFinite(result.depthTurnoverRatio)
      ? Number(result.depthTurnoverRatio.toFixed(2))
      : null,
  };
}
