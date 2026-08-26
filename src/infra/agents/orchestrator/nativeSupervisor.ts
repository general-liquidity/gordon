/**
 * Native Supervisor Delegation (Mastra 1.51 `agents:{}` supervisor topology)
 *
 * ADDITIVE + FLAG-GATED, default-off. `GORDON_NATIVE_SUPERVISOR=1` swaps the
 * orchestrator's minimal inline `delegation` block for the full native
 * supervisor delegation config built here. When the flag is unset, the existing
 * hand-rolled handoff path (streamProcessor + toolAgentMap + HandoffCoordinator
 * tracking) stays the default and behavior is IDENTICAL.
 *
 * Mastra dispatches the orchestrator's sub-agents (`agents: { executor,
 * researcher }`, wired on the Gordon Agent constructor) as native `agent-<key>`
 * tool calls. This module supplies the per-stream `delegation` config that rides
 * on that dispatch:
 *   - `messageFilter` — controls which parent messages each sub-agent sees.
 *   - `onDelegationStart` / `onDelegationComplete` — track the active agent,
 *     apply loop-safety, and drain queued supervisor feedback.
 *   - `includeSubAgentToolResultsInModelContext: false` — supervisor sees the
 *     sub-agent's text, not its nested tool results (hot-tier context discipline).
 *
 * PERMISSION BOUNDARY (non-negotiable): the executor has execution tools and the
 * researcher does NOT. That boundary is enforced by TOOL SCOPING inside the
 * agent definitions (executor.ts / researcher.ts) plus the risk deny-list at
 * execution time — this module never merges or widens tool sets. The
 * `messageFilter` here is the CONTEXT-layer complement: it reuses the tested
 * `HandoffCoordinator.filterContextForSubagent()` so the researcher (least-
 * context, no execution) never sees account financials, while the executor
 * keeps them (it needs them to size orders). Secrets are stripped for BOTH.
 */

import { createModuleLogger } from "../../logger/index.ts";
import {
  defaultHandoffCoordinator,
  HandoffCoordinator,
  type FilterableMessage,
} from "./HandoffCoordinator.ts";
import { collectSupervisorFeedback } from "./toolAgentMap.ts";
import { beginSubagentHook, endSubagentHook } from "../../hooks/subagentHookBridge.ts";

const logger = createModuleLogger("native-supervisor");

/** The supervisor agent name used for handoff tracking / feedback routing. */
const SUPERVISOR_AGENT = "Gordon";

/**
 * Minimal mutable state the delegation hooks touch. The orchestrator's
 * `StreamProcessingState` structurally satisfies this — kept narrow so this
 * module does not import the stream processor (avoids a cycle).
 */
export interface SupervisorDelegationState {
  currentAgent: string | undefined;
  activeSubagentHookKey?: string;
}

/**
 * Gate flag — `GORDON_NATIVE_SUPERVISOR=1` activates the native supervisor
 * delegation config. Off (default) keeps the hand-rolled handoff path.
 */
export function isNativeSupervisorEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.GORDON_NATIVE_SUPERVISOR;
  if (typeof raw !== "string") return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

/** "executor" → "Executor" (native subagent key → WorkerRegistry role name). */
function toRoleName(primitiveId: string): string {
  if (!primitiveId) return primitiveId;
  return primitiveId.charAt(0).toUpperCase() + primitiveId.slice(1).toLowerCase();
}

/**
 * Loop-safety decision for a native delegation.
 *
 * Reuses `HandoffCoordinator.validate` for its circular-loop / high-frequency
 * detection. Only blocks on a genuine loop signal — an "unknown agent" verdict
 * (the researcher is not a WorkerRegistry role) is advisory and never blocks,
 * so the native path does not regress researcher dispatch.
 */
export function shouldBlockDelegation(
  primitiveId: string,
  coordinator: HandoffCoordinator = defaultHandoffCoordinator,
): { block: boolean; reason?: string } {
  const role = toRoleName(primitiveId);
  const validation = coordinator.validate(SUPERVISOR_AGENT, role);
  if (validation.valid) return { block: false };
  const reason = validation.reason ?? "";
  const isLoopSignal = /circular|infinite|frequency/i.test(reason);
  if (isLoopSignal) return { block: true, reason };
  return { block: false, reason };
}

/**
 * Build the flag-gated native supervisor `delegation` config for a single
 * `gordonAgent().stream()` / `.generate()` call.
 *
 * Returned shape matches Mastra 1.51 `DelegationConfig`
 * (`agent.types.d.ts`: `messageFilter`, `onDelegationStart`,
 * `onDelegationComplete`, `includeSubAgentToolResultsInModelContext`). Typed
 * loosely (`any` in callback bodies, matching the orchestrator's existing
 * inline block) so it spreads into the `stream(..., { ... } as any)` options
 * without dragging Mastra's message types into the orchestrator.
 */
export function buildNativeSupervisorDelegation(
  state: SupervisorDelegationState,
  coordinator: HandoffCoordinator = defaultHandoffCoordinator,
  scopeKey: string = "standalone",
): Record<string, unknown> {
  return {
    // Supervisor keeps only the sub-agent's text response in later iterations —
    // not its nested tool results. Keeps the orchestrator context lean.
    includeSubAgentToolResultsInModelContext: false,

    // CONTEXT-layer permission preservation. Least-context scrub before the
    // sub-agent's model sees any parent message: account state stripped for the
    // researcher (no execution), secrets stripped for every sub-agent. Idempotent
    // with the researcher's own inputProcessor (double-redaction is safe).
    messageFilter: (ctx: any) => {
      const primitiveId: string = ctx?.primitiveId ?? "";
      const messages = (ctx?.messages ?? []) as FilterableMessage[];
      const result = coordinator.filterContextForSubagent(primitiveId, messages);
      if (result.redacted) {
        logger.info("Native messageFilter scrubbed sub-agent context", {
          primitiveId,
          filteredAgent: result.filteredAgent,
          redactionCount: result.redactionCount,
        });
      }
      return result.messages as unknown[];
    },

    onDelegationStart: async (ctx: any) => {
      const primitiveId: string = ctx?.primitiveId ?? "";
      const lifecycleKey = `stream:${scopeKey}:${ctx?.toolCallId ?? primitiveId}`;
      const lifecycle = await beginSubagentHook({
        key: lifecycleKey,
        id: ctx?.toolCallId,
        type: primitiveId,
        parent: SUPERVISOR_AGENT,
        task: typeof ctx?.task === "string" ? ctx.task : undefined,
      });
      if (!lifecycle.allowed) {
        return { proceed: false, rejectionReason: lifecycle.reason };
      }

      const decision = shouldBlockDelegation(primitiveId, coordinator);
      if (decision.block) {
        await endSubagentHook({
          key: lifecycleKey,
          type: primitiveId,
          parent: SUPERVISOR_AGENT,
          status: "aborted",
          error: decision.reason,
        });
        logger.warn("Native delegation blocked (loop-safety)", {
          agent: primitiveId,
          reason: decision.reason,
        });
        return {
          proceed: false,
          rejectionReason: decision.reason ?? "Delegation blocked by loop-safety.",
        };
      }
      state.currentAgent = primitiveId;
      state.activeSubagentHookKey = lifecycleKey;
      if (decision.reason) {
        logger.debug("Native delegation advisory", {
          agent: primitiveId,
          reason: decision.reason,
        });
      }

      // Fire-and-forget observability: record the handoff (never throws).
      void coordinator.track(SUPERVISOR_AGENT, toRoleName(primitiveId), {
        native: true,
        toolCallId: ctx?.toolCallId,
      });

      logger.info("Native delegation to sub-agent", { agent: primitiveId });
      return { proceed: true };
    },

    onDelegationComplete: async (ctx: any) => {
      const primitiveId: string = ctx?.primitiveId ?? "";
      await endSubagentHook({
        key:
          state.activeSubagentHookKey
          ?? `stream:${scopeKey}:${ctx?.toolCallId ?? primitiveId}`,
        type: primitiveId,
        parent: SUPERVISOR_AGENT,
        status: ctx?.error ? "failed" : "completed",
        result: ctx?.result,
        error: ctx?.error ? String(ctx.error) : undefined,
      });
      state.activeSubagentHookKey = undefined;
      if (ctx?.error) {
        logger.warn("Native delegation failed", { agent: primitiveId, error: ctx.error });
        return {
          feedback: `Delegation to ${primitiveId} failed: ${ctx.error}. Try another approach.`,
        };
      }

      // Drain any post-delegation feedback queued for the supervisor
      // (e.g. "researcher returned no risk section — revise") so it is injected
      // into the next iteration exactly once.
      const { text } = collectSupervisorFeedback(SUPERVISOR_AGENT, coordinator);
      if (text) return { feedback: text };
      return {};
    },
  };
}
