/**
 * Evaluator Calibration (GORDON_EVALUATOR_CALIBRATION).
 *
 * Port of the few-shot evaluator calibration pattern from Anthropic's
 * "Harness Design for Long-Running Application Development" (2026):
 *
 *   "I calibrated the evaluator using few-shot examples with detailed
 *    score breakdowns ... reduced score drift across iterations."
 *
 * The primitive maintains a small library of gold-standard
 * input → expected-score examples. When the evaluator runs, it gets
 * injected with the most-relevant K examples to anchor scoring.
 * Periodically re-running the evaluator against the calibration set
 * surfaces drift — when scores on KNOWN inputs change, the prompt or
 * model has shifted.
 *
 * Three concrete contributions:
 *   1. `buildCalibrationBlock(examples)` — formats few-shot examples
 *      ready to splice into an evaluator system prompt.
 *   2. `detectDrift(observed, expected, tolerance)` — compares the
 *      evaluator's score on a known input against the gold answer.
 *      Returns per-dimension drift + a verdict.
 *   3. JSONL persistence at `~/.gordon/evaluator-calibration.jsonl`.
 *
 * Pair with `adversarialEvaluator.ts`: calibration anchors the score
 * scale; adversarial-prompting enforces breadth of findings. Together
 * they address self-evaluation bias AND scale drift.
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const EVALUATOR_CALIBRATION_PATH_ENV = "GORDON_EVALUATOR_CALIBRATION_PATH";

export interface CalibrationExample {
  id: string;
  /** One-line description (used to pick relevant examples). */
  description: string;
  /** Short summary of the input being scored. */
  inputSummary: string;
  /** Gold-standard dimension → score map. */
  expectedScores: Record<string, number>;
  /** One-paragraph rationale that explains the gold scores. */
  rationale: string;
  /** Optional tags for relevance filtering (e.g. "venue:binance", "strategy:momentum"). */
  tags?: string[];
  /** ISO timestamp the example was registered. */
  registeredAt: string;
}

export interface DriftDimension {
  dimension: string;
  expected: number;
  observed: number;
  drift: number;
  withinTolerance: boolean;
}

export interface DriftReport {
  exampleId: string;
  tolerance: number;
  dimensions: DriftDimension[];
  maxDrift: number;
  totalDrift: number;
  hasDrift: boolean;
}

export function defaultEvaluatorCalibrationPath(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env[EVALUATOR_CALIBRATION_PATH_ENV] ?? join(homedir(), ".gordon", "evaluator-calibration.jsonl")
  );
}

function ensureParentDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ============================================================================
// Persistence
// ============================================================================

export function registerCalibrationExample(
  example: Omit<CalibrationExample, "registeredAt">,
  opts: { now?: string; path?: string } = {},
): CalibrationExample {
  const full: CalibrationExample = {
    ...example,
    registeredAt: opts.now ?? new Date().toISOString(),
  };
  const target = opts.path ?? defaultEvaluatorCalibrationPath();
  ensureParentDir(target);
  appendFileSync(target, `${JSON.stringify(full)}\n`, "utf8");
  return full;
}

export function loadCalibrationSet(path?: string): CalibrationExample[] {
  const target = path ?? defaultEvaluatorCalibrationPath();
  if (!existsSync(target)) return [];
  const lines = readFileSync(target, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  const out: CalibrationExample[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as CalibrationExample;
      if (typeof parsed.id === "string" && typeof parsed.description === "string") {
        out.push(parsed);
      }
    } catch {
      // skip malformed lines
    }
  }
  return out;
}

// ============================================================================
// Selection — pick relevant examples for the current input
// ============================================================================

export interface SelectExamplesInput {
  tags?: string[];
  /** Substrings the description or inputSummary should match (any-of). */
  keywords?: string[];
  /** Max examples to return. Default 3. */
  k?: number;
}

/**
 * Pick the K most-relevant calibration examples. Relevance scoring:
 *   +2 per overlapping tag
 *   +1 per keyword that appears in description or inputSummary
 * Returns top-K by score (ties broken by recency).
 */
export function selectRelevantExamples(
  pool: readonly CalibrationExample[],
  input: SelectExamplesInput,
): CalibrationExample[] {
  const tagSet = new Set(input.tags ?? []);
  const kws = (input.keywords ?? []).map((k) => k.toLowerCase());
  const k = input.k ?? 3;

  const scored = pool.map((e) => {
    let score = 0;
    if (e.tags) {
      for (const t of e.tags) if (tagSet.has(t)) score += 2;
    }
    const hay = `${e.description} ${e.inputSummary}`.toLowerCase();
    for (const w of kws) if (hay.includes(w)) score += 1;
    return { e, score };
  });

  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return b.e.registeredAt.localeCompare(a.e.registeredAt);
  });

  // Drop zero-score entries when ANY relevance criteria were given.
  const anyCriteria = tagSet.size > 0 || kws.length > 0;
  const filtered = anyCriteria ? scored.filter((s) => s.score > 0) : scored;
  return filtered.slice(0, k).map((s) => s.e);
}

// ============================================================================
// Prompt block
// ============================================================================

/**
 * Format selected examples as a prompt block ready to splice into an
 * evaluator system prompt. Renders each example as:
 *
 *   ## Example {id} — {description}
 *   Input: {inputSummary}
 *   Expected scores: dim1=X, dim2=Y
 *   Rationale: {rationale}
 */
export function buildCalibrationBlock(examples: readonly CalibrationExample[]): string {
  if (examples.length === 0) return "";
  const lines: string[] = [];
  lines.push("CALIBRATION EXAMPLES (anchor your scoring to these gold standards):");
  for (const e of examples) {
    lines.push("");
    lines.push(`## Example ${e.id} — ${e.description}`);
    lines.push(`Input: ${e.inputSummary}`);
    const scoreStr = Object.entries(e.expectedScores)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    lines.push(`Expected scores: ${scoreStr}`);
    lines.push(`Rationale: ${e.rationale}`);
  }
  return lines.join("\n");
}

// ============================================================================
// Drift detection
// ============================================================================

export function detectDrift(
  observed: Record<string, number>,
  example: CalibrationExample,
  tolerance: number = 0.5,
): DriftReport {
  const dims: DriftDimension[] = [];
  for (const [dimension, expected] of Object.entries(example.expectedScores)) {
    const obs = observed[dimension];
    if (obs === undefined) continue;
    const drift = Math.abs(obs - expected);
    dims.push({
      dimension,
      expected,
      observed: obs,
      drift,
      withinTolerance: drift <= tolerance,
    });
  }
  const maxDrift = dims.reduce((m, d) => Math.max(m, d.drift), 0);
  const totalDrift = dims.reduce((s, d) => s + d.drift, 0);
  const hasDrift = dims.some((d) => !d.withinTolerance);
  return {
    exampleId: example.id,
    tolerance,
    dimensions: dims,
    maxDrift,
    totalDrift,
    hasDrift,
  };
}

export function formatDriftReport(report: DriftReport): string {
  const lines: string[] = [];
  lines.push(
    `Calibration drift for ${report.exampleId}: max=${report.maxDrift.toFixed(2)}, total=${report.totalDrift.toFixed(2)} (tolerance ${report.tolerance})`,
  );
  for (const d of report.dimensions) {
    const flag = d.withinTolerance ? "✓" : "DRIFT";
    lines.push(
      `  ${flag} ${d.dimension}: expected=${d.expected}, observed=${d.observed}, drift=${d.drift.toFixed(2)}`,
    );
  }
  return lines.join("\n");
}

export function driftToPayload(report: DriftReport): Record<string, unknown> {
  return {
    kind: "evaluator_calibration.drift_recorded",
    exampleId: report.exampleId,
    tolerance: report.tolerance,
    maxDrift: report.maxDrift,
    totalDrift: report.totalDrift,
    hasDrift: report.hasDrift,
    drifters: report.dimensions
      .filter((d) => !d.withinTolerance)
      .map((d) => ({ dimension: d.dimension, expected: d.expected, observed: d.observed })),
  };
}
