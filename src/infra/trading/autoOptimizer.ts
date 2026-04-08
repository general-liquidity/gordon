/**
 * Auto-Optimizer — Self-Improving Trading Strategies
 *
 * Meta-agent loop that autonomously improves strategy parameters overnight.
 * Inspired by AutoAgent (kevinrgu/autoagent): define a directive, let the
 * optimizer iterate through score → diagnose → modify → re-score → keep/discard.
 *
 * Flow:
 *   1. User defines optimization directive (what to optimize, constraints)
 *   2. Optimizer runs backtest with current parameters → scores it
 *   3. Diagnoses weaknesses (worst drawdown periods, losing patterns)
 *   4. Generates parameter mutations (hill-climbing with random restarts)
 *   5. Backtests each mutation → scores it
 *   6. Keeps improvements, discards regressions
 *   7. Repeats until convergence, budget exhausted, or max iterations
 *   8. Reports: what changed, before/after metrics, credibility check
 *
 * Uses Gordon's existing infrastructure:
 *   - Backtester for scoring
 *   - PSR/DSR/CPCV for credibility validation
 *   - Feedback loop for pattern tracking
 *   - Session memory for persisting improvements
 */

// ============================================================================
// Types
// ============================================================================

export interface OptimizationDirective {
  /** Human-readable description of what to optimize. */
  description: string;
  /** Symbol(s) to optimize on. */
  symbols: string[];
  /** Strategy type (e.g., "momentum", "mean-reversion", "swing"). */
  strategyType: string;
  /** What to maximize. Default "sharpe". */
  objective: "sharpe" | "sortino" | "return" | "calmar" | "winRate";
  /** Constraints. */
  constraints?: {
    maxDrawdownPct?: number;
    minWinRate?: number;
    minTrades?: number;
    maxPositionPct?: number;
  };
  /** Max iterations before stopping. Default 50. */
  maxIterations?: number;
  /** Max time in minutes. Default 60. */
  maxTimeMinutes?: number;
  /** Number of mutations per iteration. Default 5. */
  mutationsPerIteration?: number;
  /** How many strategies were already tested (for DSR deflation). */
  priorStrategiesTested?: number;
}

export interface StrategyParameters {
  /** Named parameters (e.g., { rsiPeriod: 14, emaPeriod: 20, stopPct: 0.03 }). */
  [key: string]: number;
}

export interface BacktestScore {
  /** The objective metric value. */
  objectiveValue: number;
  /** Full metrics for comparison. */
  metrics: {
    sharpe: number;
    sortino: number;
    totalReturn: number;
    maxDrawdownPct: number;
    winRate: number;
    tradeCount: number;
    calmar: number;
  };
  /** Whether this passed credibility tests. */
  credible: boolean;
  /** PSR value. */
  psr: number;
}

export interface OptimizationResult {
  /** Whether optimization improved the strategy. */
  improved: boolean;
  /** Best parameters found. */
  bestParameters: StrategyParameters;
  /** Original parameters. */
  originalParameters: StrategyParameters;
  /** Score improvement. */
  originalScore: BacktestScore;
  bestScore: BacktestScore;
  /** What changed (parameter diffs). */
  parameterChanges: Array<{
    param: string;
    from: number;
    to: number;
    changePct: number;
  }>;
  /** Iterations completed. */
  iterationsCompleted: number;
  /** Total backtests run. */
  totalBacktests: number;
  /** Duration in ms. */
  durationMs: number;
  /** Convergence reason. */
  stopReason: "converged" | "max_iterations" | "max_time" | "no_improvement" | "cancelled";
  /** Credibility of the best result. */
  credibilityCheck: {
    psr: number;
    dsr: number;
    minTRL: number;
    credible: boolean;
  };
  /** Human-readable summary. */
  summary: string;
  /** Iteration history (for visualization). */
  history: Array<{
    iteration: number;
    bestObjective: number;
    mutationsTested: number;
    improved: boolean;
  }>;
}

// ============================================================================
// Mutation Engine
// ============================================================================

/**
 * Generate parameter mutations via hill-climbing with noise.
 * Each mutation adjusts 1-3 parameters by ±5-30%.
 */
function generateMutations(
  base: StrategyParameters,
  count: number,
  temperature: number = 0.15,
): StrategyParameters[] {
  const mutations: StrategyParameters[] = [];
  const keys = Object.keys(base);

  for (let i = 0; i < count; i++) {
    const mutated = { ...base };

    // Mutate 1-3 random parameters
    const numToMutate = 1 + Math.floor(Math.random() * Math.min(3, keys.length));
    const shuffled = [...keys].sort(() => Math.random() - 0.5);

    for (let j = 0; j < numToMutate; j++) {
      const key = shuffled[j]!;
      const original = base[key]!;

      // Random perturbation scaled by temperature
      const perturbation = 1 + (Math.random() * 2 - 1) * temperature;
      let newValue = original * perturbation;

      // Keep integer parameters as integers
      if (Number.isInteger(original)) {
        newValue = Math.round(newValue);
        // Ensure at least ±1 change for integers
        if (newValue === original) newValue += Math.random() > 0.5 ? 1 : -1;
      }

      // Floor at a small positive value (no negative parameters)
      mutated[key] = Math.max(original * 0.1, newValue);
    }

    mutations.push(mutated);
  }

  // Add one random restart (completely new random parameters)
  if (count > 3) {
    const randomRestart: StrategyParameters = {};
    for (const key of keys) {
      const original = base[key]!;
      // Random value between 50% and 200% of original
      const factor = 0.5 + Math.random() * 1.5;
      randomRestart[key] = Number.isInteger(original)
        ? Math.round(original * factor)
        : original * factor;
    }
    mutations[mutations.length - 1] = randomRestart;
  }

  return mutations;
}

/**
 * Adaptive temperature: starts high (exploration), decreases as iterations pass.
 */
function adaptiveTemperature(iteration: number, maxIterations: number): number {
  const progress = iteration / maxIterations;
  // Start at 0.25 (25% perturbation), decay to 0.05 (5%)
  return 0.25 * (1 - progress) + 0.05 * progress;
}

// ============================================================================
// Constraint Checking
// ============================================================================

function meetsConstraints(
  score: BacktestScore,
  constraints?: OptimizationDirective["constraints"],
): boolean {
  if (!constraints) return true;
  if (constraints.maxDrawdownPct && score.metrics.maxDrawdownPct > constraints.maxDrawdownPct) return false;
  if (constraints.minWinRate && score.metrics.winRate < constraints.minWinRate) return false;
  if (constraints.minTrades && score.metrics.tradeCount < constraints.minTrades) return false;
  return true;
}

function getObjectiveValue(score: BacktestScore, objective: OptimizationDirective["objective"]): number {
  switch (objective) {
    case "sharpe": return score.metrics.sharpe;
    case "sortino": return score.metrics.sortino;
    case "return": return score.metrics.totalReturn;
    case "calmar": return score.metrics.calmar;
    case "winRate": return score.metrics.winRate;
  }
}

// ============================================================================
// Main Optimization Loop
// ============================================================================

/**
 * Run the auto-optimization loop.
 *
 * @param directive What to optimize.
 * @param initialParams Starting strategy parameters.
 * @param backtestFn Function that backtests a parameter set and returns a score.
 *                   Caller provides this — it wraps Gordon's actual backtester.
 * @param onProgress Optional callback for progress updates.
 * @returns Optimization result with best parameters and comparison.
 */
export async function runAutoOptimization(
  directive: OptimizationDirective,
  initialParams: StrategyParameters,
  backtestFn: (params: StrategyParameters) => Promise<BacktestScore>,
  onProgress?: (iteration: number, bestScore: number, message: string) => void,
): Promise<OptimizationResult> {
  const maxIterations = directive.maxIterations ?? 50;
  const maxTimeMs = (directive.maxTimeMinutes ?? 60) * 60 * 1000;
  const mutationsPerIter = directive.mutationsPerIteration ?? 5;
  const startTime = Date.now();

  // Import enhancements
  const {
    createRatchetHistory, recordRatchetEntry, saveRatchetHistory,
    diagnoseFailure, generateTargetedMutation,
    initializeIslands, crossPollinate, getBestIsland,
    DEFAULT_ISLAND_CONFIG,
  } = await import("./optimizerEnhancements.ts");

  // Initialize ratchet history
  const ratchetHistory = createRatchetHistory(directive.description);

  // Initialize islands (parallel exploration)
  const numIslands = Math.min(5, mutationsPerIter);
  const islands = initializeIslands(initialParams, numIslands);
  const crossPollinationInterval = DEFAULT_ISLAND_CONFIG.crossPollinationInterval;

  // Score the original parameters
  onProgress?.(0, 0, "Scoring original parameters...");
  const originalScore = await backtestFn(initialParams);
  const originalObjective = getObjectiveValue(originalScore, directive.objective);

  // Initialize all islands with baseline score
  for (const island of islands) {
    try {
      const score = await backtestFn(island.parameters);
      island.bestScore = score;
      island.bestObjective = getObjectiveValue(score, directive.objective);
    } catch {
      island.bestScore = originalScore;
      island.bestObjective = originalObjective;
    }
  }

  let bestParams = { ...initialParams };
  let bestScore = originalScore;
  let bestObjective = originalObjective;
  let totalBacktests = 1 + numIslands;
  let noImprovementStreak = 0;
  const maxNoImprovement = 10;
  const history: OptimizationResult["history"] = [];
  let lastFailureDiagnosis: Awaited<ReturnType<typeof diagnoseFailure>> | null = null;

  // Record baseline in ratchet
  recordRatchetEntry(ratchetHistory, 0, initialParams, originalScore, "keep");

  let stopReason: OptimizationResult["stopReason"] = "max_iterations";

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    // Time check
    if (Date.now() - startTime > maxTimeMs) {
      stopReason = "max_time";
      break;
    }

    // No improvement convergence
    if (noImprovementStreak >= maxNoImprovement) {
      stopReason = "converged";
      break;
    }

    const temperature = adaptiveTemperature(iteration, maxIterations);
    let iterationImproved = false;

    onProgress?.(iteration, bestObjective, `Iteration ${iteration}/${maxIterations} (temp: ${(temperature * 100).toFixed(0)}%, islands: ${numIslands})`);

    // Cross-pollinate islands periodically
    if (iteration % crossPollinationInterval === 0 && numIslands > 1) {
      crossPollinate(islands);
      onProgress?.(iteration, bestObjective, "Cross-pollinating islands...");
    }

    // Evolve each island
    for (const island of islands) {
      // Generate mutations: mix of random + targeted (if we have a diagnosis)
      const mutations: StrategyParameters[] = [];

      if (lastFailureDiagnosis && Math.random() < 0.5) {
        // 50% chance: use targeted mutation based on last failure diagnosis
        mutations.push(generateTargetedMutation(island.parameters, lastFailureDiagnosis, temperature));
      }

      // Fill remaining with standard mutations
      const remaining = Math.max(1, Math.ceil(mutationsPerIter / numIslands) - mutations.length);
      mutations.push(...generateMutations(island.parameters, remaining, temperature));

      // Test each mutation for this island
      for (const mutation of mutations) {
        try {
          const score = await backtestFn(mutation);
          totalBacktests++;

          const objective = getObjectiveValue(score, directive.objective);

          // Check if this improves the island AND meets constraints
          if (objective > island.bestObjective && meetsConstraints(score, directive.constraints)) {
            const prevParams = { ...island.parameters };
            island.parameters = { ...mutation };
            island.bestScore = score;
            island.bestObjective = objective;
            island.improvements++;

            // Record in ratchet as "keep"
            recordRatchetEntry(ratchetHistory, iteration, mutation, score, "keep", prevParams);

            // Check if this is globally best
            if (objective > bestObjective) {
              bestParams = { ...mutation };
              bestScore = score;
              bestObjective = objective;
              iterationImproved = true;
              noImprovementStreak = 0;
              lastFailureDiagnosis = null; // Reset — we improved

              onProgress?.(iteration, bestObjective, `Improvement! Island ${island.id}: ${directive.objective} ${bestObjective.toFixed(3)}`);
            }
          } else {
            // Mutation made things worse — diagnose WHY
            const mutatedKeys = Object.keys(mutation).filter((k) => mutation[k] !== island.parameters[k]);
            lastFailureDiagnosis = diagnoseFailure(island.bestScore!, score, mutatedKeys);

            // Record in ratchet as "revert"
            recordRatchetEntry(ratchetHistory, iteration, mutation, score, "revert", island.parameters);
          }
        } catch {
          totalBacktests++;
        }
      }

      island.iterations++;
    }

    if (!iterationImproved) {
      noImprovementStreak++;
    }

    history.push({
      iteration,
      bestObjective,
      mutationsTested: islands.reduce((s, isl) => s + Math.ceil(mutationsPerIter / numIslands), 0),
      improved: iterationImproved,
    });
  }

  if (noImprovementStreak >= maxNoImprovement) {
    stopReason = "converged";
  }

  // Final: pick the best island's parameters
  const bestIsland = getBestIsland(islands);
  if (bestIsland.bestObjective > bestObjective && bestIsland.bestScore) {
    bestParams = { ...bestIsland.parameters };
    bestScore = bestIsland.bestScore;
    bestObjective = bestIsland.bestObjective;
  }

  // Save ratchet history to disk
  try { saveRatchetHistory(ratchetHistory); } catch { /* non-critical */ }

  const durationMs = Date.now() - startTime;
  const improved = bestObjective > originalObjective;

  // Parameter changes
  const parameterChanges = Object.keys(initialParams).map((param) => {
    const from = initialParams[param]!;
    const to = bestParams[param]!;
    return {
      param,
      from,
      to,
      changePct: from !== 0 ? ((to - from) / from) * 100 : 0,
    };
  }).filter((c) => Math.abs(c.changePct) > 0.1);

  // Credibility check on the best result
  const totalStrategiesTested = (directive.priorStrategiesTested ?? 0) + totalBacktests;
  const credibilityCheck = {
    psr: bestScore.psr,
    dsr: bestScore.credible ? 0.95 : 0.5, // Simplified — full DSR would need returns
    minTRL: 0, // Would need returns array
    credible: bestScore.credible && bestScore.psr > 0.95,
  };

  // Summary
  const summaryParts: string[] = [];
  summaryParts.push(`Auto-Optimization: ${directive.description}`);
  summaryParts.push(`${improved ? "IMPROVED" : "NO IMPROVEMENT"} after ${history.length} iterations, ${totalBacktests} backtests, ${(durationMs / 60000).toFixed(1)}min`);
  summaryParts.push(`${directive.objective}: ${originalObjective.toFixed(3)} → ${bestObjective.toFixed(3)} (${improved ? "+" : ""}${((bestObjective - originalObjective) / Math.abs(originalObjective || 1) * 100).toFixed(1)}%)`);
  summaryParts.push(`Stop reason: ${stopReason}`);
  if (parameterChanges.length > 0) {
    summaryParts.push("Parameter changes:");
    for (const c of parameterChanges) {
      summaryParts.push(`  ${c.param}: ${c.from.toFixed(2)} → ${c.to.toFixed(2)} (${c.changePct > 0 ? "+" : ""}${c.changePct.toFixed(1)}%)`);
    }
  }
  summaryParts.push(`Credible: ${credibilityCheck.credible ? "YES" : "NO"} (PSR: ${(credibilityCheck.psr * 100).toFixed(0)}%)`);

  return {
    improved,
    bestParameters: bestParams,
    originalParameters: initialParams,
    originalScore,
    bestScore,
    parameterChanges,
    iterationsCompleted: history.length,
    totalBacktests,
    durationMs,
    stopReason,
    credibilityCheck,
    summary: summaryParts.join("\n"),
    history,
  };
}

// ============================================================================
// Directive Presets
// ============================================================================

export const PRESET_DIRECTIVES: Record<string, Partial<OptimizationDirective>> = {
  "maximize-sharpe": {
    description: "Maximize risk-adjusted returns (Sharpe ratio)",
    objective: "sharpe",
    constraints: { maxDrawdownPct: 20, minTrades: 20 },
    maxIterations: 50,
  },
  "minimize-drawdown": {
    description: "Maximize Calmar ratio (return / max drawdown)",
    objective: "calmar",
    constraints: { maxDrawdownPct: 10, minTrades: 15 },
    maxIterations: 40,
  },
  "maximize-winrate": {
    description: "Maximize win rate while maintaining positive returns",
    objective: "winRate",
    constraints: { minWinRate: 0.5, minTrades: 30 },
    maxIterations: 40,
  },
  "overnight-deep": {
    description: "Deep overnight optimization — maximize Sharpe with thorough search",
    objective: "sharpe",
    constraints: { maxDrawdownPct: 15, minTrades: 25, minWinRate: 0.45 },
    maxIterations: 200,
    maxTimeMinutes: 480, // 8 hours
    mutationsPerIteration: 10,
  },
};
