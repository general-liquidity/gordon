/**
 * Strategy-pivot stagnation detector (B13, claude-trading-skills port).
 *
 * `optimization-tier.ts` routes a mutation by feedback SEVERITY, and the
 * evolution loop assumes you should keep optimizing. This is the missing
 * anti-overfitting guardrail: when backtest-iteration fitness has plateaued
 * at a local optimum — improvement below `epsilon` over the last `window`
 * iterations — more tuning is unlikely to pay, and the recommendation flips
 * to a STRUCTURAL pivot (change the strategy's shape, not its knobs).
 *
 * Complements, does not replace, the tier selector: the tier decides HOW to
 * mutate within a strategy; this decides WHETHER to keep tuning a strategy at
 * all or pivot to a structurally different one.
 *
 * Pure + total: never throws, deterministic in its inputs.
 */

// ============================================================================
// Types
// ============================================================================

export type StagnationRecommendation = "continue_tuning" | "structural_pivot";

export interface StagnationInput {
  /** Composite fitness per iteration, oldest -> newest. */
  fitnessHistory: number[];
  /** Improvement below this over the window counts as a plateau. Default 1e-3. */
  epsilon?: number;
  /** How many trailing iterations define the plateau window. Default 5. */
  window?: number;
}

export interface StagnationResult {
  stagnant: boolean;
  recommendation: StagnationRecommendation;
  /** Best-fitness gain over the trailing window (recent best - prior best). */
  improvementOverWindow: number;
  /** Iterations since the all-time best was last set. */
  iterationsSinceImprovement: number;
  /** Number of finite fitness samples considered. */
  samples: number;
  reason: string;
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_EPSILON = 1e-3;
const DEFAULT_WINDOW = 5;

// ============================================================================
// Detector
// ============================================================================

function sanitize(history: number[]): number[] {
  return history.filter((x) => typeof x === "number" && Number.isFinite(x));
}

function bestOf(values: number[]): number {
  let best = -Infinity;
  for (const v of values) if (v > best) best = v;
  return best;
}

/**
 * Iterations since the all-time best was last achieved. 0 means the most
 * recent iteration set (or tied) the best; a large value means the run has
 * been coasting below its peak.
 */
function iterationsSinceBest(history: number[]): number {
  let bestIdx = 0;
  let best = -Infinity;
  for (let i = 0; i < history.length; i++) {
    if (history[i]! >= best) {
      best = history[i]!;
      bestIdx = i;
    }
  }
  return history.length - 1 - bestIdx;
}

/**
 * Detect an optimization plateau. Stagnation requires enough history to fill
 * the window; below that the verdict is `continue_tuning` (not enough signal
 * to justify abandoning the strategy).
 */
export function detectStagnation(input: StagnationInput): StagnationResult {
  const epsilon =
    typeof input.epsilon === "number" && Number.isFinite(input.epsilon) && input.epsilon >= 0
      ? input.epsilon
      : DEFAULT_EPSILON;
  const window =
    typeof input.window === "number" && Number.isFinite(input.window) && input.window >= 1
      ? Math.floor(input.window)
      : DEFAULT_WINDOW;

  const history = sanitize(input.fitnessHistory ?? []);
  const samples = history.length;

  // Need the window plus at least one prior point to measure improvement.
  if (samples < window + 1) {
    return {
      stagnant: false,
      recommendation: "continue_tuning",
      improvementOverWindow: 0,
      iterationsSinceImprovement: samples > 0 ? iterationsSinceBest(history) : 0,
      samples,
      reason: `Not enough history (${samples} < ${window + 1}) — keep tuning to gather signal`,
    };
  }

  const recent = history.slice(history.length - window);
  const prior = history.slice(0, history.length - window);
  const bestRecent = bestOf(recent);
  const bestPrior = bestOf(prior);
  const improvementOverWindow = bestRecent - bestPrior;
  const sinceBest = iterationsSinceBest(history);

  const stagnant = improvementOverWindow < epsilon;

  if (stagnant) {
    return {
      stagnant: true,
      recommendation: "structural_pivot",
      improvementOverWindow,
      iterationsSinceImprovement: sinceBest,
      samples,
      reason: `Plateau: best gained ${improvementOverWindow.toExponential(2)} over the last ${window} iters (< epsilon ${epsilon}) — pivot the strategy structurally rather than tune further`,
    };
  }

  return {
    stagnant: false,
    recommendation: "continue_tuning",
    improvementOverWindow,
    iterationsSinceImprovement: sinceBest,
    samples,
    reason: `Still improving: best gained ${improvementOverWindow.toExponential(2)} over the last ${window} iters (>= epsilon ${epsilon}) — continue tuning`,
  };
}

export function stagnationToPayload(result: StagnationResult): Record<string, unknown> {
  return {
    kind: "genome.stagnation_checked",
    stagnant: result.stagnant,
    recommendation: result.recommendation,
    improvementOverWindow: result.improvementOverWindow,
    iterationsSinceImprovement: result.iterationsSinceImprovement,
    samples: result.samples,
  };
}
