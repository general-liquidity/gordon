/**
 * Uncertainty Decomposition (Lin, Wang, Fu & Fan, "Trading Confidence: Comprehensive
 * Uncertainty Estimation in Algorithmic Trading", PACIS 2025).
 *
 * One confidence number is not a decision. Two setups can carry identical total
 * uncertainty and demand opposite responses, so this module refuses to hand back a bare
 * scalar and instead splits uncertainty into three legs with three different remedies:
 *
 *   ALEATORIC      irreducible noise in the market itself. More data does not shrink it.
 *                  Trading is still legitimate: size smaller, widen stops.
 *   EPISTEMIC      the agent does not know. This IS reducible. Gather more evidence, or
 *                  abstain. Sizing down is the wrong response because it prices an
 *                  ignorance that could have been removed for the cost of another lookup.
 *   DISTRIBUTIONAL the state resembles nothing in the reference set. Abstain regardless
 *                  of how confident the point estimate looks.
 *
 * ADAPTATION, STATED HONESTLY
 * The paper obtains its legs from a neural RL stack: MC Dropout over a policy network,
 * SHAP-weighted reconstruction error, and an LSTM indicator-consensus head. Gordon has no
 * such network and trains nothing, so none of that machinery is reproduced or simulated
 * here. The re-expression, leg by leg:
 *
 *   aleatoric      FAITHFUL IN SPIRIT, re-derived. Realised dispersion of the observation
 *                  series around a fitted expectation (or around its own mean when no
 *                  expectation is supplied). The same quantity the paper's
 *                  heteroscedastic head is trying to predict, measured directly instead
 *                  of learned.
 *   epistemic      RE-DERIVED. The paper's MC Dropout spread becomes disagreement among
 *                  independent estimators, and its sample-coverage term becomes thinness
 *                  of evidence (few observations, few estimators). The paper's indicator
 *                  consensus leg maps cleanly: Gordon already runs many independent
 *                  indicators, and their disagreement is measurable at inference time
 *                  with no network at all.
 *   distributional FAITHFUL. Distance from a reference distribution, supplied by the
 *                  caller. Gordon's own out of distribution machinery already computes
 *                  such a score (see below).
 *
 * The paper's quantitative results are reported for RL agents on their own training
 * regime. Those numbers do not transfer to this module and none are encoded here. The
 * decomposition's LOGIC is what was adopted, not its measured gains.
 *
 * HOW THIS DIFFERS FROM WHAT ALREADY EXISTS
 *   core/regime/familiarity.ts is a full out of distribution gate: it builds density
 *   references per market dynamic and answers "is this state any of my known regimes at
 *   all". It is strictly richer than the distributional leg here, which is deliberately a
 *   thin normalizer over a caller supplied score. The intended composition is that a
 *   caller passes `FamiliarityGateResult.score` in as `familiarityScore` and gets the
 *   other two legs alongside it. This module does not re-implement density estimation and
 *   does not import the gate, so it stays usable when the caller's reference comes from
 *   somewhere else entirely.
 *
 *   core/alpha/too-good-check.ts alerts on diagnostic output that is too suspicious to be
 *   true. That is symptom based alerting about a result already computed, fired on
 *   thresholds over Sharpe, IC, win rate. This module estimates uncertainty about a
 *   decision not yet taken, from the evidence behind it. Different question, different
 *   input, no overlap. Neither wraps the other.
 *
 * KNOWN LIMITATION, LOAD BEARING
 * Estimator agreement is not correctness. Estimators that are unanimous and all wrong
 * report LOW epistemic uncertainty, because disagreement is the only signal available at
 * inference time without ground truth. Correlated estimators (three momentum indicators
 * on the same series) understate epistemic uncertainty for the same reason. The module
 * does not pretend otherwise, and callers should feed it estimators that fail
 * independently. Detecting a shared blind spot is out of scope here and belongs to out of
 * sample validation.
 *
 * Pure, injected, deterministic. No clock, no I/O, no randomness.
 */

// ============================================================================
// Types
// ============================================================================

export type UncertaintyLeg = "aleatoric" | "epistemic" | "distributional";

export type LegStatus = "measured" | "unavailable";

export interface LegEstimate {
  leg: UncertaintyLeg;
  status: LegStatus;
  /** Normalized to 0..1, higher is more uncertain. Null when unavailable. */
  value: number | null;
  reason: string;
}

export interface UncertaintyLegs {
  aleatoric: LegEstimate;
  epistemic: LegEstimate;
  distributional: LegEstimate;
}

/**
 * One estimator's opinion about the same quantity the observation series measures, on the
 * same scale (per period expected return, when the observations are per period returns).
 * Mixing scales makes the disagreement term meaningless and this module cannot detect
 * that, so the shared scale is the caller's contract.
 */
export interface EstimatorOpinion {
  name: string;
  estimate: number;
  /** Relative reliability. Defaults to 1. Non-positive weights are ignored. */
  weight?: number;
}

export interface UncertaintyEvidence {
  /** Realised series, chronological. Per period returns in the usual case. */
  observations: readonly number[];
  /** Independent opinions. Fewer than two makes the disagreement term unmeasurable. */
  estimators: readonly EstimatorOpinion[];
  /**
   * Fitted expectation, aligned index for index with `observations`. When supplied, the
   * aleatoric leg measures residual noise around the model rather than total variation,
   * which is the sharper quantity: a steadily trending series is not irreducibly noisy.
   */
  expected?: readonly number[];
  /**
   * Familiarity of the current state against a reference set, 0..1, higher is more
   * familiar. Shaped to accept `FamiliarityGateResult.score` directly.
   */
  familiarityScore?: number | null;
  /**
   * Alternative to `familiarityScore`: a raw distance to the reference set, normalized
   * through `referenceDistanceScale`. Read only when `familiarityScore` is absent.
   */
  referenceDistance?: number | null;
}

export type UncertaintyAction = "proceed" | "size_down" | "gather_evidence" | "abstain";

export interface TotalUncertainty {
  value: number | null;
  status: LegStatus;
  /** Carried on every total, because the collapsed number is not the decision. */
  warning: string;
}

export interface EvidenceSummary {
  observationCount: number;
  estimatorCount: number;
  /** Standard deviation of residuals, null when unmeasurable. */
  residualDispersion: number | null;
  /** Weighted standard deviation of estimator opinions, null when unmeasurable. */
  estimatorDispersion: number | null;
  familiarityScore: number | null;
}

export interface UncertaintyDecomposition {
  legs: UncertaintyLegs;
  total: TotalUncertainty;
  action: UncertaintyAction;
  actionReason: string;
  /** 0 whenever the action is not to trade. Never negative. */
  sizeMultiplier: number;
  evidence: EvidenceSummary;
}

// ============================================================================
// Config
//
// Every constant below is an authored default, chosen for single operator Gordon use over
// per period return series. None is derived from the paper, which reports no transferable
// thresholds for a non RL agent. Tune per caller.
// ============================================================================

export interface UncertaintyConfig {
  /** Residual dispersion at which the aleatoric leg reads 0.5. Author's choice: 0.02. */
  aleatoricScale?: number;
  /** Estimator dispersion at which the disagreement term reads 0.5. Author's choice: 0.02. */
  disagreementScale?: number;
  /** Raw reference distance at which the distributional leg reads 0.5. Author's choice: 1. */
  referenceDistanceScale?: number;
  /** Below this many observations the aleatoric leg abstains. Author's choice: 8. */
  minObservations?: number;
  /**
   * Residual dispersion at or below this fraction of the series magnitude counts as no
   * dispersion at all. Floating point never lands on an exact zero, so an exact test
   * would let a stalled feed through as a confident calm. Author's choice: 1e-9.
   */
  dispersionFloorRatio?: number;
  /** Observation count at which evidence thinness stops contributing. Author's choice: 30. */
  sufficientObservations?: number;
  /** Estimator count at which estimator thinness stops contributing. Author's choice: 3. */
  sufficientEstimators?: number;
  /** Aleatoric at or above this recommends smaller size. Author's choice: 0.5. */
  sizeDownAleatoric?: number;
  /** Aleatoric at or above this is untradeable noise. Author's choice: 0.9. */
  abstainAleatoric?: number;
  /** Epistemic at or above this recommends gathering evidence. Author's choice: 0.4. */
  gatherEpistemic?: number;
  /** Epistemic at or above this abstains rather than gathering. Author's choice: 0.75. */
  abstainEpistemic?: number;
  /** Distributional at or above this abstains outright. Author's choice: 0.7. */
  abstainDistributional?: number;
  /** Floor on the size multiplier while still trading. Author's choice: 0.25. */
  minSizeMultiplier?: number;
}

type ResolvedConfig = Required<UncertaintyConfig>;

export const UNCERTAINTY_DEFAULTS: ResolvedConfig = {
  aleatoricScale: 0.02,
  disagreementScale: 0.02,
  referenceDistanceScale: 1,
  minObservations: 8,
  dispersionFloorRatio: 1e-9,
  sufficientObservations: 30,
  sufficientEstimators: 3,
  sizeDownAleatoric: 0.5,
  abstainAleatoric: 0.9,
  gatherEpistemic: 0.4,
  abstainEpistemic: 0.75,
  abstainDistributional: 0.7,
  minSizeMultiplier: 0.25,
};

function resolveConfig(config: UncertaintyConfig | undefined): ResolvedConfig {
  return { ...UNCERTAINTY_DEFAULTS, ...(config ?? {}) };
}

// ============================================================================
// Numeric helpers
// ============================================================================

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/** Bounded, strictly increasing map from a non negative magnitude onto 0..1. */
function saturate(magnitude: number, scale: number): number {
  if (!Number.isFinite(magnitude) || magnitude <= 0) return 0;
  const s = scale > 0 ? scale : UNCERTAINTY_DEFAULTS.aleatoricScale;
  return magnitude / (magnitude + s);
}

/** Noisy OR. Monotone in every argument, so no component can be cancelled by another. */
function combine(parts: readonly number[]): number {
  let survive = 1;
  for (const p of parts) survive *= 1 - clamp01(p);
  return clamp01(1 - survive);
}

function measuredLeg(leg: UncertaintyLeg, value: number, reason: string): LegEstimate {
  return { leg, status: "measured", value: clamp01(value), reason };
}

function unavailableLeg(leg: UncertaintyLeg, reason: string): LegEstimate {
  return { leg, status: "unavailable", value: null, reason };
}

// ============================================================================
// Legs
// ============================================================================

interface DispersionResult {
  dispersion: number | null;
  reason: string;
}

function residualDispersion(
  observations: readonly number[],
  expected: readonly number[] | undefined,
  config: ResolvedConfig,
): DispersionResult {
  const n = observations.length;
  if (n === 0) return { dispersion: null, reason: "no observations supplied" };
  if (n < config.minObservations) {
    return {
      dispersion: null,
      reason: `${n} observations is below the ${config.minObservations} needed to speak about the market's own noise`,
    };
  }

  const residuals: number[] = [];
  const useExpected = expected !== undefined && expected.length === n;
  if (useExpected) {
    for (let i = 0; i < n; i++) {
      const o = observations[i];
      const e = expected[i];
      if (o === undefined || e === undefined) continue;
      if (!Number.isFinite(o) || !Number.isFinite(e)) continue;
      residuals.push(o - e);
    }
  } else {
    let sum = 0;
    let count = 0;
    for (const o of observations) {
      if (!Number.isFinite(o)) continue;
      sum += o;
      count += 1;
    }
    if (count < config.minObservations) {
      return { dispersion: null, reason: "too few finite observations" };
    }
    const mean = sum / count;
    for (const o of observations) {
      if (!Number.isFinite(o)) continue;
      residuals.push(o - mean);
    }
  }

  if (residuals.length < config.minObservations) {
    return { dispersion: null, reason: "too few usable residuals" };
  }

  let sumSq = 0;
  for (const r of residuals) sumSq += r * r;
  const sd = Math.sqrt(sumSq / (residuals.length - 1));

  let magnitude = 0;
  for (const o of observations) {
    if (!Number.isFinite(o)) continue;
    const abs = Math.abs(o);
    if (abs > magnitude) magnitude = abs;
  }
  const floor = Math.max(magnitude * config.dispersionFloorRatio, Number.EPSILON);

  // A perfectly flat series is a stalled feed far more often than it is a silent market,
  // and reporting 0 here would launder that defect into confident calm.
  if (!(sd > floor)) {
    return {
      dispersion: null,
      reason:
        "zero dispersion across the whole series, which reads as a stalled feed rather than a calm market",
    };
  }
  return { dispersion: sd, reason: `residual dispersion ${sd.toFixed(5)}` };
}

function estimatorDispersion(estimators: readonly EstimatorOpinion[]): DispersionResult {
  const usable = estimators.filter(
    (e) => Number.isFinite(e.estimate) && (e.weight === undefined || e.weight > 0),
  );
  if (usable.length < 2) {
    return {
      dispersion: null,
      reason: `${usable.length} usable estimator(s), so disagreement cannot be observed`,
    };
  }

  let sumW = 0;
  for (const e of usable) sumW += e.weight ?? 1;
  if (!(sumW > 0)) return { dispersion: null, reason: "estimator weights sum to zero" };

  let mean = 0;
  for (const e of usable) mean += ((e.weight ?? 1) / sumW) * e.estimate;

  // Reliability weighted unbiased variance. With equal weights this collapses exactly to
  // the n-1 sample variance, so weighting is opt in and changes nothing when unused.
  let sumSqShare = 0;
  let weightedSq = 0;
  for (const e of usable) {
    const share = (e.weight ?? 1) / sumW;
    sumSqShare += share * share;
    const d = e.estimate - mean;
    weightedSq += share * d * d;
  }
  const denom = 1 - sumSqShare;
  if (!(denom > 0)) {
    return { dispersion: null, reason: "one estimator carries all of the weight" };
  }
  const sd = Math.sqrt(weightedSq / denom);
  return { dispersion: sd, reason: `estimator dispersion ${sd.toFixed(5)}` };
}

function thinness(count: number, sufficient: number): number {
  if (sufficient <= 0) return 0;
  if (count >= sufficient) return 0;
  return clamp01(1 - count / sufficient);
}

function distributionalLeg(
  evidence: UncertaintyEvidence,
  config: ResolvedConfig,
): LegEstimate {
  const score = evidence.familiarityScore;
  if (score !== undefined && score !== null && Number.isFinite(score)) {
    const familiar = clamp01(score);
    return measuredLeg(
      "distributional",
      1 - familiar,
      `familiarity ${familiar.toFixed(3)} against the caller's reference set`,
    );
  }
  const distance = evidence.referenceDistance;
  if (distance !== undefined && distance !== null && Number.isFinite(distance)) {
    return measuredLeg(
      "distributional",
      saturate(distance, config.referenceDistanceScale),
      `reference distance ${distance.toFixed(4)}`,
    );
  }
  // Without a reference the state cannot be ruled out of distribution, which is not the
  // same thing as it being in distribution.
  return unavailableLeg(
    "distributional",
    "no reference familiarity or distance supplied, so novelty of the state is unknown",
  );
}

// ============================================================================
// Decomposition
// ============================================================================

/**
 * Split the supplied evidence into the three legs, then map the split to an action and a
 * size multiplier. Nothing is fetched and nothing is remembered, so identical inputs
 * always produce an identical result.
 */
export function decomposeUncertainty(
  evidence: UncertaintyEvidence,
  config?: UncertaintyConfig,
): UncertaintyDecomposition {
  const cfg = resolveConfig(config);

  const residual = residualDispersion(evidence.observations, evidence.expected, cfg);
  const aleatoric =
    residual.dispersion === null
      ? unavailableLeg("aleatoric", residual.reason)
      : measuredLeg(
          "aleatoric",
          saturate(residual.dispersion, cfg.aleatoricScale),
          residual.reason,
        );

  const spread = estimatorDispersion(evidence.estimators);
  const observationThinness = thinness(evidence.observations.length, cfg.sufficientObservations);
  const estimatorThinness = thinness(evidence.estimators.length, cfg.sufficientEstimators);

  const epistemic =
    spread.dispersion === null
      ? unavailableLeg(
          "epistemic",
          `${spread.reason}, and thin evidence on its own cannot be told apart from silent agreement`,
        )
      : measuredLeg(
          "epistemic",
          combine([
            saturate(spread.dispersion, cfg.disagreementScale),
            observationThinness,
            estimatorThinness,
          ]),
          `${spread.reason}, observation thinness ${observationThinness.toFixed(2)}, estimator thinness ${estimatorThinness.toFixed(2)}`,
        );

  const distributional = distributionalLeg(evidence, cfg);

  const legs: UncertaintyLegs = { aleatoric, epistemic, distributional };
  const decision = recommendAction(legs, cfg);

  return {
    legs,
    total: collapseToScalar(legs),
    action: decision.action,
    actionReason: decision.reason,
    sizeMultiplier: sizeMultiplierFor(legs, decision.action, cfg),
    evidence: {
      observationCount: evidence.observations.length,
      estimatorCount: evidence.estimators.length,
      residualDispersion: residual.dispersion,
      estimatorDispersion: spread.dispersion,
      familiarityScore:
        evidence.familiarityScore === undefined || evidence.familiarityScore === null
          ? null
          : evidence.familiarityScore,
    },
  };
}

/**
 * Build a leg set straight from three numbers, for callers that already hold the legs and
 * for exercising the action mapping against an exact composition. Null means the leg is
 * unavailable, never zero.
 */
export function legsFromValues(values: {
  aleatoric: number | null;
  epistemic: number | null;
  distributional: number | null;
}): UncertaintyLegs {
  const build = (leg: UncertaintyLeg, v: number | null): LegEstimate =>
    v === null
      ? unavailableLeg(leg, "supplied as unavailable")
      : measuredLeg(leg, v, "supplied directly");
  return {
    aleatoric: build("aleatoric", values.aleatoric),
    epistemic: build("epistemic", values.epistemic),
    distributional: build("distributional", values.distributional),
  };
}

// ============================================================================
// Action mapping
//
// Ordered rules, first match wins. Written as a flat sequence rather than as a blended
// score so the mapping stays inspectable and every rule is independently testable.
// ============================================================================

export interface ActionDecision {
  action: UncertaintyAction;
  reason: string;
}

export function recommendAction(
  legs: UncertaintyLegs,
  config?: UncertaintyConfig,
): ActionDecision {
  const cfg = resolveConfig(config);
  const a = legs.aleatoric.value;
  const e = legs.epistemic.value;
  const d = legs.distributional.value;

  if (d !== null && d >= cfg.abstainDistributional) {
    return {
      action: "abstain",
      reason: `distributional ${d.toFixed(2)} at or above ${cfg.abstainDistributional}: the state is unlike the reference set, so a confident point estimate is evidence of nothing`,
    };
  }
  if (e !== null && e >= cfg.abstainEpistemic) {
    return {
      action: "abstain",
      reason: `epistemic ${e.toFixed(2)} at or above ${cfg.abstainEpistemic}: too little is known for further lookups to close the gap`,
    };
  }
  if (a !== null && a >= cfg.abstainAleatoric) {
    return {
      action: "abstain",
      reason: `aleatoric ${a.toFixed(2)} at or above ${cfg.abstainAleatoric}: the market's own noise dominates any edge at any size`,
    };
  }

  const missing = (["aleatoric", "epistemic", "distributional"] as const).filter(
    (k) => legs[k].status === "unavailable",
  );
  if (missing.length > 0) {
    return {
      action: "gather_evidence",
      reason: `unavailable leg(s): ${missing.join(", ")}. An unmeasured leg is ignorance, which is reducible, so the response is to measure it rather than to trade smaller`,
    };
  }

  if (e !== null && e >= cfg.gatherEpistemic) {
    return {
      action: "gather_evidence",
      reason: `epistemic ${e.toFixed(2)} at or above ${cfg.gatherEpistemic}: this uncertainty is reducible, so resolve it before sizing anything`,
    };
  }
  if (a !== null && a >= cfg.sizeDownAleatoric) {
    return {
      action: "size_down",
      reason: `aleatoric ${a.toFixed(2)} at or above ${cfg.sizeDownAleatoric} while the rest is understood: noisy but legitimate, so trade it smaller`,
    };
  }
  return { action: "proceed", reason: "all three legs sit below their action thresholds" };
}

/**
 * Size responds to the IRREDUCIBLE leg only. High epistemic uncertainty does not buy a
 * smaller position, because paying a permanent size penalty for ignorance that one lookup
 * would have removed is the exact error the decomposition exists to prevent. It converts
 * into a non trading action instead, and the multiplier goes to zero.
 */
export function sizeMultiplierFor(
  legs: UncertaintyLegs,
  action: UncertaintyAction,
  config?: UncertaintyConfig,
): number {
  const cfg = resolveConfig(config);
  if (action === "abstain" || action === "gather_evidence") return 0;
  const a = legs.aleatoric.value;
  if (a === null) return 0;
  return Math.max(cfg.minSizeMultiplier, 1 - a);
}

/**
 * The collapsed number, behind an explicit call because collapsing is precisely what
 * destroys the decision. Null whenever any leg is unavailable: folding an unmeasured leg
 * into an average is how it silently becomes a zero.
 */
export function collapseToScalar(legs: UncertaintyLegs): TotalUncertainty {
  const values = [legs.aleatoric.value, legs.epistemic.value, legs.distributional.value];
  const present: number[] = [];
  for (const v of values) {
    if (v === null) {
      return {
        value: null,
        status: "unavailable",
        warning: "at least one leg is unmeasured, so any total would be a guess",
      };
    }
    present.push(v);
  }
  return {
    value: combine(present),
    status: "measured",
    warning:
      "this total does not determine an action: identical totals with different composition demand opposite responses",
  };
}

/** Operator readable rendering. The structured result stays the source of truth. */
export function formatUncertainty(result: UncertaintyDecomposition): string {
  const line = (leg: LegEstimate): string =>
    `  ${leg.leg.padEnd(15)}${(leg.value === null ? "unavailable" : leg.value.toFixed(3)).padEnd(12)}${leg.reason}`;
  return [
    `Uncertainty: ${result.action.toUpperCase()} (size x${result.sizeMultiplier.toFixed(2)})`,
    line(result.legs.aleatoric),
    line(result.legs.epistemic),
    line(result.legs.distributional),
    `  ${result.actionReason}`,
  ].join("\n");
}
