/**
 * WIP-limit gate (GORDON_WIP_LIMIT).
 *
 * Port of item 11 from the harness-engineering Tier 3 plan, L07.
 *
 * Harness engineering says "WIP=1" — at most one plan in flight at a
 * time. Applied naively to trading, this is wrong: multiple symbols can
 * legitimately have plans in flight simultaneously. The compromise from
 * the plan: **WIP=N per symbol** (default 1) and **WIP=M per strategy**
 * (default unbounded). Global WIP=1 is available as an opt-in.
 *
 * The module exposes a pure-functional gate (`gatePlan`) for testing
 * and a small in-memory registry (`createWipRegistry`) for callers that
 * want to track active plans across an autonomous-loop session.
 *
 * This module does NOT subscribe to plan lifecycle events. Callers
 * (autonomous-loop, planner) call `markActive` / `markInactive` at the
 * appropriate state transitions. Keeping ingestion separate from the
 * gate makes the gate testable.
 */

import { flagEnv } from "../config/flagResolver.ts";

export const WIP_FLAG_ENV = "GORDON_WIP_LIMIT_ENABLED";
export const WIP_PER_SYMBOL_ENV = "GORDON_WIP_LIMIT_PER_SYMBOL";
export const WIP_PER_STRATEGY_ENV = "GORDON_WIP_LIMIT_PER_STRATEGY";
export const WIP_GLOBAL_ENV = "GORDON_WIP_LIMIT_GLOBAL";

export interface WipLimits {
  /** Max active plans per symbol. Default 1. Set to Infinity to disable. */
  perSymbol: number;
  /** Max active plans per strategy. Default Infinity. */
  perStrategy: number;
  /** Max active plans globally. Default Infinity. */
  global: number;
}

export interface ActivePlan {
  planId: string;
  symbol: string;
  strategy: string;
  /** When the plan became active (for diagnostics). */
  activeSinceMs: number;
}

export interface WipGateInput {
  symbol: string;
  strategy: string;
  active: ActivePlan[];
}

export type WipGateReasonKind = "per-symbol" | "per-strategy" | "global" | "ok";

export interface WipGateResult {
  allowed: boolean;
  reason: WipGateReasonKind;
  /** Human-friendly message — populated on block. */
  message: string;
  /** Plan ids blocking this one (so caller can show "queued behind X"). */
  blockingPlanIds: string[];
}

export function isWipLimitEnabled(env: NodeJS.ProcessEnv = flagEnv()): boolean {
  // Default-on protective gate: absence = enabled. Explicit "0"/"false" opts out.
  // Read via flagEnv() so settings.json + /flags can toggle it (env still wins).
  const raw = env[WIP_FLAG_ENV];
  return raw !== "0" && raw !== "false";
}

function parsePositiveIntOrInfinity(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  if (raw === "Infinity" || raw === "infinity" || raw === "0") return Infinity;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

export function readWipLimitsFromEnv(env: NodeJS.ProcessEnv = flagEnv()): WipLimits {
  return {
    perSymbol: parsePositiveIntOrInfinity(env[WIP_PER_SYMBOL_ENV], 1),
    perStrategy: parsePositiveIntOrInfinity(env[WIP_PER_STRATEGY_ENV], Infinity),
    global: parsePositiveIntOrInfinity(env[WIP_GLOBAL_ENV], Infinity),
  };
}

export const DEFAULT_LIMITS: WipLimits = {
  perSymbol: 1,
  perStrategy: Infinity,
  global: Infinity,
};

/**
 * Decide whether a new plan for the given symbol/strategy can become
 * active, given the current set of active plans. Pure function — no
 * side effects.
 */
export function gatePlan(input: WipGateInput, limits: WipLimits): WipGateResult {
  const { symbol, strategy, active } = input;

  if (active.length >= limits.global) {
    return {
      allowed: false,
      reason: "global",
      message: `Global WIP limit reached (${active.length}/${limits.global}).`,
      blockingPlanIds: active.map((p) => p.planId),
    };
  }

  const symActive = active.filter((p) => p.symbol === symbol);
  if (symActive.length >= limits.perSymbol) {
    return {
      allowed: false,
      reason: "per-symbol",
      message: `Per-symbol WIP limit reached for ${symbol} (${symActive.length}/${limits.perSymbol}).`,
      blockingPlanIds: symActive.map((p) => p.planId),
    };
  }

  const stratActive = active.filter((p) => p.strategy === strategy);
  if (stratActive.length >= limits.perStrategy) {
    return {
      allowed: false,
      reason: "per-strategy",
      message: `Per-strategy WIP limit reached for ${strategy} (${stratActive.length}/${limits.perStrategy}).`,
      blockingPlanIds: stratActive.map((p) => p.planId),
    };
  }

  return {
    allowed: true,
    reason: "ok",
    message: `Within WIP limits (symbol ${symActive.length}/${limits.perSymbol}, strategy ${stratActive.length}/${limits.perStrategy === Infinity ? "∞" : limits.perStrategy}, global ${active.length}/${limits.global === Infinity ? "∞" : limits.global}).`,
    blockingPlanIds: [],
  };
}

// ============================================================================
// Optional in-memory registry — for callers that don't want to maintain
// the active set themselves.
// ============================================================================

export interface WipRegistry {
  markActive(plan: Omit<ActivePlan, "activeSinceMs">, now?: number): void;
  markInactive(planId: string): boolean;
  gate(symbol: string, strategy: string): WipGateResult;
  active(): ActivePlan[];
  activeBySymbol(symbol: string): ActivePlan[];
  activeByStrategy(strategy: string): ActivePlan[];
  clear(): void;
  size(): number;
}

export function createWipRegistry(limits: WipLimits = DEFAULT_LIMITS): WipRegistry {
  const byPlanId = new Map<string, ActivePlan>();

  return {
    markActive(plan, now) {
      if (byPlanId.has(plan.planId)) return;
      byPlanId.set(plan.planId, {
        planId: plan.planId,
        symbol: plan.symbol,
        strategy: plan.strategy,
        activeSinceMs: now ?? Date.now(),
      });
    },
    markInactive(planId) {
      return byPlanId.delete(planId);
    },
    gate(symbol, strategy) {
      return gatePlan({ symbol, strategy, active: Array.from(byPlanId.values()) }, limits);
    },
    active() {
      return Array.from(byPlanId.values());
    },
    activeBySymbol(symbol) {
      return Array.from(byPlanId.values()).filter((p) => p.symbol === symbol);
    },
    activeByStrategy(strategy) {
      return Array.from(byPlanId.values()).filter((p) => p.strategy === strategy);
    },
    clear() {
      byPlanId.clear();
    },
    size() {
      return byPlanId.size;
    },
  };
}

export function wipResultToPayload(result: WipGateResult): Record<string, unknown> {
  return {
    kind: "wip_limit.gate_recorded",
    allowed: result.allowed,
    reason: result.reason,
    message: result.message,
    blockingPlanIds: result.blockingPlanIds,
  };
}
