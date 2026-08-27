/**
 * Goal Mode (GORDON_GOAL_MODE).
 *
 * Trading-domain port of the `/goal` pattern that Codex, Claude Code, and
 * Hermes have all shipped in 2026. The user supplies a single line:
 *
 *   "/goal <work to do> until <measurable end state> without <constraints>"
 *
 * Gordon parses it into a structured `ParsedGoal`, tracks state across
 * autonomous-loop cycles, scores each cycle against the goal, and
 * persists progress to `~/.gordon/goal-progress.md` so a long-running
 * goal survives session restarts.
 *
 * What this primitive does:
 *   - parseGoal(text)              — text → structured objective + end state + constraints
 *   - createGoalState(text)        — fresh tracking state
 *   - scoreGoal(state, obs)        — one cycle's worth of progress
 *   - recordGoalProgress(state, s) — append the score, advance iteration
 *   - isGoalComplete(state)        — terminal? (achieved/failed/cleared/paused)
 *   - persistGoal(state)           — write progress markdown + state JSON
 *   - loadActiveGoal()             — restore from disk
 *
 * What this primitive does NOT do (deliberately):
 *   - Drive the autonomous-loop. The loop integration is a wire point;
 *     this module is pure scoring + state + persistence.
 *   - Define slash commands. The TUI wires `/goal`, `/pause`, `/goal-clear`
 *     against these functions separately.
 *   - Decide trade safety. Termination layers + risk classifier remain
 *     authoritative. Goal mode is about progress tracking, not execution
 *     permission.
 *
 * End-state vocabulary (trading-domain):
 *   - sharpe              "Sharpe >= X"
 *   - winrate             "win rate >= X%"
 *   - trades              "complete >= N successful trades"
 *   - drawdown_under      "max drawdown < X%"
 *   - time_horizon        "for N days/hours"
 *   - checklist           "complete every item in this checklist"
 *   - custom              free-form, scored manually by the operator
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { GoalRequirement } from "./goalGapFinding.ts";
import { deriveRequirements } from "./goalGapFinding.ts";
import {
  verifyCompletion,
  type CompletionVerifier,
  type CompletionVerdict,
} from "./completionVerifier.ts";

export const GOAL_MODE_FLAG_ENV = "GORDON_GOAL_MODE";
export const GOAL_STATE_PATH_ENV = "GORDON_GOAL_STATE_PATH";
export const GOAL_PROGRESS_PATH_ENV = "GORDON_GOAL_PROGRESS_PATH";

export type EndStateType =
  | "sharpe"
  | "winrate"
  | "trades"
  | "drawdown_under"
  | "time_horizon"
  | "checklist"
  | "custom";

export interface ParsedEndState {
  type: EndStateType;
  /** Numeric threshold when applicable (e.g. 1.5 for "Sharpe >= 1.5"). */
  threshold?: number;
  /** Metric name when generic (e.g. "Sharpe", "winrate"). */
  metric?: string;
  /** Items for checklist end states. */
  items?: string[];
  /** Time horizon in days for time_horizon end states. */
  timeHorizonDays?: number;
  /** Original substring from the goal text. */
  raw: string;
}

export interface ParsedGoal {
  /** Raw goal text as the user entered it. */
  raw: string;
  /** Objective clause — the "do X" part before "until". */
  objective: string;
  /** Parsed end state, or null if the goal had no measurable "until" clause. */
  endState: ParsedEndState | null;
  /** Constraint clauses — the "without X, without Y" parts. */
  constraints: string[];
}

export type GoalStatus =
  | "active"
  | "paused"
  | "achieved"
  | "achieved_with_acknowledged_gaps"
  | "failed"
  | "cleared";

export interface GoalScore {
  iteration: number;
  capturedAt: string;
  /** Heuristic progress 0..1 toward the end state. */
  progressPct: number;
  /** True when the end state's quantitative target has been hit. */
  endStateMet: boolean;
  /** True when no constraint was violated. */
  constraintsHeld: boolean;
  /** Free-form rationale for the score; surfaced in the markdown log. */
  rationale: string;
  /** Optional observation payload (raw metric values). */
  observations?: Record<string, number | string | boolean | null>;
}

export interface GoalState {
  /** Auto-generated id (timestamp + random suffix). */
  id: string;
  parsedGoal: ParsedGoal;
  startedAt: string;
  /** Cycles run since the goal started. */
  iterations: number;
  status: GoalStatus;
  lastScore: GoalScore | null;
  /** Free-form notes the operator (or agent) appended. */
  notes: string[];
  /**
   * Requirements sealed as explicitly-acknowledged gaps (C1). Set only when a
   * goal terminates as `achieved_with_acknowledged_gaps` — an honest seal of
   * what was left unmet, instead of a clean `achieved` or a silent cancel.
   */
  acknowledgedGaps?: GoalRequirement[];
}

export interface GoalObservation {
  /** Current annualized Sharpe (if known). */
  sharpe?: number;
  /** Current win rate as a fraction 0..1. */
  winRate?: number;
  /** Number of completed trades since the goal started. */
  trades?: number;
  /** Current max drawdown as a positive fraction (0.10 = 10% drawdown). */
  maxDrawdown?: number;
  /** Hours elapsed since the goal started. */
  elapsedHours?: number;
  /** Boolean array aligned to ParsedEndState.items for checklist goals. */
  checklistChecks?: boolean[];
  /** Constraint violations observed this cycle; empty = clean. */
  constraintViolations?: string[];
  /** Optional free-form rationale override. */
  rationale?: string;
}

export function isGoalModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[GOAL_MODE_FLAG_ENV] === "1" || env[GOAL_MODE_FLAG_ENV] === "true";
}

export function defaultGoalStatePath(env: NodeJS.ProcessEnv = process.env): string {
  return env[GOAL_STATE_PATH_ENV] ?? join(homedir(), ".gordon", "goal-state.json");
}

export function defaultGoalProgressPath(env: NodeJS.ProcessEnv = process.env): string {
  return env[GOAL_PROGRESS_PATH_ENV] ?? join(homedir(), ".gordon", "goal-progress.md");
}

function ensureParentDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ============================================================================
// Parsing
// ============================================================================

const END_STATE_PATTERNS: Array<{
  re: RegExp;
  build: (m: RegExpMatchArray) => ParsedEndState;
}> = [
  {
    re: /\b(?:sharpe(?:\s+ratio)?)\s*(?:>=?|of\s+at\s+least|>)\s*(-?\d+(?:\.\d+)?)/i,
    build: (m) => ({ type: "sharpe", threshold: Number(m[1]), metric: "sharpe", raw: m[0] }),
  },
  {
    re: /\b(?:win\s*rate|hit\s*rate)\s*(?:>=?|of\s+at\s+least|>)\s*(\d+(?:\.\d+)?)\s*%?/i,
    build: (m) => ({
      type: "winrate",
      threshold: Number(m[1]) > 1 ? Number(m[1]) / 100 : Number(m[1]),
      metric: "winRate",
      raw: m[0],
    }),
  },
  {
    re: /\bmax\s*drawdown\s*(?:<=?|under|below|of\s+at\s+most|<)\s*(\d+(?:\.\d+)?)\s*%?/i,
    build: (m) => ({
      type: "drawdown_under",
      threshold: Number(m[1]) > 1 ? Number(m[1]) / 100 : Number(m[1]),
      metric: "maxDrawdown",
      raw: m[0],
    }),
  },
  {
    re: /\b(?:complete|run|execute|finish)\s+(\d+)\s+(?:successful\s+)?trades?/i,
    build: (m) => ({ type: "trades", threshold: Number(m[1]), metric: "trades", raw: m[0] }),
  },
  {
    re: /\bfor\s+(\d+)\s+days?\b/i,
    build: (m) => ({
      type: "time_horizon",
      timeHorizonDays: Number(m[1]),
      threshold: Number(m[1]) * 24,
      metric: "elapsedHours",
      raw: m[0],
    }),
  },
  {
    re: /\bfor\s+(\d+)\s+hours?\b/i,
    build: (m) => ({
      type: "time_horizon",
      timeHorizonDays: Number(m[1]) / 24,
      threshold: Number(m[1]),
      metric: "elapsedHours",
      raw: m[0],
    }),
  },
  {
    re: /\bevery\s+item\s+in\s+(?:the\s+)?checklist/i,
    build: (m) => ({ type: "checklist", raw: m[0] }),
  },
];

/**
 * Parse a /goal text into structured parts. Tolerant: returns sensible
 * defaults when "until" or "without" clauses are missing.
 *
 *   "/goal X until Y without Z"
 *   "/goal X until Y, without A, without B"
 *   "/goal X" → objective only
 *
 * Strips a leading "/goal " if present.
 */
export function parseGoal(raw: string): ParsedGoal {
  const trimmed = raw
    .trim()
    .replace(/^\/goal\s+/i, "")
    .trim();

  // Constraints: split on each "without ..." clause, plus comma-separated extras.
  const withoutMatch = trimmed.match(/\bwithout\b/i);
  let beforeWithout = trimmed;
  const constraints: string[] = [];
  if (withoutMatch) {
    beforeWithout = trimmed.slice(0, withoutMatch.index).trim();
    const rest = trimmed.slice(withoutMatch.index!).trim();
    // Split on "without" then on commas inside each segment.
    const segments = rest
      .split(/\bwithout\b/i)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const seg of segments) {
      for (const part of seg
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean)) {
        constraints.push(part);
      }
    }
  }

  // End state: take the "until ..." clause if present.
  let objective = beforeWithout;
  let endState: ParsedEndState | null = null;
  const untilMatch = beforeWithout.match(/\buntil\b/i);
  if (untilMatch) {
    objective = beforeWithout.slice(0, untilMatch.index).trim();
    const untilClause = beforeWithout.slice(untilMatch.index! + "until".length).trim();
    endState = parseEndState(untilClause);
  }

  return { raw, objective, endState, constraints };
}

function parseEndState(clause: string): ParsedEndState {
  for (const { re, build } of END_STATE_PATTERNS) {
    const m = clause.match(re);
    if (m) return build(m);
  }
  return { type: "custom", raw: clause };
}

// ============================================================================
// Scoring
// ============================================================================

/**
 * Score one cycle of progress against the goal. Returns endStateMet=true
 * iff the quantitative target has been hit AND no constraints were
 * violated this cycle.
 */
export function scoreGoal(
  goal: ParsedGoal,
  obs: GoalObservation,
  iteration: number,
  now?: string,
): GoalScore {
  const constraintsHeld = (obs.constraintViolations ?? []).length === 0;
  const score: GoalScore = {
    iteration,
    capturedAt: now ?? new Date().toISOString(),
    progressPct: 0,
    endStateMet: false,
    constraintsHeld,
    rationale: obs.rationale ?? "",
    observations: extractObservations(obs),
  };

  if (!goal.endState) {
    // No quantitative end state — operator scores manually via notes.
    score.progressPct = 0;
    score.rationale ||= "no end state defined; operator scoring required";
    return score;
  }

  const es = goal.endState;
  switch (es.type) {
    case "sharpe": {
      const current = obs.sharpe ?? null;
      if (current === null || es.threshold === undefined) {
        score.rationale ||= "sharpe not observed this cycle";
        break;
      }
      score.progressPct = clamp01(current / es.threshold);
      score.endStateMet = current >= es.threshold;
      score.rationale ||= `Sharpe ${current.toFixed(2)} vs target ${es.threshold}`;
      break;
    }
    case "winrate": {
      const current = obs.winRate ?? null;
      if (current === null || es.threshold === undefined) break;
      score.progressPct = clamp01(current / es.threshold);
      score.endStateMet = current >= es.threshold;
      score.rationale ||= `Win rate ${(current * 100).toFixed(1)}% vs target ${(es.threshold * 100).toFixed(0)}%`;
      break;
    }
    case "trades": {
      const current = obs.trades ?? null;
      if (current === null || es.threshold === undefined) break;
      score.progressPct = clamp01(current / es.threshold);
      score.endStateMet = current >= es.threshold;
      score.rationale ||= `${current}/${es.threshold} trades complete`;
      break;
    }
    case "drawdown_under": {
      const current = obs.maxDrawdown ?? null;
      if (current === null || es.threshold === undefined) break;
      // Drawdown is the OPPOSITE direction: smaller is better.
      // Progress = 1 when current is well below target, 0 when at/above target.
      score.progressPct = current >= es.threshold ? 0 : clamp01(1 - current / es.threshold);
      score.endStateMet = current < es.threshold;
      score.rationale ||= `Drawdown ${(current * 100).toFixed(1)}% vs cap ${(es.threshold * 100).toFixed(0)}%`;
      break;
    }
    case "time_horizon": {
      const current = obs.elapsedHours ?? null;
      if (current === null || es.threshold === undefined) break;
      score.progressPct = clamp01(current / es.threshold);
      score.endStateMet = current >= es.threshold;
      score.rationale ||= `${current.toFixed(1)}h / ${es.threshold}h`;
      break;
    }
    case "checklist": {
      const checks = obs.checklistChecks ?? [];
      const total = es.items?.length ?? checks.length;
      if (total === 0) break;
      const done = checks.filter(Boolean).length;
      score.progressPct = clamp01(done / total);
      score.endStateMet = done === total;
      score.rationale ||= `${done}/${total} checklist items`;
      break;
    }
    case "custom": {
      score.rationale ||= "custom end state; manual scoring required";
      break;
    }
  }

  // A goal cannot be "met" while constraints are being broken.
  if (!constraintsHeld) {
    score.endStateMet = false;
    score.rationale +=
      (score.rationale ? "; " : "") +
      `constraint violations: ${(obs.constraintViolations ?? []).join(", ")}`;
  }

  return score;
}

function extractObservations(
  obs: GoalObservation,
): Record<string, number | string | boolean | null> {
  const out: Record<string, number | string | boolean | null> = {};
  if (obs.sharpe !== undefined) out.sharpe = obs.sharpe;
  if (obs.winRate !== undefined) out.winRate = obs.winRate;
  if (obs.trades !== undefined) out.trades = obs.trades;
  if (obs.maxDrawdown !== undefined) out.maxDrawdown = obs.maxDrawdown;
  if (obs.elapsedHours !== undefined) out.elapsedHours = obs.elapsedHours;
  if (obs.checklistChecks !== undefined)
    out.checklistDone = obs.checklistChecks.filter(Boolean).length;
  if (obs.constraintViolations !== undefined) out.violations = obs.constraintViolations.length;
  return out;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

// ============================================================================
// State lifecycle
// ============================================================================

let _idCounter = 0;
function nextGoalId(): string {
  _idCounter += 1;
  return `g${Date.now().toString(36)}-${_idCounter.toString(36)}`;
}

export function resetGoalIdCounterForTesting(): void {
  _idCounter = 0;
}

export function createGoalState(text: string, now?: string): GoalState {
  return {
    id: nextGoalId(),
    parsedGoal: parseGoal(text),
    startedAt: now ?? new Date().toISOString(),
    iterations: 0,
    status: "active",
    lastScore: null,
    notes: [],
  };
}

/**
 * Record a score and increment the iteration counter. Returns a NEW state
 * object — input is not mutated.
 *
 * A1: this NO LONGER seals `achieved` on the self-score alone. Meeting the
 * self-scored end state makes a goal a *completion candidate*, not done — the
 * seal is gated on an independent verifier via {@link finalizeGoalCompletion}.
 * Self-report is necessary but not sufficient for completion.
 */
export function recordGoalProgress(state: GoalState, score: GoalScore): GoalState {
  return {
    ...state,
    iterations: state.iterations + 1,
    lastScore: score,
  };
}

/**
 * True when the self-score proposes completion (end state met + constraints
 * held). This is the completion *candidate* signal — it must still clear the
 * verifier gate before the goal is sealed `achieved`.
 */
export function isCompletionCandidate(score: GoalScore): boolean {
  return score.endStateMet && score.constraintsHeld;
}

export interface FinalizeCompletionResult {
  /** Possibly-sealed state. `achieved` only when the verifier confirmed. */
  state: GoalState;
  /** The requirement set derived this cycle (A2). */
  requirements: GoalRequirement[];
  /** The unmet subset. */
  unmet: GoalRequirement[];
  /** The verifier verdict, or null when the self-score did not even propose completion. */
  verdict: CompletionVerdict | null;
  /** True when the goal was sealed `achieved` this call. */
  sealed: boolean;
  /**
   * True when the self-score proposed completion but the verifier refused to
   * confirm — a premature completion was blocked and the loop should continue.
   */
  blockedPrematureCompletion: boolean;
}

/**
 * A1 + A2: the single place `achieved` is sealed. Re-derives the
 * unmet-requirement set for this cycle (A2), then consults an INDEPENDENT
 * completion verifier (A1). Only seals `achieved` when the self-score proposes
 * completion AND the verifier confirms. Otherwise leaves the goal `active`
 * (unless it was already terminal via another path) so the loop keeps working.
 *
 * Additive: this only adds a stop condition before `achieved`; it never
 * seals a goal the self-score did not already propose as complete.
 */
export async function finalizeGoalCompletion(
  state: GoalState,
  score: GoalScore,
  observation: GoalObservation,
  verifier: CompletionVerifier,
  cycle: number,
): Promise<FinalizeCompletionResult> {
  const requirements = deriveRequirements(state.parsedGoal, observation, score);
  const unmet = requirements.filter((r) => !r.met);

  if (!isCompletionCandidate(score)) {
    return {
      state,
      requirements,
      unmet,
      verdict: null,
      sealed: false,
      blockedPrematureCompletion: false,
    };
  }

  const verdict = await verifyCompletion(verifier, {
    goal: state.parsedGoal,
    score,
    observation,
    requirements,
    cycle,
  });

  if (verdict.confirmed) {
    const sealedState: GoalState = {
      ...state,
      status: "achieved",
      notes: [...state.notes, `completion verified by ${verdict.verifierId}: ${verdict.rationale}`],
    };
    return {
      state: sealedState,
      requirements,
      unmet,
      verdict,
      sealed: true,
      blockedPrematureCompletion: false,
    };
  }

  const blockedState: GoalState = {
    ...state,
    notes: [
      ...state.notes,
      `self-scored completion blocked by ${verdict.verifierId}: ${verdict.rationale}`,
    ],
  };
  return {
    state: blockedState,
    requirements,
    unmet,
    verdict,
    sealed: false,
    blockedPrematureCompletion: true,
  };
}

/**
 * C1: seal a goal that is stopping with KNOWN unmet requirements as
 * `achieved_with_acknowledged_gaps` — an honest terminal state that records
 * exactly what was left outstanding, instead of a clean `achieved` or a silent
 * cancel. Used when the loop halts for another reason (stall / budget / mandate)
 * while requirements remain open.
 */
export function sealAcknowledgedGaps(
  state: GoalState,
  unmet: GoalRequirement[],
  reason: string,
): GoalState {
  return {
    ...state,
    status: "achieved_with_acknowledged_gaps",
    acknowledgedGaps: unmet,
    notes: [
      ...state.notes,
      `sealed with ${unmet.length} acknowledged gap(s) (${reason}): ${unmet.map((r) => r.id).join(", ") || "none"}`,
    ],
  };
}

export function pauseGoal(state: GoalState): GoalState {
  if (state.status !== "active") return state;
  return { ...state, status: "paused" };
}

export function resumeGoal(state: GoalState): GoalState {
  if (state.status !== "paused") return state;
  return { ...state, status: "active" };
}

export function clearGoal(state: GoalState): GoalState {
  return { ...state, status: "cleared" };
}

export function failGoal(state: GoalState, reason: string): GoalState {
  return { ...state, status: "failed", notes: [...state.notes, `failed: ${reason}`] };
}

export function isGoalComplete(state: GoalState): boolean {
  return (
    state.status === "achieved" ||
    state.status === "achieved_with_acknowledged_gaps" ||
    state.status === "failed" ||
    state.status === "cleared"
  );
}

export function appendGoalNote(state: GoalState, note: string): GoalState {
  return { ...state, notes: [...state.notes, note] };
}

// ============================================================================
// Persistence
// ============================================================================

/**
 * Write the full goal state as JSON. Atomic-ish: writes then renames.
 * The companion markdown progress file is written by `appendProgressLog`.
 */
export function persistGoalState(state: GoalState, path?: string): void {
  const target = path ?? defaultGoalStatePath();
  ensureParentDir(target);
  writeFileSync(target, JSON.stringify(state, null, 2), "utf8");
}

export function loadActiveGoal(path?: string): GoalState | null {
  const target = path ?? defaultGoalStatePath();
  if (!existsSync(target)) return null;
  try {
    const parsed = JSON.parse(readFileSync(target, "utf8")) as GoalState;
    if (typeof parsed.id !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Append a markdown entry for this iteration to the progress log.
 * Format mirrors the Codex EXPERIMENTS.md pattern:
 *
 *   ## Iteration N — <ISO timestamp>
 *   - end state met: yes/no
 *   - constraints held: yes/no
 *   - progress: 45%
 *   - <rationale>
 *   - observations: { ... }
 */
export function appendProgressLog(state: GoalState, score: GoalScore, path?: string): void {
  const target = path ?? defaultGoalProgressPath();
  ensureParentDir(target);

  const header = !existsSync(target)
    ? `# Gordon goal progress\n\n` +
      `**Goal:** ${state.parsedGoal.raw}\n` +
      `**Started:** ${state.startedAt}\n` +
      `**Goal id:** ${state.id}\n\n` +
      `---\n\n`
    : "";

  const lines: string[] = [];
  lines.push(`## Iteration ${score.iteration} — ${score.capturedAt}`);
  lines.push(`- end state met: ${score.endStateMet ? "yes" : "no"}`);
  lines.push(`- constraints held: ${score.constraintsHeld ? "yes" : "no"}`);
  lines.push(`- progress: ${(score.progressPct * 100).toFixed(0)}%`);
  if (score.rationale) lines.push(`- rationale: ${score.rationale}`);
  if (score.observations && Object.keys(score.observations).length > 0) {
    lines.push(`- observations: ${JSON.stringify(score.observations)}`);
  }
  lines.push("");

  appendFileSync(target, header + lines.join("\n"), "utf8");
}

// ============================================================================
// Reporting
// ============================================================================

export function formatGoalState(state: GoalState): string {
  const lines: string[] = [];
  lines.push(`Goal ${state.id} (${state.status})`);
  lines.push(`  Started: ${state.startedAt}`);
  lines.push(`  Objective: ${state.parsedGoal.objective}`);
  if (state.parsedGoal.endState) {
    const es = state.parsedGoal.endState;
    lines.push(`  End state: ${es.type}${es.threshold !== undefined ? ` >= ${es.threshold}` : ""}`);
  } else {
    lines.push(`  End state: (none — operator scored)`);
  }
  if (state.parsedGoal.constraints.length > 0) {
    lines.push(`  Constraints: ${state.parsedGoal.constraints.join(" | ")}`);
  }
  lines.push(`  Iterations: ${state.iterations}`);
  if (state.lastScore) {
    lines.push(
      `  Last score: progress=${(state.lastScore.progressPct * 100).toFixed(0)}%, met=${state.lastScore.endStateMet}, constraints=${state.lastScore.constraintsHeld}`,
    );
  }
  return lines.join("\n");
}

export function goalStateToPayload(state: GoalState): Record<string, unknown> {
  return {
    kind: "goal.state_recorded",
    id: state.id,
    status: state.status,
    iterations: state.iterations,
    progressPct: state.lastScore?.progressPct ?? 0,
    endStateMet: state.lastScore?.endStateMet ?? false,
    constraintsHeld: state.lastScore?.constraintsHeld ?? true,
    parsedEndState: state.parsedGoal.endState?.type ?? null,
    constraintCount: state.parsedGoal.constraints.length,
    acknowledgedGapCount: state.acknowledgedGaps?.length ?? 0,
  };
}
