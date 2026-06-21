/**
 * Named permission profiles — DOCUMENTATION DATA TABLE (not wired).
 *
 * Three trust profiles expressed as an inheritance chain:
 *   read_only → paper_trading → live_trading
 *
 * This is the typed source the security docs derive from
 * (docs/security/PERMISSION-PROFILES.md). It is intentionally **not**
 * registered with `PermissionEngine` — wiring a new profile layer into
 * live gating could change default behavior, which is off-limits this
 * close to launch. The table exists as a future, tested building block.
 *
 * Invariant (asserted in profiles.test.ts): no profile may auto-allow a
 * safety-critical deny-list tool. Profiles gate the easy stuff; the
 * deny-list / risk gate / kill switches / constitution always apply.
 */

import type { RuntimePermissionScope } from "../contracts/types.ts";
import { SAFETY_CRITICAL_PATTERNS, isSafetyCritical } from "./trustTrajectory.ts";

export type PermissionProfileName = "read_only" | "paper_trading" | "live_trading";

export interface PermissionProfile {
  name: PermissionProfileName;
  /** Profile this one inherits permitted scopes from (undefined = base). */
  inheritsFrom?: PermissionProfileName;
  /** Human-readable purpose. */
  description: string;
  /**
   * Permission scopes this profile grants on top of its parent. Granting a
   * scope means "execution against this scope is on the table"; it never
   * means safety-critical tools auto-fire — those always route to the
   * human/confirmation path (enforced by PermissionEngine + trustTrajectory).
   */
  addsScopes: readonly RuntimePermissionScope[];
  /**
   * Surface tool ids this profile permits without a confirmation prompt
   * (read / analytics / plan-authoring). MUST exclude every safety-critical
   * deny-list tool — the test enforces this.
   */
  autoAllowTools: readonly string[];
  /**
   * Tool ids that this profile makes *available* but which still always
   * require confirmation (deny-listed / write / execution). Documented for
   * clarity; the safety chain — not this list — does the enforcing.
   */
  alwaysConfirmTools: readonly string[];
}

/**
 * Base profile: data + analytics, no side effects. Mirrors PermissionEngine's
 * `classifier:read-only` auto-allow path (read + low risk).
 */
const READ_ONLY: PermissionProfile = {
  name: "read_only",
  description: "Data and analytics only. No side effects on any venue.",
  addsScopes: ["market.read", "portfolio.read", "analysis.run"],
  autoAllowTools: [
    "get_market_data",
    "get_news",
    "get_fundamentals",
    "get_account_state",
    "get_portfolio",
    "compute_indicator",
    "compute_regime",
    "compute_risk",
    "compute_microstructure",
    "memory_search",
    "verify_plan",
    "backtest",
  ],
  alwaysConfirmTools: [],
};

/**
 * Adds plan/exec against PAPER venues. Execution tools stay confirmation-only
 * — they are deny-listed and flow through the same surface tools as live.
 */
const PAPER_TRADING: PermissionProfile = {
  name: "paper_trading",
  inheritsFrom: "read_only",
  description: "Adds plan authoring + execution against paper venues. Execution still confirms.",
  addsScopes: ["papertrade.execute"],
  autoAllowTools: ["create_plan", "approve_plan"],
  alwaysConfirmTools: ["execute_plan", "cancel"],
};

/**
 * Adds execution against LIVE venues. Adds NO relaxation of any safety
 * control — deny-list, risk gate, constitution, and kill switches all still
 * apply per-action. The profile grants the scope, not a bypass.
 */
const LIVE_TRADING: PermissionProfile = {
  name: "live_trading",
  inheritsFrom: "paper_trading",
  description:
    "Adds execution against live venues. Deny-list, risk gate, constitution, and kill switches still apply per-action.",
  addsScopes: ["livetrade.execute"],
  autoAllowTools: [],
  alwaysConfirmTools: [
    "execute_plan",
    "cancel",
    "place_order",
    "place_market_order",
    "place_limit_order",
    "place_bracket_order",
    "place_oco_order",
    "execute_trade",
    "submit_order",
    "wallet_send",
    "wallet_transfer",
    "transfer_funds",
    "withdraw",
    "approve_token",
  ],
};

export const PERMISSION_PROFILES: Readonly<Record<PermissionProfileName, PermissionProfile>> = {
  read_only: READ_ONLY,
  paper_trading: PAPER_TRADING,
  live_trading: LIVE_TRADING,
};

/** Ordered base → most-privileged, for docs/iteration. */
export const PERMISSION_PROFILE_CHAIN: readonly PermissionProfileName[] = [
  "read_only",
  "paper_trading",
  "live_trading",
];

/**
 * Resolve the full set of scopes a profile grants, walking the inheritance
 * chain. Pure helper; does not consult or mutate runtime state.
 */
export function resolveProfileScopes(name: PermissionProfileName): RuntimePermissionScope[] {
  const seen = new Set<RuntimePermissionScope>();
  let current: PermissionProfile | undefined = PERMISSION_PROFILES[name];
  while (current) {
    for (const scope of current.addsScopes) seen.add(scope);
    current = current.inheritsFrom ? PERMISSION_PROFILES[current.inheritsFrom] : undefined;
  }
  return [...seen];
}

/**
 * Resolve the full set of auto-allowed tools a profile grants, walking the
 * inheritance chain. Used by the safety test to assert no deny-list tool ever
 * appears in any profile's auto-allow set.
 */
export function resolveProfileAutoAllowTools(name: PermissionProfileName): string[] {
  const seen = new Set<string>();
  let current: PermissionProfile | undefined = PERMISSION_PROFILES[name];
  while (current) {
    for (const tool of current.autoAllowTools) seen.add(tool);
    current = current.inheritsFrom ? PERMISSION_PROFILES[current.inheritsFrom] : undefined;
  }
  return [...seen];
}

/** Re-export so the docs + test reference a single deny-list source of truth. */
export { SAFETY_CRITICAL_PATTERNS, isSafetyCritical };
