/**
 * In-loop async background tool dispatch.
 *
 * Today a slow tool call blocks the agent's turn end-to-end. This module
 * lets a tool that is *explicitly flagged* `backgroundEligible: true` run
 * asynchronously off the critical path; when it finishes, its result is
 * surfaced for re-injection into the conversation so the agent can react
 * (the Mastra "streamUntilIdle" pattern).
 *
 * ── HARD SAFETY INVARIANT (non-negotiable) ─────────────────────────────────
 * Execution / money tools MUST NEVER be background-dispatched. They always
 * run foreground/synchronously so the human-in-the-loop, risk gate, and
 * audit trail observe them inline on the turn that issued them. The
 * safety-critical deny-list is the single source of truth (imported from
 * `trustTrajectory.ts`) and it WINS over any `backgroundEligible` flag,
 * always. A tool flagged `backgroundEligible: true` that is ALSO on the
 * deny-list runs foreground — the flag is ignored. This is enforced in
 * `shouldRunInBackground` / `decideDispatch` below, in code, not by
 * convention.
 *
 * v1 keeps everything in-memory — no persistence. In-flight tasks are
 * tracked in a Map and a bounded concurrency cap protects the loop from
 * fan-out (the [[goal-blast-radius-framing]] amplification concern).
 */

import { createModuleLogger } from "../../logger/index.ts";
import { isSafetyCritical } from "../../../runtime/permissions/trustTrajectory.ts";

const logger = createModuleLogger("background-dispatch");

/**
 * Minimal view of a tool definition this module reads. Mastra's
 * `ToolAction` type is closed (no index signature), so the
 * `backgroundEligible` opt-in rides on the created tool object as an
 * extra own-property and is read structurally here. `withToolsMetrics`
 * preserves it via `Object.assign`, so the flag survives instrumentation.
 */
export interface BackgroundEligibleTool {
  id?: string;
  /**
   * Opt-in: when `true`, this tool MAY run in the background — but only
   * if it is NOT on the safety-critical deny-list. Read-only / compute
   * tools only. Never set on a tool that mutates account state.
   */
  backgroundEligible?: boolean;
}

/**
 * Extra deny-list patterns layered on top of `isSafetyCritical` from the
 * trust trajectory. `isSafetyCritical` already covers `execute_plan`,
 * `place_order`, `cancel_order`, `wallet_transfer`, etc. via substring
 * match, but the plan-*approval* gate (`approve_plan`) is a control-flow
 * authority step that must also stay inline — it does not contain any of
 * the existing deny-list substrings. Matched case-insensitively as a
 * substring, same semantics as the trust list.
 */
const EXTRA_BACKGROUND_DENY_PATTERNS: readonly string[] = ["approve_plan"];

/**
 * The hard guard. Returns `true` when a tool must NEVER be backgrounded,
 * regardless of any `backgroundEligible` flag. Layers the trust
 * trajectory's safety-critical deny-list (the single source of truth for
 * execution/money tools) with the plan-approval authority step.
 *
 * This function is the enforcement point for the safety invariant — the
 * deny-list always wins.
 */
export function isBackgroundDenied(toolName: string): boolean {
  if (isSafetyCritical(toolName)) return true;
  const lower = toolName.toLowerCase();
  return EXTRA_BACKGROUND_DENY_PATTERNS.some((p) => lower.includes(p));
}

/**
 * Decide whether a tool call may run in the background.
 *
 * Background ONLY if BOTH hold:
 *   1. the tool is explicitly flagged `backgroundEligible: true`, AND
 *   2. the tool is NOT on the safety-critical deny-list.
 *
 * The deny-list check is evaluated FIRST and short-circuits — a
 * deny-listed tool can never be backgrounded even if a caller (or a
 * mis-configuration) flags it eligible.
 */
export function shouldRunInBackground(
  toolName: string,
  tool: BackgroundEligibleTool | undefined,
): boolean {
  // Hard guard — deny-list wins over any flag, always.
  if (isBackgroundDenied(toolName)) return false;
  return tool?.backgroundEligible === true;
}

export type DispatchMode = "foreground" | "background";

export interface DispatchDecision {
  mode: DispatchMode;
  reason: string;
}

/**
 * Pure decision helper (no side effects) used by the manager and by
 * tests. Folds in the concurrency cap: even an eligible, non-deny-listed
 * tool runs foreground when the in-flight pool is full, so background
 * dispatch degrades gracefully into the existing blocking behavior rather
 * than queueing unboundedly.
 */
export function decideDispatch(
  toolName: string,
  tool: BackgroundEligibleTool | undefined,
  options: { inFlight: number; maxConcurrent: number },
): DispatchDecision {
  if (isBackgroundDenied(toolName)) {
    return {
      mode: "foreground",
      reason: `${toolName} is on the safety-critical deny-list — never backgrounded`,
    };
  }
  if (tool?.backgroundEligible !== true) {
    return { mode: "foreground", reason: `${toolName} is not flagged backgroundEligible` };
  }
  if (options.inFlight >= options.maxConcurrent) {
    return {
      mode: "foreground",
      reason: `Background pool full (${options.inFlight}/${options.maxConcurrent}) — running ${toolName} foreground`,
    };
  }
  return { mode: "background", reason: `${toolName} dispatched to background` };
}

/**
 * A completed background task, ready for re-injection into the message
 * list. `error` is set when the task threw; in that case `result` is the
 * thrown value coerced to a string so the model still gets attribution.
 */
export interface CompletedBackgroundTask {
  id: string;
  toolName: string;
  agent: string | undefined;
  startedAt: number;
  completedAt: number;
  result: unknown;
  error?: string;
}

interface InFlightTask {
  id: string;
  toolName: string;
  agent: string | undefined;
  startedAt: number;
  promise: Promise<void>;
}

export interface BackgroundDispatchOptions {
  /** Max concurrent background tasks. Default 4. */
  maxConcurrent?: number;
}

export interface DispatchRequest {
  toolName: string;
  /** The tool definition — read for the `backgroundEligible` flag. */
  tool: BackgroundEligibleTool | undefined;
  /** The work to run (the tool's execute, already bound to its args). */
  run: () => Promise<unknown>;
  /** Active agent at dispatch time, for re-injection attribution. */
  agent?: string;
  /** Optional caller-supplied id (e.g. the Mastra toolCallId). */
  toolCallId?: string;
}

export interface DispatchResult {
  mode: DispatchMode;
  reason: string;
  /**
   * Present only for `mode: "foreground"` — the synchronous tool result.
   * For `mode: "background"`, the result arrives later via
   * `takeCompleted()` and this is undefined.
   */
  result?: unknown;
  /** The task id assigned to a backgrounded call (for correlation). */
  taskId?: string;
}

/**
 * Tracks in-flight background tasks and buffers their results for
 * re-injection. One instance per stream/turn is the intended lifecycle,
 * but it is safe to reuse across a session. In-memory only.
 */
export class BackgroundDispatchManager {
  private readonly maxConcurrent: number;
  private readonly inFlight = new Map<string, InFlightTask>();
  private readonly completed: CompletedBackgroundTask[] = [];
  private seq = 0;

  constructor(options: BackgroundDispatchOptions = {}) {
    this.maxConcurrent = Math.max(1, options.maxConcurrent ?? 4);
  }

  /** Number of background tasks currently running. */
  get inFlightCount(): number {
    return this.inFlight.size;
  }

  /** Whether any results are waiting to be re-injected. */
  hasCompleted(): boolean {
    return this.completed.length > 0;
  }

  /**
   * Dispatch a tool call. Runs it foreground (awaited inline) unless it is
   * eligible AND the pool has room, in which case it starts in the
   * background and resolves immediately with `mode: "background"`.
   *
   * The deny-list guard inside `decideDispatch` is authoritative: a
   * safety-critical tool is always awaited foreground here regardless of
   * its flag.
   */
  async dispatch(request: DispatchRequest): Promise<DispatchResult> {
    const decision = decideDispatch(request.toolName, request.tool, {
      inFlight: this.inFlight.size,
      maxConcurrent: this.maxConcurrent,
    });

    if (decision.mode === "foreground") {
      // Foreground path is identical to the pre-existing blocking behavior:
      // await the work and return it inline. Errors propagate to the caller
      // exactly as a normal synchronous tool call would.
      const result = await request.run();
      return { mode: "foreground", reason: decision.reason, result };
    }

    // Background path — start the work, register it, return immediately.
    const id = request.toolCallId ?? `bg_${Date.now()}_${this.seq++}`;
    const startedAt = Date.now();
    logger.info("Dispatching tool in background", { toolName: request.toolName, id });

    const promise = (async () => {
      let result: unknown;
      let error: string | undefined;
      try {
        result = await request.run();
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        result = error;
        logger.warn("Background tool failed", { toolName: request.toolName, id, error });
      }
      this.inFlight.delete(id);
      this.completed.push({
        id,
        toolName: request.toolName,
        agent: request.agent,
        startedAt,
        completedAt: Date.now(),
        result,
        error,
      });
    })();

    this.inFlight.set(id, {
      id,
      toolName: request.toolName,
      agent: request.agent,
      startedAt,
      promise,
    });

    return { mode: "background", reason: decision.reason, taskId: id };
  }

  /**
   * Drain all completed background tasks for re-injection. Returns them in
   * completion order and clears the buffer, so the caller injects each
   * exactly once. Does NOT wait for in-flight tasks.
   */
  takeCompleted(): CompletedBackgroundTask[] {
    if (this.completed.length === 0) return [];
    return this.completed.splice(0, this.completed.length);
  }

  /**
   * Await all in-flight background tasks, then drain. Used at turn end so
   * no backgrounded result is lost when the stream is about to close.
   */
  async settleAll(): Promise<CompletedBackgroundTask[]> {
    // Snapshot — new tasks shouldn't be started during settle, but be safe.
    const pending = [...this.inFlight.values()].map((t) => t.promise);
    if (pending.length > 0) {
      await Promise.allSettled(pending);
    }
    return this.takeCompleted();
  }
}
