/**
 * Pairs Eligibility Filter (GORDON_PAIRS_ELIGIBILITY_FILTER).
 *
 * Port of Ch 3.5 from Sarmento & Horta, "A Machine Learning based Pairs
 * Trading Investment Strategy" (Springer 2020).
 *
 * Composes the four pair-selection criteria Sarmento derives into a single
 * verdict primitive. A pair is eligible for trading only if it satisfies
 * ALL four conditions:
 *
 *   1. Cointegration p-value < 0.01 (Engle-Granger, run both X→Y and Y→X,
 *      caller selects the lower t-statistic direction)
 *   2. Hurst exponent of spread < 0.5 (mean-reverting character)
 *   3. Half-life of mean reversion ∈ [1, 252] periods (compatible with
 *      typical trading horizons — neither too fast nor too slow)
 *   4. Spread crosses its mean ≥ 12 times per year (one cross/month
 *      minimum — exit liquidity)
 *
 * Quoting Sarmento (p. 32-33): "cointegration per se is too restrictive of
 * a condition to impose and that is rarely fulfilled … the Hurst exponent
 * value [is] a second check to look for mean-reverting properties." And:
 * "even though there is logically a (negative) correlation between the
 * number of mean crosses and the half-life period … both properties are
 * not necessarily interchangeable."
 *
 * Composes existing Gordon primitives:
 *   - `cointegration.ts` (Engle-Granger + half-life)
 *   - `hurstExponent.ts` (Wright port)
 *   - `meanCrossingFrequency.ts` (Sarmento Ch 3.5 condition 4)
 *
 * Caller is expected to thread pre-computed values in. The filter does no
 * recomputation — keeps it pure and avoids tight coupling to specific
 * upstream signatures.
 *
 * Pure compute. No I/O.
 */

export interface PairsEligibilityFilterInput {
  /** Engle-Granger cointegration p-value (lower of X→Y and Y→X). */
  cointegrationPValue: number;
  /** Hurst exponent of the spread (0 < H < 1; H<0.5 = mean-reverting). */
  hurstExponent: number;
  /** Half-life of mean reversion in periods (typically days). */
  halfLifePeriods: number;
  /** Annualised mean-crossing rate of the spread. */
  meanCrossingsPerYear: number;
  /** Override defaults. */
  thresholds?: Partial<EligibilityThresholds>;
}

export interface EligibilityThresholds {
  /** Maximum acceptable cointegration p-value. Sarmento default 0.01. */
  maxPValue: number;
  /** Maximum acceptable Hurst exponent. Sarmento default 0.5. */
  maxHurst: number;
  /** Minimum acceptable half-life (periods). Sarmento default 1. */
  minHalfLife: number;
  /** Maximum acceptable half-life (periods). Sarmento default 252. */
  maxHalfLife: number;
  /** Minimum acceptable annual mean-crossing rate. Sarmento default 12. */
  minMeanCrossingsPerYear: number;
}

export const DEFAULT_THRESHOLDS: EligibilityThresholds = {
  maxPValue: 0.01,
  maxHurst: 0.5,
  minHalfLife: 1,
  maxHalfLife: 252,
  minMeanCrossingsPerYear: 12,
};

export interface ConditionResult {
  passed: boolean;
  value: number;
  threshold: number;
  reason: string;
}

export interface PairsEligibilityFilterResult {
  eligible: boolean;
  conditions: {
    cointegration: ConditionResult;
    hurst: ConditionResult;
    halfLife: ConditionResult;
    meanCrossings: ConditionResult;
  };
  failureReasons: string[];
  reasoning: string;
}

export function computePairsEligibilityFilter(
  input: PairsEligibilityFilterInput,
): PairsEligibilityFilterResult {
  const t: EligibilityThresholds = {
    ...DEFAULT_THRESHOLDS,
    ...(input.thresholds ?? {}),
  };

  const coint: ConditionResult = {
    passed: input.cointegrationPValue < t.maxPValue,
    value: input.cointegrationPValue,
    threshold: t.maxPValue,
    reason: `p-value ${input.cointegrationPValue.toFixed(4)} ${
      input.cointegrationPValue < t.maxPValue ? "<" : "≥"
    } ${t.maxPValue}`,
  };

  const hurst: ConditionResult = {
    passed: input.hurstExponent < t.maxHurst,
    value: input.hurstExponent,
    threshold: t.maxHurst,
    reason: `Hurst ${input.hurstExponent.toFixed(3)} ${
      input.hurstExponent < t.maxHurst ? "<" : "≥"
    } ${t.maxHurst}`,
  };

  const hlInRange =
    input.halfLifePeriods >= t.minHalfLife && input.halfLifePeriods <= t.maxHalfLife;
  const halfLife: ConditionResult = {
    passed: hlInRange,
    value: input.halfLifePeriods,
    threshold: t.maxHalfLife, // surface upper bound; minHalfLife in reason
    reason: `half-life ${input.halfLifePeriods.toFixed(2)} ${
      hlInRange ? "∈" : "∉"
    } [${t.minHalfLife}, ${t.maxHalfLife}]`,
  };

  const meanCrossings: ConditionResult = {
    passed: input.meanCrossingsPerYear >= t.minMeanCrossingsPerYear,
    value: input.meanCrossingsPerYear,
    threshold: t.minMeanCrossingsPerYear,
    reason: `mean-crossings ${input.meanCrossingsPerYear.toFixed(2)}/year ${
      input.meanCrossingsPerYear >= t.minMeanCrossingsPerYear ? "≥" : "<"
    } ${t.minMeanCrossingsPerYear}`,
  };

  const conditions = { cointegration: coint, hurst, halfLife, meanCrossings };
  const eligible = coint.passed && hurst.passed && halfLife.passed && meanCrossings.passed;
  const failureReasons: string[] = [];
  if (!coint.passed) failureReasons.push(`cointegration: ${coint.reason}`);
  if (!hurst.passed) failureReasons.push(`hurst: ${hurst.reason}`);
  if (!halfLife.passed) failureReasons.push(`half-life: ${halfLife.reason}`);
  if (!meanCrossings.passed) failureReasons.push(`mean-crossings: ${meanCrossings.reason}`);

  const reasoning = eligible
    ? `eligible: ${coint.reason}, ${hurst.reason}, ${halfLife.reason}, ${meanCrossings.reason}`
    : `ineligible (${failureReasons.length}/4 failed): ${failureReasons.join("; ")}`;

  return {
    eligible,
    conditions,
    failureReasons,
    reasoning,
  };
}

export function pairsEligibilityFilterToPayload(
  result: PairsEligibilityFilterResult,
): Record<string, unknown> {
  return {
    kind: "pairs_eligibility_filter.computed",
    eligible: result.eligible,
    conditions: {
      cointegration: {
        passed: result.conditions.cointegration.passed,
        value: Number(result.conditions.cointegration.value.toFixed(6)),
      },
      hurst: {
        passed: result.conditions.hurst.passed,
        value: Number(result.conditions.hurst.value.toFixed(4)),
      },
      halfLife: {
        passed: result.conditions.halfLife.passed,
        value: Number(result.conditions.halfLife.value.toFixed(4)),
      },
      meanCrossings: {
        passed: result.conditions.meanCrossings.passed,
        value: Number(result.conditions.meanCrossings.value.toFixed(4)),
      },
    },
    failureReasons: result.failureReasons,
  };
}
