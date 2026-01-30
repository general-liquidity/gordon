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
import { checkInputGuardrails, checkOutputGuardrails } from "./middleware/guardrails.ts";
import {
  initializeTracing as initTracingModule,
  buildTracingOptions,
  isTracingEnabled,
  getTracingConfig,
  recordRequest,
  recordError,
  type SpanContext,
} from "../observability/index.ts";
import type { GordonContext } from "./types.ts";

const logger = createModuleLogger("orchestrator");

// ============================================================================
// Tool-to-Agent Mapping
// ============================================================================

/**
 * Map tool names to their owning sub-agent
 * Used to detect which agent is responding during streaming
 */
const TOOL_AGENT_MAP: Record<string, string> = {
  // Scanner tools
  scan_market: "Scanner",
  // Analyst tools
  analyze_coin: "Analyst",
  get_technical_analysis: "Analyst",
  get_rsi: "Analyst",
  get_vwap: "Analyst",
  get_stochastic_rsi: "Analyst",
  detect_whales: "Analyst",
  detect_breakout: "Analyst",
  detect_consolidation: "Analyst",
  score_setup: "Analyst",
  get_orderbook_depth: "Analyst",
  get_orderbook_imbalance: "Analyst",
  find_liquidity_clusters: "Analyst",
  get_chart: "Analyst",
  // Planner tools
  create_plan: "Planner",
  create_grid_plan: "Planner",
  list_plans: "Planner",
  calculate_kelly_size: "Planner",
  calculate_volatility_adjusted_size: "Planner",
  assess_trade_risk: "Planner",
  // Executor tools
  execute_plan: "Executor",
  close_trade: "Executor",
  arm_system: "Executor",
  approve_plan: "Executor",
  // Monitor tools
  check_positions: "Monitor",
  get_portfolio: "Monitor",
  get_wallet_balances: "Monitor",
  get_earn_positions: "Monitor",
  get_trade_history: "Monitor",
  check_exit_conditions: "Monitor",
  check_drawdown_status: "Monitor",
  check_daily_limit: "Monitor",
  get_performance_metrics: "Monitor",
  // Teacher tools
  explain: "Teacher",
  // Discovery tools (Scanner)
  discover_coins: "Scanner",
  get_trending: "Scanner",
  get_new_listings: "Scanner",
  get_top_movers: "Scanner",
};

/**
 * Get the agent name that owns a specific tool
 */
function getAgentForTool(toolName: string): string | undefined {
  return TOOL_AGENT_MAP[toolName];
}

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
  const startTime = Date.now();
  logger.debug("Starting streaming message processing", { messageLength: userMessage.length });

  // INPUT GUARDRAIL: Check for dangerous patterns before processing
  const inputCheck = await checkInputGuardrails(userMessage);
  if (!inputCheck.allowed) {
    logger.warn("Input blocked by guardrail", { reason: inputCheck.reason });
    recordRequest(Date.now() - startTime, false);
    recordError("InputGuardrailBlock");
    yield { type: "error", error: inputCheck.reason };
    return;
  }

  const requestContext = createRequestContext(context);

  try {
    // Emit agent started event
    await emitEvent("agent:started", { agent: "gordon" });

    // Build tracing options if tracing is enabled
    const tracingOptions = createAgentTracingOptions();

    // Use Mastra's stream() method for real-time responses
    // Type assertion needed as Mastra's types don't fully expose all options
    const streamResult = await gordonAgent().stream(userMessage, {
      requestContext,
      threadId,
      maxSteps: 20,
      ...(tracingOptions && { tracingOptions }),
    } as Record<string, unknown>);

    let fullText = "";
    let currentAgent: string | undefined;

    // Mastra's stream() returns a MastraModelOutput with fullStream for all events
    // Use type assertion to access the streaming interface
    interface StreamChunk {
      type: string;
      payload?: {
        agentId?: string;
        toolName?: string;
        text?: string;
        textDelta?: string;
        args?: Record<string, unknown>;
        result?: unknown;
      };
    }

    const streamObj = streamResult as unknown as {
      fullStream?: ReadableStream<StreamChunk>;
      textStream?: AsyncIterable<string>;
      text?: string | (() => Promise<string>);
      usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | Promise<{ inputTokens?: number; outputTokens?: number; totalTokens?: number }>;
    };

    // Try fullStream first for complete event information (including tool calls and agent switches)
    if (streamObj.fullStream) {
      const reader = streamObj.fullStream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = value as StreamChunk;

          switch (chunk.type) {
            case "text-delta":
              if (chunk.payload?.textDelta) {
                const outputCheck = await checkOutputGuardrails(chunk.payload.textDelta);
                const sanitizedChunk = outputCheck.sanitized;
                fullText += sanitizedChunk;
                yield {
                  type: "text_delta",
                  content: sanitizedChunk,
                  agentName: currentAgent,
                };
              }
              break;

            case "tool-call":
              if (chunk.payload?.toolName) {
                const toolName = chunk.payload.toolName;
                const detectedAgent = getAgentForTool(toolName);

                // Emit agent switch if we detected a different agent
                if (detectedAgent && detectedAgent !== currentAgent) {
                  currentAgent = detectedAgent;
                  yield {
                    type: "agent_switch",
                    agentName: currentAgent,
                  };
                }

                yield {
                  type: "tool_call_start",
                  toolName,
                  toolArgs: chunk.payload.args,
                  agentName: currentAgent,
                };
              }
              break;

            case "tool-result":
              yield {
                type: "tool_call_end",
                toolName: chunk.payload?.toolName,
                toolResult: chunk.payload?.result,
                agentName: currentAgent,
              };
              break;

            case "agent-execution-start":
            case "routing-agent-start":
              if (chunk.payload?.agentId) {
                const agentId = chunk.payload.agentId;
                // Capitalize agent name for display
                const agentName = agentId.charAt(0).toUpperCase() + agentId.slice(1);
                if (agentName !== currentAgent && agentName.toLowerCase() !== "gordon") {
                  currentAgent = agentName;
                  yield {
                    type: "agent_switch",
                    agentName: currentAgent,
                  };
                }
              }
              break;
          }
        }
      } finally {
        reader.releaseLock();
      }
    } else if (streamObj.textStream && typeof streamObj.textStream[Symbol.asyncIterator] === 'function') {
      // Fallback to textStream if fullStream is not available
      // Stream text chunks as they arrive
      // OUTPUT GUARDRAIL: Sanitize each chunk for sensitive data
      for await (const chunk of streamObj.textStream) {
        const outputCheck = await checkOutputGuardrails(chunk);
        const sanitizedChunk = outputCheck.sanitized;
        fullText += sanitizedChunk;
        yield {
          type: "text_delta",
          content: sanitizedChunk,
          agentName: currentAgent,
        };
      }
    } else if (typeof streamObj.text === 'function') {
      // text is a promise function
      const rawText = await streamObj.text();
      // OUTPUT GUARDRAIL: Sanitize the response
      const outputCheck = await checkOutputGuardrails(rawText);
      fullText = outputCheck.sanitized;
      yield {
        type: "text_delta",
        content: fullText,
        agentName: currentAgent,
      };
    } else if (typeof streamObj.text === 'string') {
      // OUTPUT GUARDRAIL: Sanitize the response
      const outputCheck = await checkOutputGuardrails(streamObj.text);
      fullText = outputCheck.sanitized;
      yield {
        type: "text_delta",
        content: fullText,
        agentName: currentAgent,
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

    // Record successful request metrics
    recordRequest(Date.now() - startTime, true);

    yield {
      type: "done",
      content: fullText,
      usage,
      agentName: currentAgent,
    };

  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error("Streaming error", error);

    // Record failed request metrics
    recordRequest(Date.now() - startTime, false);
    recordError(error.name || "UnknownError");

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
  const startTime = Date.now();
  logger.debug("Starting network processing", { messageLength: userMessage.length });

  // INPUT GUARDRAIL: Check for dangerous patterns before processing
  const inputCheck = await checkInputGuardrails(userMessage);
  if (!inputCheck.allowed) {
    logger.warn("Input blocked by guardrail", { reason: inputCheck.reason });
    recordRequest(Date.now() - startTime, false);
    recordError("InputGuardrailBlock");
    yield { type: "error", error: inputCheck.reason };
    return;
  }

  const requestContext = createRequestContext(context);

  try {
    await emitEvent("agent:started", { agent: "gordon-network" });

    // Build tracing options if tracing is enabled
    const tracingOptions = createAgentTracingOptions();

    // Use Agent Network for automatic routing between sub-agents
    // Type assertion needed as Mastra's types don't fully expose all options
    const networkResult = await gordonAgent().network(userMessage, {
      requestContext,
      threadId,
      maxSteps: 30,
      ...(tracingOptions && { tracingOptions }),
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

    // OUTPUT GUARDRAIL: Sanitize the response for sensitive data
    const outputCheck = await checkOutputGuardrails(fullText);
    fullText = outputCheck.sanitized;

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

    // Record successful request metrics
    recordRequest(Date.now() - startTime, true);

    yield {
      type: "done",
      content: fullText,
      usage,
    };

  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error("Network processing error", error);

    // Record failed request metrics
    recordRequest(Date.now() - startTime, false);
    recordError(error.name || "UnknownError");

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
  const startTime = Date.now();
  logger.debug("Processing message with Mastra", { messageLength: userMessage.length });

  // INPUT GUARDRAIL: Check for dangerous patterns before processing
  const inputCheck = await checkInputGuardrails(userMessage);
  if (!inputCheck.allowed) {
    logger.warn("Input blocked by guardrail", { reason: inputCheck.reason });
    recordRequest(Date.now() - startTime, false);
    recordError("InputGuardrailBlock");
    return {
      response: inputCheck.reason || "Input blocked by safety guardrail.",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

  const requestContext = createRequestContext(context);

  try {
    // Build tracing options if tracing is enabled
    const tracingOptions = createAgentTracingOptions();

    // Use generate() for non-streaming responses
    // Type assertion needed for threadId support with Memory
    const result = await gordonAgent().generate(userMessage, {
      requestContext,
      threadId,
      maxSteps: 20,
      ...(tracingOptions && { tracingOptions }),
    } as Record<string, unknown>);

    // Extract text from result - Mastra returns { text, usage, ... }
    const resultObj = result as unknown as {
      text?: string;
      usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
    };

    const rawResponse = resultObj.text || "I'm not sure how to help with that.";

    // OUTPUT GUARDRAIL: Sanitize response for sensitive data
    const outputCheck = await checkOutputGuardrails(rawResponse);
    const response = outputCheck.sanitized;

    // Emit event for tracking
    await emitEvent("agent:message_processed", {
      userMessage: userMessage.substring(0, 100),
      responseLength: response.length,
      historyLength: 0, // Not tracking history length in this context
    });

    logger.debug("Message processed", { responseLength: response.length });

    // Record successful request metrics
    recordRequest(Date.now() - startTime, true);

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

    // Record failed request metrics
    recordRequest(Date.now() - startTime, false);
    recordError(error.name || "UnknownError");

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
  const startTime = Date.now();

  // INPUT GUARDRAIL: Check for dangerous patterns before processing
  const inputCheck = await checkInputGuardrails(userMessage);
  if (!inputCheck.allowed) {
    logger.warn("Input blocked by guardrail", { reason: inputCheck.reason });
    recordRequest(Date.now() - startTime, false);
    recordError("InputGuardrailBlock");
    return inputCheck.reason || "Input blocked by safety guardrail.";
  }

  const requestContext = createRequestContext(context);

  try {
    // Build tracing options if tracing is enabled
    const tracingOptions = createAgentTracingOptions();

    const result = await gordonAgent().generate(userMessage, {
      requestContext,
      maxSteps: 5, // Limit steps for simple queries
      ...(tracingOptions && { tracingOptions }),
    });

    const resultObj = result as unknown as { text?: string };
    const rawResponse = resultObj.text || "I'm not sure how to help with that.";

    // OUTPUT GUARDRAIL: Sanitize response for sensitive data
    const outputCheck = await checkOutputGuardrails(rawResponse);

    // Record successful request metrics
    recordRequest(Date.now() - startTime, true);

    return outputCheck.sanitized;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));

    // Record failed request metrics
    recordRequest(Date.now() - startTime, false);
    recordError(error.name || "UnknownError");

    throw error;
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
// Tracing & Observability
// ============================================================================

/**
 * Initialize OpenTelemetry tracing for agent operations
 *
 * This initializes the tracing infrastructure and logs configuration.
 * When OTEL_TRACING_ENABLED=true, traces will be exported to the
 * configured OTLP endpoint.
 *
 * Environment variables:
 * - OTEL_TRACING_ENABLED: Enable tracing (default: false)
 * - OTEL_EXPORTER_OTLP_ENDPOINT: OTLP endpoint URL
 * - OTEL_SERVICE_NAME: Service name for traces
 */
export function initializeTracing(): void {
  // Initialize the tracing module
  initTracingModule();

  // Log configuration status
  const config = getTracingConfig();
  if (config.enabled) {
    logger.info("OpenTelemetry tracing enabled", {
      serviceName: config.serviceName,
      endpoint: config.endpoint,
    });
  } else {
    logger.debug("Tracing disabled (set OTEL_TRACING_ENABLED=true to enable)");
  }
}

/**
 * Create tracing options for agent calls
 *
 * This builds the tracingOptions object that can be passed to
 * agent.generate() or agent.stream() calls for distributed tracing.
 */
function createAgentTracingOptions(parentContext?: SpanContext): Record<string, unknown> | undefined {
  if (!isTracingEnabled()) {
    return undefined;
  }

  const tracingOpts = buildTracingOptions({
    parentContext,
    metadata: {
      agent: "gordon",
      timestamp: new Date().toISOString(),
    },
    tags: ["gordon-agent"],
  });

  // Cast to Record<string, unknown> to match Mastra's expected type
  return tracingOpts as Record<string, unknown>;
}

// ============================================================================
// Exports
// ============================================================================

export {
  createRequestContext,
};
