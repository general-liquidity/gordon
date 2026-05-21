/**
 * MCP tool-task support declarations.
 *
 * Slow tools (backtests, MCPT permutation tests, multi-symbol scans,
 * ACE Reflector / Curator passes, deep research) currently block the
 * MCP tool call until they complete. Editors with short request
 * timeouts (typically 30-60s) drop the connection mid-execution.
 *
 * Per the v2025-11-25 MCP spec (SEP-1686), tools can declare task
 * support via `execution.taskSupport: "required" | "optional" |
 * "forbidden"`. Editors then poll via tasks/get + tasks/result instead
 * of blocking the HTTP/stdio call. This is the right pattern for
 * Gordon's slow tools.
 *
 * Declaration philosophy:
 *
 *   - "required" — operations that take >30s often enough that a
 *     non-task call would frequently timeout (full backtests, deep
 *     parallel scans, ACE Reflector/Curator)
 *   - "optional" — operations that can take 5-30s; editors with longer
 *     timeouts handle them direct, others can opt into async
 *     (single-symbol scans, MCPT for small N, get_candles with large
 *     limits)
 *   - default ("forbidden" / unset) — everything else: trade execution
 *     (must be synchronous so the operator sees the verdict in the
 *     same turn), price reads, account queries, etc.
 *
 * Safety-critical execution stays synchronous regardless: deferring
 * `execute_plan` or `place_market_order` to a background task is the
 * wrong shape — the operator needs the outcome attested in the same
 * agent turn the trade was authorized in.
 */

/**
 * The MCP SDK v0.x typed `ToolAnnotations` doesn't yet expose the
 * `execution` field that the v2025-11-25 spec adds for task support.
 * We model the right wire shape locally and write it as a top-level
 * config field via a registration-time cast in exposeServer.ts; the
 * SDK serializes unknown keys passthrough on the JSON-RPC envelope.
 */
export interface TaskExecutionAnnotation {
  execution: {
    taskSupport: "required" | "optional" | "forbidden";
  };
}

/**
 * Tools that take long enough to need task support in MCP mode.
 *
 * Match against the tool id (Gordon's internal name). Exact-match
 * preferred; substring matches kept narrow so we don't accidentally
 * flag adjacent tools.
 */
const REQUIRED_TASK_TOOLS = new Set<string>([
  "run_backtest",
  "run_full_backtest",
  "backtest_strategy",
  "run_mcpt",
  "monte_carlo_permutation_test",
  "ace_reflector_pass",
  "ace_curator_pass",
  "deep_research",
  "scan_market_full",
  "parallel_analysis_run",
  "pair_analysis_run",
  "cross_correlation_compute",
]);

const OPTIONAL_TASK_TOOLS = new Set<string>([
  "scan_market",
  "get_top_movers",
  "find_setups",
  "analyze_pair",
  "evaluate_strategy",
  "get_candles", // optional because large-limit pulls can stretch
  "get_orderbook", // optional for deep orderbooks
  "fetch_funding_history",
  "fetch_funding_rates",
  "fetch_positions",
]);

/**
 * Resolve the task-support level for a given tool id. Defaults to
 * undefined (no declaration → tool runs synchronously per MCP default).
 */
export function resolveTaskSupport(toolId: string): "required" | "optional" | undefined {
  if (REQUIRED_TASK_TOOLS.has(toolId)) return "required";
  if (OPTIONAL_TASK_TOOLS.has(toolId)) return "optional";
  return undefined;
}

/**
 * Build the ToolAnnotations bag for a tool registration that includes
 * task support when applicable. Returns undefined when no annotations
 * apply (lets callers skip the param entirely).
 */
export function buildTaskAnnotations(toolId: string): TaskExecutionAnnotation | undefined {
  const taskSupport = resolveTaskSupport(toolId);
  if (!taskSupport) return undefined;
  return {
    execution: {
      taskSupport,
    },
  };
}

/**
 * Diagnostic helper — returns the full slow-tool sets so operators or
 * tests can verify coverage.
 */
export function getTaskToolSets(): {
  required: string[];
  optional: string[];
} {
  return {
    required: [...REQUIRED_TASK_TOOLS].sort(),
    optional: [...OPTIONAL_TASK_TOOLS].sort(),
  };
}
