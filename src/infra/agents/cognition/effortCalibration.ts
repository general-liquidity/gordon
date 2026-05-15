/**
 * Effort Calibration (GORDON_EFFORT_CALIBRATION).
 *
 * Port of the "scaling rules calibrating effort to query complexity" pattern
 * from Anthropic's "How we built our multi-agent research system" (2026).
 * Anthropic identified over-parallelization as a real failure mode — early
 * agents spawning 50 subagents for trivial queries. Their fix: embed
 * effort-calibration rules in the lead agent's prompt.
 *
 * This primitive provides:
 *
 *   1. `classifyComplexity(hints)` — heuristic mapping from task signals
 *      to a `ComplexityLevel`. Lightweight; runs before the LLM gets the
 *      task so the LLM sees a budget appropriate to the complexity.
 *   2. `budgetFor(level)` — concrete budgets (tokens, subagent fanout,
 *      tool calls, reasoning depth) per complexity tier.
 *   3. `buildCalibrationBlock(level, taskType?)` — formatted prompt
 *      block ready to splice into a subagent's system prompt. Tells the
 *      subagent how much effort to expend.
 *
 * The primitive does NOT enforce the budget — it injects guidance into
 * the prompt. Pair with `runtimeHarness.ts`'s doom-loop detection +
 * `wipLimit.ts` for hard enforcement. Calibration is the *cheap* lever;
 * enforcement is the *expensive* one. Use both.
 */

export const EFFORT_CALIBRATION_FLAG_ENV = "GORDON_EFFORT_CALIBRATION";

export type ComplexityLevel = "trivial" | "normal" | "deep";
export type ReasoningDepth = "shallow" | "medium" | "high";

export interface ComplexityHints {
  /** Task description (used for keyword classification). */
  task?: string;
  /** Explicit hint from the caller (overrides heuristic). */
  level?: ComplexityLevel;
  /** Number of symbols / venues / instruments the task touches. */
  fanout?: number;
  /** Is this a routing/dispatch decision (most are trivial)? */
  isRouting?: boolean;
  /** Does the task require multi-step reasoning? */
  isMultiStep?: boolean;
  /** Does the task involve real-time / market-moving stakes? */
  isLiveExecution?: boolean;
}

export interface EffortBudget {
  level: ComplexityLevel;
  /** Approximate token budget for this task (subagent inputs + outputs). */
  maxTokens: number;
  /** Max subagent fanout (Anthropic's "50 subagents" failure mode). */
  maxSubagentFanout: number;
  /** Max tool calls before the subagent should report back. */
  maxToolCalls: number;
  reasoningDepth: ReasoningDepth;
  /** Human-readable budget rationale. */
  rationale: string;
}

const TRIVIAL_KEYWORDS = [
  "route",
  "dispatch",
  "list",
  "show",
  "fetch",
  "lookup",
  "what is",
  "current price",
  "current value",
];

const DEEP_KEYWORDS = [
  "research",
  "compare",
  "analyze",
  "deep dive",
  "thoroughly",
  "comprehensive",
  "regime",
  "thesis",
  "multi-factor",
  "cross-correlation",
  "regression",
];

export function isEffortCalibrationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env[EFFORT_CALIBRATION_FLAG_ENV] === "1" ||
    env[EFFORT_CALIBRATION_FLAG_ENV] === "true"
  );
}

/**
 * Map task signals to a `ComplexityLevel`. Order of precedence:
 *   1. explicit `level` hint
 *   2. `isLiveExecution` → deep (real money at stake = more care)
 *   3. `isRouting` → trivial
 *   4. keyword match (deep keywords > trivial keywords)
 *   5. fanout: > 5 = deep, 0-2 = trivial, else normal
 *   6. isMultiStep → at least normal
 *   7. default: normal
 */
export function classifyComplexity(hints: ComplexityHints): ComplexityLevel {
  if (hints.level) return hints.level;
  if (hints.isLiveExecution) return "deep";
  if (hints.isRouting) return "trivial";

  const taskLower = (hints.task ?? "").toLowerCase();
  if (taskLower.length > 0) {
    if (DEEP_KEYWORDS.some((k) => taskLower.includes(k))) return "deep";
    if (TRIVIAL_KEYWORDS.some((k) => taskLower.includes(k))) return "trivial";
  }

  if (hints.fanout !== undefined) {
    if (hints.fanout > 5) return "deep";
    if (hints.fanout <= 2) return "trivial";
  }

  if (hints.isMultiStep) return "normal";

  return "normal";
}

const TRIVIAL_BUDGET: EffortBudget = {
  level: "trivial",
  maxTokens: 2_000,
  maxSubagentFanout: 0,
  maxToolCalls: 3,
  reasoningDepth: "shallow",
  rationale:
    "Trivial task — single lookup or routing. No subagents; ≤3 tool calls; minimal reasoning.",
};

const NORMAL_BUDGET: EffortBudget = {
  level: "normal",
  maxTokens: 8_000,
  maxSubagentFanout: 2,
  maxToolCalls: 10,
  reasoningDepth: "medium",
  rationale:
    "Normal task — direct analysis on a few inputs. Spawn at most 2 subagents only when independent work is genuinely parallel.",
};

const DEEP_BUDGET: EffortBudget = {
  level: "deep",
  maxTokens: 24_000,
  maxSubagentFanout: 5,
  maxToolCalls: 30,
  reasoningDepth: "high",
  rationale:
    "Deep task — research, regime analysis, or live execution. Up to 5 subagents for parallel breadth; up to 30 tool calls. Use extended thinking.",
};

export function budgetFor(level: ComplexityLevel): EffortBudget {
  switch (level) {
    case "trivial":
      return TRIVIAL_BUDGET;
    case "deep":
      return DEEP_BUDGET;
    case "normal":
    default:
      return NORMAL_BUDGET;
  }
}

/**
 * Build the calibration block as a prompt section. Splice into a
 * subagent's system prompt before the task. Anthropic's pattern:
 * lead agent decides complexity, subagent receives the budget as
 * part of its instructions.
 */
export function buildCalibrationBlock(level: ComplexityLevel, taskType?: string): string {
  const b = budgetFor(level);
  const lines: string[] = [];
  lines.push("EFFORT CALIBRATION (Anthropic multi-agent research-system pattern):");
  if (taskType) lines.push(`Task type: ${taskType}`);
  lines.push(`Complexity: ${b.level} — ${b.rationale}`);
  lines.push("");
  lines.push("Budgets (these are firm — exceed them only with explicit justification):");
  lines.push(`  - Token budget:        ~${b.maxTokens.toLocaleString()} tokens`);
  lines.push(`  - Subagent fanout:     ${b.maxSubagentFanout} subagent(s)`);
  lines.push(`  - Tool calls:          ≤ ${b.maxToolCalls}`);
  lines.push(`  - Reasoning depth:     ${b.reasoningDepth}`);
  lines.push("");
  lines.push(
    "Match effort to complexity. Over-investing on a trivial task is as bad as under-investing on a deep one.",
  );
  return lines.join("\n");
}

export function budgetToPayload(budget: EffortBudget): Record<string, unknown> {
  return {
    kind: "effort_calibration.budget_recorded",
    level: budget.level,
    maxTokens: budget.maxTokens,
    maxSubagentFanout: budget.maxSubagentFanout,
    maxToolCalls: budget.maxToolCalls,
    reasoningDepth: budget.reasoningDepth,
  };
}
