/**
 * Tool-Call Reconciler — repairs dangling tool_use blocks before the
 * next provider turn.
 *
 * Premise: when a tool call is interrupted mid-execution (process crash,
 * timeout, doom-loop force-stop, permission-denied after dispatch,
 * manual cancel), the conversation can end up with an assistant
 * message containing a `tool_use` block whose matching `tool_result`
 * was never produced. Anthropic's API rejects subsequent turns until
 * every `tool_use` has a paired `tool_result`. Without repair the
 * agent is wedged.
 *
 * This reconciler scans the API message array, identifies dangling
 * tool_use blocks, and synthesizes minimal `tool_result` blocks
 * carrying a structured interruption report. The agent then sees the
 * interruption explicitly in its context and can decide how to
 * proceed.
 *
 * Distinct from:
 *   - `cognition/transcriptValidator.ts` operates at the ACTION-LOG
 *      layer and emits prose repair NOTES into a [GORDON_TRANSCRIPT_REPAIR]
 *      block for the LLM. It tells the model "something looks off"; it
 *      does NOT repair the API-message array. This reconciler operates
 *      at the API-message layer and emits structured tool_result blocks
 *      that satisfy the provider's pairing requirement.
 *
 * Composes with:
 *   - `transcriptValidator` — both can run pre-turn. Reconciler first
 *      (repair the structure), then transcriptValidator (annotate the
 *      anomaly for the model).
 *   - `runtimeHarness` doom-loop / recovery tiers — when force-stop
 *      fires, the partial tool state should be passed in via
 *      `partialState` so the synthesized tool_result captures what is
 *      known.
 *
 * Generic message shape: accepts any message with `role` and content
 * that is either a string or an array of content parts. Tool-use parts
 * are identified by `type === "tool-call"` (AI SDK) or
 * `type === "tool_use"` (Anthropic raw). Tool-result parts by
 * `type === "tool-result"` or `type === "tool_result"`. Both pair on
 * an `id` / `toolCallId` / `tool_use_id` / `toolUseId` field.
 *
 * Pure function. No I/O.
 */

export type InterruptionReason =
  | "timeout"
  | "cancelled"
  | "permission_denied_after_dispatch"
  | "process_crash"
  | "force_stop"
  | "unknown";

export interface DanglingToolCall {
  /** Tool-call id used to pair tool_use with tool_result. */
  id: string;
  /** Tool name as observed in the tool_use block, if extractable. */
  toolName?: string;
  /** Index of the assistant message containing the dangling tool_use. */
  assistantMessageIndex: number;
}

export interface SynthesizedToolResult {
  id: string;
  toolName?: string;
  reason: InterruptionReason;
  partialState?: Record<string, unknown>;
  /** Inserted into the messages array at this index (after the assistant message). */
  insertAtIndex: number;
}

export interface ReconciliationInput {
  messages: ReadonlyArray<Record<string, unknown>>;
  /**
   * Optional map from tool-call id to known interruption details. Caller
   * supplies this when it knows why a specific call was interrupted (e.g.,
   * doom-loop force-stop emits a fingerprint id; permission engine emits
   * the denied call id). Unknown calls default to reason="unknown".
   */
  knownInterruptions?: ReadonlyMap<
    string,
    { reason: InterruptionReason; partialState?: Record<string, unknown> }
  >;
  /**
   * Reason to assign to dangling calls without an entry in
   * knownInterruptions. Default "unknown".
   */
  defaultReason?: InterruptionReason;
}

export interface ReconciliationResult {
  /** Original count of messages supplied. */
  totalMessages: number;
  /** All dangling tool_use blocks detected. */
  dangling: DanglingToolCall[];
  /** Synthesized tool_result blocks ready for insertion. */
  synthesized: SynthesizedToolResult[];
  /**
   * Reconstructed message array with synthesized tool_result blocks
   * inserted immediately after the assistant message containing the
   * matching tool_use. The original messages array is not mutated.
   */
  reconciledMessages: Record<string, unknown>[];
  /** Number of repairs applied. 0 = no dangling calls; messages unchanged. */
  repairCount: number;
  /** True iff the input was already well-formed. */
  wasWellFormed: boolean;
  /** Verdict for the caller to log / surface. */
  verdict:
    | "no_dangling_calls"
    | "repaired"
    | "non_message_input"
    | "no_messages";
  summary: string;
}

// ---------------------------------------------------------------------
// Content-part helpers
// ---------------------------------------------------------------------

interface ToolUsePart {
  type: string;
  id?: string;
  toolCallId?: string;
  tool_use_id?: string;
  toolUseId?: string;
  toolName?: string;
  tool_name?: string;
  name?: string;
  [key: string]: unknown;
}

interface ToolResultPart {
  type: string;
  toolCallId?: string;
  tool_call_id?: string;
  tool_use_id?: string;
  toolUseId?: string;
  id?: string;
  [key: string]: unknown;
}

function isToolUsePart(part: unknown): part is ToolUsePart {
  if (typeof part !== "object" || part === null) return false;
  const t = (part as { type?: unknown }).type;
  return t === "tool-call" || t === "tool_use";
}

function isToolResultPart(part: unknown): part is ToolResultPart {
  if (typeof part !== "object" || part === null) return false;
  const t = (part as { type?: unknown }).type;
  return t === "tool-result" || t === "tool_result";
}

function extractToolUseId(part: ToolUsePart): string | undefined {
  return part.id ?? part.toolCallId ?? part.tool_use_id ?? part.toolUseId;
}

function extractToolResultId(part: ToolResultPart): string | undefined {
  return (
    part.toolCallId ??
    part.tool_call_id ??
    part.tool_use_id ??
    part.toolUseId ??
    part.id
  );
}

function extractToolName(part: ToolUsePart): string | undefined {
  return part.toolName ?? part.tool_name ?? part.name;
}

function getContentParts(message: Record<string, unknown>): unknown[] {
  const content = message.content;
  if (Array.isArray(content)) return content;
  return [];
}

function getRole(message: Record<string, unknown>): string {
  const r = message.role;
  return typeof r === "string" ? r : "";
}

// ---------------------------------------------------------------------
// Reconciliation core
// ---------------------------------------------------------------------

/**
 * Synthesize a minimal tool_result content part keyed to the dangling
 * tool_use id. Uses the AI SDK "tool-result" shape (snake-case variants
 * are accepted on input but the synthesized part uses kebab to match
 * AI SDK convention; downstream provider adapters convert as needed).
 */
function buildSynthesizedResultPart(
  id: string,
  toolName: string | undefined,
  reason: InterruptionReason,
  partialState: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    status: "interrupted",
    reason,
    reconciled: true,
    reconciledAt: new Date().toISOString(),
  };
  if (toolName) body.toolName = toolName;
  if (partialState) body.partialState = partialState;

  return {
    type: "tool-result",
    toolCallId: id,
    toolName: toolName ?? "unknown",
    result: body,
    isError: true,
  };
}

export function reconcileToolCalls(
  input: ReconciliationInput,
): ReconciliationResult {
  const messages = input.messages;
  const known = input.knownInterruptions ?? new Map();
  const defaultReason: InterruptionReason = input.defaultReason ?? "unknown";

  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      totalMessages: 0,
      dangling: [],
      synthesized: [],
      reconciledMessages: [],
      repairCount: 0,
      wasWellFormed: true,
      verdict: messages && messages.length === 0 ? "no_messages" : "non_message_input",
      summary:
        messages && messages.length === 0
          ? "Empty message array — nothing to reconcile."
          : "Non-array input — cannot reconcile.",
    };
  }

  // First pass: collect every tool_use id with its source assistant
  // message index, then every tool_result id that was actually produced.
  const toolUses = new Map<
    string,
    { messageIndex: number; toolName?: string }
  >();
  const resolvedResultIds = new Set<string>();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    if (typeof msg !== "object" || msg === null) continue;
    const role = getRole(msg);
    const parts = getContentParts(msg);

    if (role === "assistant") {
      for (const part of parts) {
        if (isToolUsePart(part)) {
          const id = extractToolUseId(part);
          if (id && !toolUses.has(id)) {
            toolUses.set(id, {
              messageIndex: i,
              toolName: extractToolName(part),
            });
          }
        }
      }
    } else if (role === "tool" || role === "user") {
      for (const part of parts) {
        if (isToolResultPart(part)) {
          const id = extractToolResultId(part);
          if (id) resolvedResultIds.add(id);
        }
      }
    }
  }

  // Identify dangling tool_use ids (uses without results), preserve
  // discovery order so synthesized inserts are stable.
  const dangling: DanglingToolCall[] = [];
  for (const [id, meta] of toolUses) {
    if (!resolvedResultIds.has(id)) {
      dangling.push({
        id,
        toolName: meta.toolName,
        assistantMessageIndex: meta.messageIndex,
      });
    }
  }

  if (dangling.length === 0) {
    return {
      totalMessages: messages.length,
      dangling: [],
      synthesized: [],
      reconciledMessages: messages.map((m) => ({ ...m })),
      repairCount: 0,
      wasWellFormed: true,
      verdict: "no_dangling_calls",
      summary: `Well-formed: all tool_use blocks across ${messages.length} messages have matching tool_result blocks.`,
    };
  }

  // Group dangling calls by their source assistant message so synthesized
  // tool_result blocks can be batched into a single tool message inserted
  // immediately after each assistant message that owned dangling uses.
  const danglingByMessage = new Map<number, DanglingToolCall[]>();
  for (const d of dangling) {
    const bucket = danglingByMessage.get(d.assistantMessageIndex) ?? [];
    bucket.push(d);
    danglingByMessage.set(d.assistantMessageIndex, bucket);
  }

  // Build reconciled message array. Walk original messages; after each
  // assistant message with dangling calls, splice in a synthesized tool
  // message containing tool_result parts.
  const reconciled: Record<string, unknown>[] = [];
  const synthesized: SynthesizedToolResult[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    reconciled.push({ ...msg });

    const bucket = danglingByMessage.get(i);
    if (!bucket) continue;

    const resultParts: Record<string, unknown>[] = [];
    for (const d of bucket) {
      const knownEntry = known.get(d.id);
      const reason = knownEntry?.reason ?? defaultReason;
      const partial = knownEntry?.partialState;
      const insertAtIndex = reconciled.length;

      synthesized.push({
        id: d.id,
        toolName: d.toolName,
        reason,
        partialState: partial,
        insertAtIndex,
      });

      resultParts.push(
        buildSynthesizedResultPart(d.id, d.toolName, reason, partial),
      );
    }

    reconciled.push({
      role: "tool",
      content: resultParts,
    });
  }

  const repairCount = synthesized.length;
  const reasonSummary = summarizeReasons(synthesized);

  return {
    totalMessages: messages.length,
    dangling,
    synthesized,
    reconciledMessages: reconciled,
    repairCount,
    wasWellFormed: false,
    verdict: "repaired",
    summary:
      `Repaired ${repairCount} dangling tool_use block${repairCount === 1 ? "" : "s"} ` +
      `across ${danglingByMessage.size} assistant message${danglingByMessage.size === 1 ? "" : "s"}. ` +
      reasonSummary,
  };
}

function summarizeReasons(
  synthesized: ReadonlyArray<SynthesizedToolResult>,
): string {
  if (synthesized.length === 0) return "";
  const counts = new Map<InterruptionReason, number>();
  for (const s of synthesized) {
    counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  }
  const parts: string[] = [];
  for (const [reason, count] of counts) {
    parts.push(`${reason}=${count}`);
  }
  return `Reasons: ${parts.join(", ")}.`;
}

export function formatReconciliationReport(
  result: ReconciliationResult,
): string {
  const lines = [
    `Tool-Call Reconciler — ${result.verdict.toUpperCase()}`,
    "",
    `  Total messages:    ${result.totalMessages}`,
    `  Well-formed:       ${result.wasWellFormed ? "yes" : "no"}`,
    `  Repairs applied:   ${result.repairCount}`,
  ];
  if (result.dangling.length > 0) {
    lines.push("");
    lines.push(`  Dangling tool_use blocks:`);
    for (const d of result.dangling) {
      lines.push(
        `    id=${d.id}  tool=${d.toolName ?? "unknown"}  msgIdx=${d.assistantMessageIndex}`,
      );
    }
  }
  if (result.synthesized.length > 0) {
    lines.push("");
    lines.push(`  Synthesized tool_result blocks:`);
    for (const s of result.synthesized) {
      lines.push(
        `    id=${s.id}  reason=${s.reason}  insertAt=${s.insertAtIndex}${s.partialState ? "  (with partial state)" : ""}`,
      );
    }
  }
  lines.push("");
  lines.push(`Summary: ${result.summary}`);
  return lines.join("\n");
}
