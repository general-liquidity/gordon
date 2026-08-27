/**
 * Optimal Limit-Order Depth — CJ3.
 *
 * Closed-form optimal posting depth δ*(t, q) for a limit-order
 * execution problem with exponential fill intensity and terminal
 * inventory penalty.
 *
 * Model (Cartea-Jaimungal-Penalva 2015 ch. 7 / Drissi 2024 Sec 9):
 *   Posting a limit at depth δ from the mid → fills arrive at intensity
 *     λ(δ) = A · exp(−κ·δ)             (exponential intensity decay)
 *   Inventory dynamics: dQ_t = −dN_t     (each fill consumes 1 share)
 *   Terminal penalty: α · Q_T²
 *
 * Closed form for ν*(t, q) — depth as a function of (time remaining, q):
 *
 *   Define Λ = A / κ.
 *
 *   ψ_q(t) = Σ_{n=0..q}  Λ^n · exp(−α·(q−n)²) · (T−t)^n / n!
 *
 *   δ*(t, q) = (1/κ) · [1 + log(ψ_q(t) / ψ_{q−1}(t))]
 *
 * Behavior:
 *   - Higher inventory q → tighter depth (post closer to mid to fill faster)
 *   - Longer horizon (T−t) → wider depth (can afford to be patient)
 *   - Higher intensity A → tighter depth (no need to be aggressive)
 *   - Higher terminal penalty α → tighter depth (urgency to flatten)
 *
 * Pedigree: Guéant-Lehalle-Fernandez-Tapia (2012) "Optimal portfolio
 * liquidation with limit orders," SIAM J. Financial Math, and the
 * synthesis in Cartea-Jaimungal-Penalva (2015) ch. 7.
 *
 * Pure compute. No side effects.
 */

export interface OptimalLimitDepthInput {
  /** Time remaining in the execution horizon. Must be > 0. */
  timeRemaining: number;
  /** Inventory units remaining (integer ≥ 1). */
  inventoryRemaining: number;
  /** Fill-intensity scale A (fills per unit time at depth=0). Must be > 0. */
  intensityScale: number;
  /** Fill-intensity decay rate κ (depth-sensitivity of arrivals). Must be > 0. */
  intensityDecay: number;
  /** Terminal inventory penalty α (≥ 0). Higher = more urgent to flatten. Default 0.1. */
  terminalPenalty?: number;
}

export interface OptimalLimitDepthResult {
  /** Optimal posting depth δ* from mid (price units). */
  optimalDepth: number;
  /** Implied instantaneous fill intensity at the optimal depth. */
  fillIntensityAtOptimal: number;
  /** Λ = A/κ (problem-scale parameter). */
  lambdaRatio: number;
  /** Ratio of polynomial sums ψ_q / ψ_{q−1} that drives the depth choice. */
  psiRatio: number;
  reasoning: string;
}

/**
 * Compute ψ_q(t) = Σ_{n=0..q}  Λ^n · exp(−α·(q−n)²) · (T−t)^n / n!
 *
 * Loop-based; q is small (institutional inventories ≤ thousands of shares
 * scaled into round-lots, and the model treats them as count). Caller
 * passes q in whatever unit is the "1 share = 1 fill" granularity.
 */
function computePsi(q: number, lambdaRatio: number, alpha: number, tau: number): number {
  let sum = 0;
  let lambdaPow = 1; // Λ^0
  let tauPow = 1; // (T-t)^0
  let nFact = 1; // 0!
  for (let n = 0; n <= q; n++) {
    if (n > 0) {
      lambdaPow *= lambdaRatio;
      tauPow *= tau;
      nFact *= n;
    }
    const residual = q - n;
    sum += (lambdaPow * tauPow * Math.exp(-alpha * residual * residual)) / nFact;
  }
  return sum;
}

export function computeOptimalLimitDepth(input: OptimalLimitDepthInput): OptimalLimitDepthResult {
  if (input.timeRemaining <= 0) {
    throw new Error("timeRemaining must be > 0");
  }
  if (!Number.isInteger(input.inventoryRemaining) || input.inventoryRemaining < 1) {
    throw new Error("inventoryRemaining must be an integer ≥ 1");
  }
  if (input.intensityScale <= 0) {
    throw new Error("intensityScale must be > 0");
  }
  if (input.intensityDecay <= 0) {
    throw new Error("intensityDecay must be > 0");
  }
  const alpha = input.terminalPenalty ?? 0.1;
  if (alpha < 0) {
    throw new Error("terminalPenalty must be ≥ 0");
  }

  const tau = input.timeRemaining;
  const q = input.inventoryRemaining;
  const A = input.intensityScale;
  const kappa = input.intensityDecay;
  const lambdaRatio = A / kappa;

  const psiQ = computePsi(q, lambdaRatio, alpha, tau);
  const psiQMinus = computePsi(q - 1, lambdaRatio, alpha, tau);

  // Closed-form δ*(t, q) = (1/κ) · [1 + log(ψ_q / ψ_{q−1})].
  // The log argument is always positive by construction.
  const psiRatio = psiQ / psiQMinus;
  const optimalDepth = (1 + Math.log(psiRatio)) / kappa;
  const fillIntensityAtOptimal = A * Math.exp(-kappa * optimalDepth);

  const reasoning =
    `OptimalLimitDepth q=${q} τ=${tau.toFixed(2)}: Λ=A/κ=${lambdaRatio.toFixed(4)}, ` +
    `ψ_q/ψ_{q-1}=${psiRatio.toFixed(4)} → δ*=${optimalDepth.toFixed(4)} ` +
    `(intensity at depth=${fillIntensityAtOptimal.toFixed(4)}/unit_time, α=${alpha}).`;

  return {
    optimalDepth,
    fillIntensityAtOptimal,
    lambdaRatio,
    psiRatio,
    reasoning,
  };
}

export function optimalLimitDepthToPayload(
  result: OptimalLimitDepthResult,
): Record<string, unknown> {
  return {
    kind: "optimal_limit_depth.computed",
    optimalDepth: Number(result.optimalDepth.toFixed(6)),
    fillIntensityAtOptimal: Number(result.fillIntensityAtOptimal.toFixed(6)),
    lambdaRatio: Number(result.lambdaRatio.toFixed(6)),
    psiRatio: Number(result.psiRatio.toFixed(6)),
  };
}
