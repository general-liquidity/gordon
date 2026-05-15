/**
 * Error-Only Output Filter (GORDON_ERROR_ONLY_FILTER).
 *
 * Port of the back-pressure pattern from HumanLayer's "Skill Issue:
 * Harness Engineering for Coding Agents" (2026). The failure mode they
 * name explicitly:
 *
 *   "Running full test suite surfaced 4,000+ lines of passing tests,
 *    flooding context and causing agent to hallucinate."
 *
 * Their fix: "swallow success output; surface only errors." Done well,
 * a tool that runs 5,000 lines of green-checkmark output returns nothing
 * to the agent's context; the same tool on a failed run surfaces only
 * the error lines + a small ring of surrounding context.
 *
 * Gordon already has output filtering for market-data tools
 * (`GORDON_TOOL_OUTPUT_FILTERS`), but that filter is semantic-compression
 * for noisy market data. This module is the trading-domain analog of
 * HumanLayer's pattern: line-level success/error classification for
 * any tool output (verification scripts, broker logs, paper-mode
 * sessions, reconciliation reports).
 *
 * The filter is rule-based: callers can supply `FilterRule`s, or use
 * `DEFAULT_ERROR_PATTERNS` which covers common shapes (Error/FAIL/✗,
 * stack-trace lines, broker reject messages). Surface rules win over
 * suppress rules when both match the same line.
 *
 * `filterOutput` also supports context-line preservation — keep N lines
 * around each surfaced line so error messages don't lose their preceding
 * "What was being attempted?" context.
 */

export const ERROR_ONLY_FILTER_FLAG_ENV = "GORDON_ERROR_ONLY_FILTER";

export type FilterAction = "surface" | "suppress";

export interface FilterRule {
  /** Human-readable identifier (for diagnostics). */
  id: string;
  pattern: RegExp;
  action: FilterAction;
  /** Higher priority wins when multiple rules match the same line. */
  priority: number;
}

export interface FilterOptions {
  rules?: readonly FilterRule[];
  /**
   * Lines that match no rule. "surface" keeps them; "suppress" drops
   * them. Default "suppress" — only explicit error lines + their context
   * survive.
   */
  defaultAction?: FilterAction;
  /** Keep N lines BEFORE each surfaced line for context. Default 1. */
  contextBefore?: number;
  /** Keep N lines AFTER each surfaced line for context. Default 0. */
  contextAfter?: number;
  /** Maximum total output lines. Default Infinity. */
  maxLines?: number;
}

export interface FilterResult {
  /** Lines that survived filtering, in original order. */
  surfaced: string[];
  /** Lines that were suppressed (count only — content is dropped). */
  suppressedCount: number;
  /** Total input lines. */
  totalLines: number;
  /** Reconstructed output (surfaced lines joined with \n). */
  filteredOutput: string;
  /** filteredOutput.length / input.length, 0..1. */
  compressionRatio: number;
  /**
   * True if at least one surface rule fired. Useful as a quick
   * "did anything go wrong?" check.
   */
  hasErrors: boolean;
}

export const DEFAULT_ERROR_PATTERNS: readonly FilterRule[] = [
  // === Surface (errors) ===
  {
    id: "explicit_error_keyword",
    pattern: /\b(?:error|fail|failed|exception|fatal|panic)\b/i,
    action: "surface",
    priority: 100,
  },
  {
    id: "broker_reject_keywords",
    pattern: /\b(?:reject|rejected|denied|cancel(?:l)?ed|insufficient|timeout|unauthorized|forbidden)\b/i,
    action: "surface",
    priority: 90,
  },
  {
    id: "failure_marker_glyph",
    pattern: /(?:^|\s)(?:✗|❌|⚠|×)\s/,
    action: "surface",
    priority: 95,
  },
  {
    id: "stack_trace_frame",
    pattern: /^\s*at\s+[\w.$<>]+(?:\s+\([^)]*\))?$/,
    action: "surface",
    priority: 85,
  },
  {
    id: "exception_class",
    pattern: /\b\w*(?:Error|Exception)(?::|\s)/,
    action: "surface",
    priority: 95,
  },

  // === Suppress (known success) ===
  {
    id: "explicit_success_keyword",
    pattern: /\b(?:passed|passing|ok|success(?:ful)?)\b/i,
    action: "suppress",
    priority: 50,
  },
  {
    id: "success_marker_glyph",
    pattern: /(?:^|\s)(?:✓|✔|✅)\s/,
    action: "suppress",
    priority: 50,
  },
  {
    id: "test_summary_passing",
    pattern: /^\s*\d+\s+pass(?:ing)?\b/i,
    action: "suppress",
    priority: 40,
  },
];

export function isErrorOnlyFilterEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env[ERROR_ONLY_FILTER_FLAG_ENV] === "1" ||
    env[ERROR_ONLY_FILTER_FLAG_ENV] === "true"
  );
}

interface LineDecision {
  line: string;
  action: FilterAction;
  ruleId: string | null;
  /** True if surfaced *because* a context window included it. */
  surfacedByContext: boolean;
}

function classifyLine(
  line: string,
  rules: readonly FilterRule[],
  defaultAction: FilterAction,
): LineDecision {
  let chosen: { rule: FilterRule; priority: number } | null = null;
  for (const rule of rules) {
    if (chosen && rule.priority <= chosen.priority) continue;
    if (rule.pattern.test(line)) {
      if (!chosen || rule.priority > chosen.priority) {
        chosen = { rule, priority: rule.priority };
      }
    }
  }
  if (chosen) {
    return {
      line,
      action: chosen.rule.action,
      ruleId: chosen.rule.id,
      surfacedByContext: false,
    };
  }
  return { line, action: defaultAction, ruleId: null, surfacedByContext: false };
}

/**
 * Filter `output` so only lines matching a `surface` rule (plus their
 * context window) are returned. Pure function — same input → same
 * output. No I/O.
 */
export function filterOutput(output: string, opts: FilterOptions = {}): FilterResult {
  const rules = opts.rules ?? DEFAULT_ERROR_PATTERNS;
  const defaultAction = opts.defaultAction ?? "suppress";
  const contextBefore = Math.max(0, opts.contextBefore ?? 1);
  const contextAfter = Math.max(0, opts.contextAfter ?? 0);
  const maxLines = opts.maxLines ?? Infinity;

  const lines = output.split(/\r?\n/);
  const totalLines = lines.length;

  // First pass: classify each line.
  const decisions: LineDecision[] = lines.map((l) => classifyLine(l, rules, defaultAction));

  // Second pass: expand surface decisions with context windows.
  const keepFlags = new Array<boolean>(decisions.length).fill(false);
  let hasErrors = false;
  for (let i = 0; i < decisions.length; i++) {
    if (decisions[i]!.action === "surface") {
      if (decisions[i]!.ruleId !== null) hasErrors = true;
      keepFlags[i] = true;
      for (let b = 1; b <= contextBefore; b++) {
        if (i - b >= 0) keepFlags[i - b] = true;
      }
      for (let a = 1; a <= contextAfter; a++) {
        if (i + a < decisions.length) keepFlags[i + a] = true;
      }
    }
  }

  // Third pass: collect surfaced lines, respecting maxLines cap.
  const surfaced: string[] = [];
  let suppressedCount = 0;
  for (let i = 0; i < decisions.length; i++) {
    if (keepFlags[i] && surfaced.length < maxLines) {
      surfaced.push(decisions[i]!.line);
    } else {
      suppressedCount++;
    }
  }

  const filteredOutput = surfaced.join("\n");
  const compressionRatio = output.length === 0 ? 0 : filteredOutput.length / output.length;

  return {
    surfaced,
    suppressedCount,
    totalLines,
    filteredOutput,
    compressionRatio,
    hasErrors,
  };
}

/**
 * Convenience wrapper: returns just the filtered text, with a 1-line
 * suffix when content was suppressed. Use this when you want a
 * drop-in replacement for raw tool output going to the agent.
 */
export function filterOutputForAgent(output: string, opts: FilterOptions = {}): string {
  const result = filterOutput(output, opts);
  if (result.suppressedCount === 0) return result.filteredOutput;
  if (!result.hasErrors) {
    // All-success run — collapse to a single OK line.
    return `(all ${result.totalLines} lines suppressed — no errors detected)`;
  }
  return `${result.filteredOutput}\n(${result.suppressedCount} non-error lines suppressed)`;
}

export function resultToPayload(result: FilterResult): Record<string, unknown> {
  return {
    kind: "error_only_filter.result_recorded",
    totalLines: result.totalLines,
    surfacedCount: result.surfaced.length,
    suppressedCount: result.suppressedCount,
    compressionRatio: Number(result.compressionRatio.toFixed(3)),
    hasErrors: result.hasErrors,
  };
}
