/**
 * Brier Score — Probabilistic-Prediction Calibration Metric.
 *
 * Mean squared error between predicted probabilities and binary
 * outcomes. The standard calibration metric for any system that emits
 * probability-like outputs:
 *
 *   BS = (1/N) · Σᵢ (pᵢ − oᵢ)²    where oᵢ ∈ {0, 1}
 *
 * Calibration classification (from the prediction-market literature):
 *   < 0.10  excellent  (538 / Economist hit 0.06–0.12 on presidential races)
 *   < 0.20  good
 *   < 0.25  marginal   (0.25 = "always predict 0.5", the noise floor)
 *   ≥ 0.25  poor
 *
 * Skill score: 1 − (BS / BS_baseline). Positive = better than the
 * baseline (default = base rate of outcomes). 0 = same as baseline.
 * Negative = the baseline beats you. The baseline-vs-skill comparison
 * is what makes the Brier score useful for tracking model drift over
 * time — raw BS can be small for trivial reasons (e.g., predicting low
 * probability of rare events) and skill score catches that.
 *
 * Plausible Gordon consumers:
 *   - `markovRegime.ts` confidence + transition probabilities scored
 *     against realized state transitions over a window
 *   - signal classifiers that output graded probabilities
 *   - ACE Reflector hook: drift in Brier score over recent windows
 *     surfaces calibration degradation to the operator
 *
 * Pure compute. No I/O.
 */

export interface BrierScoreInput {
  /** Predicted probabilities, each in [0, 1]. */
  predictions: ReadonlyArray<number>;
  /** Binary outcomes: 0 or 1 (booleans accepted and coerced). */
  outcomes: ReadonlyArray<number | boolean>;
  /**
   * Baseline probability for skill-score reference. Default: sample
   * mean of `outcomes` (climatology). Pass a custom value (e.g., the
   * long-run regime base rate) for skill comparisons against a fixed
   * benchmark.
   */
  baselineProbability?: number;
}

export type BrierClassification = "excellent" | "good" | "marginal" | "poor";

export interface BrierScoreResult {
  brierScore: number;
  baselineBrier: number;
  /** 1 − (brierScore / baselineBrier). Positive = beats baseline. */
  skillScore: number;
  classification: BrierClassification;
  baseRate: number;
  baselineProbability: number;
  nPredictions: number;
  reasoning: string;
}

function classify(brier: number): BrierClassification {
  if (brier < 0.1) return "excellent";
  if (brier < 0.2) return "good";
  if (brier < 0.25) return "marginal";
  return "poor";
}

function coerceOutcome(o: number | boolean, index: number): number {
  if (typeof o === "boolean") return o ? 1 : 0;
  if (o !== 0 && o !== 1) {
    throw new Error(`outcomes[${index}] must be 0, 1, or boolean (got ${o})`);
  }
  return o;
}

export function computeBrierScore(input: BrierScoreInput): BrierScoreResult {
  const n = input.predictions.length;
  if (n === 0) {
    throw new Error("predictions must not be empty");
  }
  if (input.outcomes.length !== n) {
    throw new Error(
      `predictions and outcomes must have equal length (got ${n} vs ${input.outcomes.length})`,
    );
  }

  let sumSquaredError = 0;
  let sumOutcomes = 0;
  const numericOutcomes: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = input.predictions[i]!;
    if (!Number.isFinite(p) || p < 0 || p > 1) {
      throw new Error(`predictions[${i}] must be in [0, 1] (got ${p})`);
    }
    const o = coerceOutcome(input.outcomes[i]!, i);
    numericOutcomes[i] = o;
    sumOutcomes += o;
    const err = p - o;
    sumSquaredError += err * err;
  }

  const brierScore = sumSquaredError / n;
  const baseRate = sumOutcomes / n;
  const baselineProbability = input.baselineProbability ?? baseRate;
  if (baselineProbability < 0 || baselineProbability > 1 || !Number.isFinite(baselineProbability)) {
    throw new Error(`baselineProbability must be in [0, 1] (got ${baselineProbability})`);
  }

  // Baseline Brier = (1/N) Σ (baseline − oᵢ)²  =  baseline² − 2·baseline·baseRate + (Σoᵢ²)/N
  // Since oᵢ ∈ {0,1}, Σoᵢ² = Σoᵢ = N·baseRate. Substitute:
  //   = baseline² − 2·baseline·baseRate + baseRate
  // When baseline = baseRate, this collapses to baseRate·(1 − baseRate) (variance of Bernoulli).
  const baselineBrier =
    baselineProbability * baselineProbability -
    2 * baselineProbability * baseRate +
    baseRate;

  const skillScore = baselineBrier > 0 ? 1 - brierScore / baselineBrier : 0;

  const classification = classify(brierScore);

  const reasoning =
    `N=${n} predictions, base rate=${baseRate.toFixed(4)}, ` +
    `baseline prob=${baselineProbability.toFixed(4)} (baseline BS=${baselineBrier.toFixed(4)}). ` +
    `Brier=${brierScore.toFixed(4)} (${classification}); skill score=${skillScore.toFixed(4)} ` +
    `(${skillScore > 0 ? "beats baseline" : skillScore < 0 ? "worse than baseline" : "matches baseline"}).`;

  return {
    brierScore,
    baselineBrier,
    skillScore,
    classification,
    baseRate,
    baselineProbability,
    nPredictions: n,
    reasoning,
  };
}

export function brierScoreToPayload(result: BrierScoreResult): Record<string, unknown> {
  return {
    kind: "brier_score.computed",
    brierScore: Number(result.brierScore.toFixed(6)),
    baselineBrier: Number(result.baselineBrier.toFixed(6)),
    skillScore: Number(result.skillScore.toFixed(6)),
    classification: result.classification,
    baseRate: Number(result.baseRate.toFixed(6)),
    baselineProbability: Number(result.baselineProbability.toFixed(6)),
    nPredictions: result.nPredictions,
  };
}
