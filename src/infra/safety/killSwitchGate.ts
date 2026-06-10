import type { GordonContext } from "../agents/types.ts";
import {
  isExecutionAllowed,
  isKillSwitchesEnabled,
  killSwitchesToPayload,
  type ExecutionContext,
  type ExecutionDecision,
} from "./killSwitches.ts";

export interface KillSwitchOrderContext {
  instrument: string;
  strategyId?: string;
  venue?: string;
  traderId?: string;
}

export interface KillSwitchBlock {
  blocked: true;
  error: string;
  decision: ExecutionDecision;
  payload: Record<string, unknown>;
}

export type KillSwitchCheck = KillSwitchBlock | { blocked: false };

export function buildKillSwitchExecutionContext(
  ctx: { userId?: string; exchange?: GordonContext["exchange"] },
  opts: KillSwitchOrderContext,
): ExecutionContext {
  return {
    traderId: opts.traderId ?? ctx.userId,
    instrument: opts.instrument,
    venue: opts.venue ?? ctx.exchange?.exchangeId,
    strategyId: opts.strategyId,
  };
}

export function checkKillSwitchForOrder(
  ctx: { userId?: string; exchange?: GordonContext["exchange"] },
  opts: KillSwitchOrderContext,
): KillSwitchCheck {
  if (!isKillSwitchesEnabled()) return { blocked: false };
  const decision = isExecutionAllowed(buildKillSwitchExecutionContext(ctx, opts));
  if (decision.allowed) return { blocked: false };
  return {
    blocked: true,
    error: `${decision.reason}. Reset the relevant kill switch before placing this order.`,
    decision,
    payload: killSwitchesToPayload(decision),
  };
}