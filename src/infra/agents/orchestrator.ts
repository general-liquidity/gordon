/**
 * Gordon Orchestrator
 * Main agent that coordinates all specialized agents via Mastra
 *
 * SOTA Features Implemented:
 * - Streaming responses with real-time text deltas
 * - Agent Network for automatic multi-agent routing
 * - OpenTelemetry tracing integration
 */

import { RequestContext } from "@mastra/core/request-context";

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
  requestContext.set("portfolioValue", context.portfolioValue || 0);
  requestContext.set("availableCash", context.availableCash || 0);
  return requestContext;
}

// ============================================================================
// Stream Event Types
// ============================================================================

/**
 * Stream event types emitted during processing
 */
export interface StreamEvent {
  type: "text_delta" | "tool_call_start" | "tool_call_end" | "agent_switch" | "step_complete" | "done" | "error";
  content?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  agentName?: string;
  stepIndex?: number;
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// ============================================================================
// Streaming Message Processing (SOTA)
// ============================================================================

/**
 * Process a message with streaming support using Mastra's stream() method
 *
 * This is the primary way to interact with Gordon - provides real-time feedback
 * as the agent thinks, calls tools, and generates responses.
 */
export async function* processMessageStream(
  userMessage: string,
  context: GordonContext,
  threadId?: string
): AsyncGenerator<StreamEvent, void> {
  logger.debug("Starting streaming message processing", { messageLength: userMessage.length });

  const requestContext = createRequestContext(context);

  try {
    // Emit agent started event
    await emitEvent("agent:started", { agent: "gordon" });

    // Use Mastra's stream() method for real-time responses
    // Type assertion needed as Mastra's types don't fully expose all options
    const streamResult = await gordonAgent().stream(userMessage, {
      requestContext,
      threadId,
      maxSteps: 20,
    } as Record<string, unknown>);

    let fullText = "";

    // Mastra's stream() returns a MastraModelOutput with textStream
    // Use type assertion to access the streaming interface
    const streamObj = streamResult as unknown as {
      textStream?: AsyncIterable<string>;
      text?: string | (() => Promise<string>);
      usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | Promise<{ inputTokens?: number; outputTokens?: number; totalTokens?: number }>;
    };

    if (streamObj.textStream && typeof streamObj.textStream[Symbol.asyncIterator] === 'function') {
      // Stream text chunks as they arrive
      for await (const chunk of streamObj.textStream) {
        fullText += chunk;
        yield {
          type: "text_delta",
          content: chunk,
        };
      }
    } else if (typeof streamObj.text === 'function') {
      // text is a promise function
      fullText = await streamObj.text();
      yield {
        type: "text_delta",
        content: fullText,
      };
    } else if (typeof streamObj.text === 'string') {
      fullText = streamObj.text;
      yield {
        type: "text_delta",
        content: fullText,
      };
    }

    // Get usage stats
    let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    if (streamObj.usage) {
      const usageData = streamObj.usage instanceof Promise ? await streamObj.usage : streamObj.usage;
      usage = {
        promptTokens: usageData.inputTokens || 0,
        completionTokens: usageData.outputTokens || 0,
        totalTokens: usageData.totalTokens || 0,
      };
    }

    // Emit completion events
    await emitEvent("agent:stream_completed", {
      responseLength: fullText.length,
    });

    yield {
      type: "done",
      content: fullText,
      usage,
    };

  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error("Streaming error", error);

    await emitEvent("system:error", {
      error: {
        name: error.name,
        message: error.message,
      },
    });

    yield {
      type: "error",
      error: error.message,
    };
  }
}

// ============================================================================
// Agent Network Processing (SOTA Multi-Agent)
// ============================================================================

/**
 * Process a message using Mastra's Agent Network for automatic multi-agent routing
 *
 * The network automatically delegates to the most appropriate sub-agent
 * (Scanner, Analyst, Planner, etc.) based on user intent.
 */
export async function* processWithNetwork(
  userMessage: string,
  context: GordonContext,
  threadId?: string
): AsyncGenerator<StreamEvent, void> {
  logger.debug("Starting network processing", { messageLength: userMessage.length });

  const requestContext = createRequestContext(context);

  try {
    await emitEvent("agent:started", { agent: "gordon-network" });

    // Use Agent Network for automatic routing between sub-agents
    // Type assertion needed as Mastra's types don't fully expose all options
    const networkResult = await gordonAgent().network(userMessage, {
      requestContext,
      threadId,
      maxSteps: 30,
    } as Record<string, unknown>);

    // Stream the network result
    let fullText = "";

    // Network result is a MastraAgentNetworkStream
    const resultObj = networkResult as unknown as {
      text?: string | (() => Promise<string>);
      usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | Promise<{ inputTokens?: number; outputTokens?: number; totalTokens?: number }>;
    };

    // Get the text result
    if (typeof resultObj.text === 'function') {
      fullText = await resultObj.text();
    } else if (typeof resultObj.text === 'string') {
      fullText = resultObj.text;
    }

    yield {
      type: "text_delta",
      content: fullText,
    };

    await emitEvent("agent:stream_completed", {
      responseLength: fullText.length,
    });

    // Get usage stats
    let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    if (resultObj.usage) {
      const usageData = resultObj.usage instanceof Promise ? await resultObj.usage : resultObj.usage;
      usage = {
        promptTokens: usageData.inputTokens || 0,
        completionTokens: usageData.outputTokens || 0,
        totalTokens: usageData.totalTokens || 0,
      };
    }

    yield {
      type: "done",
      content: fullText,
      usage,
    };

  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error("Network processing error", error);
    yield {
      type: "error",
      error: error.message,
    };
  }
}

// ============================================================================
// Non-Streaming Message Processing (Backwards Compatible)
// ============================================================================

/**
 * Process a user message through Gordon using Mastra Agent
 *
 * This is the simple, non-streaming version for backwards compatibility.
 * Prefer processMessageStream() for better UX.
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
    // Use generate() for non-streaming responses
    // Type assertion needed for threadId support with Memory
    const result = await gordonAgent().generate(userMessage, {
      requestContext,
      threadId,
      maxSteps: 20,
    } as Record<string, unknown>);

    // Extract text from result - Mastra returns { text, usage, ... }
    const resultObj = result as unknown as {
      text?: string;
      usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
    };

    const response = resultObj.text || "I'm not sure how to help with that.";

    // Emit event for tracking
    await emitEvent("agent:message_processed", {
      userMessage: userMessage.substring(0, 100),
      responseLength: response.length,
      historyLength: 0, // Not tracking history length in this context
    });

    logger.debug("Message processed", { responseLength: response.length });

    return {
      response,
      usage: {
        promptTokens: resultObj.usage?.inputTokens || 0,
        completionTokens: resultObj.usage?.outputTokens || 0,
        totalTokens: resultObj.usage?.totalTokens || 0,
      },
    };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error("Failed to process message", error);
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
    maxSteps: 5, // Limit steps for simple queries
  });

  const resultObj = result as unknown as { text?: string };
  return resultObj.text || "I'm not sure how to help with that.";
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
// Tracing & Observability
// ============================================================================

/**
 * Initialize OpenTelemetry tracing for agent operations
 * Mastra supports built-in tracing when configured
 */
export function initializeTracing(): void {
  // Mastra uses OpenTelemetry under the hood
  // Tracing is enabled via environment variables:
  // - OTEL_EXPORTER_OTLP_ENDPOINT
  // - OTEL_SERVICE_NAME
  logger.debug("Tracing initialized via Mastra Agent class");

  // Log tracing configuration
  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (otlpEndpoint) {
    logger.info("OpenTelemetry tracing enabled", { endpoint: otlpEndpoint });
  }
}

// ============================================================================
// Exports
// ============================================================================

export {
  createRequestContext,
};
