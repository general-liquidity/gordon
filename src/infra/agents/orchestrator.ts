/**
 * Gordon Orchestrator
 * Main agent that coordinates all specialized agents via Mastra
 *
 * Uses Mastra's Agent class with .generate() for responses:
 * - agent.generate() for LLM-powered responses with tool access
 * - RequestContext for dependency injection
 * - Memory integration for conversation persistence
 */

import { RequestContext } from "@mastra/core/request-context";
import type { CoreMessage } from "ai";

import { gordonAgent } from "./agents.ts";
import { createModuleLogger } from "../logger/index.ts";
import { emitEvent } from "../../events/index.ts";
import type { GordonContext } from "./types.ts";

const logger = createModuleLogger("orchestrator");

// ============================================================================
// Request Context Helper
// ============================================================================

/**
 * Create a RequestContext with Gordon's dependencies
 * This is how we inject context into tools in Mastra
 */
function createRequestContext(context: GordonContext): RequestContext {
  const requestContext = new RequestContext();
  requestContext.set("binance", context.binance);
  requestContext.set("config", context.config);
  requestContext.set("llm", context.llm);
  requestContext.set("userId", context.userId || "default");
  return requestContext;
}

// ============================================================================
// Message Processing
// ============================================================================

/**
 * Process a user message through Gordon using Mastra Agent
 *
 * @param userMessage - The user's input message
 * @param context - Gordon's context (binance, llm, config, etc.)
 * @param threadId - Thread ID for conversation persistence
 * @returns The agent's response and usage stats
 */
export async function processMessage(
  userMessage: string,
  context: GordonContext,
  threadId?: string
): Promise<{
  response: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}> {
  logger.debug("Processing message with Mastra", { messageLength: userMessage.length });

  const requestContext = createRequestContext(context);

  try {
    // Use agent.generate() for LLM-powered responses
    const result = await gordonAgent().generate(userMessage, {
      requestContext,
      threadId,
      maxSteps: 20,
    });

    const response = result.text || "I'm not sure how to help with that.";

    // Emit event for tracking
    await emitEvent("agent:message_processed", {
      userMessage: userMessage.substring(0, 100),
      responseLength: response.length,
    });

    logger.debug("Message processed", { responseLength: response.length });

    return {
      response,
      usage: {
        promptTokens: result.usage?.promptTokens || 0,
        completionTokens: result.usage?.completionTokens || 0,
        totalTokens: result.usage?.totalTokens || 0,
      },
    };
  } catch (error) {
    const errorDetails = {
      name: error instanceof Error ? error.name : "Unknown",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack?.split("\n").slice(0, 5).join("\n") : undefined,
    };
    logger.error("Failed to process message", { error: errorDetails });
    throw error;
  }
}

/**
 * Process a simple message without full tool access
 * Use this for quick single-turn responses
 */
export async function processSimpleMessage(
  userMessage: string,
  context: GordonContext
): Promise<string> {
  const requestContext = createRequestContext(context);

  const result = await gordonAgent().generate(userMessage, {
    requestContext,
  });

  return result.text || "I'm not sure how to help with that.";
}

// ============================================================================
// Streaming Support
// ============================================================================

/**
 * Stream event types emitted during processing
 */
export interface StreamEvent {
  type: "text_delta" | "tool_call" | "agent_switch" | "step_complete" | "done" | "error";
  content?: string;
  toolName?: string;
  agentName?: string;
  error?: string;
}

/**
 * Process a message with streaming support
 * Uses Mastra's generate with callbacks for streaming
 */
export async function* processMessageStream(
  userMessage: string,
  context: GordonContext,
  threadId?: string
): AsyncGenerator<StreamEvent, void> {
  logger.debug("Starting streaming message processing");

  const requestContext = createRequestContext(context);

  try {
    const result = await gordonAgent().generate(userMessage, {
      requestContext,
      threadId,
      maxSteps: 20,
    });

    // Yield the final response
    const response = result.text || "";
    yield { type: "done", content: response };

    await emitEvent("agent:stream_completed", {
      responseLength: response.length,
    });
  } catch (error) {
    logger.error("Streaming error", { error });
    yield {
      type: "error",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
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

// ============================================================================
// Tracing Initialization
// ============================================================================

/**
 * Initialize tracing for agent operations
 * Mastra uses its own tracing via the Agent class
 */
export function initializeTracing(): void {
  logger.debug("Tracing initialized via Mastra Agent class");
}
