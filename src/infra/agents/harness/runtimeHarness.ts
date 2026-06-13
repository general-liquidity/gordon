import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { listActionLogEntries } from "../../action-log/store.ts";
import { digestLargeResult } from "./resultDigest.ts";
import type { GordonContext } from "../types.ts";
import { determineWorkflowPhase, getPhasePromptGuidance, isExecutionPhase, type WorkflowPhase } from "../cognition/workflowPhase.ts";
import { shouldEmitTraderReminders } from "../reminders/traderReminders.ts";
import { dedupeParallelTasks } from "../../../core/pipeline/parallel-task-dedup.ts";

interface PlanningArtifact {
  symbol?: string;
  sourceActionId: string;
  artifactType: "plan" | "preview";
  handoffSummary: string;
  extractedTasks: string[];
  approved: boolean;
  createdAt: number;
  expiresAt: number;
}

interface LoopSignal {
  count: number;
  lastSeenAt: number;
}

interface RecoveryContext {
  toolName?: string;
  phase: WorkflowPhase;
  currentAgent?: string;
  emptyResponse?: boolean;
}

export interface ExecutionReadiness {
  ready: boolean;
  reason?: string;
  artifact?: PlanningArtifact;
}

export interface RecoveryGuidance {
  category:
    | "provider_throttle"
    | "venue_data_failure"
    | "policy_block"
    | "approval_required"
    | "tool_validation"
    | "empty_response"
    | "unknown";
  title: string;
  detail: string;
  nextSteps: string[];
}

export interface OptimizedToolResult {
  result: unknown;
  offloaded: boolean;
  scratchFile?: string;
  previewText?: string;
  bytes?: number;
}

const planningArtifacts = new Map<string, PlanningArtifact>();
const loopSignals = new Map<string, Map<string, LoopSignal>>();
/** Sliding call-count window for fingerprint-based doom-loop detection */
const loopCallLogs = new Map<string, string[]>();
/**
 * Parallel sliding window of decision-SURFACE tokens per call (or null for
 * non-trading calls). Lets the assignment-axis "coherent amplification" check
 * catch many same-symbol/action calls with VARIED args — which the identical-
 * fingerprint doom-loop above misses by construction. See parallel-task-dedup.ts.
 */
const loopSurfaceLogs = new Map<string, (string[] | null)[]>();

const PLANNING_ARTIFACT_TTL_MS = 15 * 60 * 1000;
const LOOP_WINDOW_MS = 30_000;
const LOOP_WINDOW_CALL_COUNT = 20; // sliding window of last N tool call fingerprints
const LOOP_BLOCK_THRESHOLD = 3;
/** Min surfaced (trading) calls in-window before the coherent-amplification check runs. */
const COHERENT_AMP_MIN_CALLS = 4;
/** Redundant calls (collapsed by dedup) at/above which amplification is flagged. */
const COHERENT_AMP_DROP_THRESHOLD = 3;

/** Extract a decision surface (symbol + action) from a tool call, or null if non-trading. */
function extractCallSurface(toolName: string, args: unknown): string[] | null {
  if (!args || typeof args !== "object") return null;
  const a = args as Record<string, unknown>;
  const symbol = a.symbol ?? a.ticker ?? a.pair ?? a.instrument;
  if (typeof symbol !== "string" || symbol.length === 0) return null;
  const surface = [`tool:${toolName.toLowerCase()}`, `sym:${symbol.toLowerCase()}`];
  const action = a.action ?? a.side ?? a.direction;
  if (typeof action === "string" && action.length > 0) surface.push(`act:${action.toLowerCase()}`);
  return surface;
}
/** Longest repeating tool-call cycle (A-B-A-B…) to scan for. */
const CYCLE_MAX_LEN = 5;
/**
 * A cycle block must recur at least this many times to count as a doom-loop.
 * 2 (not 3) is deliberate: a cycle that repeats 3× makes each member appear 3×,
 * which the identical-count check (threshold 3) already catches — so the cycle
 * detector only adds value at 2 round trips (A-B-A-B), where each member appears
 * just twice and the count-based check misses it. The recovery escalation
 * (notify→redirect→force_stop) cushions any false positive on read-only tools;
 * safety-critical tools fast-track to force_stop regardless.
 */
const CYCLE_MIN_REPEATS = 2;
/** @deprecated use per-tool-family limits via getToolFamilyLimit() */
export const TOOL_RESULT_INLINE_LIMIT = 2500;
const TOOL_RESULT_PREVIEW_LIMIT = 600;

// Per-tool-family inline limits (chars). Trading payloads vary widely in noise level.
const TOOL_RESULT_LIMITS: Record<string, number> = {
  // Structured financial payloads — valuable, allow more
  market: 6000,
  account: 5000,
  order: 5000,
  position: 5000,
  portfolio: 5000,
  price: 4000,
  ticker: 4000,
  candle: 3500,
  chart: 3500,
  prediction: 4000,
  analysis: 4000,
  plan: 4000,
  backtest: 4000,
  filing: 12000, // SEC filing text (get_filing_text) — section bodies are long; let the model read a real chunk before spill

  // Raw/noisy protocol outputs — keep small
  raw: 800,
  log: 800,
  status: 1200,
  ping: 400,
  // Default fallback
  default: 2500,
};

function getToolFamilyLimit(toolName: string): number {
  const lower = toolName.toLowerCase();
  for (const [family, limit] of Object.entries(TOOL_RESULT_LIMITS)) {
    if (family === "default") continue;
    if (lower.includes(family)) return limit;
  }
  return TOOL_RESULT_LIMITS.default ?? 2500;
}

// ─── Reminder state tracking (one-shot flags + counters per thread) ──────────
interface ReminderState {
  planApprovedInjected: boolean;
  executionBlockedWarned: boolean;
  venueFailureCount: number;
  lastVenueFailure: number;
  staleMandateWarned: boolean;
  noPlanWarned: boolean;
  reminderAttempts: Record<string, number>;
}

const reminderStateMap = new Map<string, ReminderState>();

function getOrCreateReminderState(threadKey: string): ReminderState {
  if (!reminderStateMap.has(threadKey)) {
    reminderStateMap.set(threadKey, {
      planApprovedInjected: false,
      executionBlockedWarned: false,
      venueFailureCount: 0,
      lastVenueFailure: 0,
      staleMandateWarned: false,
      noPlanWarned: false,
      reminderAttempts: {},
    });
  }
  return reminderStateMap.get(threadKey)!;
}

function canFireReminder(
  state: ReminderState,
  key: string,
  maxAttempts = 3,
  once: boolean = false,
): boolean {
  const attempts = state.reminderAttempts[key] ?? 0;
  if (once) {
    return attempts === 0;
  }
  return attempts < maxAttempts;
}

function markReminderFired(state: ReminderState, key: string): void {
  state.reminderAttempts[key] = (state.reminderAttempts[key] ?? 0) + 1;
}

export function recordVenueFailure(context: GordonContext): void {
  const key = getThreadKey(context);
  const state = getOrCreateReminderState(key);
  state.venueFailureCount += 1;
  state.lastVenueFailure = Date.now();

  // Fire an alert once per failure-count threshold per thread. The existing
  // reminder at count ≥ 2 (below, in evaluateReminders) is an in-conversation
  // hint; this alert is the operator-facing signal that the bus/TUI renders.
  if (state.venueFailureCount === 3 || state.venueFailureCount === 6) {
    void import("../../platform/observability/alertEmitter.ts").then((m) => {
      void m.emitAlert({
        level: state.venueFailureCount >= 6 ? "critical" : "warning",
        category: "venue",
        message: `Venue failures crossed ${state.venueFailureCount} in this session.`,
        context: { threadKey: key, failureCount: state.venueFailureCount },
        dedupeKey: `venue-failure:${key}:${state.venueFailureCount}`,
      });
    }).catch(() => { /* alert emission is best-effort */ });
  }
}

export function resetReminderState(context: GordonContext): void {
  reminderStateMap.delete(getThreadKey(context));
}
// ─────────────────────────────────────────────────────────────────────────────

function getThreadKey(context: GordonContext): string {
  return context.threadId || "default";
}

export function registerPlanningArtifact(
  context: GordonContext,
  input: {
    symbol?: string;
    artifactType?: "plan" | "preview";
    handoffSummary?: string;
    extractedTasks?: string[];
    approved?: boolean;
  },
): void {
  const threadKey = getThreadKey(context);
  planningArtifacts.set(threadKey, {
    symbol: typeof input.symbol === "string" ? input.symbol.toUpperCase() : undefined,
    sourceActionId: context.requestedActionId ?? "planning",
    artifactType: input.artifactType ?? "plan",
    handoffSummary: input.handoffSummary ?? "Recent planning artifact available in this thread.",
    extractedTasks: input.extractedTasks?.filter(Boolean) ?? [],
    approved: input.approved ?? false,
    createdAt: Date.now(),
    expiresAt: Date.now() + PLANNING_ARTIFACT_TTL_MS,
  });
}

export function registerPlanningArtifactFromResult(
  context: GordonContext,
  toolName: string,
  result: unknown,
): void {
  const symbol = extractSymbolFromUnknownResult(result);
  const summary = extractPlanningSummary(result, toolName);
  const extractedTasks = extractPlanningTasks(result, toolName);
  const success = typeof result === "object" && result !== null
    ? ((result as Record<string, unknown>).success !== false)
    : true;
  registerPlanningArtifact(context, {
    symbol,
    artifactType: toolName === "preview_market_order" ? "preview" : "plan",
    handoffSummary: summary,
    extractedTasks,
    approved: toolName === "preview_market_order" && success,
  });
}

export function getPlanningHandoff(context: GordonContext, symbol?: string): PlanningArtifact | null {
  const readiness = getExecutionReadiness(context, symbol);
  return readiness.artifact ?? null;
}

export function formatPlanningHandoffBlock(artifact: PlanningArtifact | null): string {
  if (!artifact) {
    return "";
  }

  const lines = [
    "[GORDON_PLANNING_HANDOFF]",
    `- Artifact type: ${artifact.artifactType}`,
    `- Source action: ${artifact.sourceActionId}`,
    `- Symbol: ${artifact.symbol ?? "unspecified"}`,
    `- Approved for execution handoff: ${artifact.approved ? "yes" : "no"}`,
    `- Summary: ${artifact.handoffSummary}`,
  ];

  if (artifact.extractedTasks.length > 0) {
    lines.push("- Extracted tasks:");
    for (const task of artifact.extractedTasks) {
      lines.push(`  - ${task}`);
    }
  }

  return lines.join("\n");
}

export function getExecutionReadiness(
  context: GordonContext,
  symbol?: string,
): ExecutionReadiness {
  const phase = determineWorkflowPhase(context);
  if (!isExecutionPhase(phase)) {
    return { ready: true };
  }

  if (context.config.permissionMode === "strict") {
    return {
      ready: false,
      reason: "Live execution is blocked because permissionMode is 'strict' (read-only).",
    };
  }

  const threadKey = getThreadKey(context);
  const artifact = planningArtifacts.get(threadKey);
  if (!artifact || artifact.expiresAt < Date.now()) {
    planningArtifacts.delete(threadKey);
    return {
      ready: false,
      reason: "Execution requires a recent plan or order preview in this thread first.",
    };
  }

  const normalizedSymbol = symbol?.toUpperCase();
  if (normalizedSymbol && artifact.symbol && artifact.symbol !== normalizedSymbol) {
    return {
      ready: false,
      reason: `Execution is primed for ${artifact.symbol}, not ${normalizedSymbol}. Refresh the plan or preview for the symbol you want to trade.`,
      artifact,
    };
  }

  if (!artifact.approved) {
    return {
      ready: false,
      reason: "Execution requires a recent approved preview or explicit execution-ready handoff in this thread.",
      artifact,
    };
  }

  return { ready: true, artifact };
}

export function buildEventDrivenReminders(
  context: GordonContext,
  phase: WorkflowPhase,
): string[] {
  const reminders: string[] = [...getPhasePromptGuidance(phase)];
  const threadKey = getThreadKey(context);
  const state = getOrCreateReminderState(threadKey);

  if (phase === "execution") {
    const readiness = getExecutionReadiness(context);
    if (!readiness.ready && readiness.reason) {
      if (!state.executionBlockedWarned) {
        reminders.push(readiness.reason);
        state.executionBlockedWarned = true;
      }
    }
    if (context.credentialProfile && context.credentialProfile !== "live") {
      reminders.push(`Current credential profile is ${context.credentialProfile}; confirm the target execution profile before live orders.`);
    }
  }

  if ((phase === "planning" || phase === "analysis") && !context.exchange && !context.broker) {
    reminders.push("No active venue is connected. Keep the answer read-only and note that live venue-backed checks are unavailable.");
  }

  // ─── Trading-specific reminder categories ──────────────────────────────────
  // Gated by GORDON_TRADER_REMINDERS env var via shouldEmitTraderReminders().
  // The "force_off" path lets operators temporarily suppress all six categories
  // for diagnostic A/B comparisons without code changes.
  const emitTraderReminders = shouldEmitTraderReminders();
  // 1. Plan lifecycle — no plan prepared yet for planning phase
  if (emitTraderReminders && phase === "planning") {
    const artifact = planningArtifacts.get(threadKey);
    if (!artifact || artifact.expiresAt < Date.now()) {
      if (!state.noPlanWarned && canFireReminder(state, "plan_missing", 1, true)) {
        reminders.push("No trade plan has been prepared yet for this thread. Begin with analysis before proposing execution steps.");
        state.noPlanWarned = true;
        markReminderFired(state, "plan_missing");
      }
    }
  }

  // 2. Execution approval — artifact exists but not approved
  if (emitTraderReminders && phase === "execution") {
    const artifact = planningArtifacts.get(threadKey);
    if (artifact && artifact.expiresAt >= Date.now() && !artifact.approved) {
      if (canFireReminder(state, "execution_unapproved", 2)) {
        reminders.push("An execution step was requested but the current plan has not been explicitly approved. Present the plan summary and request confirmation before placing any live order.");
        markReminderFired(state, "execution_unapproved");
      }
    } else if (artifact?.approved && !state.planApprovedInjected) {
      if (canFireReminder(state, "plan_approved_signal", 1, true)) {
        reminders.push("A recent approved plan is available in this thread. Use that approved intent as the execution boundary and do not expand scope without a fresh preview.");
        markReminderFired(state, "plan_approved_signal");
      }
      state.planApprovedInjected = true;
    }
  }

  // 3. Repeated venue failure (2+ failures within 5 minutes)
  const VENUE_FAILURE_WINDOW_MS = 5 * 60 * 1000;
  if (
    emitTraderReminders &&
    state.venueFailureCount >= 2 &&
    Date.now() - state.lastVenueFailure < VENUE_FAILURE_WINDOW_MS
  ) {
    if (canFireReminder(state, "venue_failure", 3)) {
      reminders.push("Venue data requests have failed repeatedly in this thread. Keep the response read-only and note that live market data may be unavailable.");
      markReminderFired(state, "venue_failure");
    }
  }

  // 4. Stale mandate — execution phase with no active action ID
  if (emitTraderReminders && phase === "execution" && !context.requestedActionId) {
    if (!state.staleMandateWarned && canFireReminder(state, "stale_mandate", 1, true)) {
      reminders.push("No active action mandate is set for this thread. Confirm the intended symbol and direction before proceeding with any execution step.");
      state.staleMandateWarned = true;
      markReminderFired(state, "stale_mandate");
    }
  }

  // 5. Repeated loop — fingerprint doom-loop detected in call log
  const callLog = loopCallLogs.get(threadKey) ?? [];
  if (emitTraderReminders && callLog.length >= LOOP_WINDOW_CALL_COUNT) {
    const fingerprints = new Map<string, number>();
    for (const fp of callLog) {
      fingerprints.set(fp, (fingerprints.get(fp) ?? 0) + 1);
    }
    const maxRepeat = Math.max(...fingerprints.values());
    if (maxRepeat >= LOOP_BLOCK_THRESHOLD && !reminders.some((r) => r.includes("identical")) && canFireReminder(state, "repeated_loop", 2)) {
      reminders.push("Repeated identical tool invocations detected. Change approach, venue, or scope before retrying the same action.");
      markReminderFired(state, "repeated_loop");
    }
    const cycle = detectFingerprintCycle(callLog);
    if (cycle && !reminders.some((r) => r.includes("cycle")) && canFireReminder(state, "repeated_cycle", 2)) {
      reminders.push(`Repeating ${cycle.cycleLen}-step tool cycle detected (${cycle.repeats}× round trips of the same action sequence). You're looping between the same calls without making progress — change approach or scope, or stop and summarize what you have.`);
      markReminderFired(state, "repeated_cycle");
    }

    // Assignment-axis amplification: many trading calls on the SAME decision surface
    // (symbol/action) with varied args — coherent-but-distinct, so the identical-
    // fingerprint/cycle checks above miss it. (goal-blast-radius assignment axis.)
    const surfaceLog = loopSurfaceLogs.get(threadKey) ?? [];
    const surfacedTasks = surfaceLog
      .map((s, i) => (s ? { id: String(i), surface: s } : null))
      .filter((t): t is { id: string; surface: string[] } => t !== null);
    if (
      surfacedTasks.length >= COHERENT_AMP_MIN_CALLS &&
      !reminders.some((r) => r.includes("identical") || r.includes("cycle")) &&
      canFireReminder(state, "coherent_amplification", 2)
    ) {
      const dedupe = dedupeParallelTasks(surfacedTasks);
      if (dedupe.dropped.length >= COHERENT_AMP_DROP_THRESHOLD) {
        reminders.push(
          `Coherent-action amplification: ${surfacedTasks.length} recent trading calls collapse to ${dedupe.reducedTo} distinct decision surface(s) (same symbol/action, varied args). You may be amplifying one decision across many calls — consolidate, size once, or stop.`,
        );
        markReminderFired(state, "coherent_amplification");
      }
    }
  }

  const recentEntries = context.threadId
    ? listActionLogEntries({ threadId: context.threadId, limit: 30 })
    : [];
  const recentToolCalls = recentEntries.filter((entry) => entry.entryType === "tool_call");
  const recentStatuses = recentEntries.filter((entry) => entry.entryType === "run_status");

  // 6. Incomplete runtime task — approved plan with outstanding next-steps
  const artifact = planningArtifacts.get(threadKey);
  if (emitTraderReminders && artifact?.approved && artifact.extractedTasks.length > 0 && canFireReminder(state, "task_lifecycle", 2)) {
    reminders.push(`There is an approved trade artifact with outstanding next steps (${artifact.extractedTasks.slice(0, 3).join("; ")}). Do not claim completion until those steps are either executed or explicitly deferred.`);
    markReminderFired(state, "task_lifecycle");
  }

  // 7. Behavioral — too many read-only analysis calls without narrowing scope
  const readOnlyHeavyCalls = recentToolCalls
    .slice(0, 10)
    .filter((entry) => /scan|analy|market|chart|ta|predict|regime/i.test(`${entry.title} ${entry.content}`));
  if (readOnlyHeavyCalls.length >= 5 && canFireReminder(state, "behavior_read_only_loop", 2)) {
    reminders.push("Several read-only market-analysis steps have already run in this thread. Narrow the symbol, timeframe, or requested outcome before requesting more exploratory scans.");
    markReminderFired(state, "behavior_read_only_loop");
  }

  // 8. Error recovery nudges selected from recent failure classes
  const recentFailureText = recentStatuses
    .slice(0, 8)
    .map((entry) => `${entry.title} ${entry.content}`.toLowerCase());
  if (recentFailureText.some((text) => text.includes("rate limit") || text.includes("429")) && canFireReminder(state, "error_rate_limit", 2)) {
    reminders.push("Recent provider throttling was detected. Retry with a narrower request or wait for the rate-limit window to cool down before repeating the same path.");
    markReminderFired(state, "error_rate_limit");
  }
  if (recentFailureText.some((text) => text.includes("approval") || text.includes("blocked")) && canFireReminder(state, "error_approval", 2)) {
    reminders.push("A recent request was blocked by approval or policy controls. Present the missing approval step explicitly instead of retrying the blocked action verbatim.");
    markReminderFired(state, "error_approval");
  }
  if (recentFailureText.some((text) => text.includes("empty response")) && canFireReminder(state, "error_empty_response", 2)) {
    reminders.push("A recent model call returned an empty response. Prefer a smaller, more concrete follow-up request or switch workflow phase before retrying.");
    markReminderFired(state, "error_empty_response");
  }
  if (recentFailureText.some((text) => text.includes("validation")) && canFireReminder(state, "error_validation", 2)) {
    reminders.push("Recent tool input validation failed. Normalize the requested symbol, venue, or parameters before retrying the same tool path.");
    markReminderFired(state, "error_validation");
  }
  // ─────────────────────────────────────────────────────────────────────────

  return [...new Set(reminders)].slice(0, 8);
}

export function recordLoopSignal(
  context: GordonContext,
  signature: string,
): { blocked: boolean; count: number } {
  const threadKey = getThreadKey(context);
  const now = Date.now();
  let threadSignals = loopSignals.get(threadKey);
  if (!threadSignals) {
    threadSignals = new Map<string, LoopSignal>();
    loopSignals.set(threadKey, threadSignals);
  }

  const existing = threadSignals.get(signature);
  if (!existing || now - existing.lastSeenAt > LOOP_WINDOW_MS) {
    threadSignals.set(signature, { count: 1, lastSeenAt: now });
    return { blocked: false, count: 1 };
  }

  existing.count += 1;
  existing.lastSeenAt = now;
  return {
    blocked: existing.count >= LOOP_BLOCK_THRESHOLD,
    count: existing.count,
  };
}

export function resetLoopSignals(context: GordonContext): void {
  const key = getThreadKey(context);
  loopSignals.delete(key);
  loopCallLogs.delete(key);
  loopSurfaceLogs.delete(key);
}

/**
 * Detect a repeating multi-step cycle (A-B-A-B…) at the tail of a fingerprint
 * window. The identical-repeat count catches one tool hammered N times; this
 * catches the "different-but-coherent amplification" loop the count-based check
 * misses — e.g. place_order → check_balance → place_order → check_balance …
 * Returns the SHORTEST cycle whose block recurs ≥ minRepeats times, or null.
 * Degenerate single-fingerprint blocks are left to the identical-count check
 * (we require ≥ 2 distinct fingerprints in the block), so the two detectors
 * don't double-count the same loop.
 */
export function detectFingerprintCycle(
  fingerprints: readonly string[],
  maxCycleLen: number = CYCLE_MAX_LEN,
  minRepeats: number = CYCLE_MIN_REPEATS,
): { cycleLen: number; repeats: number } | null {
  const n = fingerprints.length;
  for (let len = 2; len <= maxCycleLen; len++) {
    if (n < len * minRepeats) continue;
    const block = fingerprints.slice(n - len);
    if (new Set(block).size < 2) continue; // single-fp loop → identical check owns it
    let repeats = 1;
    let pos = n - len;
    while (pos - len >= 0) {
      let same = true;
      for (let i = 0; i < len; i++) {
        if (fingerprints[pos - len + i] !== block[i]) {
          same = false;
          break;
        }
      }
      if (!same) break;
      repeats += 1;
      pos -= len;
    }
    if (repeats >= minRepeats) return { cycleLen: len, repeats };
  }
  return null;
}

/**
 * Record a tool call fingerprint and detect doom-loops using a sliding call-count window.
 * More reliable than time-based windowing for detecting repeated identical calls.
 * Flags BOTH identical-repeat loops (same call ≥ threshold) and repeating
 * multi-step cycles (A-B-A-B…) via `detectFingerprintCycle`.
 *
 * @param context  - Gordon context (for thread key)
 * @param toolName - Name of the tool being called
 * @param args     - Tool arguments (JSON-serialized for fingerprinting)
 * @returns { blocked, count, fingerprint, cycle }
 */
export function recordToolCallFingerprint(
  context: GordonContext,
  toolName: string,
  args: unknown,
): { blocked: boolean; count: number; fingerprint: string; cycle: { cycleLen: number; repeats: number } | null } {
  const fingerprint = createHash("md5")
    .update(toolName + ":" + JSON.stringify(args ?? {}))
    .digest("hex")
    .slice(0, 16);

  const threadKey = getThreadKey(context);
  const existing = loopCallLogs.get(threadKey) ?? [];
  const updated = [...existing, fingerprint].slice(-LOOP_WINDOW_CALL_COUNT);
  loopCallLogs.set(threadKey, updated);

  const surface = extractCallSurface(toolName, args);
  const existingSurfaces = loopSurfaceLogs.get(threadKey) ?? [];
  loopSurfaceLogs.set(threadKey, [...existingSurfaces, surface].slice(-LOOP_WINDOW_CALL_COUNT));

  const count = updated.filter((f) => f === fingerprint).length;
  const cycle = detectFingerprintCycle(updated);
  return {
    blocked: count >= LOOP_BLOCK_THRESHOLD || cycle !== null,
    count,
    fingerprint,
    cycle,
  };
}

export function classifyRecoveryGuidance(
  error: Error | string,
  context: GordonContext,
  recoveryContext: RecoveryContext,
): RecoveryGuidance {
  const message = typeof error === "string" ? error : error.message;
  const lower = message.toLowerCase();

  if (lower.includes("rate limit") || lower.includes("429")) {
    return {
      category: "provider_throttle",
      title: "Model provider is rate-limited",
      detail: "The active model provider throttled this request before Gordon could finish the response.",
      nextSteps: [
        "Retry after the rate-limit window cools down.",
        "If the request is urgent, retry manually with the same model or switch models yourself.",
      ],
    };
  }

  if (lower.includes("public api request failed") || lower.includes("unable to fetch") || lower.includes("failed to fetch price")) {
    return {
      category: "venue_data_failure",
      title: "Venue data request failed",
      detail: "A venue or broker data request failed while Gordon was gathering live market context.",
      nextSteps: [
        "Retry after the venue recovers.",
        "If the venue remains unstable, switch to a different active venue or keep the request read-only.",
      ],
    };
  }

  if (lower.includes("armed mode") || lower.includes("safe mode") || lower.includes("blocked")) {
    return {
      category: "policy_block",
      title: "Policy blocked the action",
      detail: "Gordon intentionally blocked the request because the current safety or execution policy does not allow it.",
      nextSteps: [
        "Review the mode, profile, and plan blockers in the current thread.",
        "Move back to planning or preview first, then retry the execution step.",
      ],
    };
  }

  if (lower.includes("approval")) {
    return {
      category: "approval_required",
      title: "Approval is required",
      detail: "This request needs an explicit approval step before Gordon can proceed.",
      nextSteps: [
        "Confirm the plan or order details in-thread.",
        "Then retry the execution step once approval requirements are satisfied.",
      ],
    };
  }

  if (lower.includes("validation failed") || lower.includes("too small") || lower.includes("invalid")) {
    return {
      category: "tool_validation",
      title: "Tool input validation failed",
      detail: recoveryContext.toolName
        ? `${recoveryContext.toolName} rejected the provided arguments.`
        : "A tool rejected the provided arguments.",
      nextSteps: [
        "Check the command arguments and required fields.",
        "Retry with explicit symbol, sizing, or venue details if the tool needs them.",
      ],
    };
  }

  if (recoveryContext.emptyResponse) {
    return {
      category: "empty_response",
      title: "Empty response",
      detail: "Model returned no output. Try /model to switch or retry your message.",
      nextSteps: [],
    };
  }

  return {
    category: "unknown",
    title: "Request failed",
    detail: `The ${recoveryContext.phase} phase failed${recoveryContext.currentAgent ? ` while routed through ${recoveryContext.currentAgent}` : ""}.`,
    nextSteps: [
      "Retry with a narrower request.",
      "If the failure repeats, inspect venue, provider, and mode state before retrying.",
    ],
  };
}

export function formatRecoveryGuidance(guidance: RecoveryGuidance): string {
  const lines = [
    `${guidance.title}.`,
    guidance.detail,
  ];

  if (guidance.nextSteps.length > 0) {
    lines.push("", `Try: ${guidance.nextSteps.join(" ")}`);
  }

  return lines.join("\n");
}

function buildPreviewText(serialized: string, result?: unknown): string {
  if (serialized.length <= TOOL_RESULT_PREVIEW_LIMIT) {
    return serialized;
  }
  // For a large tabular result, a sample-with-totals digest beats a blind
  // head-slice — the model gets the row count + column aggregates + a sample
  // instead of just the first N chars. Falls back to truncation otherwise.
  if (result !== undefined) {
    const digest = digestLargeResult(result, { sampleRows: 4, maxChars: TOOL_RESULT_PREVIEW_LIMIT * 2 });
    if (digest) return digest;
  }
  return `${serialized.slice(0, TOOL_RESULT_PREVIEW_LIMIT)}…`;
}

function extractSymbolFromUnknownResult(result: unknown): string | undefined {
  if (!result || typeof result !== "object") {
    return undefined;
  }

  const record = result as Record<string, unknown>;
  const directSymbol = typeof record.symbol === "string" ? record.symbol : undefined;
  if (directSymbol) {
    return directSymbol.toUpperCase();
  }

  for (const key of ["plan", "preview", "result"] as const) {
    const nested = record[key];
    if (nested && typeof nested === "object" && typeof (nested as Record<string, unknown>).symbol === "string") {
      return ((nested as Record<string, unknown>).symbol as string).toUpperCase();
    }
  }

  return undefined;
}

function extractPlanningSummary(result: unknown, toolName: string): string {
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    for (const key of ["summary", "message", "reasoning", "recommendation"] as const) {
      if (typeof record[key] === "string" && record[key].trim().length > 0) {
        return record[key] as string;
      }
    }
    if (record.plan && typeof record.plan === "object") {
      const plan = record.plan as Record<string, unknown>;
      const entry = typeof plan.entry === "number" || typeof plan.entry === "string" ? String(plan.entry) : undefined;
      const stopLoss = typeof plan.stopLoss === "number" || typeof plan.stopLoss === "string" ? String(plan.stopLoss) : undefined;
      const takeProfit = typeof plan.takeProfit === "number" || typeof plan.takeProfit === "string" ? String(plan.takeProfit) : undefined;
      const parts = [
        entry ? `entry ${entry}` : null,
        stopLoss ? `stop ${stopLoss}` : null,
        takeProfit ? `target ${takeProfit}` : null,
      ].filter(Boolean);
      if (parts.length > 0) {
        return `Recent plan prepared with ${parts.join(", ")}.`;
      }
    }
  }

  return toolName === "preview_market_order"
    ? "Recent execution preview available in this thread."
    : "Recent trade plan available in this thread.";
}

function extractPlanningTasks(result: unknown, toolName: string): string[] {
  const tasks: string[] = [];
  if (toolName !== "preview_market_order") {
    tasks.push("Review the plan summary and confirm the intended symbol, direction, and sizing.");
  }
  tasks.push("Check runtime blockers before placing a live order.");
  tasks.push("Use the preview or execution surface only after the plan is explicit in-thread.");

  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    const plan = (record.plan && typeof record.plan === "object" ? record.plan : record.preview && typeof record.preview === "object" ? record.preview : null) as Record<string, unknown> | null;
    if (plan) {
      if (plan.entry !== undefined) tasks.unshift(`Use entry reference ${String(plan.entry)}.`);
      if (plan.stopLoss !== undefined) tasks.push(`Honor stop-loss ${String(plan.stopLoss)} unless a new approved plan supersedes it.`);
      if (plan.takeProfit !== undefined) tasks.push(`Honor take-profit ${String(plan.takeProfit)} unless a new approved plan supersedes it.`);
    }
  }

  return [...new Set(tasks)];
}

/**
 * Tool name patterns whose output is known to be noisy/verbose and benefits
 * from error-only filtering when GORDON_ERROR_ONLY_FILTER is on. Conservative
 * allow-list — filtering anything market-data or strategy-related is wrong
 * because the agent needs the full signal, not just errors.
 */
const ERROR_ONLY_FILTERABLE_TOOLS = new Set<string>([
  "run_test",
  "run_verification",
  "run_typecheck",
  "run_lint",
  "reconcile_position",
  "reconcile_orders",
  "validate_strategy",
  "verify_plan",
  "check_balances",
]);

export async function optimizeToolResultForContext(
  context: GordonContext,
  toolName: string,
  result: unknown,
): Promise<OptimizedToolResult> {
  let serialized: string;
  try {
    serialized = typeof result === "string" ? result : JSON.stringify(result, null, 2);
  } catch {
    serialized = String(result);
  }

  // R2 wire: when the error-only filter flag is on AND this tool is in
  // the conservative filterable allow-list, run the filter first so
  // success-only output collapses to a single OK line and only error
  // lines reach the agent. Failures here must not break the path —
  // catch and fall through to the raw result.
  try {
    const { isErrorOnlyFilterEnabled, filterOutputForAgent } = await import(
      "../runtime/errorOnlyOutputFilter.ts"
    );
    if (isErrorOnlyFilterEnabled() && ERROR_ONLY_FILTERABLE_TOOLS.has(toolName)) {
      serialized = filterOutputForAgent(serialized, { contextBefore: 2, contextAfter: 1 });
    }
  } catch {
    // filter unavailable — fall through with raw result
  }

  const bytes = Buffer.byteLength(serialized, "utf8");
  const inlineLimit = getToolFamilyLimit(toolName);
  if (bytes <= inlineLimit) {
    return {
      result,
      offloaded: false,
      previewText: buildPreviewText(serialized, result),
      bytes,
    };
  }

  const dir = path.join(os.tmpdir(), "gordon-tool-results", getThreadKey(context));
  await mkdir(dir, { recursive: true });
  const filename = `${Date.now()}-${toolName}.json`;
  const scratchFile = path.join(dir, filename);
  await writeFile(scratchFile, serialized, "utf8");

  return {
    result: {
      offloaded: true,
      scratchFile,
      preview: buildPreviewText(serialized, result),
      bytes,
      toolName,
    },
    offloaded: true,
    scratchFile,
    previewText: buildPreviewText(serialized),
    bytes,
  };
}
