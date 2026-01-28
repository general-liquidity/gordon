/**
 * Gordon Orchestrator
 * Main agent that coordinates all specialized agents via handoffs
 */

import { Agent, run } from "@openai/agents";

import {
  scannerAgent,
  analystAgent,
  plannerAgent,
  executorAgent,
  monitorAgent,
  teacherAgent,
} from "./agents.ts";
import { allTools } from "./tools/index.ts";
import type { GordonContext } from "./types.ts";

// ============================================================================
// Gordon - The Main Orchestrator
// ============================================================================

export const gordonAgent = new Agent({
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
});

// ============================================================================
// Run Gordon
// ============================================================================

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
  pendingApproval?: {
    toolName: string;
    args: unknown;
  };
}> {
  // Build input with conversation history
  const historyText = conversationHistory
    .map((m) => `${m.role === "user" ? "User" : "Gordon"}: ${m.content}`)
    .join("\n");

  const input = historyText
    ? `Previous conversation:\n${historyText}\n\nUser: ${userMessage}`
    : userMessage;

  // Run the agent
  const result = await run(gordonAgent, input, {
    context,
    maxTurns: 10, // Limit agent loop iterations
  });

  // Extract the final output
  const response = result.finalOutput ?? "I'm not sure how to help with that. Could you rephrase?";

  // Update conversation history
  const newHistory = [
    ...conversationHistory,
    { role: "user" as const, content: userMessage },
    { role: "assistant" as const, content: response },
  ];

  // Check for pending approvals (tools with needsApproval)
  // This is a simplified check - in production you'd handle this more robustly
  const pendingApproval = extractPendingApproval(result);

  return {
    response,
    history: newHistory,
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
 * Process a message with streaming support
 * Yields partial responses as they come in
 */
export async function* processMessageStream(
  userMessage: string,
  context: GordonContext,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = []
): AsyncGenerator<string, { history: Array<{ role: "user" | "assistant"; content: string }> }> {
  // Build input with conversation history
  const historyText = conversationHistory
    .map((m) => `${m.role === "user" ? "User" : "Gordon"}: ${m.content}`)
    .join("\n");

  const input = historyText
    ? `Previous conversation:\n${historyText}\n\nUser: ${userMessage}`
    : userMessage;

  // For streaming, we'd use the SDK's streaming API
  // This is a simplified non-streaming fallback
  const result = await run(gordonAgent, input, {
    context,
    maxTurns: 10,
  });

  const response = result.finalOutput ?? "I'm not sure how to help with that.";

  // Yield the response (in production, this would yield chunks)
  yield response;

  // Return updated history
  return {
    history: [
      ...conversationHistory,
      { role: "user" as const, content: userMessage },
      { role: "assistant" as const, content: response },
    ],
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
