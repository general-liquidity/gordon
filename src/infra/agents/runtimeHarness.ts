import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { listActionLogEntries } from "../action-log/store.ts";
import type { GordonContext } from "./types.ts";
import { determineWorkflowPhase, getPhasePromptGuidance, isExecutionPhase, type WorkflowPhase } from "./workflowPhase.ts";

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

const PLANNING_ARTIFACT_TTL_MS = 15 * 60 * 1000;
const LOOP_WINDOW_MS = 30_000;
const LOOP_WINDOW_CALL_COUNT = 20; // sliding window of last N tool call fingerprints
const LOOP_BLOCK_THRESHOLD = 3;
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
  // 1. Plan lifecycle — no plan prepared yet for planning phase
  if (phase === "planning") {
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
  if (phase === "execution") {
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
    state.venueFailureCount >= 2 &&
    Date.now() - state.lastVenueFailure < VENUE_FAILURE_WINDOW_MS
  ) {
    if (canFireReminder(state, "venue_failure", 3)) {
      reminders.push("Venue data requests have failed repeatedly in this thread. Keep the response read-only and note that live market data may be unavailable.");
      markReminderFired(state, "venue_failure");
    }
  }

  // 4. Stale mandate — execution phase with no active action ID
  if (phase === "execution" && !context.requestedActionId) {
    if (!state.staleMandateWarned && canFireReminder(state, "stale_mandate", 1, true)) {
      reminders.push("No active action mandate is set for this thread. Confirm the intended symbol and direction before proceeding with any execution step.");
      state.staleMandateWarned = true;
      markReminderFired(state, "stale_mandate");
    }
  }

  // 5. Repeated loop — fingerprint doom-loop detected in call log
  const callLog = loopCallLogs.get(threadKey) ?? [];
  if (callLog.length >= LOOP_WINDOW_CALL_COUNT) {
    const fingerprints = new Map<string, number>();
    for (const fp of callLog) {
      fingerprints.set(fp, (fingerprints.get(fp) ?? 0) + 1);
    }
    const maxRepeat = Math.max(...fingerprints.values());
    if (maxRepeat >= LOOP_BLOCK_THRESHOLD && !reminders.some((r) => r.includes("identical")) && canFireReminder(state, "repeated_loop", 2)) {
      reminders.push("Repeated identical tool invocations detected. Change approach, venue, or scope before retrying the same action.");
      markReminderFired(state, "repeated_loop");
    }
  }

  const recentEntries = context.threadId
    ? listActionLogEntries({ threadId: context.threadId, limit: 30 })
    : [];
  const recentToolCalls = recentEntries.filter((entry) => entry.entryType === "tool_call");
  const recentStatuses = recentEntries.filter((entry) => entry.entryType === "run_status");

  // 6. Task lifecycle — approved plan exists but no preview/execution follow-up yet
  const artifact = planningArtifacts.get(threadKey);
  if (artifact?.approved && artifact.extractedTasks.length > 0 && canFireReminder(state, "task_lifecycle", 2)) {
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
}

/**
 * Record a tool call fingerprint and detect doom-loops using a sliding call-count window.
 * More reliable than time-based windowing for detecting repeated identical calls.
 *
 * @param context  - Gordon context (for thread key)
 * @param toolName - Name of the tool being called
 * @param args     - Tool arguments (JSON-serialized for fingerprinting)
 * @returns { blocked, count, fingerprint }
 */
export function recordToolCallFingerprint(
  context: GordonContext,
  toolName: string,
  args: unknown,
): { blocked: boolean; count: number; fingerprint: string } {
  const fingerprint = createHash("md5")
    .update(toolName + ":" + JSON.stringify(args ?? {}))
    .digest("hex")
    .slice(0, 16);

  const threadKey = getThreadKey(context);
  const existing = loopCallLogs.get(threadKey) ?? [];
  const updated = [...existing, fingerprint].slice(-LOOP_WINDOW_CALL_COUNT);
  loopCallLogs.set(threadKey, updated);

  const count = updated.filter((f) => f === fingerprint).length;
  return {
    blocked: count >= LOOP_BLOCK_THRESHOLD,
    count,
    fingerprint,
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

function buildPreviewText(serialized: string): string {
  if (serialized.length <= TOOL_RESULT_PREVIEW_LIMIT) {
    return serialized;
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

  const bytes = Buffer.byteLength(serialized, "utf8");
  const inlineLimit = getToolFamilyLimit(toolName);
  if (bytes <= inlineLimit) {
    return {
      result,
      offloaded: false,
      previewText: buildPreviewText(serialized),
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
      preview: buildPreviewText(serialized),
      bytes,
      toolName,
    },
    offloaded: true,
    scratchFile,
    previewText: buildPreviewText(serialized),
    bytes,
  };
}
