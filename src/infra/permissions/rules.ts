/**
 * Content-Scoped Permission Rules
 *
 * Fine-grained approval rules matched against tool name + tool args.
 * Enables rules like:
 *   - auto-approve place_order when notional < $1000
 *   - deny short selling on any symbol
 *   - always ask for any trade on BTC
 *   - auto-deny place_order outside market hours
 *
 * Rules are evaluated in priority order; first match wins. Each rule scopes
 * to a tool name (glob) + optional content conditions on args.
 */

export type RuleBehavior = "allow" | "deny" | "ask";
export type RuleSource = "user" | "project" | "local" | "policy" | "cli" | "session";

export interface ContentCondition {
  /** Dot-path into the args object (e.g., "notionalUsd" or "order.side"). */
  path: string;
  /** Comparison operator. */
  op:
    | "eq"
    | "ne"
    | "lt"
    | "lte"
    | "gt"
    | "gte"
    | "in"
    | "nin"
    | "matches"
    | "starts_with"
    | "contains";
  /** Value to compare against. */
  value: string | number | boolean | string[] | number[];
}

export interface PermissionRule {
  id: string;
  source: RuleSource;
  /** Tool name or glob pattern (e.g., "place_*", "*_order", "*"). */
  toolPattern: string;
  /** All conditions must match for the rule to fire. Empty = tool-only match. */
  conditions?: ContentCondition[];
  behavior: RuleBehavior;
  /** Lower priority runs first; first matching rule wins. Default 100. */
  priority?: number;
  /** Human-readable explanation shown when rule fires. */
  reason?: string;
  /** If true, rule is session-only and not persisted. */
  sessionOnly?: boolean;
}

// ============================================================================
// Matching
// ============================================================================

function toolMatches(pattern: string, toolName: string): boolean {
  if (pattern === "*" || pattern === toolName) return true;
  if (!pattern.includes("*")) return false;
  const regex = new RegExp(
    `^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
  );
  return regex.test(toolName);
}

function resolvePath(obj: unknown, path: string): unknown {
  if (obj == null) return undefined;
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function conditionMatches(cond: ContentCondition, args: unknown): boolean {
  const actual = resolvePath(args, cond.path);

  switch (cond.op) {
    case "eq":
      return actual === cond.value;
    case "ne":
      return actual !== cond.value;
    case "lt": {
      const a = toNumber(actual);
      const b = toNumber(cond.value);
      return a !== null && b !== null && a < b;
    }
    case "lte": {
      const a = toNumber(actual);
      const b = toNumber(cond.value);
      return a !== null && b !== null && a <= b;
    }
    case "gt": {
      const a = toNumber(actual);
      const b = toNumber(cond.value);
      return a !== null && b !== null && a > b;
    }
    case "gte": {
      const a = toNumber(actual);
      const b = toNumber(cond.value);
      return a !== null && b !== null && a >= b;
    }
    case "in":
      return Array.isArray(cond.value) && (cond.value as unknown[]).includes(actual as never);
    case "nin":
      return Array.isArray(cond.value) && !(cond.value as unknown[]).includes(actual as never);
    case "matches":
      if (typeof actual !== "string" || typeof cond.value !== "string") return false;
      try {
        return new RegExp(cond.value).test(actual);
      } catch {
        return false;
      }
    case "starts_with":
      return (
        typeof actual === "string" &&
        typeof cond.value === "string" &&
        actual.startsWith(cond.value)
      );
    case "contains":
      return (
        typeof actual === "string" && typeof cond.value === "string" && actual.includes(cond.value)
      );
    default:
      return false;
  }
}

// ============================================================================
// Evaluator
// ============================================================================

export interface PermissionDecision {
  behavior: RuleBehavior;
  matchedRule?: PermissionRule;
  reason: string;
}

export interface EvaluateInput {
  toolName: string;
  args: unknown;
  defaultBehavior?: RuleBehavior;
}

/**
 * Evaluate rules against a tool call. Returns the first matching rule's
 * behavior, or the default (defaults to "ask") if nothing matches.
 */
export function evaluateRules(rules: PermissionRule[], input: EvaluateInput): PermissionDecision {
  const sorted = [...rules].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

  for (const rule of sorted) {
    if (!toolMatches(rule.toolPattern, input.toolName)) continue;
    const conds = rule.conditions ?? [];
    if (conds.length > 0 && !conds.every((c) => conditionMatches(c, input.args))) continue;

    return {
      behavior: rule.behavior,
      matchedRule: rule,
      reason: rule.reason ?? `Matched rule ${rule.id} (${rule.source})`,
    };
  }

  return {
    behavior: input.defaultBehavior ?? "ask",
    reason: "No rule matched — falling through to default behavior",
  };
}

// ============================================================================
// Preset trading rules
// ============================================================================

export const PRESET_SMALL_TRADE_AUTO_APPROVE: PermissionRule = {
  id: "small-trade-auto-approve",
  source: "policy",
  toolPattern: "place_*order*",
  conditions: [{ path: "notionalUsd", op: "lt", value: 1000 }],
  behavior: "allow",
  priority: 10,
  reason: "Small trade (< $1000 notional) auto-approved",
};

export const PRESET_LARGE_TRADE_REQUIRE_APPROVAL: PermissionRule = {
  id: "large-trade-require-approval",
  source: "policy",
  toolPattern: "place_*order*",
  conditions: [{ path: "notionalUsd", op: "gte", value: 10000 }],
  behavior: "ask",
  priority: 20,
  reason: "Large trade (>= $10k notional) requires explicit approval",
};

export const PRESET_BLOCK_SHORTING: PermissionRule = {
  id: "no-shorting",
  source: "policy",
  toolPattern: "place_*order*",
  conditions: [
    { path: "side", op: "eq", value: "sell" },
    { path: "isShort", op: "eq", value: true },
  ],
  behavior: "deny",
  priority: 5,
  reason: "Short selling is disabled by policy",
};

export const PRESET_WHITELIST_SYMBOLS: (allowedSymbols: string[]) => PermissionRule = (syms) => ({
  id: "symbol-whitelist",
  source: "policy",
  toolPattern: "place_*order*",
  conditions: [{ path: "symbol", op: "nin", value: syms }],
  behavior: "deny",
  priority: 3,
  reason: `Symbol not in whitelist: ${syms.join(", ")}`,
});
