/**
 * Harness Evolution Loop (GORDON_HARNESS_EVOLUTION) — inner-loop primitive.
 *
 * Port of Algorithm 1 from Seong, Yin, Zhang, Shi — "The Last Harness
 * You'll Ever Build" (arXiv 2604.21003v3, Apr–May 2026).
 *
 *   blueprint Λ = (Worker template W_ℋ, initial harness H^(0), Evaluator V, Evolution Agent E)
 *
 *   for k = 1..K:
 *     rebuild Worker from H^(k-1)
 *     trace      ← Worker.execute(task)
 *     (report,s) ← V.evaluate(trace, task)
 *     if s > best: best ← H^(k-1)
 *     history.append((H^(k-1), report, s))
 *     H^(k)      ← E.evolve(history, best, last_report)
 *
 * This module is the **inner-loop primitive only**. Meta-evolution (the
 * outer loop that optimizes the blueprint across tasks) is **parked**
 * pending validated training tasks — the paper has no experimental
 * results and Gordon has no 𝒯_train yet.
 *
 * Boundaries this primitive holds:
 *   - It does NOT execute agents directly. The caller supplies
 *     `BlueprintHooks` that wire the loop into Gordon's executor +
 *     planRubric/critiquePhase + ACE-style evolution agent.
 *   - It does NOT bypass safety. The harness it evolves is the *config*;
 *     every evolved harness goes through Gordon's terminationLayers /
 *     riskClassifier / permissionEngine at execution time.
 *   - Hooks are async and isolated. A throw in any hook is caught,
 *     logged into the iteration record, and the loop terminates with
 *     reason="error" rather than crashing the host.
 *
 * Harness shape mirrors Gordon's CLAUDE.md five-subsystem framing
 * (instructions / tools / environment / state / feedback) so an
 * evolved harness round-trips cleanly with the rest of Gordon's
 * configuration surface.
 */

import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const HARNESS_EVOLUTION_FLAG_ENV = "GORDON_HARNESS_EVOLUTION";
export const HARNESS_EVOLUTION_LOG_PATH_ENV = "GORDON_HARNESS_EVOLUTION_LOG_PATH";

// ============================================================================
// Types — formal Λ = (Worker template, H^(0), V, E)
// ============================================================================

/**
 * Five-subsystem harness config. Sub-keys are intentionally open
 * (Record<string, unknown>) so a caller can extend without modifying
 * this module — the Evolution Agent gets free reign to add/remove
 * fields inside the five layers.
 */
export interface HarnessConfig {
  /** Stable id for this harness version. */
  id: string;
  instructions: {
    systemPrompt?: string;
    taskPrompt?: string;
    successCriteria?: string;
    examples?: string[];
    [k: string]: unknown;
  };
  tools: {
    allowed?: string[];
    denied?: string[];
    permissions?: Record<string, "auto" | "prompt" | "deny">;
    offloadLimits?: Record<string, number>;
    [k: string]: unknown;
  };
  environment: {
    flags?: Record<string, string | number | boolean>;
    modelId?: string;
    temperature?: number;
    maxTokens?: number;
    [k: string]: unknown;
  };
  state: {
    memoryBudgetChars?: number;
    persistencePaths?: string[];
    workingMemoryEnabled?: boolean;
    [k: string]: unknown;
  };
  feedback: {
    rubricDimensions?: string[];
    doomLoopThreshold?: number;
    terminationLayersEnabled?: boolean;
    [k: string]: unknown;
  };
  /** Free-form notes — operator review, evolution rationale, etc. */
  notes?: string[];
}

/** Opaque trace handed back by the Worker. Caller-defined shape. */
export type Trace = Record<string, unknown>;

export interface EvaluationReport {
  /** Higher is better. Unbounded; convergence checks use `passed`. */
  score: number;
  /** Task-level pass/fail — used for early termination. */
  passed: boolean;
  /** Short reason for the score, surfaced in iteration records. */
  rationale: string;
  /** Adversarial diagnostics — what the Evaluator flagged. */
  diagnostics?: string[];
  /** Free-form observations for the Evolution Agent. */
  observations?: Record<string, unknown>;
}

export interface IterationRecord {
  iteration: number;
  capturedAt: string;
  /** The harness used in this iteration (NOT the post-evolution one). */
  harnessId: string;
  score: number;
  passed: boolean;
  rationale: string;
  diagnostics: string[];
  /** True iff this iteration improved on the running best. */
  isBest: boolean;
  /** Error captured if any hook threw during this iteration. */
  error?: string;
}

export type TerminationReason =
  | "converged"
  | "max_iterations"
  | "no_improvement"
  | "error";

export interface EvolutionResult {
  bestHarness: HarnessConfig;
  bestScore: number;
  bestIteration: number;
  bestPassed: boolean;
  history: IterationRecord[];
  terminationReason: TerminationReason;
}

/**
 * The three hooks that make the loop concrete. Supplied by the caller
 * because they depend on Gordon's executor / evaluator / evolution
 * implementations.
 */
export interface BlueprintHooks {
  /**
   * Run the Worker with this harness against the task. Returns a trace
   * the Evaluator can score.
   */
  execute(harness: HarnessConfig, task: string): Promise<Trace>;
  /**
   * Score the trace + optionally diagnose failures.
   */
  evaluate(trace: Trace, task: string): Promise<EvaluationReport>;
  /**
   * Mutate the best-so-far harness based on full evolution history and
   * the most recent report. Pure-functional from the caller's
   * perspective (the loop does not mutate the input).
   */
  evolve(
    history: readonly IterationRecord[],
    bestHarness: HarnessConfig,
    lastReport: EvaluationReport,
  ): Promise<HarnessConfig>;
}

export interface RunLoopOptions {
  /** Maximum iterations (the K in the paper). Required. */
  maxIterations: number;
  /**
   * Stop early once `passed=true` AND score >= this value. If undefined,
   * any `passed=true` iteration terminates with reason="converged".
   */
  targetScore?: number;
  /** Stop early if `patience` iterations pass with no improvement. */
  patience?: number;
  /** Persist iteration records as JSONL at this path. Default ~/.gordon/harness-evolution.jsonl. */
  historyLogPath?: string;
  /** Skip persistence entirely. */
  noLog?: boolean;
  /** Override clock for tests. */
  now?: () => string;
  /** Progress callback after each iteration. */
  onIteration?: (entry: IterationRecord) => void;
}

// ============================================================================
// Module-level helpers
// ============================================================================

export function isHarnessEvolutionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[HARNESS_EVOLUTION_FLAG_ENV] === "1" || env[HARNESS_EVOLUTION_FLAG_ENV] === "true";
}

export function defaultHarnessEvolutionLogPath(env: NodeJS.ProcessEnv = process.env): string {
  return env[HARNESS_EVOLUTION_LOG_PATH_ENV] ?? join(homedir(), ".gordon", "harness-evolution.jsonl");
}

function ensureParentDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

let _idCounter = 0;
export function generateHarnessId(prefix = "h"): string {
  _idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${_idCounter.toString(36)}`;
}

export function resetHarnessIdCounterForTesting(): void {
  _idCounter = 0;
}

/**
 * Deep-clone a harness config. Used by the loop to ensure the
 * Evolution Agent's mutations cannot leak into earlier iterations.
 */
export function cloneHarness(harness: HarnessConfig): HarnessConfig {
  return JSON.parse(JSON.stringify(harness)) as HarnessConfig;
}

/**
 * Compare two scores. Higher = better. Ties go to the EARLIER iteration
 * (paper convention — the simpler harness wins on ties).
 */
export function isBetterScore(candidate: number, best: number): boolean {
  return candidate > best;
}

// ============================================================================
// The loop
// ============================================================================

/**
 * Execute the harness evolution loop (Algorithm 1 in the paper).
 *
 * Termination reasons:
 *   - "converged"        — passed=true + score >= targetScore (or any passed=true if no target)
 *   - "max_iterations"   — completed K iterations without convergence
 *   - "no_improvement"   — `patience` iterations passed without improving best
 *   - "error"            — a hook threw; the loop captures the error and stops
 */
export async function runHarnessEvolutionLoop(
  initialHarness: HarnessConfig,
  hooks: BlueprintHooks,
  task: string,
  opts: RunLoopOptions,
): Promise<EvolutionResult> {
  if (opts.maxIterations < 1) {
    throw new Error("maxIterations must be >= 1");
  }

  const now = opts.now ?? (() => new Date().toISOString());
  const historyPath = opts.historyLogPath ?? defaultHarnessEvolutionLogPath();

  let currentHarness = cloneHarness(initialHarness);
  let bestHarness = cloneHarness(initialHarness);
  let bestScore = -Infinity;
  let bestIteration = 0;
  let bestPassed = false;
  const history: IterationRecord[] = [];
  let terminationReason: TerminationReason = "max_iterations";
  let lastImprovementIter = 0;

  for (let k = 1; k <= opts.maxIterations; k++) {
    const capturedAt = now();
    let entry: IterationRecord;
    let lastReport: EvaluationReport | null = null;

    try {
      const trace = await hooks.execute(currentHarness, task);
      const report = await hooks.evaluate(trace, task);
      lastReport = report;

      const improved = isBetterScore(report.score, bestScore);
      if (improved) {
        bestHarness = cloneHarness(currentHarness);
        bestScore = report.score;
        bestIteration = k;
        bestPassed = report.passed;
        lastImprovementIter = k;
      }

      entry = {
        iteration: k,
        capturedAt,
        harnessId: currentHarness.id,
        score: report.score,
        passed: report.passed,
        rationale: report.rationale,
        diagnostics: report.diagnostics ?? [],
        isBest: improved,
      };
    } catch (err) {
      entry = {
        iteration: k,
        capturedAt,
        harnessId: currentHarness.id,
        score: -Infinity,
        passed: false,
        rationale: "hook error",
        diagnostics: [],
        isBest: false,
        error: err instanceof Error ? err.message : String(err),
      };
      history.push(entry);
      if (!opts.noLog) {
        try {
          ensureParentDir(historyPath);
          appendFileSync(historyPath, JSON.stringify(entry) + "\n", "utf8");
        } catch {
          // persistence failures must not break the loop
        }
      }
      opts.onIteration?.(entry);
      terminationReason = "error";
      break;
    }

    history.push(entry);
    if (!opts.noLog) {
      try {
        ensureParentDir(historyPath);
        appendFileSync(historyPath, JSON.stringify(entry) + "\n", "utf8");
      } catch {
        // persistence failures must not break the loop
      }
    }
    opts.onIteration?.(entry);

    // Convergence check: passed AND (no target set OR target met)
    if (
      entry.passed &&
      (opts.targetScore === undefined || entry.score >= opts.targetScore)
    ) {
      terminationReason = "converged";
      break;
    }

    // Patience check
    if (opts.patience !== undefined && k - lastImprovementIter >= opts.patience) {
      terminationReason = "no_improvement";
      break;
    }

    // Last iteration — no point evolving (the result is discarded)
    if (k === opts.maxIterations) break;

    // Evolve. If evolve throws, treat as a hook error.
    try {
      currentHarness = await hooks.evolve(history, bestHarness, lastReport!);
    } catch (err) {
      const errEntry: IterationRecord = {
        iteration: k + 1,
        capturedAt: now(),
        harnessId: `${currentHarness.id}-evolve-failed`,
        score: -Infinity,
        passed: false,
        rationale: "evolve hook error",
        diagnostics: [],
        isBest: false,
        error: err instanceof Error ? err.message : String(err),
      };
      history.push(errEntry);
      if (!opts.noLog) {
        try {
          ensureParentDir(historyPath);
          appendFileSync(historyPath, JSON.stringify(errEntry) + "\n", "utf8");
        } catch {
          // ignore
        }
      }
      opts.onIteration?.(errEntry);
      terminationReason = "error";
      break;
    }
  }

  return {
    bestHarness,
    bestScore,
    bestIteration,
    bestPassed,
    history,
    terminationReason,
  };
}

// ============================================================================
// Reporting
// ============================================================================

export function formatEvolutionResult(result: EvolutionResult): string {
  const lines: string[] = [];
  lines.push(
    `Harness evolution complete — ${result.terminationReason} after ${result.history.length} iterations`,
  );
  lines.push(
    `Best: iteration ${result.bestIteration}, score=${result.bestScore.toFixed(3)}, passed=${result.bestPassed}, harness=${result.bestHarness.id}`,
  );
  for (const entry of result.history) {
    const tag = entry.isBest ? "★" : " ";
    const errSuffix = entry.error ? ` ERROR: ${entry.error}` : "";
    lines.push(
      `  ${tag} k=${entry.iteration} score=${entry.score.toFixed(3)} passed=${entry.passed} — ${entry.rationale}${errSuffix}`,
    );
  }
  return lines.join("\n");
}

export function resultToPayload(result: EvolutionResult): Record<string, unknown> {
  return {
    kind: "harness_evolution.result_recorded",
    terminationReason: result.terminationReason,
    iterations: result.history.length,
    bestIteration: result.bestIteration,
    bestScore: result.bestScore,
    bestPassed: result.bestPassed,
    bestHarnessId: result.bestHarness.id,
  };
}
