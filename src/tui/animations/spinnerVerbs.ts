/**
 * Customizable Spinner Verbs
 *
 * Claude Code pattern: loading states show context-aware action verbs
 * instead of generic "Loading...". Users can customize via settings.
 *
 * For Gordon: trading-specific verbs make wait states engaging and
 * informative. Different verb pools for different activities.
 */

export type SpinnerContext =
  | "thinking"
  | "scanning"
  | "analyzing"
  | "executing"
  | "fetching"
  | "backtesting"
  | "planning"
  | "monitoring"
  | "connecting"
  | "compacting"
  | "idle";

const VERB_POOLS: Record<SpinnerContext, string[]> = {
  thinking: [
    "Thinking",
    "Reasoning",
    "Considering",
    "Evaluating",
    "Deliberating",
    "Processing",
    "Reflecting",
  ],
  scanning: [
    "Scanning markets",
    "Discovering opportunities",
    "Hunting setups",
    "Screening tickers",
    "Scouting",
    "Surveying",
  ],
  analyzing: [
    "Analyzing",
    "Crunching numbers",
    "Computing indicators",
    "Running technical analysis",
    "Evaluating patterns",
    "Studying charts",
  ],
  executing: [
    "Executing trade",
    "Placing order",
    "Routing to venue",
    "Submitting",
    "Processing order",
  ],
  fetching: [
    "Fetching data",
    "Pulling market data",
    "Loading prices",
    "Querying exchange",
    "Downloading",
    "Retrieving",
  ],
  backtesting: [
    "Backtesting",
    "Simulating trades",
    "Running historical",
    "Replaying market",
    "Testing strategy",
    "Validating edge",
  ],
  planning: [
    "Building plan",
    "Sizing position",
    "Computing risk",
    "Setting levels",
    "Designing entry",
    "Crafting strategy",
  ],
  monitoring: [
    "Monitoring",
    "Watching positions",
    "Tracking P&L",
    "Checking levels",
    "Observing",
  ],
  connecting: [
    "Connecting",
    "Authenticating",
    "Establishing link",
    "Handshaking",
    "Verifying credentials",
  ],
  compacting: [
    "Compacting context",
    "Summarizing history",
    "Trimming memory",
    "Optimizing context",
  ],
  idle: [
    "Ready",
    "Waiting",
    "Standing by",
    "Listening",
  ],
};

// ── Custom verbs (user-provided) ──

let customVerbs: Partial<Record<SpinnerContext, string[]>> = {};

/**
 * Set custom verb overrides. Mode determines how they merge with defaults.
 */
export function setCustomVerbs(
  verbs: Partial<Record<SpinnerContext, string[]>>,
  mode: "replace" | "append" = "append",
): void {
  if (mode === "replace") {
    customVerbs = verbs;
  } else {
    for (const [ctx, list] of Object.entries(verbs)) {
      const key = ctx as SpinnerContext;
      customVerbs[key] = [...(customVerbs[key] ?? []), ...list];
    }
  }
}

/**
 * Get a random verb for the given context.
 */
export function getSpinnerVerb(context: SpinnerContext): string {
  const custom = customVerbs[context];
  const defaults = VERB_POOLS[context] ?? VERB_POOLS.thinking;
  const pool = custom ? [...defaults, ...custom] : defaults;
  return pool[Math.floor(Math.random() * pool.length)] ?? "Working";
}

/**
 * Get all available verbs for a context (for settings UI).
 */
export function getVerbPool(context: SpinnerContext): string[] {
  const custom = customVerbs[context] ?? [];
  const defaults = VERB_POOLS[context] ?? [];
  return [...defaults, ...custom];
}

/**
 * Map a tool name to the most appropriate spinner context.
 */
export function toolToSpinnerContext(toolName: string): SpinnerContext {
  if (toolName.startsWith("scan_") || toolName.startsWith("detect_")) return "scanning";
  if (toolName.startsWith("analyze_") || toolName.startsWith("compute_") || toolName.startsWith("explain_")) return "analyzing";
  if (toolName.startsWith("place_") || toolName.startsWith("execute_") || toolName.startsWith("cancel_")) return "executing";
  if (toolName.startsWith("get_") || toolName.startsWith("fetch_") || toolName.startsWith("load_")) return "fetching";
  if (toolName.startsWith("backtest_") || toolName.startsWith("test_strategy")) return "backtesting";
  if (toolName.startsWith("create_") && toolName.includes("plan")) return "planning";
  if (toolName.startsWith("monitor_") || toolName.startsWith("check_") || toolName.startsWith("watch_")) return "monitoring";
  if (toolName.startsWith("connect_") || toolName.startsWith("test_connection")) return "connecting";
  return "thinking";
}
