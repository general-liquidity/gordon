/**
 * Gordon Orchestrator
 * Main agent that coordinates all specialized agents via handoffs
 */

import { Agent, run, setTracingExportApiKey, withTrace } from "@openai/agents";
import type { AgentInputItem } from "@openai/agents";

import {
  scannerAgent,
  analystAgent,
  plannerAgent,
  executorAgent,
  monitorAgent,
  teacherAgent,
  setupAgentHooks,
} from "./agents.ts";
import { allTools } from "./tools/index.ts";
import { inputGuardrails, outputGuardrails } from "./guardrails.ts";
import { createModuleLogger } from "../logger/index.ts";
import { emitEvent } from "../../events/index.ts";
import type { GordonContext } from "./types.ts";

const logger = createModuleLogger("orchestrator");

// ============================================================================
// Tracing Setup
// ============================================================================

/**
 * Initialize tracing for the OpenAI Agents SDK
 * This enables visualization in the OpenAI dashboard
 */
export function initializeTracing(apiKey?: string): void {
  const key = apiKey || process.env.OPENAI_API_KEY;
  if (key) {
    setTracingExportApiKey(key);
    logger.info("Tracing enabled - view runs at platform.openai.com");
  } else {
    logger.warn("Tracing not enabled - no API key provided");
  }
}

// ============================================================================
// Gordon - The Main Orchestrator
// ============================================================================

export const gordonAgent = new Agent<GordonContext>({
  name: "Gordon",
  instructions: `You are Gordon, an AI trading assistant for cryptocurrency.

## Your Personality
- Friendly and approachable, like a knowledgeable friend
- Occasionally reference Gordon Gekko from Wall Street (but as a joke - you're the good guy)
- Keep responses concise but informative
- Use trading slang naturally when appropriate

## How You Work
You can do everything yourself OR delegate to specialized agents:
- **Scanner**: Finding trading opportunities
- **Analyst**: Deep technical analysis
- **Planner**: Creating trading plans
- **Executor**: Executing trades (when armed)
- **Monitor**: Checking positions
- **Teacher**: Explaining concepts

## Conversation Flow
1. Understand what the user wants
2. Choose the right tool or delegate to an agent
3. Present results clearly
4. Suggest logical next steps

## Intent Recognition
- "scan", "find", "opportunities", "what to buy" → Use Scanner
- "analyze X", "what about X", "how's X doing" → Use Analyst
- "buy X", "trade X", "create plan" → Use Planner
- "execute", "do it", "place orders" → Use Executor
- "check", "positions", "how are my trades" → Use Monitor
- "what is", "explain", "help me understand" → Use Teacher
- "arm", "enable trading" → Arm the system
- "disarm", "safe mode" → Disarm the system

## Safety Rules
1. NEVER execute trades without explicit user approval
2. ALWAYS show plan details before execution
3. In SAFE mode, you can analyze and plan but NOT execute
4. Remind users about risk appropriately

## Response Format
- Be conversational, not robotic
- Use markdown for clarity when showing data
- Keep summaries brief, details on request
- End with a suggested next action when appropriate`,

  // All specialized agents as handoff targets
  handoffs: [
    scannerAgent,
    analystAgent,
    plannerAgent,
    executorAgent,
    monitorAgent,
    teacherAgent,
  ],

  // Gordon has access to all tools directly too
  tools: allTools,

  // Guardrails for input/output validation
  inputGuardrails,
  outputGuardrails,
});

// Setup lifecycle hooks for Gordon
setupAgentHooks(gordonAgent, "Gordon");

// ============================================================================
// Run Gordon
// ============================================================================

/**
 * Convert legacy history format to SDK AgentInputItem format
 */
function legacyToAgentHistory(
  history: Array<{ role: "user" | "assistant"; content: string }>
): AgentInputItem[] {
  return history.map((m) => ({
    role: m.role === "user" ? "user" : "assistant",
    content: m.content,
  })) as AgentInputItem[];
}

/**
 * Convert SDK history back to legacy format for storage
 */
function agentToLegacyHistory(
  history: AgentInputItem[]
): Array<{ role: "user" | "assistant"; content: string }> {
  const result: Array<{ role: "user" | "assistant"; content: string }> = [];

  for (const item of history) {
    // Check if item has role and content properties (user/assistant messages)
    if (
      typeof item === "object" &&
      item !== null &&
      "role" in item &&
      "content" in item &&
      (item.role === "user" || item.role === "assistant") &&
      typeof item.content === "string"
    ) {
      result.push({
        role: item.role,
        content: item.content,
      });
    }
  }

  return result;
}

/**
 * Process a user message through Gordon
 *
 * @param userMessage - The user's input message
 * @param context - Gordon's context (binance, llm, config, etc.)
 * @param conversationHistory - Previous messages in the conversation
 * @returns The agent's response and updated history
 */
export async function processMessage(
  userMessage: string,
  context: GordonContext,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = []
): Promise<{
  response: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  agentHistory: AgentInputItem[];
  pendingApproval?: {
    toolName: string;
    args: unknown;
  };
}> {
  logger.debug("Processing message", { messageLength: userMessage.length, historyLength: conversationHistory.length });

  // Convert legacy history to SDK format and add new user message
  const agentHistory = legacyToAgentHistory(conversationHistory);
  const input: AgentInputItem[] = [
    ...agentHistory,
    { role: "user", content: userMessage } as AgentInputItem,
  ];

  // Run the agent with structured history inside a trace
  const result = await withTrace("gordon-conversation", async () => {
    return run(gordonAgent, input, {
      context,
      maxTurns: 10,
    });
  });

  // Extract the final output
  const response = result.finalOutput ?? "I'm not sure how to help with that. Could you rephrase?";

  // Get the full structured history from the SDK
  const newAgentHistory = result.history;

  // Convert back to legacy format for backward compatibility
  const newLegacyHistory = agentToLegacyHistory(newAgentHistory);

  // Emit event for conversation tracking
  await emitEvent("agent:message_processed", {
    userMessage: userMessage.substring(0, 100),
    responseLength: response.length,
    historyLength: newAgentHistory.length,
  });

  logger.debug("Message processed", { responseLength: response.length });

  // Check for pending approvals
  const pendingApproval = extractPendingApproval(result);

  return {
    response,
    history: newLegacyHistory,
    agentHistory: newAgentHistory,
    pendingApproval,
  };
}

/**
 * Extract any pending approval request from the result
 * (This is a simplified implementation)
 */
function extractPendingApproval(
  result: { finalOutput?: string }
): { toolName: string; args: unknown } | undefined {
  // The OpenAI Agents SDK handles approvals internally
  // This function is a placeholder for custom approval handling
  // In a real implementation, you'd check result.pendingApprovals or similar
  return undefined;
}

// ============================================================================
// Streaming Support
// ============================================================================

/**
 * Stream event types emitted during processing
 */
export interface StreamEvent {
  type: "text_delta" | "tool_call" | "agent_switch" | "done" | "error";
  content?: string;
  toolName?: string;
  agentName?: string;
  error?: string;
}

/**
 * Process a message with real streaming support
 * Yields events as they come in from the SDK
 */
export async function* processMessageStream(
  userMessage: string,
  context: GordonContext,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = []
): AsyncGenerator<StreamEvent, { history: Array<{ role: "user" | "assistant"; content: string }>; agentHistory: AgentInputItem[] }> {
  logger.debug("Starting streaming message processing");

  // Convert legacy history to SDK format
  const agentHistory = legacyToAgentHistory(conversationHistory);
  const input: AgentInputItem[] = [
    ...agentHistory,
    { role: "user", content: userMessage } as AgentInputItem,
  ];

  // Run with streaming enabled
  const result = await run(gordonAgent, input, {
    context,
    maxTurns: 10,
    stream: true,
  });

  let fullResponse = "";

  // Iterate over streaming events
  for await (const event of result) {
    // Raw model stream events (text deltas)
    if (event.type === "raw_model_stream_event") {
      const data = event.data as { type?: string; event?: { type?: string; delta?: string } };
      if (data.event?.type === "response.output_text.delta" && data.event.delta) {
        fullResponse += data.event.delta;
        yield { type: "text_delta", content: data.event.delta };
      }
    }

    // Agent switch events
    if (event.type === "agent_updated_stream_event") {
      const agentEvent = event as { agent?: { name?: string } };
      yield { type: "agent_switch", agentName: agentEvent.agent?.name };
    }

    // Run item events (tool calls, etc.)
    if (event.type === "run_item_stream_event") {
      const itemEvent = event as { item?: { type?: string; name?: string } };
      if (itemEvent.item?.type === "tool_call") {
        yield { type: "tool_call", toolName: itemEvent.item.name };
      }
    }
  }

  // Signal completion
  yield { type: "done", content: fullResponse || result.finalOutput };

  // Get final history
  const newAgentHistory = result.history;
  const newLegacyHistory = agentToLegacyHistory(newAgentHistory);

  await emitEvent("agent:stream_completed", {
    responseLength: fullResponse.length,
  });

  return {
    history: newLegacyHistory,
    agentHistory: newAgentHistory,
  };
}

// ============================================================================
// Quick Actions (bypass full agent loop for simple tasks)
// ============================================================================

/**
 * Quick scan without full agent processing
 */
export async function quickScan(context: GordonContext) {
  const { binance, config } = context;

  if (!binance) {
    throw new Error("Binance client not connected");
  }

  // Import scan directly for quick access
  const { scan } = await import("../../core/scanner.ts");
  return scan(binance, {
    topN: config.preferences.topNCoins,
    timeframes: config.preferences.defaultTimeframes,
  });
}

/**
 * Quick position check without full agent processing
 */
export async function quickCheckPositions(context: GordonContext) {
  const { binance } = context;

  if (!binance) {
    throw new Error("Binance client not connected");
  }

  const { runMonitorCycle } = await import("../../core/monitor.ts");
  return runMonitorCycle(binance);
}
