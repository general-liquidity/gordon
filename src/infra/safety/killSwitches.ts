/**
 * Multi-Level Kill Switches (GORDON_KILL_SWITCHES).
 *
 * Implements the article's Section 7.2 isolation hierarchy. A serious
 * trading environment needs kill switches at multiple scopes so the
 * operator (or automation) can isolate exactly the problem source
 * without taking the entire firm down.
 *
 *   strategy → trader → account → client → instrument → venue → gateway → firm
 *
 * Each scope is an independent boolean tripwire. Trip status persists
 * across calls (in-memory; persistent storage is the caller's job).
 * Composes with the existing permission engine — `isExecutionAllowed`
 * is the single gate to consult before any irreversible action.
 */

export const KILL_SWITCHES_FLAG_ENV = "GORDON_KILL_SWITCHES";

export function isKillSwitchesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[KILL_SWITCHES_FLAG_ENV];
  return raw !== "0" && raw !== "false";
}

export type KillSwitchScope =
  | "strategy"
  | "trader"
  | "account"
  | "client"
  | "instrument"
  | "venue"
  | "gateway"
  | "firm";

export interface KillSwitchKey {
  scope: KillSwitchScope;
  /** Identifier within the scope (e.g. strategy id, account id, venue name). Omit for firm-wide. */
  id?: string;
}

export interface ExecutionContext {
  strategyId?: string;
  traderId?: string;
  accountId?: string;
  clientId?: string;
  instrument?: string;
  venue?: string;
  gateway?: string;
}

interface TripRecord {
  trippedAt: number;
  reason: string;
}

const TRIPS = new Map<string, TripRecord>();

function keyOf(k: KillSwitchKey): string {
  return k.id ? `${k.scope}:${k.id}` : k.scope;
}

export function tripKillSwitch(key: KillSwitchKey, reason: string, nowMs: number = Date.now()): void {
  TRIPS.set(keyOf(key), { trippedAt: nowMs, reason });
}

export function resetKillSwitch(key: KillSwitchKey): boolean {
  return TRIPS.delete(keyOf(key));
}

export function resetAllKillSwitches(): void {
  TRIPS.clear();
}

export interface ExecutionDecision {
  allowed: boolean;
  blockingKeys: Array<{ key: KillSwitchKey; reason: string; trippedAt: number }>;
  reason: string;
}

export function isExecutionAllowed(ctx: ExecutionContext): ExecutionDecision {
  const candidates: KillSwitchKey[] = [{ scope: "firm" }];
  if (ctx.gateway) candidates.push({ scope: "gateway", id: ctx.gateway });
  if (ctx.venue) candidates.push({ scope: "venue", id: ctx.venue });
  if (ctx.instrument) candidates.push({ scope: "instrument", id: ctx.instrument });
  if (ctx.clientId) candidates.push({ scope: "client", id: ctx.clientId });
  if (ctx.accountId) candidates.push({ scope: "account", id: ctx.accountId });
  if (ctx.traderId) candidates.push({ scope: "trader", id: ctx.traderId });
  if (ctx.strategyId) candidates.push({ scope: "strategy", id: ctx.strategyId });

  const blocking: Array<{ key: KillSwitchKey; reason: string; trippedAt: number }> = [];
  for (const cand of candidates) {
    const trip = TRIPS.get(keyOf(cand));
    if (trip) blocking.push({ key: cand, reason: trip.reason, trippedAt: trip.trippedAt });
  }

  if (blocking.length === 0) {
    return { allowed: true, blockingKeys: [], reason: "no kill switches tripped" };
  }
  const summary = blocking.map((b) => keyOf(b.key)).join(", ");
  return {
    allowed: false,
    blockingKeys: blocking,
    reason: `execution blocked — tripped: ${summary}`,
  };
}

export function listTrippedSwitches(): Array<{ key: KillSwitchKey; reason: string; trippedAt: number }> {
  const out: Array<{ key: KillSwitchKey; reason: string; trippedAt: number }> = [];
  for (const [k, v] of TRIPS) {
    const [scope, id] = k.split(":") as [KillSwitchScope, string | undefined];
    out.push({ key: { scope, id }, reason: v.reason, trippedAt: v.trippedAt });
  }
  return out.sort((a, b) => a.trippedAt - b.trippedAt);
}

export function killSwitchesToPayload(decision: ExecutionDecision): Record<string, unknown> {
  return {
    kind: "kill_switches.evaluated",
    allowed: decision.allowed,
    blockingCount: decision.blockingKeys.length,
    scopes: decision.blockingKeys.map((b) => b.key.scope),
  };
}
