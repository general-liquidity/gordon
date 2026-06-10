/**
 * FW7 — Read-only tool filter for operator subagents.
 *
 * The dispatcher MUST NOT grant execution permissions to profile-defined
 * subagents. This module computes the intersection of (profile.tools) ∩
 * (read-only registry) and emits warnings for entries that didn't match.
 *
 * What "read-only" means here:
 *   - Anything that places, modifies, or cancels orders (execute_plan,
 *     place_*_order, cancel_*) is BLOCKED, no matter what.
 *   - Anything that moves funds (wallet_transfer, *_withdraw, *_deposit,
 *     swap, bridge) is BLOCKED.
 *   - Anything that mutates persistent state (set_permission_mode,
 *     approve_plan, write_shared_context) is BLOCKED.
 *
 * The block list is checked AFTER glob resolution. A glob that matches
 * an execution tool drops the execution tool silently and emits a
 * warning. The block list is the source of truth — profiles never get
 * to opt back in.
 *
 * Glob semantics: `*` matches any sequence of characters EXCEPT `:`.
 * Anchored: pattern must match the entire tool id. Multiple `*` allowed.
 *
 * No `?` or character-class support — keep the matcher simple. Operators
 * who need that granularity can list exact tool ids.
 */

/**
 * Hard deny-list. These tools are NEVER granted to a profile-defined
 * subagent, regardless of profile.tools content. Mirror of the
 * permission engine's safety-critical deny-list from
 * `src/runtime/permissions/trustTrajectory.ts` plus a broader pattern
 * sweep for trading mutations.
 */
const EXECUTION_TOOL_DENY_PATTERNS: ReadonlyArray<string | RegExp> = [
  // Order placement / execution
  "execute_plan",
  /^place_/,
  /^cancel_/,
  "cancel_replace_order",
  "approve_plan",
  "approve_strategy_trade",
  "close_trade",
  "close_partial_position",
  "set_trailing_stop",
  "update_trailing_stop",
  // Permission / mode mutations
  "set_permission_mode",
  // Wallet / fund movement
  "wallet_transfer",
  "transfer_between_accounts",
  "transfer_funds",
  "withdraw_to_external",
  // Shared-context mutations
  "write_shared_context",
  // Test-order utilities (still touch venue API)
  "test_order",
  "preview_market_order",
  "simulate_order_bundle",
  // Plan / sandbox lifecycle
  /^run_/,
  /^stop_/,
];

export function isExecutionTool(toolName: string): boolean {
  for (const pattern of EXECUTION_TOOL_DENY_PATTERNS) {
    if (typeof pattern === "string") {
      if (pattern === toolName) return true;
    } else if (pattern.test(toolName)) {
      return true;
    }
  }
  return false;
}

/**
 * Compile a glob pattern to a RegExp. Anchored. `*` becomes `[^:]*`.
 * Other regex metacharacters are escaped.
 */
function compileGlob(pattern: string): RegExp {
  let body = "";
  for (const ch of pattern) {
    if (ch === "*") {
      body += "[^:]*";
    } else if ("\\^$.|?+()[]{}".includes(ch)) {
      body += "\\" + ch;
    } else {
      body += ch;
    }
  }
  return new RegExp(`^${body}$`);
}

export interface ToolFilterResult {
  /** Tool ids the subagent is allowed to use. */
  allowed: string[];
  /** Profile entries that matched no read-only tool. */
  unmatched: string[];
  /** Profile entries that matched but were execution tools (blocked). */
  blocked: string[];
}

/**
 * Resolve a profile's `tools` whitelist against the read-only tool
 * registry, emitting per-entry classification.
 *
 * Algorithm:
 *   for each pattern in profile.tools:
 *     candidates = registry keys matching the pattern (exact or glob)
 *     for each candidate:
 *       if execution-tool → blocked
 *       else              → allowed
 *     if no candidates    → unmatched
 *
 * Allowed is deduplicated. Order is the registry order (so the agent's
 * tool list is deterministic across runs).
 */
export function filterToolsForProfile(
  profileTools: ReadonlyArray<string>,
  readOnlyRegistry: ReadonlyArray<string>,
): ToolFilterResult {
  const allowedSet = new Set<string>();
  const blockedSet = new Set<string>();
  const unmatched: string[] = [];

  for (const pattern of profileTools) {
    if (pattern.length === 0) continue;
    const isGlob = pattern.includes("*");

    if (!isGlob) {
      // Exact match path.
      if (readOnlyRegistry.includes(pattern)) {
        if (isExecutionTool(pattern)) blockedSet.add(pattern);
        else allowedSet.add(pattern);
      } else if (isExecutionTool(pattern)) {
        blockedSet.add(pattern);
      } else {
        unmatched.push(pattern);
      }
      continue;
    }

    const re = compileGlob(pattern);
    let matched = false;
    for (const toolId of readOnlyRegistry) {
      if (!re.test(toolId)) continue;
      matched = true;
      if (isExecutionTool(toolId)) blockedSet.add(toolId);
      else allowedSet.add(toolId);
    }
    if (!matched) unmatched.push(pattern);
  }

  const allowed = readOnlyRegistry.filter((id) => allowedSet.has(id));

  return {
    allowed,
    unmatched,
    blocked: [...blockedSet],
  };
}
