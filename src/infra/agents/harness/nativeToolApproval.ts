/**
 * Native tool-approval wiring (GORDON_NATIVE_TOOL_APPROVAL).
 *
 * Adopts Mastra 1.51's native tool-call-approval / suspend-resume HITL for the
 * money-path tools (`execute_plan` and the `cancel_*` family). When the flag is
 * set, these tools carry a `requireApproval` predicate so the agent stream
 * SUSPENDS on the tool call and waits for `approveToolCall` / `declineToolCall`
 * — an ADDITIONAL supervision layer on top of Gordon's existing deny-first
 * stack (riskClassifier + PermissionEngine + trading-constitution + signed
 * audit + required rationale).
 *
 * INVARIANTS (money path):
 *   1. Purely ADDITIVE. Flag unset → `isNativeToolApprovalEnabled()` is false,
 *      every helper is inert, and behavior is byte-identical to today.
 *   2. Native approval NEVER approves something the deny-first gate would block.
 *      The resume decision (`decideNativeApproval`) declines whenever the gate
 *      blocks, is killed by a kill switch, or the risk classifier recommends
 *      `block`. It can only route an already-permitted call to the human.
 *   3. The native layer runs BEFORE the tool body executes; the tool's own
 *      internal gate (binding hash, risk kernel, guardrails, kill switch) still
 *      runs on resume. Native approval replaces none of it.
 *
 * The suspend/resume machinery is storage-backed (workflow snapshots). Gordon
 * already configures a Mastra store — libSQL when available, InMemoryStore as a
 * fallback (see `infra/agents/memory/mastraStorage.ts`). Suspended runs survive
 * a restart only on the libSQL path; on the in-memory fallback they are lost
 * with the process, which is acceptable because a lost suspension fails safe
 * (the trade simply never executes).
 */

import type { RiskTier } from "../../trading/risk/riskClassifier.ts";

/** Tools that get the native approval step when the flag is on. */
export const NATIVE_APPROVAL_TOOL_IDS = [
  "execute_plan",
  // Deny-list cancel family — every one is safety-critical, no tier concept.
  "cancel",
  "cancel_order",
  "cancel_all_orders",
  "cancel_replace_order",
  "cancel_order_list",
] as const;

export type NativeApprovalToolId = (typeof NATIVE_APPROVAL_TOOL_IDS)[number];

const CANCEL_TOOL_IDS = new Set<string>([
  "cancel",
  "cancel_order",
  "cancel_all_orders",
  "cancel_replace_order",
  "cancel_order_list",
]);

export function isNativeApprovalTool(toolId: string): toolId is NativeApprovalToolId {
  return (NATIVE_APPROVAL_TOOL_IDS as readonly string[]).includes(toolId);
}

export function isNativeToolApprovalEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env.GORDON_NATIVE_TOOL_APPROVAL === "1" ||
    env.GORDON_NATIVE_TOOL_APPROVAL === "true"
  );
}

// ---------------------------------------------------------------------------
// Tier resolver injection
// ---------------------------------------------------------------------------
//
// `execute_plan` only fires the native step for MEDIUM+ tier plans (low-tier
// executions keep today's friction-free path). Deciding that needs the plan +
// portfolio + riskClassifier, which the `requireApproval` predicate does not
// receive from Mastra (it only gets `{ planId, rationale }`). Rather than pull
// heavy plan/portfolio plumbing into this harness module, the coordinator
// injects a resolver. If none is registered, or it cannot classify, we FAIL
// SAFE and require approval.

export type PlanTierResolver = (
  planId: string,
) => RiskTier | undefined | Promise<RiskTier | undefined>;

let planTierResolver: PlanTierResolver | undefined;

export function setPlanTierResolver(resolver: PlanTierResolver | undefined): void {
  planTierResolver = resolver;
}

/** Medium, high and critical tiers gate; low does not. Unknown fails safe. */
function tierRequiresApproval(tier: RiskTier | undefined): boolean {
  if (tier === undefined) return true; // fail safe
  return tier !== "low";
}

// ---------------------------------------------------------------------------
// Predicate builders (per-tool `requireApproval` + global `requireToolApproval`)
// ---------------------------------------------------------------------------

type RequireApprovalCtx = {
  requestContext?: Record<string, unknown>;
  workspace?: unknown;
};

/**
 * Per-tool `requireApproval` predicate for a specific money-path tool. Attach
 * the returned function to `tool.requireApproval`. Shape matches Mastra's
 * `(input, ctx?) => boolean | Promise<boolean>`.
 *
 * - Flag off → always false (tool behaves exactly as today).
 * - cancel_* → always true when flag on (deny-list, no tier).
 * - execute_plan → true for medium+ tier (via injected resolver), true when
 *   tier is unknown (fail safe), false for low tier.
 */
export function buildRequireApproval(
  toolId: string,
  env: NodeJS.ProcessEnv = process.env,
): (input: unknown, ctx?: RequireApprovalCtx) => Promise<boolean> {
  return async (input: unknown): Promise<boolean> => {
    if (!isNativeToolApprovalEnabled(env)) return false;
    if (!isNativeApprovalTool(toolId)) return false;
    if (CANCEL_TOOL_IDS.has(toolId)) return true;

    // execute_plan
    const planId =
      input && typeof input === "object" && "planId" in input
        ? String((input as { planId: unknown }).planId)
        : undefined;
    if (!planId || !planTierResolver) return true; // fail safe
    try {
      const tier = await planTierResolver(planId);
      return tierRequiresApproval(tier);
    } catch {
      return true; // fail safe on any resolver error
    }
  };
}

/**
 * Global `requireToolApproval` function for the agent `.stream()` / `.generate()`
 * option. Evaluated per tool call with `{ toolName, args, ... }`. Use this when
 * marking tool objects directly is inconvenient (e.g. instrumented spreads);
 * it is equivalent to attaching `buildRequireApproval` on each matching tool.
 */
export function buildRequireToolApproval(
  env: NodeJS.ProcessEnv = process.env,
): (ctx: { toolName: string; args?: Record<string, unknown> }) => Promise<boolean> {
  return async (ctx: {
    toolName: string;
    args?: Record<string, unknown>;
  }): Promise<boolean> => {
    if (!isNativeToolApprovalEnabled(env)) return false;
    if (!isNativeApprovalTool(ctx.toolName)) return false;
    return buildRequireApproval(ctx.toolName, env)(ctx.args ?? {});
  };
}

/**
 * Mutates the `requireApproval` field on each matching tool in a registry
 * (flag-gated). Call at the single registration point; a no-op when the flag
 * is off. Returns the ids that were marked.
 */
export function applyNativeApprovalMarkers(
  tools: Record<string, { id?: string; requireApproval?: unknown }>,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (!isNativeToolApprovalEnabled(env)) return [];
  const marked: string[] = [];
  for (const [key, tool] of Object.entries(tools)) {
    const toolId = tool?.id ?? key;
    if (!isNativeApprovalTool(toolId)) continue;
    tool.requireApproval = buildRequireApproval(toolId, env);
    marked.push(toolId);
  }
  return marked;
}

// ---------------------------------------------------------------------------
// Resume-time decision — DEFERS to the deny-first gate
// ---------------------------------------------------------------------------

/**
 * Snapshot of the EXISTING deny-first decision, supplied by the coordinator
 * from the same gate the tool body runs (PermissionEngine + riskClassifier +
 * kill switch). This module does not re-implement any of it — it only maps the
 * outcome onto an approve/decline so native approval can never be laxer.
 */
export interface DenyFirstOutcome {
  /** PermissionEngine: deny-list hit or an explicit `deny` rule matched. */
  blocked: boolean;
  /** `isExecutionAllowed().allowed` — false when a kill switch is engaged. */
  executionAllowed?: boolean;
  /** riskClassifier `recommendation`, when a full assessment is available. */
  recommendation?: "auto_approve" | "prompt_user" | "require_confirmation" | "block";
}

export interface NativeApprovalDecision {
  /**
   * - `decline`  → call `agent.declineToolCall(...)`; the deny-first gate would
   *   have blocked, so native approval must not let it through.
   * - `prompt`   → the gate permits; surface the native approval to the human
   *   (existing approval UX), then `approveToolCall` / `declineToolCall`.
   */
  action: "decline" | "prompt";
  reason: string;
}

/**
 * Map a deny-first gate outcome onto the native approval action. Pure and
 * total. Guarantees native approval is strictly stricter-or-equal than the
 * existing gate: any blocking condition forces `decline`; only a permitted
 * call reaches the human `prompt`.
 */
export function decideNativeApproval(
  outcome: DenyFirstOutcome,
): NativeApprovalDecision {
  if (outcome.blocked) {
    return {
      action: "decline",
      reason:
        "Deny-first permission gate blocked this call (deny-list or explicit deny). " +
        "Native approval declines — it cannot override the gate.",
    };
  }
  if (outcome.executionAllowed === false) {
    return {
      action: "decline",
      reason:
        "Execution is halted by a kill switch (isExecutionAllowed = false). " +
        "Native approval declines.",
    };
  }
  if (outcome.recommendation === "block") {
    return {
      action: "decline",
      reason:
        "Risk classifier recommends block (critical tier). Native approval declines.",
    };
  }
  return {
    action: "prompt",
    reason:
      "Deny-first gate permits this call; routing the native tool-call approval to the human.",
  };
}
