/**
 * Multi-Method Expected Return Estimator
 *
 * Combines three independent estimation methods into a composite
 * forward-return estimate per asset:
 *
 *   1. Historical — arithmetic mean of past returns over a lookback
 *   2. Valuation-implied — Shiller PE / YTM / operator-supplied
 *   3. Regime-adjusted — historical mean modulated by macro regime
 *
 * The composite is a weighted blend with explicit operator-readable
 * weights. The module surfaces method divergence + flags when
 * methods disagree by more than a threshold (the canonical
 * "historical vs. valuation widest gap since 2007" pattern).
 *
 * Composes with Gordon's existing primitives:
 *   - `markov-regime.ts` + `regime/` modules supply the Regime input
 *   - `ic-tracker.ts` measures whether the composite IS predictive
 *   - `marginal-contribution.ts` checks whether adding a new asset
 *     given its composite estimate adds portfolio diversification
 *
 * Pure function over numeric inputs. No I/O. Operator controls all
 * thresholds + weights + regime adjustments via options.
 */

export type ExpectedReturnRegime =
  | "expansion"
  | "late_cycle"
  | "recession"
  | "recovery"
  | "unknown";

export type ValuationMetricType =
  | "shiller_pe"
  | "yield_to_maturity"
  | "operator_supplied";

export interface ValuationInput {
  /**
   * The metric value. For shiller_pe: current CAPE (e.g., 32).
   * For yield_to_maturity: decimal yield (e.g., 0.045 for 4.5%).
   * For operator_supplied: the operator's pre-computed valuation-
   * implied annualized return (decimal).
   */
  metric: number;
  metricType: ValuationMetricType;
  /** Long-run mean for shiller_pe mean-reversion math. Default 17 (US equity CAPE long-run avg). */
  longRunMean?: number;
  /** Expected inflation (annualized decimal). Used for shiller_pe nominal-return conversion. Default 0.025. */
  expectedInflation?: number;
  /** Years over which CAPE mean-reverts in shiller_pe path. Default 10. */
  meanReversionYears?: number;
}

export interface RegimeAdjustment {
  expansion: number;
  late_cycle: number;
  recession: number;
  recovery: number;
  unknown: number;
}

/**
 * Default regime multipliers calibrated to US equity historical
 * regime behavior. Operator should override for non-equity assets
 * (bonds rally in recession, etc.).
 */
export const DEFAULT_EQUITY_REGIME_ADJUSTMENTS: RegimeAdjustment = {
  expansion: 1.10,
  late_cycle: 0.85,
  recession: 0.50,
  recovery: 1.30,
  unknown: 1.0,
};

export interface ExpectedReturnInput {
  assetClass: "equity" | "bond" | "commodity" | "real_estate" | "fx" | "crypto" | "other";
  /** Annualized historical returns (decimal). At least 12 data points recommended. */
  historicalReturns: number[];
  valuation: ValuationInput;
  regime: ExpectedReturnRegime;
  /** Optional regime-multiplier overrides. Merged with defaults. */
  regimeAdjustments?: Partial<RegimeAdjustment>;
  /**
   * Composite weights. Default [0.25, 0.50, 0.25] for [historical,
   * valuation, regime]. Re-weighted to sum to 1 if operator passes
   * something else.
   */
  weights?: {
    historical: number;
    valuation: number;
    regime: number;
  };
  /** Divergence threshold (decimal). Default 0.05 (500 bps). */
  divergenceThreshold?: number;
}

export interface ExpectedReturnMethodResult {
  name: "historical" | "valuation_implied" | "regime_adjusted";
  estimate: number;
  reasoning: string;
}

export interface ExpectedReturnResult {
  composite: number;
  methods: ExpectedReturnMethodResult[];
  weights: { historical: number; valuation: number; regime: number };
  flags: string[];
  /** Max minus min across method estimates, in basis points. */
  methodDivergenceBps: number;
  /** Historical-vs-valuation gap in basis points (the canonical "widest since 2007" check). */
  historicalVsValuationBps: number;
  summary: string;
}

// ============================================================================
// Internals
// ============================================================================

const DEFAULT_WEIGHTS = { historical: 0.25, valuation: 0.50, regime: 0.25 };
const DEFAULT_DIVERGENCE_THRESHOLD = 0.05;
const DEFAULT_LONG_RUN_CAPE = 17;
const DEFAULT_EXPECTED_INFLATION = 0.025;
const DEFAULT_MEAN_REVERSION_YEARS = 10;

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

function normalizeWeights(w: {
  historical: number;
  valuation: number;
  regime: number;
}): { historical: number; valuation: number; regime: number } {
  const sum = w.historical + w.valuation + w.regime;
  if (sum <= 0) return DEFAULT_WEIGHTS;
  return {
    historical: w.historical / sum,
    valuation: w.valuation / sum,
    regime: w.regime / sum,
  };
}

function valuationImpliedEstimate(v: ValuationInput): {
  estimate: number;
  reasoning: string;
} {
  if (v.metricType === "operator_supplied") {
    return {
      estimate: v.metric,
      reasoning: `Operator-supplied valuation-implied return: ${(v.metric * 100).toFixed(2)}%`,
    };
  }

  if (v.metricType === "yield_to_maturity") {
    // For bonds held-to-maturity, expected nominal return ≈ YTM
    return {
      estimate: v.metric,
      reasoning: `Yield-to-maturity ${(v.metric * 100).toFixed(2)}% — expected return for held-to-maturity bonds`,
    };
  }

  // shiller_pe path
  const cape = v.metric;
  const longRunMean = v.longRunMean ?? DEFAULT_LONG_RUN_CAPE;
  const inflation = v.expectedInflation ?? DEFAULT_EXPECTED_INFLATION;
  const years = v.meanReversionYears ?? DEFAULT_MEAN_REVERSION_YEARS;

  if (cape <= 0) {
    return {
      estimate: 0,
      reasoning: `Invalid CAPE ${cape} — using 0`,
    };
  }

  // Real return = earnings yield + valuation-change contribution
  const earningsYield = 1 / cape;
  const valuationChange = Math.pow(longRunMean / cape, 1 / years) - 1;
  const realReturn = earningsYield + valuationChange;
  const nominalReturn = realReturn + inflation;

  return {
    estimate: nominalReturn,
    reasoning:
      `CAPE ${cape.toFixed(1)} vs long-run mean ${longRunMean}: earnings yield ${(earningsYield * 100).toFixed(2)}% + ` +
      `valuation-change ${(valuationChange * 100).toFixed(2)}%/yr (over ${years}yr) + inflation ${(inflation * 100).toFixed(1)}% ` +
      `= ${(nominalReturn * 100).toFixed(2)}% nominal`,
  };
}

// ============================================================================
// Public API
// ============================================================================

export function estimateExpectedReturn(
  input: ExpectedReturnInput,
): ExpectedReturnResult {
  const flags: string[] = [];

  // Method 1: historical
  if (input.historicalReturns.length < 12) {
    flags.push(
      `Insufficient historical data — only ${input.historicalReturns.length} observations (12+ recommended)`,
    );
  }
  const historicalEstimate = mean(input.historicalReturns);
  const historicalResult: ExpectedReturnMethodResult = {
    name: "historical",
    estimate: historicalEstimate,
    reasoning: `Mean of ${input.historicalReturns.length} historical returns: ${(historicalEstimate * 100).toFixed(2)}%`,
  };

  // Method 2: valuation-implied
  const valuation = valuationImpliedEstimate(input.valuation);
  const valuationResult: ExpectedReturnMethodResult = {
    name: "valuation_implied",
    estimate: valuation.estimate,
    reasoning: valuation.reasoning,
  };

  // Method 3: regime-adjusted
  const regimeAdjustments: RegimeAdjustment = {
    ...DEFAULT_EQUITY_REGIME_ADJUSTMENTS,
    ...(input.regimeAdjustments ?? {}),
  };
  const multiplier = regimeAdjustments[input.regime];
  const regimeEstimate = historicalEstimate * multiplier;
  const regimeResult: ExpectedReturnMethodResult = {
    name: "regime_adjusted",
    estimate: regimeEstimate,
    reasoning:
      `Historical ${(historicalEstimate * 100).toFixed(2)}% × ${multiplier.toFixed(2)} (${input.regime}) = ${(regimeEstimate * 100).toFixed(2)}%`,
  };

  if (input.regime === "unknown") {
    flags.push(
      "Regime is unknown — regime-adjusted estimate equals historical (no adjustment applied)",
    );
  }

  // Composite
  const rawWeights = input.weights ?? DEFAULT_WEIGHTS;
  const weights = normalizeWeights(rawWeights);
  const composite =
    weights.historical * historicalEstimate +
    weights.valuation * valuation.estimate +
    weights.regime * regimeEstimate;

  // Divergence + flags
  const estimates = [historicalEstimate, valuation.estimate, regimeEstimate];
  const methodDivergence = Math.max(...estimates) - Math.min(...estimates);
  const methodDivergenceBps = methodDivergence * 10_000;
  const histVsValGap = Math.abs(historicalEstimate - valuation.estimate);
  const histVsValBps = histVsValGap * 10_000;

  const threshold = input.divergenceThreshold ?? DEFAULT_DIVERGENCE_THRESHOLD;
  if (methodDivergence > threshold) {
    flags.push(
      `Method divergence ${methodDivergenceBps.toFixed(0)}bps exceeds threshold ${(threshold * 10_000).toFixed(0)}bps — methods disagree materially`,
    );
  }
  if (histVsValGap > threshold) {
    flags.push(
      `Historical vs valuation gap ${histVsValBps.toFixed(0)}bps exceeds threshold — backward-looking and forward-looking lenses disagree`,
    );
  }

  const summary =
    `${input.assetClass} (regime: ${input.regime}): composite ${(composite * 100).toFixed(2)}% ` +
    `[hist ${(historicalEstimate * 100).toFixed(2)}%, val ${(valuation.estimate * 100).toFixed(2)}%, ` +
    `regime ${(regimeEstimate * 100).toFixed(2)}%], divergence ${methodDivergenceBps.toFixed(0)}bps` +
    (flags.length > 0 ? ` — ${flags.length} flag${flags.length > 1 ? "s" : ""}` : "");

  return {
    composite: parseFloat(composite.toFixed(6)),
    methods: [historicalResult, valuationResult, regimeResult],
    weights,
    flags,
    methodDivergenceBps: parseFloat(methodDivergenceBps.toFixed(2)),
    historicalVsValuationBps: parseFloat(histVsValBps.toFixed(2)),
    summary,
  };
}

/**
 * Format the result as operator-readable text.
 */
export function formatExpectedReturn(result: ExpectedReturnResult): string {
  const lines: string[] = [
    `Composite expected return: ${(result.composite * 100).toFixed(2)}%`,
    "",
    "Per-method estimates:",
  ];
  for (const m of result.methods) {
    lines.push(`  - ${m.name}: ${(m.estimate * 100).toFixed(2)}% — ${m.reasoning}`);
  }
  lines.push("");
  lines.push(
    `Weights: historical ${(result.weights.historical * 100).toFixed(0)}%, ` +
      `valuation ${(result.weights.valuation * 100).toFixed(0)}%, ` +
      `regime ${(result.weights.regime * 100).toFixed(0)}%`,
  );
  lines.push("");
  lines.push(
    `Method divergence: ${result.methodDivergenceBps.toFixed(0)}bps (historical-vs-valuation: ${result.historicalVsValuationBps.toFixed(0)}bps)`,
  );
  if (result.flags.length > 0) {
    lines.push("");
    lines.push("Flags:");
    for (const f of result.flags) lines.push(`  ⚠ ${f}`);
  }
  return lines.join("\n");
}
