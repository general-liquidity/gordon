/**
 * External-Execution HITL Requirement — pure pause/resume primitive
 *
 * A requirement where the agent emits a tool call it does NOT execute itself.
 * The run is marked Paused awaiting a client-supplied result; a client performs
 * the action out of band (wallet / hardware-key signing, broker 2FA) and posts
 * the RESULT back via `setExternalExecutionResult(id, result)` (not just an
 * approve/deny). The run then resumes with that result spliced in.
 *
 * PURE state machine: no transport, no event bus, and it NEVER auto-executes the
 * tool call. Sibling to `askUser.ts` — but askUser resolves a user *answer* over
 * the event bus, whereas this holds a *deferred external result* with no wire.
 *
 * UNWIRED — parked until a non-TUI client (Pro / gateway / ACP) exists to fulfil
 * the request. See `gordon-rs/specs/new-builds-candidates.md` item C8.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export type ExternalExecutionStatus =
  | "paused" // emitted, awaiting a client-supplied result
  | "fulfilled" // client posted a result; run resumes with it spliced in
  | "rejected" // client declined / the external action failed
  | "cancelled"; // withdrawn before a client acted

export interface ExternalExecutionRequirement {
  id: string;
  /** The tool the agent wants executed out of band (e.g. `sign_transaction`). */
  toolName: string;
  /** Arguments the client should execute the tool with, verbatim. */
  args: Record<string, unknown>;
  /** Why the client must perform this (signing, 2FA) — surfaced to the operator. */
  reason: string;
  status: ExternalExecutionStatus;
  requestedAt: number;
  settledAt?: number;
  /** Client-supplied result, present iff `status === "fulfilled"`. */
  result?: unknown;
  /** Failure/decline reason, present iff `status === "rejected"`. */
  error?: string;
}

/** Resolution handed back to the paused caller once the requirement settles. */
export interface ExternalExecutionResolution {
  /** True only when a client posted a real result. */
  ok: boolean;
  /** The client-supplied result, spliced back into the run. */
  result?: unknown;
  /** Present when the requirement was rejected. */
  error?: string;
  /** True when the requirement was cancelled before any client acted. */
  cancelled: boolean;
}

/**
 * Pure pause/resume registry for external-execution requirements.
 *
 * `request()` parks a requirement and returns a Promise that stays pending
 * (the run is Paused) until exactly one of `setExternalExecutionResult`,
 * `reject`, or `cancel` settles it. Idempotent on settle: a second settle for
 * the same id is a no-op.
 */
export class ExternalExecutionManager {
  private pending = new Map<string, ExternalExecutionRequirement>();
  private settled: ExternalExecutionRequirement[] = [];
  private resolvers = new Map<string, (r: ExternalExecutionResolution) => void>();

  /**
   * Emit an external-execution requirement and pause until a client settles it.
   * Never executes `toolName` — it only records the intent and waits.
   */
  request(
    toolName: string,
    args: Record<string, unknown>,
    reason: string,
  ): {
    id: string;
    requirement: ExternalExecutionRequirement;
    result: Promise<ExternalExecutionResolution>;
  } {
    const id = crypto.randomUUID();
    const requirement: ExternalExecutionRequirement = {
      id,
      toolName,
      args,
      reason,
      status: "paused",
      requestedAt: Date.now(),
    };
    this.pending.set(id, requirement);

    const result = new Promise<ExternalExecutionResolution>((resolve) => {
      this.resolvers.set(id, resolve);
    });

    return { id, requirement, result };
  }

  /**
   * Resume a paused requirement with a client-supplied result, spliced in.
   * Returns the settled requirement, or null if the id is unknown/already settled.
   */
  setExternalExecutionResult(id: string, result: unknown): ExternalExecutionRequirement | null {
    return this.settle(id, { status: "fulfilled", result });
  }

  /** Resume a paused requirement as rejected (client declined or action failed). */
  reject(id: string, error: string): ExternalExecutionRequirement | null {
    return this.settle(id, { status: "rejected", error });
  }

  /** Withdraw a paused requirement before any client acts. */
  cancel(id: string): ExternalExecutionRequirement | null {
    return this.settle(id, { status: "cancelled" });
  }

  private settle(
    id: string,
    outcome:
      | { status: "fulfilled"; result: unknown }
      | { status: "rejected"; error: string }
      | { status: "cancelled" },
  ): ExternalExecutionRequirement | null {
    const requirement = this.pending.get(id);
    if (!requirement) return null; // unknown or already settled — no-op

    requirement.status = outcome.status;
    requirement.settledAt = Date.now();
    if (outcome.status === "fulfilled") requirement.result = outcome.result;
    if (outcome.status === "rejected") requirement.error = outcome.error;

    this.pending.delete(id);
    this.settled.push(requirement);

    const resolve = this.resolvers.get(id);
    if (resolve) {
      this.resolvers.delete(id);
      resolve({
        ok: outcome.status === "fulfilled",
        result: outcome.status === "fulfilled" ? outcome.result : undefined,
        error: outcome.status === "rejected" ? outcome.error : undefined,
        cancelled: outcome.status === "cancelled",
      });
    }
    return requirement;
  }

  get(id: string): ExternalExecutionRequirement | undefined {
    return this.pending.get(id) ?? this.settled.find((r) => r.id === id);
  }

  getPaused(): ExternalExecutionRequirement[] {
    return [...this.pending.values()];
  }

  getSettled(): ExternalExecutionRequirement[] {
    return [...this.settled];
  }

  /** True while at least one requirement is paused — i.e. the run is Paused. */
  isPaused(): boolean {
    return this.pending.size > 0;
  }
}

let instance: ExternalExecutionManager | null = null;

export function getExternalExecutionManager(): ExternalExecutionManager {
  if (!instance) instance = new ExternalExecutionManager();
  return instance;
}

/**
 * Resume the paused run identified by `id` with the client-supplied `result`.
 * The client-facing entry point named in the C8 spec.
 */
export function setExternalExecutionResult(
  id: string,
  result: unknown,
): ExternalExecutionRequirement | null {
  return getExternalExecutionManager().setExternalExecutionResult(id, result);
}

/**
 * Agent-facing tool: emit an external-execution requirement and pause.
 *
 * UNWIRED — not registered on any agent (`gordon.ts`/`executor.ts`/`researcher.ts`)
 * because it is inert without a non-TUI client to post the result back. Kept as a
 * sibling to `ask_user` so the wiring is a one-line spread once such a client ships.
 */
export const requestExternalExecutionTool = createTool({
  id: "request_external_execution",
  description:
    "Emit a tool call for a CLIENT to execute out of band, then pause until it posts the result back. " +
    "Use ONLY when the action must happen client-side and cannot run in-process (wallet / hardware-key signing, broker 2FA). " +
    "You do NOT execute the call yourself; the run pauses awaiting the client-supplied result, then resumes with it spliced in.",
  inputSchema: z.object({
    tool_name: z.string().describe("The tool the client must execute out of band."),
    args: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Arguments the client should execute the tool with, verbatim."),
    reason: z
      .string()
      .describe("Why this must be executed client-side (e.g. hardware-key signing, broker 2FA)."),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: z.string().optional(),
    cancelled: z.boolean(),
  }),
  execute: async ({ tool_name, args, reason }) => {
    const { result } = getExternalExecutionManager().request(tool_name, args ?? {}, reason);
    return result;
  },
});

export const externalExecutionTools = {
  request_external_execution: requestExternalExecutionTool,
};
