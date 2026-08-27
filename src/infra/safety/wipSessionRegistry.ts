/**
 * Process-scoped WIP registry for plan lifecycle tracking.
 *
 * Callers gate at approve/execute and mark inactive on close/cancel.
 * Registry resets only on explicit `resetSessionWipRegistry()` (tests).
 */

import {
  createWipRegistry,
  gatePlan,
  isWipLimitEnabled,
  readWipLimitsFromEnv,
  type WipGateResult,
  type WipRegistry,
} from "./wipLimit.ts";

let sessionRegistry: WipRegistry | null = null;

export function getSessionWipRegistry(): WipRegistry {
  if (!sessionRegistry) {
    sessionRegistry = createWipRegistry(readWipLimitsFromEnv());
  }
  return sessionRegistry;
}

/** Tests only. */
export function resetSessionWipRegistryForTesting(): void {
  sessionRegistry = null;
}

export function gateSessionPlan(symbol: string, strategy: string): WipGateResult {
  if (!isWipLimitEnabled()) {
    return {
      allowed: true,
      reason: "ok",
      message: "WIP limit disabled.",
      blockingPlanIds: [],
    };
  }
  return getSessionWipRegistry().gate(symbol, strategy);
}

export function activateSessionPlan(planId: string, symbol: string, strategy: string): void {
  if (!isWipLimitEnabled()) return;
  getSessionWipRegistry().markActive({ planId, symbol, strategy });
}

export function deactivateSessionPlan(planId: string): boolean {
  if (!isWipLimitEnabled()) return false;
  return getSessionWipRegistry().markInactive(planId);
}

export function sessionWipSnapshot(): {
  enabled: boolean;
  active: ReturnType<WipRegistry["active"]>;
  limits: ReturnType<typeof readWipLimitsFromEnv>;
} {
  const limits = readWipLimitsFromEnv();
  return {
    enabled: isWipLimitEnabled(),
    active: getSessionWipRegistry().active(),
    limits,
  };
}

/** Pure helper for callers that already hold the active set. */
export { gatePlan };
