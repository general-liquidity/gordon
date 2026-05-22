/**
 * Context fork — Gordon's analogue of Claude Code's
 * `CLAUDE_CODE_FORK_SUBAGENT=1` + `/fork` slash command.
 *
 * A fork is an investigation that INHERITS the parent's conversation
 * history. The fork sees what the orchestrator has been doing; the
 * orchestrator only sees the fork's final synthesis.
 *
 * Use cases:
 *   - Operator: "Take everything we've discussed about BTCUSDT and
 *     analyze whether the recent volume profile supports the breakout
 *     thesis."
 *   - Orchestrator: hands off a multi-step research task without
 *     polluting its own context with the intermediate work.
 *
 * Safety considerations (Gordon's deliberate inversion of Claude
 * Code's design):
 *
 *   1. Deny-list enforced — fork can NEVER call execute_plan,
 *      place_order, cancel_*, withdraw, wallet_transfer. Same hard
 *      ceiling as investigation.
 *
 *   2. Safety-message filtering (optional, default ON): messages
 *      containing rationale fields, permission grants, or recent
 *      execution records are stripped from the inherited context.
 *      Defends against the fork accidentally re-asserting
 *      operator approvals from the parent conversation.
 *
 *   3. Audit hook (optional): when supplied, a fork action is
 *      recorded to the audit trail with task description + inherited
 *      message count + deny-list hits. Audit trail visible to
 *      operator + reviewer post-session.
 *
 * Built on top of `runInvestigation` — the fork primitive is
 * structurally identical except for the inherited-context seed.
 * That cohesion means a single safety hardening at the investigation
 * layer protects both surfaces.
 */

import {
  runInvestigation,
  INVESTIGATION_SAFETY_DENY_LIST,
  type InvestigationDependencies,
  type InvestigationMessage,
  type InvestigationResult,
  type InvestigationToolCall,
} from "./investigation.ts";

export interface ContextForkRequest {
  /** The parent's conversation — what the fork inherits as context. */
  parentMessages: InvestigationMessage[];
  /** The new task to run in the forked context. */
  task: string;
  /** Tool ids the fork is allowed to call. Filtered by safety deny-list. */
  allowedTools: string[];
  /** Maximum number of tool calls. Default 20. */
  maxToolCalls?: number;
  /**
   * Strip parent messages containing rationale fields / permission
   * grants / execution records. Default true — safer default.
   */
  stripSafetyMessages?: boolean;
  /** Optional system prompt override. */
  systemPrompt?: string;
}

export interface ContextForkResult extends InvestigationResult {
  /** Number of parent messages inherited into the fork's context. */
  inheritedMessageCount: number;
  /** Number of parent messages STRIPPED by the safety filter. */
  strippedMessageCount: number;
}

export interface ContextForkAuditEntry {
  /** ISO-8601 timestamp of the fork. */
  timestamp: string;
  task: string;
  inheritedMessageCount: number;
  strippedMessageCount: number;
  allowedToolCount: number;
  deniedTools: string[];
  budgetExhausted: boolean;
  toolCallCount: number;
  durationMs: number;
}

export interface ContextForkDependencies extends InvestigationDependencies {
  /** Optional hook called when a fork begins or completes. Used for audit-trail logging. */
  auditHook?: (entry: ContextForkAuditEntry) => void;
}

/**
 * Markers that flag a message as containing safety-critical content
 * the fork should NOT inherit. Conservative — when in doubt, strip.
 *
 * The substring match is intentional — we don't try to parse JSON
 * inside the content; we just refuse to forward any message whose
 * text contains these markers. False positives are acceptable;
 * leaking a permission grant into a forked context is not.
 */
const SAFETY_MARKERS: readonly string[] = [
  "rationale_recorded",
  "execution_record",
  "execute_plan(",
  "place_order(",
  "cancel_order(",
  "wallet_transfer(",
  "withdraw(",
  '"permission_granted"',
  "PermissionEngine",
  "[GORDON_SAFETY]",
  "evidence_bundle",
];

function containsSafetyMarker(message: InvestigationMessage): boolean {
  const text = message.content;
  for (const marker of SAFETY_MARKERS) {
    if (text.includes(marker)) return true;
  }
  return false;
}

/**
 * Run a forked-context investigation. Inherits parent conversation
 * (optionally safety-filtered), runs the task in isolation, returns
 * only the synthesis.
 */
export async function forkContext(
  request: ContextForkRequest,
  deps: ContextForkDependencies,
): Promise<ContextForkResult> {
  const stripSafety = request.stripSafetyMessages ?? true;
  let inheritedCount = 0;
  let strippedCount = 0;
  const inheritedMessages: InvestigationMessage[] = [];

  for (const msg of request.parentMessages) {
    if (stripSafety && containsSafetyMarker(msg)) {
      strippedCount += 1;
      continue;
    }
    inheritedMessages.push(msg);
    inheritedCount += 1;
  }

  // Delegate to investigation primitive with inherited context seeded.
  // System prompt slot is taken by the investigation default unless
  // the caller overrode it explicitly.
  const result = await runInvestigation(
    {
      task: request.task,
      allowedTools: request.allowedTools,
      maxToolCalls: request.maxToolCalls,
      systemPrompt: request.systemPrompt,
      contextMessages: inheritedMessages,
    },
    deps,
  );

  // Audit hook
  if (deps.auditHook) {
    const now = deps.now ?? (() => new Date());
    const entry: ContextForkAuditEntry = {
      timestamp: now().toISOString(),
      task: request.task,
      inheritedMessageCount: inheritedCount,
      strippedMessageCount: strippedCount,
      allowedToolCount: request.allowedTools.length,
      deniedTools: result.deniedTools,
      budgetExhausted: result.budgetExhausted,
      toolCallCount: result.toolCallCount,
      durationMs: result.durationMs,
    };
    try {
      deps.auditHook(entry);
    } catch {
      // Audit failures must not break the fork
    }
  }

  return {
    ...result,
    inheritedMessageCount: inheritedCount,
    strippedMessageCount: strippedCount,
  };
}

// Re-export the safety deny-list so callers can reason about it without
// importing two modules.
export { INVESTIGATION_SAFETY_DENY_LIST };
