/**
 * Permission Mode Helpers
 *
 * Single source of truth for how the 6 permission modes gate tool execution.
 * Replaces scattered `permissionMode === "strict"` checks across 20+ files
 * with a context-aware helper that knows which modes block which operations.
 *
 * Six modes (see src/tui/state/types.ts):
 *   auto    — allows all (no per-action approval)
 *   ask     — allows all (with approval dialog)
 *   strict  — blocks all writes; read-only
 *   paper   — blocks REAL writes; paper engine could allow simulated ones
 *   observe — blocks all execution including paper
 *   plan    — allows plan creation but blocks plan execution
 */

import type { PermissionMode } from "../../../../tui/state/types.ts";

/**
 * Operation context hint — determines how strict the check should be.
 * - "execute": real trade execution (place_order, execute_plan, etc.)
 * - "cancel":  modifying open orders (cancel_order, cancel_all_orders)
 * - "transfer": moving money (withdraw, transfer between accounts)
 * - "autonomous": starting autonomous mode (persistent execution loop)
 * - "plan_create": creating a plan (preview, approve_plan)
 * - "state_mutation": other writes (earn subscribe, dust convert, etc.)
 */
export type TradingOperationContext =
  | "execute"
  | "cancel"
  | "transfer"
  | "autonomous"
  | "plan_create"
  | "state_mutation";

export interface PermissionCheck {
  allowed: boolean;
  reason?: string;
  /** Short mode descriptor for error messages (e.g., "read-only"). */
  modeLabel?: string;
}

const MODE_LABELS: Record<PermissionMode, string> = {
  auto: "auto-execute",
  ask: "ask-per-trade",
  strict: "read-only",
  paper: "paper trading",
  observe: "pure observation",
  plan: "planning-only",
};

/**
 * Check whether a trading operation is allowed under the current permission mode.
 *
 * When the active venue adapter is in sandbox/testnet mode (e.g. Binance
 * testnet, Hyperliquid testnet, OKX demo), paper mode allows execution —
 * orders are sent to fake-money infrastructure. Pass `options.sandboxActive`
 * from the caller so this helper can make that call. Paper mode still
 * blocks when no sandbox adapter is active.
 */
export function checkTradingPermission(
  mode: PermissionMode | undefined,
  operation: TradingOperationContext,
  options: { sandboxActive?: boolean } = {},
): PermissionCheck {
  const m = mode ?? "ask";
  const label = MODE_LABELS[m] ?? m;

  // auto and ask always allow — the approval dialog and risk gate handle fine-grained checks
  if (m === "auto" || m === "ask") return { allowed: true, modeLabel: label };

  // strict and observe block everything
  if (m === "strict" || m === "observe") {
    return {
      allowed: false,
      modeLabel: label,
      reason: `Cannot ${operationLabel(operation)}: permissionMode is '${m}' (${label}). Use /auto or /ask to enable trading.`,
    };
  }

  // plan mode allows plan_create but blocks execution
  if (m === "plan") {
    if (operation === "plan_create") return { allowed: true, modeLabel: label };
    return {
      allowed: false,
      modeLabel: label,
      reason: `Cannot ${operationLabel(operation)}: permissionMode is 'plan' (planning-only — can create plans but not execute them). Use /auto or /ask to enable trading.`,
    };
  }

  // paper mode — allow execution when active venue is on a sandbox/testnet;
  // block otherwise (no local paper-fill engine for non-sandbox adapters).
  if (m === "paper") {
    if (operation === "plan_create") return { allowed: true, modeLabel: label };
    if (options.sandboxActive) {
      return { allowed: true, modeLabel: `${label} (sandbox)` };
    }
    return {
      allowed: false,
      modeLabel: label,
      reason: `Cannot ${operationLabel(operation)}: permissionMode is 'paper' but the active venue is not a sandbox/testnet adapter. Connect a venue with sandbox credentials (crypto: Binance testnet, Hyperliquid testnet, OKX demo, Coinbase sandbox, Gemini sandbox; stocks: Alpaca paper, Tradier sandbox, TradeStation sim, tastytrade cert, Trading 212 demo, E*TRADE sandbox) or switch to /auto / /ask.`,
    };
  }

  // Unknown mode — fail safe
  return {
    allowed: false,
    modeLabel: label,
    reason: `Cannot ${operationLabel(operation)}: unknown permissionMode '${m}'. Use /auto, /ask, or /strict.`,
  };
}

/**
 * Convenience boolean — returns true if the mode blocks any kind of real execution.
 * Matches the set used by access-control.ts TRADING_TOOLS gate.
 */
export function blocksTradeExecution(mode: PermissionMode | undefined): boolean {
  const m = mode ?? "ask";
  return m === "strict" || m === "observe" || m === "plan" || m === "paper";
}

function operationLabel(op: TradingOperationContext): string {
  switch (op) {
    case "execute": return "execute trade";
    case "cancel": return "cancel order";
    case "transfer": return "transfer funds";
    case "autonomous": return "start autonomous mode";
    case "plan_create": return "create plan";
    case "state_mutation": return "mutate state";
  }
}
