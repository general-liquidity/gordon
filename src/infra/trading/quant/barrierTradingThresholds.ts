/**
 * Barrier Trading Thresholds with Hysteresis (GORDON_BARRIER_TRADING_THRESHOLDS).
 *
 * Derives optimal entry/exit barriers for a position state machine when the
 * trader pays a transaction cost κ per unit traded. Under leptokurtotic
 * (Laplace-like) alphas the optimal barriers split:
 *
 *   entry barrier b₁ = ζ × σ_α + κ      (open position when |α| > b₁)
 *   exit  barrier b₂ = ζ × σ_α − κ      (close position when |α| < b₂)
 *
 * where σ_α is the standard deviation of the alpha (signal) and ζ ≈ 0.6 is
 * a slowly-varying offset capturing the risk-aversion contribution. By
 * construction the barriers are 2κ apart — exactly the round-trip cost.
 *
 * When κ > ζ × σ_α the exit barrier becomes NEGATIVE. The trader then holds
 * a long position even when the alpha turns slightly negative, because the
 * round-trip cost of flipping exceeds the small expected loss. This is the
 * Schmitt-trigger hysteresis Giller identifies — it prevents whipsaws.
 *
 * Also computes the expected breadth N (independent trades per year) for
 * Laplace and standard-normal alpha distributions, feeding directly into
 * `fundamentalLawActiveManagement.ts` (G4).
 *
 * Generalises Gordon's existing `src/core/strategies/recipes/signal-gate.ts`
 * which uses a single symmetric amplitude threshold without hysteresis or
 * cost-derived separation.
 *
 * Source: Giller, "Essays on Trading Strategy" (2023), Essay 5.4.
 *
 * Pure compute. No I/O.
 */

export const BARRIER_TRADING_THRESHOLDS_FLAG_ENV = "GORDON_BARRIER_TRADING_THRESHOLDS";

export function isBarrierTradingThresholdsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env[BARRIER_TRADING_THRESHOLDS_FLAG_ENV] === "1" ||
    env[BARRIER_TRADING_THRESHOLDS_FLAG_ENV] === "true"
  );
}

export type AlphaDistribution = "normal" | "laplace";

export interface BarrierTradingThresholdsInput {
  /** Standard deviation of the alpha signal (in same units as alpha and cost). */
  alphaStdDev: number;
  /** Transaction cost per unit traded (same units as alpha). */
  transactionCost: number;
  /** Risk-aversion offset ζ. Giller's heuristic ≈ 0.6 across normal/Laplace. Default 0.6. */
  zeta?: number;
  /** Periods per year for breadth annualisation. Default 252. */
  periodsPerYear?: number;
  /** Distribution shape for breadth calculation. Default "laplace" (better fit for crypto). */
  alphaDistribution?: AlphaDistribution;
}

export interface BarrierTradingThresholdsResult {
  /** Entry barrier b₁ (in same units as alpha). */
  entryBarrier: number;
  /** Exit barrier b₂ (same units). Negative ⇒ hysteresis dominant. */
  exitBarrier: number;
  /** Standardised entry barrier B₁ = b₁ / σ_α. */
  entryBarrierStandardised: number;
  /** Standardised exit barrier B₂ = b₂ / σ_α. */
  exitBarrierStandardised: number;
  /** Standardised cost K = κ / σ_α. */
  transactionCostStandardised: number;
  /** Whether κ > ζ × σ_α (i.e. b₂ < 0; hysteresis dominates). */
  hysteresisDominant: boolean;
  /** Per-period probability of |α| > b₁ — entry rate per period. */
  perPeriodEntryProbability: number;
  /** Expected breadth: independent trades per year given the alpha distribution. */
  expectedBreadthPerYear: number;
  reasoning: string;
}

const DEFAULT_ZETA = 0.6;

/** Survival function of a standard normal at x ≥ 0, via Abramowitz–Stegun 7.1.26. */
function normalSurvivalFunction(x: number): number {
  if (x === 0) return 0.5;
  const absX = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * absX);
  const y =
    t *
    (0.254829592 +
      t *
        (-0.284496736 +
          t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const tail = 0.5 * y * Math.exp(-(absX * absX) / 2);
  return x >= 0 ? tail : 1 - tail;
}

export function computeBarrierTradingThresholds(
  input: BarrierTradingThresholdsInput,
): BarrierTradingThresholdsResult {
  const sigma = input.alphaStdDev;
  const kappa = input.transactionCost;
  const zeta = input.zeta ?? DEFAULT_ZETA;
  const ppy = input.periodsPerYear ?? 252;
  const dist: AlphaDistribution = input.alphaDistribution ?? "laplace";

  if (sigma <= 0) {
    throw new Error("alphaStdDev must be positive");
  }
  if (kappa < 0) {
    throw new Error("transactionCost must be non-negative");
  }
  if (zeta < 0) {
    throw new Error("zeta must be non-negative");
  }

  const offset = zeta * sigma;
  const entryBarrier = offset + kappa;
  const exitBarrier = offset - kappa;
  const entryBarrierStandardised = entryBarrier / sigma;
  const exitBarrierStandardised = exitBarrier / sigma;
  const K = kappa / sigma;
  const hysteresisDominant = exitBarrier < 0;

  // Per-period crossing probability (symmetric distribution → 2× one-sided tail).
  let perPeriodCrossingProb: number;
  if (dist === "laplace") {
    // Standardised Laplace (variance 1): density f(z) = (1/√2) e^(−√2|z|),
    // survival P(|Z| > b) = e^(−√2 × b).
    perPeriodCrossingProb = Math.exp(-Math.SQRT2 * entryBarrierStandardised);
  } else {
    perPeriodCrossingProb = 2 * normalSurvivalFunction(entryBarrierStandardised);
  }
  const expectedBreadthPerYear = ppy * perPeriodCrossingProb;

  const reasoning =
    `σ_α=${sigma.toFixed(6)}, κ=${kappa.toFixed(6)}, ζ=${zeta.toFixed(2)}; ` +
    `b₁=${entryBarrier.toFixed(6)}, b₂=${exitBarrier.toFixed(6)}; ` +
    `K=${K.toFixed(3)}, hysteresis=${hysteresisDominant ? "dominant" : "none"}; ` +
    `breadth≈${expectedBreadthPerYear.toFixed(1)} trades/year (${dist})`;

  return {
    entryBarrier,
    exitBarrier,
    entryBarrierStandardised,
    exitBarrierStandardised,
    transactionCostStandardised: K,
    hysteresisDominant,
    perPeriodEntryProbability: perPeriodCrossingProb,
    expectedBreadthPerYear,
    reasoning,
  };
}

export function barrierTradingThresholdsToPayload(
  result: BarrierTradingThresholdsResult,
): Record<string, unknown> {
  return {
    kind: "barrier_trading_thresholds.computed",
    entryBarrier: Number(result.entryBarrier.toFixed(8)),
    exitBarrier: Number(result.exitBarrier.toFixed(8)),
    entryBarrierStandardised: Number(result.entryBarrierStandardised.toFixed(4)),
    exitBarrierStandardised: Number(result.exitBarrierStandardised.toFixed(4)),
    hysteresisDominant: result.hysteresisDominant,
    expectedBreadthPerYear: Number(result.expectedBreadthPerYear.toFixed(2)),
  };
}
