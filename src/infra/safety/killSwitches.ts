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
 * Each scope is an independent boolean tripwire. Trips persist to disk
 * (~/.gordon/kill-switches.json, atomic write) and reload on startup, so a
 * tripped switch survives a restart. Resetting a switch requires a logged
 * rationale. Composes with the existing permission engine —
 * `isExecutionAllowed` is the single gate to consult before any
 * irreversible action.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createModuleLogger } from "../logger/index.ts";
import { getGordonDir } from "../storage/paths.ts";
import { flagEnv } from "../config/flagResolver.ts";

const logger = createModuleLogger("kill-switches");

export const KILL_SWITCHES_FLAG_ENV = "GORDON_KILL_SWITCHES";
export const KILL_SWITCH_STATE_PATH_ENV = "GORDON_KILL_SWITCH_STATE_PATH";
export const MIN_KILL_SWITCH_RESET_RATIONALE_CHARS = 10;

export function isKillSwitchesEnabled(env: NodeJS.ProcessEnv = flagEnv()): boolean {
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

function statePath(): string | null {
  const override = process.env[KILL_SWITCH_STATE_PATH_ENV];
  if (override) return override;
  // Tests across the repo trip/reset switches as scaffolding — they must
  // never touch the operator's real persisted state. In-memory-only under
  // bun test unless the path env is set explicitly.
  if (process.env.NODE_ENV === "test") return null;
  return join(getGordonDir(), "kill-switches.json");
}

function persistenceActive(): boolean {
  return statePath() !== null;
}

function persistTrips(): void {
  const path = statePath();
  if (!path) return;
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify({ trips: Object.fromEntries(TRIPS) }, null, 2));
    renameSync(tmp, path);
  } catch (error) {
    // The in-memory trip still gates this session; durability failure is loud.
    logger.error("Failed to persist kill-switch state", error as Error);
  }
}

/** Reload trip state from disk. Called at module init (startup). */
export function reloadKillSwitchState(): void {
  TRIPS.clear();
  const path = statePath();
  if (!path || !existsSync(path)) return;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      trips?: Record<string, TripRecord>;
    };
    for (const [k, v] of Object.entries(parsed.trips ?? {})) {
      if (v && typeof v.trippedAt === "number" && typeof v.reason === "string") {
        TRIPS.set(k, { trippedAt: v.trippedAt, reason: v.reason });
      }
    }
  } catch (error) {
    // Fail closed: an unreadable state file may be hiding a tripped switch.
    TRIPS.set("firm", {
      trippedAt: Date.now(),
      reason: `kill-switch state file unreadable (${String(error)}) — failing closed firm-wide`,
    });
    logger.error("Kill-switch state unreadable — failing closed with firm-wide trip", error as Error);
  }
}

reloadKillSwitchState();

export function tripKillSwitch(key: KillSwitchKey, reason: string, nowMs: number = Date.now()): void {
  TRIPS.set(keyOf(key), { trippedAt: nowMs, reason });
  persistTrips();
}

/**
 * Reset a single switch. Requires a rationale (min 10 chars), which is
 * logged — a reset without one fails closed and the switch stays tripped.
 * Returns true only when a tripped switch was actually cleared.
 */
export function resetKillSwitch(key: KillSwitchKey, rationale?: string): boolean {
  const k = keyOf(key);
  if (!TRIPS.has(k)) return false;
  const trimmed = rationale?.trim() ?? "";
  if (trimmed.length < MIN_KILL_SWITCH_RESET_RATIONALE_CHARS) {
    logger.warn("Kill-switch reset refused — rationale of at least 10 chars required", { key: k });
    return false;
  }
  TRIPS.delete(k);
  persistTrips();
  logger.info("Kill switch reset", { key: k, rationale: trimmed });
  return true;
}

/**
 * Clear every switch. While persistence is active (real operator state) a
 * rationale is required and the call fails closed without one; in
 * in-memory-only mode (tests) it clears unconditionally as scaffolding.
 */
export function resetAllKillSwitches(rationale?: string): void {
  const trimmed = rationale?.trim() ?? "";
  if (
    persistenceActive() &&
    TRIPS.size > 0 &&
    trimmed.length < MIN_KILL_SWITCH_RESET_RATIONALE_CHARS
  ) {
    logger.warn("resetAllKillSwitches refused — rationale required while persistence is active");
    return;
  }
  const hadTrips = TRIPS.size > 0;
  TRIPS.clear();
  persistTrips();
  if (hadTrips && trimmed.length > 0) {
    logger.info("All kill switches reset", { rationale: trimmed });
  }
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
