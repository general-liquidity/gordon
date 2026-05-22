/**
 * Investigation sub-agent primitive — Gordon's analogue of Claude
 * Code's `Explore` subagent.
 *
 * Spawns a bounded sub-agent task in an isolated context. The
 * sub-agent runs an agent loop with a caller-supplied subset of
 * Gordon's tools, accumulates its OWN message history, then returns
 * ONLY a synthesis string to the caller. Intermediate tool results
 * never enter the orchestrator's context.
 *
 * Use cases:
 *   - "Scan 50 symbols, tell me which look interesting"
 *   - "Pull the last 7 days of trades for BTCUSDT + analyze"
 *   - "Search news + filings for AAPL, summarize what's moving"
 *
 * Without this primitive, the orchestrator runs all N tool calls
 * itself, accumulating N tool-result payloads in its context. With
 * it, the orchestrator handles off one synthesis-task and gets
 * back a single text answer.
 *
 * Safety:
 *   - Hardcoded deny-list mirrors Gordon's PermissionEngine — tools
 *     like execute_plan, place_order, cancel_order, withdraw, and
 *     wallet_transfer are stripped from the allowed-tool list
 *     before the sub-agent is spawned. An investigation that tries
 *     to call one of these never reaches the runtime.
 *   - Budget cap (default 20 tool calls) prevents runaway loops.
 *   - The investigation can NEVER place orders. By construction.
 *
 * Dependency injection:
 *   - `agentStep` is the function that actually runs one LLM turn
 *     with the given messages + tools. Tests pass a mock; runtime
 *     wires this to the existing Mastra agent loop.
 *   - `toolCatalog` is Gordon's existing tool registry — investigation
 *     looks up tools by id, doesn't construct them.
 */

export interface InvestigationMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface InvestigationToolCall {
  toolId: string;
  /** Truncated argument summary for telemetry — full args don't leave the investigation. */
  argsSummary?: string;
}

export interface InvestigationAgentStepInput {
  messages: InvestigationMessage[];
  allowedToolIds: string[];
}

export interface InvestigationAgentStepOutput {
  /** Updated message list including the assistant's response. */
  messages: InvestigationMessage[];
  /** Tool calls the assistant made during this step. */
  toolCalls: InvestigationToolCall[];
  /** True when the agent declared the task complete (no further tool calls expected). */
  finished: boolean;
}

export type InvestigationAgentStep = (
  input: InvestigationAgentStepInput,
) => Promise<InvestigationAgentStepOutput>;

export interface InvestigationDependencies {
  /** Function that runs one round of the agent loop. */
  agentStep: InvestigationAgentStep;
  /** Optional override of the hardcoded safety deny-list. */
  safetyDenyList?: string[];
  /** Clock for deterministic testing. */
  now?: () => Date;
}

export interface InvestigationRequest {
  /** Operator-readable task description. Becomes the user message. */
  task: string;
  /** Tool ids the investigation is allowed to call. Filtered against deny-list. */
  allowedTools: string[];
  /** Maximum number of tool calls the investigation may make. Default 20. */
  maxToolCalls?: number;
  /** Optional system message to prime the sub-agent. */
  systemPrompt?: string;
  /** Optional context messages to seed the sub-agent (used by contextFork). */
  contextMessages?: InvestigationMessage[];
}

export interface InvestigationResult {
  /** The sub-agent's final synthesis text — the ONLY content that returns to the caller. */
  synthesis: string;
  /** Tool calls executed during the investigation. */
  toolsCalled: InvestigationToolCall[];
  /** Total tool-call count (matches toolsCalled.length). */
  toolCallCount: number;
  /** Tool ids that were requested but stripped by the deny-list. */
  deniedTools: string[];
  /** True when the budget cap halted the investigation before it declared finish. */
  budgetExhausted: boolean;
  /** Duration in milliseconds (start → end). */
  durationMs: number;
  /** Number of agent-step rounds executed. */
  rounds: number;
}

/**
 * Safety deny-list — mirrors Gordon's PermissionEngine hard-deny tools.
 * Investigations are READ-ONLY by construction. Any attempt to allow
 * a denied tool is silently filtered + reported in `deniedTools`.
 */
export const INVESTIGATION_SAFETY_DENY_LIST: readonly string[] = [
  "execute_plan",
  "place_order",
  "place_market_order",
  "place_limit_order",
  "place_stop_order",
  "place_bracket_order",
  "cancel_order",
  "cancel_all_orders",
  "cancel_replace_order",
  "cancel_order_list",
  "close_position",
  "withdraw",
  "wallet_transfer",
  "transfer_between_accounts",
] as const;

const DEFAULT_MAX_TOOL_CALLS = 20;
const DEFAULT_SYSTEM_PROMPT =
  "You are a read-only investigation sub-agent. Use the allowed tools to gather " +
  "information about the operator's task, then return a concise synthesis. Your final " +
  "message must be plain text — no tool calls. Do not propose trades; you are observing only.";

/**
 * Run an investigation in an isolated context.
 *
 * The agent loop is bounded by `maxToolCalls` and only the final
 * assistant message is returned to the caller. Tool results from
 * intermediate steps stay within the investigation's local history.
 */
export async function runInvestigation(
  request: InvestigationRequest,
  deps: InvestigationDependencies,
): Promise<InvestigationResult> {
  const now = deps.now ?? (() => new Date());
  const startMs = now().getTime();
  const denyList = new Set(deps.safetyDenyList ?? INVESTIGATION_SAFETY_DENY_LIST);
  const maxCalls = request.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;

  // Filter allowed tools through the deny-list
  const allowedTools: string[] = [];
  const deniedTools: string[] = [];
  for (const toolId of request.allowedTools) {
    if (denyList.has(toolId)) deniedTools.push(toolId);
    else allowedTools.push(toolId);
  }

  // Build initial message list
  const messages: InvestigationMessage[] = [];
  messages.push({
    role: "system",
    content: request.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
  });
  if (request.contextMessages) {
    for (const msg of request.contextMessages) messages.push(msg);
  }
  messages.push({ role: "user", content: request.task });

  // Agent loop
  const toolsCalled: InvestigationToolCall[] = [];
  let rounds = 0;
  let budgetExhausted = false;
  let synthesis = "";
  // Safety cap on rounds (defense against agentStep that never finishes
  // without making tool calls — should be impossible but defends anyway)
  const maxRounds = Math.max(maxCalls + 5, 10);

  let currentMessages = messages;
  while (rounds < maxRounds) {
    rounds += 1;
    const step = await deps.agentStep({
      messages: currentMessages,
      allowedToolIds: allowedTools,
    });
    currentMessages = step.messages;

    // Track tool calls + enforce budget
    for (const call of step.toolCalls) {
      toolsCalled.push(call);
      if (toolsCalled.length > maxCalls) {
        budgetExhausted = true;
        break;
      }
    }

    if (step.finished || budgetExhausted) break;
  }

  // Extract synthesis = last assistant message content
  for (let i = currentMessages.length - 1; i >= 0; i--) {
    const msg = currentMessages[i];
    if (msg && msg.role === "assistant") {
      synthesis = msg.content;
      break;
    }
  }

  const endMs = now().getTime();
  return {
    synthesis,
    toolsCalled,
    toolCallCount: toolsCalled.length,
    deniedTools,
    budgetExhausted,
    durationMs: endMs - startMs,
    rounds,
  };
}
