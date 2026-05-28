/**
 * Tool-friction telemetry — per-turn tool-call counting.
 *
 * Captures the signal Monigatti's "Agentic Search for Context Engineering"
 * (AI Engineer Europe 2026) identifies as the operational tell that a
 * tool stack has a gap: when the agent needs 4–5+ different tool calls
 * to answer one user question, the right specialized tool probably does
 * not exist yet. This is a distinct signal from the existing doom-loop
 * detector, which catches *identical* fingerprint repetition. Friction
 * = many *different* calls chasing the same question.
 *
 * Two outputs when the per-turn threshold is crossed:
 *   1. Append a `tool_friction_observed` entry to ~/.gordon/tool-friction.jsonl
 *      (review-queue pattern, matches agent-feedback.ts).
 *   2. Emit a structured observation with eventType `agent.tool_friction_observed`
 *      so the audit log + Axiom see it correlated with the surrounding trace.
 *
 * The skill /tool-friction-report consumes the jsonl + observations to
 * surface "which user questions cost the most tool calls" so the operator
 * can decide what specialized tool to add next.
 *
 * Turn-boundary detection: callers can explicitly call
 * `recordUserTurnStart(context, userMessage)` to mark a new user turn.
 * Absent that, the tracker treats any tool call after `TURN_IDLE_RESET_MS`
 * of inactivity as a new turn — a heuristic that survives missing wire-up.
 *
 * Threshold defaults to 5 (Monigatti's "four or five tool calls for a
 * simple question often means the current tool is too hard for the model").
 * Override via env `GORDON_TOOL_FRICTION_THRESHOLD` or per-call option.
 */

import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";

import type { GordonContext } from "../types.ts";
import { recordStructuredObservation } from "../../platform/observability/structured.ts";

export const DEFAULT_FRICTION_THRESHOLD = 5;
export const TURN_IDLE_RESET_MS = 30_000;

export interface ToolFrictionEntry {
  /** ISO timestamp when the friction event fired (threshold crossed). */
  observedAt: string;
  /** Thread the turn belongs to. */
  threadId: string;
  /** User message that opened the turn, if captured. */
  userMessage?: string;
  /** Tool sequence (oldest first) up to and including the trigger call. */
  toolNames: string[];
  /** Number of tool calls in the turn at fire time. */
  count: number;
  /** Threshold that was crossed. */
  threshold: number;
  /** Turn duration at fire time, in milliseconds. */
  turnDurationMs: number;
}

export interface RecordToolCallOptions {
  /** Override the threshold for this call only. */
  thresholdOverride?: number;
  /** Skip the jsonl append + structured observation. Useful for tests. */
  suppressFire?: boolean;
}

export interface RecordToolCallResult {
  count: number;
  threshold: number;
  /** True when this call crossed the threshold (first time only — dedup
   *  within a turn so the operator gets one event per friction episode). */
  frictionTriggered: boolean;
  /** Snapshot of the tool sequence so far. */
  toolNames: string[];
  /** Captured user message for this turn, if any. */
  userMessage?: string;
  turnStartedAt: number;
  turnDurationMs: number;
}

interface TurnState {
  startedAt: number;
  lastToolCallAt: number;
  toolNames: string[];
  userMessage?: string;
  frictionFired: boolean;
}

const turnStateByThread = new Map<string, TurnState>();

function getThreadKey(context: GordonContext): string {
  return context.threadId || "default";
}

export function defaultToolFrictionPath(): string {
  const fromEnv = process.env.GORDON_TOOL_FRICTION_PATH;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return join(homedir(), ".gordon", "tool-friction.jsonl");
}

function resolveDefaultThreshold(): number {
  const fromEnv = process.env.GORDON_TOOL_FRICTION_THRESHOLD;
  if (!fromEnv) return DEFAULT_FRICTION_THRESHOLD;
  const parsed = Number(fromEnv);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_FRICTION_THRESHOLD;
}

/**
 * Mark the start of a new user turn for this thread. Resets the tool
 * counter and captures the user message so future friction events can
 * be attributed to a specific question.
 */
export function recordUserTurnStart(
  context: GordonContext,
  userMessage?: string,
): void {
  const key = getThreadKey(context);
  const now = Date.now();
  turnStateByThread.set(key, {
    startedAt: now,
    lastToolCallAt: now,
    toolNames: [],
    ...(typeof userMessage === "string" && userMessage.length > 0 && { userMessage }),
    frictionFired: false,
  });
}

/**
 * Record one tool call in the current turn. Returns the running count,
 * the threshold, and a `frictionTriggered` flag set on the call that
 * crosses the threshold (only fires once per turn). When triggered, also
 * appends to ~/.gordon/tool-friction.jsonl and emits a structured
 * observation unless `suppressFire` is set.
 */
export function recordToolCallForFriction(
  context: GordonContext,
  toolName: string,
  options: RecordToolCallOptions = {},
): RecordToolCallResult {
  const key = getThreadKey(context);
  const now = Date.now();
  let state = turnStateByThread.get(key);
  if (!state || now - state.lastToolCallAt > TURN_IDLE_RESET_MS) {
    state = {
      startedAt: now,
      lastToolCallAt: now,
      toolNames: [],
      frictionFired: false,
    };
    turnStateByThread.set(key, state);
  }
  state.toolNames.push(toolName);
  state.lastToolCallAt = now;

  const threshold = options.thresholdOverride ?? resolveDefaultThreshold();
  const count = state.toolNames.length;
  const triggered = !state.frictionFired && count >= threshold;
  if (triggered) state.frictionFired = true;

  const result: RecordToolCallResult = {
    count,
    threshold,
    frictionTriggered: triggered,
    toolNames: [...state.toolNames],
    ...(state.userMessage !== undefined && { userMessage: state.userMessage }),
    turnStartedAt: state.startedAt,
    turnDurationMs: now - state.startedAt,
  };

  if (triggered && !options.suppressFire) {
    const entry: ToolFrictionEntry = {
      observedAt: new Date(now).toISOString(),
      threadId: key,
      ...(state.userMessage !== undefined && { userMessage: state.userMessage }),
      toolNames: result.toolNames,
      count,
      threshold,
      turnDurationMs: result.turnDurationMs,
    };
    appendToolFrictionEvent(entry);
    try {
      recordStructuredObservation({
        eventType: "agent.tool_friction_observed",
        outcome: "info",
        workflow: "agentic_search",
        component: "tool_friction_tracker",
        ...(context.threadId && { threadId: context.threadId }),
        toolName,
        reason:
          `tool-stack friction: ${count} tool calls in turn` +
          (state.userMessage ? ` for "${state.userMessage.slice(0, 80)}"` : ""),
        actionCount: count,
        durationMs: result.turnDurationMs,
        details: {
          toolNames: result.toolNames,
          threshold,
          userMessage: state.userMessage,
        },
      });
    } catch {
      // Observability failures must not break tool dispatch.
    }
  }

  return result;
}

/**
 * Append a tool-friction entry to the review-queue jsonl. Failure is
 * swallowed (observability cannot block tool dispatch).
 */
export function appendToolFrictionEvent(
  entry: ToolFrictionEntry,
  path: string = defaultToolFrictionPath(),
): { written: boolean; path: string; error?: string } {
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(entry) + "\n", { encoding: "utf-8" });
    return { written: true, path };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { written: false, path, error: msg };
  }
}

/**
 * Read all tool-friction entries from disk, oldest first. Skips malformed
 * lines silently. Returns [] if the file does not exist.
 */
export function readToolFrictionEvents(
  path: string = defaultToolFrictionPath(),
): ReadonlyArray<ToolFrictionEntry> {
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, { encoding: "utf-8" });
    const out: ToolFrictionEntry[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      try {
        out.push(JSON.parse(trimmed) as ToolFrictionEntry);
      } catch {
        // skip malformed
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Reset the turn state for a thread. Used by /clear and by tests. */
export function resetToolFrictionForThread(context: GordonContext): void {
  turnStateByThread.delete(getThreadKey(context));
}

/** Test helper — wipe all in-memory turn state. */
export function __resetAllToolFrictionStateForTests(): void {
  turnStateByThread.clear();
}
