/**
 * Gordon Orchestrator
 * Main agent that coordinates all specialized agents via Mastra
 *
 * SOTA Features Implemented:
 * - Streaming responses with real-time text deltas
 * - Agent Network for automatic multi-agent routing
 * - OpenTelemetry tracing integration
 *
 * This file acts as a thin coordinator, delegating to extracted modules in
 * ./orchestrator/ for stream processing, error handling, guardrails, etc.
 */

import { RequestContext } from "@mastra/core/request-context";
import { z } from "zod";

import { gordonAgent } from "./agents.ts";
import {
  buildPromptEnvelope,
  type GroundedPromptMessage,
} from "./context/contextBudget.ts";
import {
  formatIntegrationGlossary,
  selectRelevantIntegrationGlossary,
} from "./integrationGlossary.ts";
import { createModuleLogger } from "../logger/index.ts";
import { emitEvent } from "../../events/index.ts";
import {
  checkInputGuardrails,
  checkOutputGuardrails,
} from "./middleware/index.ts";
import {
  initializeTracing as initTracingModule,
  buildTracingOptions,
  isTracingEnabled,
  getTracingConfig,
  recordRequest,
  recordError,
  recordAgentCall,
  type SpanContext,
} from "../platform/observability/index.ts";
import type { GordonContext } from "./types.ts";
import {
  classifyRecoveryGuidance,
  formatRecoveryGuidance,
  formatPlanningHandoffBlock,
  getPlanningHandoff,
  resetLoopSignals,
  resetReminderState,
} from "./harness/runtimeHarness.ts";
import { determineWorkflowPhase } from "./cognition/workflowPhase.ts";
import { providerOptionsForPhase } from "./wiring/extendedThinkingWiring.ts";
import {
  runThinkingPhase,
  resolveThinkingDepth,
  shouldRunToolFreeThinking,
  prependThinkingTrace,
  type ThinkingResult,
} from "./cognition/thinkingPhase.ts";
import { runCritiquePhase } from "./cognition/critiquePhase.ts";
import {
  validateAndRepairTranscript,
  formatTranscriptRepairBlock,
  validateAndRepairModelMessages,
} from "./cognition/transcriptValidator.ts";
import {
  runLifecycleHooks,
  startLifecycleSession,
  endLifecycleSession,
  type LifecycleHookPayload,
} from "./harness/lifecycleHooks.ts";
import {
  defaultHandoffCoordinator,
  type HandoffRecord,
  type HandoffValidation,
} from "./orchestrator/HandoffCoordinator.ts";
import { createAgentRequestContext } from "./orchestrator/RequestContextFactory.ts";
import { recordPromptUsage, resolveNormalizedUsage } from "./orchestrator/UsageTracker.ts";
import { bridgeStreamEvent } from "./streaming/streamBridge.ts";
import { getCompactionTrigger } from "../context/compaction/compactionTrigger.ts";
import { getConversationBudget } from "../context/budgeting/conversationBudget.ts";
import { recordTombstone } from "../context/compaction/tombstones.ts";
import { getCostTracker } from "../platform/costTracker.ts";
import { toMessageStreamChunk, type MessageStreamChunk } from "./orchestrator/StreamCoordinator.ts";
import {
  advanceReActStage,
  awaitWithAbort,
  readStreamChunkWithAbort,
  StreamCancelledError,
  throwIfStreamAborted,
  type ReActStage,
} from "./orchestrator/StreamLifecycle.ts";
import {
  ensureMCPToolsDiscovered,
  getMCPDiscoveryIntent,
  areMCPSchemasDiscovered,
  scheduleBackgroundDiscoveryRefresh,
} from "../ai/mcp/client.ts";
import { captureAuditedRequest } from "./context/promptCacheAudit.ts";
import type { Message } from "../ai/llm/types.ts";
import { resetAgents } from "./agents.ts";
import { rebuildACEMemoryForThread, getACEMemorySnapshot } from "./memory/aceMemory.ts";
import {
  type StreamWriter,
  type StreamingResult,
  type StreamChunk,
  createStartChunk,
  createChunk,
  createEndChunk,
  createErrorChunk,
} from "./streaming/streamWriter.ts";

// ── Extracted modules ──────────────────────────────────────────────────────
import {
  type StreamEvent,
  type ProcessMessageStreamOptions,
} from "./orchestrator/types.ts";
import {
  getAgentForTool,
} from "./orchestrator/toolAgentMap.ts";
import {
  getCompiledSubagentProfiles,
  validateToolCall,
  handleAgentSwitch,
  processToolResult,
  type StreamChunk as InternalStreamChunk,
  type StreamProcessingState,
} from "./orchestrator/streamProcessor.ts";
import { reportToolCallInterruption } from "./processors/toolcall-reconciler.ts";
import type { InterruptionReason } from "./runtime/toolCallReconciler.ts";

const logger = createModuleLogger("orchestrator");

/**
 * Per-call output-token caps. Without these, Mastra defaults to the model's
 * full catalog max (e.g. 100000 for Claude Haiku 4.5), and some provider
 * backends reject non-streaming requests above ~21K with
 * "streaming_required" — producing a wave of 400s during fast-tier calls
 * (compaction, scan, ops phases use Haiku regardless of which main model
 * the user picked).
 *
 * - STREAM cap is generous (65536) since streaming requests don't hit the
 *   provider threshold, and we want long agent responses to render fully.
 * - GENERATE cap stays under the Anthropic non-stream threshold (~21333)
 *   since the only generate() callers are structured-output and
 *   simple-message paths that don't need very long responses.
 */
const MAX_OUTPUT_TOKENS_STREAM = 65536;
const MAX_OUTPUT_TOKENS_GENERATE = 16384;

// ============================================================================
// Lifecycle Session Management
// ============================================================================

const lifecycleSessionContexts = new Map<string, GordonContext>();
let lifecycleProcessHooksRegistered = false;

function registerLifecycleProcessHooks(): void {
  if (lifecycleProcessHooksRegistered) {
    return;
  }

  lifecycleProcessHooksRegistered = true;
  const closeSessions = (): void => {
    for (const [threadId, context] of lifecycleSessionContexts.entries()) {
      void endLifecycleSession(context, {
        threadId,
        agentName: "Gordon",
      });
      resetReminderState(context);
    }
    lifecycleSessionContexts.clear();
  };

  process.once("beforeExit", closeSessions);
  process.once("exit", closeSessions);
}

// ============================================================================
// Handoff Tracking & Validation (thin wrappers over HandoffCoordinator)
// ============================================================================

/**
 * Validate a handoff between agents
 */
export function validateHandoff(
  fromAgent: string,
  toAgent: string,
  context?: Record<string, unknown>
): HandoffValidation {
  return defaultHandoffCoordinator.validate(fromAgent, toAgent, context);
}

/**
 * Track an agent handoff
 */
export async function trackHandoff(
  fromAgent: string,
  toAgent: string,
  metadata?: Record<string, unknown>
): Promise<HandoffRecord> {
  return defaultHandoffCoordinator.track(fromAgent, toAgent, metadata);
}

/**
 * Get recent handoff history
 */
export function getHandoffHistory(limit: number = 20): HandoffRecord[] {
  return defaultHandoffCoordinator.getHistory(limit);
}

/**
 * Clear handoff history (for testing)
 */
export function clearHandoffHistory(): void {
  defaultHandoffCoordinator.clear();
}

// ============================================================================
// Request Context Helper
// ============================================================================

function createRequestContext(context: GordonContext): RequestContext {
  const compiledSubagentProfiles = getCompiledSubagentProfiles();
  return createAgentRequestContext(context, compiledSubagentProfiles);
}

// ============================================================================
// Grounded Prompt Builder
// ============================================================================

async function buildGroundedPrompt(
  userMessage: string,
  context: GordonContext,
  requestContext: RequestContext,
): Promise<{
  prompt: string;
  messages: GroundedPromptMessage[];
  requestOptions: Record<string, unknown>;
}> {
  let mcpDiscoveryNote = "";
  const transcriptValidation = validateAndRepairTranscript(userMessage, context);
  const sanitizedUserMessage = transcriptValidation.sanitizedUserMessage;

  const discoveryIntent = getMCPDiscoveryIntent(sanitizedUserMessage);
  if (
    discoveryIntent.shouldDiscover &&
    !areMCPSchemasDiscovered(discoveryIntent.matchedServerIds)
  ) {
    try {
      await ensureMCPToolsDiscovered(discoveryIntent.matchedServerIds);
      resetAgents();
      requestContext.set("mcpDiscoveryIntent", discoveryIntent);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      mcpDiscoveryNote = `Lazy MCP discovery failed for this turn: ${message}. Ignore MCP tools unless the user explicitly retries plugin-related work.`;
    }
  }

  registerLifecycleProcessHooks();
  await startLifecycleSession(context, {
    threadId: context.threadId,
    agentName: "Gordon",
  });
  if (context.threadId) {
    lifecycleSessionContexts.set(context.threadId, context);
  }
  const lifecycleResult = await runLifecycleHooks("before_request", context, {
    threadId: context.threadId,
    userMessage: sanitizedUserMessage,
  });
  if (lifecycleResult.blocked) {
    throw new Error(lifecycleResult.reason ?? "Request blocked by lifecycle hook.");
  }

  const glossarySelection = await selectRelevantIntegrationGlossary(sanitizedUserMessage, context);
  const glossaryText = formatIntegrationGlossary(glossarySelection.entries);
  const planningHandoff = getPlanningHandoff(context);
  const transcriptRepairBlock = formatTranscriptRepairBlock(transcriptValidation);
  const planningHandoffBlock = formatPlanningHandoffBlock(planningHandoff);
  const aceSnapshot = getACEMemorySnapshot(context.threadId);
  const lifecycleAnnotationBlock = lifecycleResult.annotations.length > 0
    ? ["[GORDON_LIFECYCLE_NOTES]", ...lifecycleResult.annotations.map((note) => `- ${note}`)].join("\n")
    : "";

  const envelope = buildPromptEnvelope(sanitizedUserMessage, context, glossarySelection, glossaryText, {
    additionalSections: [
      transcriptRepairBlock
        ? { kind: "transcript_repair" as const, source: "transcript-validator", priority: 70, content: transcriptRepairBlock }
        : null,
      planningHandoffBlock
        ? { kind: "planning_handoff" as const, source: "runtime-harness", priority: 80, content: planningHandoffBlock }
        : null,
      lifecycleAnnotationBlock
        ? { kind: "runtime_reminders" as const, source: "lifecycle-hooks", priority: 90, content: lifecycleAnnotationBlock }
        : null,
      mcpDiscoveryNote
        ? { kind: "runtime_reminders" as const, source: "mcp-discovery", priority: 95, content: `[GORDON_RUNTIME_REMINDERS]\n- ${mcpDiscoveryNote}` }
        : null,
      aceSnapshot?.renderedBlock
        ? { kind: "tool_hints" as const, source: "ace-memory", stable: false, priority: 96, content: aceSnapshot.renderedBlock }
        : null,
    ].filter((section): section is NonNullable<typeof section> => Boolean(section)),
  });

  const messageValidation = validateAndRepairModelMessages(envelope.messages);
  if (messageValidation.repairNotes.length > 0) {
    requestContext.set("modelMessageValidation", messageValidation);
  }

  requestContext.set("integrationGlossaryIds", envelope.report.glossaryIds);
  requestContext.set("activeIntegrationIds", envelope.report.activeIntegrationIds);
  requestContext.set("promptContextReport", envelope.report);
  requestContext.set("promptCacheMetadata", envelope.report.cache);
  // Capture the assembled messages so /cache-audit can introspect them
  // out-of-band without re-running the prompt build pipeline.
  try {
    captureAuditedRequest(messageValidation.messages, envelope.report.provider, context.threadId);
  } catch { /* non-critical diagnostic */ }
  requestContext.set("workflowPhase", envelope.report.workflowPhase);
  requestContext.set("executionReadiness", envelope.report.executionReadiness);
  requestContext.set("transcriptValidation", transcriptValidation);
  requestContext.set("planningHandoff", planningHandoff);
  requestContext.set("mcpDiscoveryIntent", discoveryIntent);

  return {
    prompt: envelope.prompt,
    messages: messageValidation.messages,
    requestOptions: envelope.requestOptions,
  };
}

// ============================================================================
// Post-Request Helpers
// ============================================================================

function rebuildThreadACEArtifacts(context: GordonContext, threadId?: string): void {
  const effectiveThreadId = threadId ?? context.threadId;
  if (!effectiveThreadId) return;
  rebuildACEMemoryForThread(effectiveThreadId);
}

async function finalizeAfterRequest(
  context: GordonContext,
  payload: LifecycleHookPayload,
  options: { resetLoops?: boolean; rebuildAce?: boolean } = {},
): Promise<void> {
  await runLifecycleHooks("after_request", context, payload);
  if (options.rebuildAce !== false && !payload.error) {
    rebuildThreadACEArtifacts(context, payload.threadId);
  }
  if (options.resetLoops !== false) {
    resetLoopSignals(context);
  }
}

// ============================================================================
// Tracing
// ============================================================================

/**
 * Initialize OpenTelemetry tracing for agent operations
 */
export async function initializeTracing(): Promise<void> {
  await initTracingModule();
  const config = getTracingConfig();
  if (config.enabled) {
    logger.info("OpenTelemetry tracing enabled", {
      serviceName: config.serviceName,
      endpoint: config.endpoint,
    });
  } else {
    logger.debug("Tracing disabled (set OTEL_TRACING_ENABLED=true and GORDON_TRACING_REVIEWED=true to enable)");
  }
}

function createAgentTracingOptions(parentContext?: SpanContext): Record<string, unknown> | undefined {
  if (!isTracingEnabled()) return undefined;
  const tracingOpts = buildTracingOptions({
    parentContext,
    metadata: { agent: "gordon", timestamp: new Date().toISOString() },
    tags: ["gordon-agent"],
  });
  return tracingOpts as Record<string, unknown>;
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
  threadId?: string,
  resourceId?: string,
  options: ProcessMessageStreamOptions = {}
): AsyncGenerator<StreamEvent, void> {
  const startTime = Date.now();
  logger.debug("Starting streaming message processing", { messageLength: userMessage.length });
  const { signal } = options;
  const workflowPhase = determineWorkflowPhase(context);
  const state: StreamProcessingState = {
    currentAgent: undefined,
    fullText: "",
    lastSubAgentToolResult: null,
    pendingToolCalls: new Map(),
  };

  const requestContext = createRequestContext(context);

  try {
    const groundedPrompt = await buildGroundedPrompt(userMessage, context, requestContext);
    // Mutable view used when the tool-free thinking gate prepends its trace.
    let groundedMessages = groundedPrompt.messages;
    let reactStage: ReActStage = "compaction_checked";
    await throwIfStreamAborted(signal);
    reactStage = advanceReActStage(reactStage, "interrupt_checked_before_thinking");

    // ── Thinking phase ──────────────────────────────────────────────────────
    // Thinking depth uses one resolution order shared by tool-free and
    // in-band extended thinking. Phase-default depth alone does not force the
    // extra tool-free network call; config/env/override or the explicit gate do.
    let _thinkingResult: ThinkingResult | null = null;
    const _thinkingResolution = resolveThinkingDepth({ context, phase: workflowPhase });
    const _thinkingDepth = _thinkingResolution.depth;
    const _toolFreeGate = shouldRunToolFreeThinking(userMessage, context);
    const _explicitThinking =
      (_thinkingResolution.source === "config" ||
        _thinkingResolution.source === "env" ||
        _thinkingResolution.source === "override") &&
      _thinkingDepth !== "off";
    const _depthForRun: typeof _thinkingDepth =
      _explicitThinking ? _thinkingDepth : (_toolFreeGate.run ? (_thinkingDepth === "off" ? "medium" : _thinkingDepth) : "off");
    if (_depthForRun !== "off") {
      _thinkingResult = await runThinkingPhase(userMessage, [], context, _depthForRun);
      if (_depthForRun === "high" && _thinkingResult && !_thinkingResult.skipped && _thinkingResult.trace) {
        const _critique = await runCritiquePhase(_thinkingResult.trace, userMessage, context);
        if (_critique && _critique !== "Reasoning is sound.") {
          _thinkingResult = { ..._thinkingResult, trace: `${_thinkingResult.trace}\n[Critique]: ${_critique}` };
        }
      }
      // When the flag is on, also prepend the trace to the messages array so
      // the tool-enabled action call has explicit reasoning to act on.
      if (_toolFreeGate.run && _thinkingResult && !_thinkingResult.skipped && _thinkingResult.trace) {
        groundedMessages = prependThinkingTrace(groundedMessages, _thinkingResult.trace);
        logger.info("Tool-free thinking active", {
          reason: _toolFreeGate.reason,
          thinkingDurationMs: _thinkingResult.thinkingDurationMs,
          gateDurationMs: _thinkingResult.gateDurationMs,
          traceLength: _thinkingResult.trace.length,
        });
      }
    }
    // Surface the thinking trace as a streaming event so TUI subscribers can
    // render it inline before the first tool call — Vibe-Trading pattern of
    // showing reasoning → tool calls → results as distinct streamed events.
    if (_thinkingResult && !_thinkingResult.skipped && _thinkingResult.trace) {
      yield {
        type: "thinking_delta",
        content: _thinkingResult.trace,
        agentName: state.currentAgent,
      };
    }
    reactStage = advanceReActStage(reactStage, "thinking_complete");
    reactStage = advanceReActStage(reactStage, "ui_drained");

    await emitEvent("agent:started", { agent: "gordon" });
    const tracingOptions = createAgentTracingOptions();
    const effectiveResourceId = resourceId || context.userId || "default";
    await throwIfStreamAborted(signal);
    reactStage = advanceReActStage(reactStage, "interrupt_checked_before_action");

    // Per Mastra docs: `const stream = await agent.stream(messages, options)`
    // Returns MastraModelOutput with textStream, fullStream, text (Promise<string>)
    // Extended-thinking providerOptions are spliced in when GORDON_EXTENDED_THINKING
    // is set; returns {} otherwise so the call shape is identical when off.
    const extendedThinkingOpts = providerOptionsForPhase(workflowPhase, {
      maxTokens: MAX_OUTPUT_TOKENS_STREAM,
      context,
    });
    const streamObj = await awaitWithAbort(
      gordonAgent().stream(groundedMessages, ({
        requestContext,
        ...(threadId && effectiveResourceId ? { memory: { thread: threadId, resource: effectiveResourceId } } : {}),
        maxSteps: 20,
        modelSettings: { maxOutputTokens: MAX_OUTPUT_TOKENS_STREAM },
        ...(Object.keys(extendedThinkingOpts).length > 0 ? { providerOptions: extendedThinkingOpts } : {}),
        ...groundedPrompt.requestOptions,
        ...(tracingOptions && { tracingOptions }),
        // Delegation hooks for supervisor → sub-agent routing
        delegation: {
          onDelegationStart: async (ctx: any) => {
            state.currentAgent = ctx.primitiveId;
            logger.info("Delegation to sub-agent", { agent: ctx.primitiveId });
            return { proceed: true };
          },
          onDelegationComplete: async (ctx: any) => {
            if (ctx.error) {
              logger.warn("Delegation failed", { agent: ctx.primitiveId, error: ctx.error });
              return { feedback: `Delegation to ${ctx.primitiveId} failed: ${ctx.error}. Try another approach.` };
            }
            return {};
          },
        },
        onError: ({ error }: { error: string | Error }) => {
          logger.error("Stream error", { error: error instanceof Error ? error.message : error });
        },
      } as any)),
      signal,
    );
    reactStage = advanceReActStage(reactStage, "action_started");

    // Log available properties for debugging
    const streamKeys = Object.keys(streamObj ?? {});
    logger.info("Stream result keys: " + streamKeys.join(", "));

    // ── Primary: fullStream (rich typed events — tool calls, reasoning, agent switches) ──
    if (streamObj?.fullStream) {
      const reader = (streamObj.fullStream as unknown as ReadableStream<InternalStreamChunk>).getReader();
      try {
        while (true) {
          const { done, value } = await readStreamChunkWithAbort(reader, signal);
          if (done) break;
          const chunk = value as InternalStreamChunk;
          try { bridgeStreamEvent(chunk as any, 0); } catch { /* non-critical */ }
          yield* processFullStreamChunk(chunk, state, context);
        }
      } finally {
        reader.releaseLock();
        if (state.currentAgent && state.currentAgent.toLowerCase() !== "gordon") {
          await runLifecycleHooks("subagent_stop", context, {
            threadId: context.threadId,
            subagentName: state.currentAgent,
            subagentType: state.currentAgent,
            payload: { eventType: "subagent_stop_stream_end" },
          });
        }
      }
    }
    // ── Fallback: textStream (simple text chunks, no tool/agent events) ──
    else if (streamObj?.textStream) {
      for await (const chunk of streamObj.textStream) {
        await throwIfStreamAborted(signal);
        const outputCheck = await checkOutputGuardrails(chunk);
        state.fullText += outputCheck.sanitized;
        yield { type: "text_delta", content: outputCheck.sanitized, agentName: state.currentAgent };
      }
    }
    // ── Last resort: text promise ───────────────────────────────────────
    else if (streamObj?.text) {
      await throwIfStreamAborted(signal);
      const rawText = typeof (streamObj as any).text === "function"
        ? await (streamObj as any).text()
        : await streamObj.text;
      if (rawText && typeof rawText === "string" && rawText.trim()) {
        const outputCheck = await checkOutputGuardrails(rawText);
        state.fullText = outputCheck.sanitized;
        yield { type: "text_delta", content: state.fullText, agentName: state.currentAgent };
      }
    } else {
      logger.warn("No stream content available", { keys: streamKeys.join(", ") });
    }

    // Final text fallback
    const MAX_TEXT_FALLBACK_ATTEMPTS = 3;
    if (!state.fullText && streamObj.text) {
      for (let attempt = 0; attempt < MAX_TEXT_FALLBACK_ATTEMPTS; attempt++) {
        await throwIfStreamAborted(signal);
        try {
          let finalText: string | undefined;
          if (typeof (streamObj as any).text === 'function') finalText = await (streamObj as any).text();
          else if ((streamObj as any).text instanceof Promise) finalText = await streamObj.text;
          else if (typeof (streamObj as any).text === 'string') finalText = (streamObj as any).text;

          if (finalText && finalText.trim()) {
            const outputCheck = await checkOutputGuardrails(finalText);
            state.fullText = outputCheck.sanitized;
            yield { type: "text_delta", content: state.fullText, agentName: state.currentAgent };
            break;
          }
        } catch (textError) {
          logger.error("Failed to get text from fallback", textError as Error);
        }
      }
    }

    // Usage tracking
    await throwIfStreamAborted(signal);
    const usage = await resolveNormalizedUsage(streamObj.usage);
    recordPromptUsage(context, threadId, usage);

    // Wire: compaction trigger — check token thresholds after each API response
    try {
      const inputToks = (usage as unknown as Record<string, unknown>).inputTokens as number ?? usage.totalTokens ?? 0;
      const compactionDecision = getCompactionTrigger().check(inputToks);
      if (compactionDecision.action === "warn" || compactionDecision.action === "microcompact" || compactionDecision.action === "compact") {
        logger.info("Compaction trigger fired", { action: compactionDecision.action, stage: compactionDecision.stage, tokens: inputToks });
      }
      if (compactionDecision.action === "microcompact" || compactionDecision.action === "compact") {
        const { applyCompactionIfNeeded } = await import("../domain/memory/compactionHandler.ts");
        const compacted = await applyCompactionIfNeeded({
          action: compactionDecision.action,
          messages: groundedMessages.map((m) => ({
            role: m.role,
            content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
          })),
          llm: context.llm,
        });
        if (compacted.applied) {
          groundedMessages = compacted.messages as typeof groundedMessages;
          logger.info("Compaction applied post-turn", { detail: compacted.detail });
        }
      }
    } catch { /* non-critical */ }

    // Wire: per-model cost tracking
    try {
      const inputToks = (usage as unknown as Record<string, unknown>).inputTokens as number ?? 0;
      const outputToks = (usage as unknown as Record<string, unknown>).outputTokens as number ?? 0;
      getCostTracker().record({
        modelId: context.config?.modelConfig?.model ?? "unknown",
        inputTokens: inputToks,
        outputTokens: outputToks,
      });
    } catch { /* non-critical */ }

    await emitEvent("agent:stream_completed", { responseLength: state.fullText.length });
    recordRequest(Date.now() - startTime, true);
    const finalAgent = state.currentAgent || "Gordon";
    recordAgentCall(finalAgent, Date.now() - startTime, true, usage.totalTokens);

    // Handle empty response
    if (!state.fullText || state.fullText.trim().length === 0) {
      if (state.lastSubAgentToolResult) {
        try {
          const { toolName, result } = state.lastSubAgentToolResult;
          const resultObj = typeof result === "string" ? JSON.parse(result) : result;
          const resultData = (resultObj as Record<string, unknown>)?.result ?? resultObj;
          if ((resultData as Record<string, unknown>)?.success === false) {
            state.fullText = `Tool ${toolName} failed: ${(resultData as Record<string, unknown>)?.error || "Unknown error"}`;
          } else {
            state.fullText = JSON.stringify(resultData, null, 2);
          }
        } catch {
          state.fullText = String(state.lastSubAgentToolResult.result);
        }
      } else {
        state.fullText = formatRecoveryGuidance(
          classifyRecoveryGuidance("empty_response", context, { emptyResponse: true, phase: workflowPhase, currentAgent: state.currentAgent }),
        );
      }
      yield { type: "text_delta", content: state.fullText, agentName: state.currentAgent };
    }

    yield { type: "done", content: state.fullText, usage, agentName: state.currentAgent };
    reactStage = advanceReActStage(reactStage, "response_dispatched");
    // Phase 2 lazy MCP discovery — refresh cache in background AFTER the
    // first user-visible response so subsequent cold starts are fast.
    try { scheduleBackgroundDiscoveryRefresh(); } catch { /* best-effort */ }
    await finalizeAfterRequest(context, {
      threadId: threadId ?? context.threadId,
      agentName: state.currentAgent,
      userMessage,
      response: state.fullText,
      payload: { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, totalTokens: usage.totalTokens },
    });
    reactStage = advanceReActStage(reactStage, "persisted");

  } catch (err) {
    // FW1 emitter — report any in-flight tool calls so the next turn's
    // reconciler synthesizes matching tool_result blocks. Reason is
    // derived from the error type so the synthesized result carries
    // useful attribution ("user_cancelled" / "exception" / "unknown").
    if (state.pendingToolCalls.size > 0) {
      const reason: InterruptionReason =
        err instanceof StreamCancelledError ? "cancelled" : "unknown";
      for (const [callId, entry] of state.pendingToolCalls) {
        reportToolCallInterruption(callId, reason, {
          toolName: entry.toolName,
          agent: entry.agent,
          startedAt: entry.startedAt,
        });
      }
      state.pendingToolCalls.clear();
    }

    if (err instanceof StreamCancelledError) {
      logger.info("Streaming cancelled by user", { messageLength: userMessage.length });
      yield { type: "cancelled", content: err.message };
      resetLoopSignals(context);
      return;
    }

    const error = err instanceof Error ? err : new Error(String(err));
    logger.error("Streaming error", error);
    recordRequest(Date.now() - startTime, false);
    recordError(error.name || "UnknownError");
    recordAgentCall("Gordon", Date.now() - startTime, false, 0, error.name || "UnknownError", error.message);

    await emitEvent("system:error", { error: { name: error.name, message: error.message } });
    yield {
      type: "error",
      error: formatRecoveryGuidance(classifyRecoveryGuidance(error, context, { phase: workflowPhase, currentAgent: state.currentAgent })),
    };
    await finalizeAfterRequest(context, {
      threadId: threadId ?? context.threadId,
      agentName: state.currentAgent,
      userMessage,
      error: error.message,
      payload: { failed: true },
    });
  }
}

// ============================================================================
// Full Stream Chunk Processing (delegated)
// ============================================================================

/**
 * Process a single fullStream chunk, yielding StreamEvents.
 * This is a generator that uses yield* delegation from processMessageStream.
 */
async function* processFullStreamChunk(
  chunk: InternalStreamChunk,
  state: StreamProcessingState,
  context: GordonContext,
): AsyncGenerator<StreamEvent, void> {
  switch (chunk.type) {
    case "text-delta":
      if (chunk.payload?.text) {
        state.fullText += chunk.payload.text;
        yield { type: "text_delta", content: chunk.payload.text, agentName: state.currentAgent };
      }
      break;

    case "tool-call":
      if (chunk.payload?.toolName) {
        yield* processToolCallChunk(
          chunk.payload.toolName,
          chunk.payload.args,
          state,
          context,
          chunk.payload.toolCallId,
        );
      }
      break;

    case "tool-result":
      if (chunk.payload?.toolCallId) {
        state.pendingToolCalls.delete(chunk.payload.toolCallId);
      }
      yield await processToolResult(chunk.payload?.toolName, chunk.payload?.result, state, context);
      break;

    case "agent-execution-start":
    case "routing-agent-start":
      if (chunk.payload?.agentId) {
        const agentName = chunk.payload.agentId.charAt(0).toUpperCase() + chunk.payload.agentId.slice(1);
        if (agentName !== state.currentAgent && agentName.toLowerCase() !== "gordon") {
          const switchEvent = await handleAgentSwitch(agentName, state, context, undefined, undefined, chunk.type);
          if (switchEvent) yield switchEvent;
        }
      }
      break;

    case "routing-agent-text-delta":
      if (chunk.payload?.text) {
        state.fullText += chunk.payload.text;
        yield { type: "text_delta", content: chunk.payload.text, agentName: state.currentAgent || "Gordon" };
      }
      break;

    default:
      if (chunk.type?.startsWith("agent-execution-event-")) {
        yield* processAgentExecutionEvent(chunk, state, context);
      }
      break;
  }
}

/**
 * Process a tool-call stream event with validation and agent switching.
 */
async function* processToolCallChunk(
  toolName: string,
  toolArgs: Record<string, unknown> | undefined,
  state: StreamProcessingState,
  context: GordonContext,
  toolCallId?: string,
): AsyncGenerator<StreamEvent, void> {
  const detectedAgent = getAgentForTool(toolName);

  const validation = await validateToolCall(toolName, toolArgs, detectedAgent, state.currentAgent, context);
  if (!validation.allowed) {
    if (validation.event) yield validation.event;
    return;
  }

  if (detectedAgent && detectedAgent !== state.currentAgent) {
    const switchEvent = await handleAgentSwitch(detectedAgent, state, context, toolName, toolArgs);
    if (switchEvent) yield switchEvent;
  }

  const hookResult = await runLifecycleHooks("tool_call_start", context, {
    threadId: context.threadId,
    agentName: state.currentAgent,
    toolName,
    payload: toolArgs,
  });
  if (hookResult.blocked) {
    yield { type: "error", error: hookResult.reason ?? `Tool blocked before start: ${toolName}` };
    return;
  }

  // FW1 emitter: register pending tool call so a downstream error/cancel
  // can report it to the reconciler. Cleared in processToolResult.
  if (toolCallId) {
    state.pendingToolCalls.set(toolCallId, {
      toolName,
      startedAt: Date.now(),
      agent: state.currentAgent,
    });
  }

  yield { type: "tool_call_start", toolName, toolArgs, agentName: state.currentAgent };
}

/**
 * Process wrapped agent-execution-event-* sub-agent events.
 */
async function* processAgentExecutionEvent(
  chunk: InternalStreamChunk,
  state: StreamProcessingState,
  context: GordonContext,
): AsyncGenerator<StreamEvent, void> {
  const innerType = chunk.type.replace("agent-execution-event-", "");
  const innerPayload = chunk.payload as unknown as InternalStreamChunk;

  if (innerType === "text-delta" && innerPayload?.payload?.text) {
    state.fullText += innerPayload.payload.text;
    yield { type: "text_delta", content: innerPayload.payload.text, agentName: state.currentAgent };
  } else if (innerType === "tool-call" && innerPayload?.payload?.toolName) {
    const toolName = innerPayload.payload.toolName;
    const detectedAgent = getAgentForTool(toolName);

    const validation = await validateToolCall(toolName, innerPayload.payload.args, detectedAgent, state.currentAgent, context);
    if (!validation.allowed) {
      if (validation.event) yield validation.event;
      return;
    }

    if (detectedAgent && detectedAgent !== state.currentAgent) {
      const switchEvent = await handleAgentSwitch(
        detectedAgent, state, context, toolName, innerPayload.payload.args, "agent-execution-event",
      );
      if (switchEvent) yield switchEvent;
    }

    const hookResult = await runLifecycleHooks("tool_call_start", context, {
      threadId: context.threadId,
      agentName: state.currentAgent,
      toolName,
      payload: innerPayload.payload.args,
    });
    if (hookResult.blocked) {
      yield { type: "error", error: hookResult.reason ?? `Tool blocked before start: ${toolName}` };
      return;
    }

    // FW1 emitter: register pending tool call for the agent-execution path too.
    const subAgentToolCallId = innerPayload.payload.toolCallId;
    if (subAgentToolCallId) {
      state.pendingToolCalls.set(subAgentToolCallId, {
        toolName,
        startedAt: Date.now(),
        agent: state.currentAgent,
      });
    }

    yield { type: "tool_call_start", toolName, toolArgs: innerPayload.payload.args, agentName: state.currentAgent };
  } else if (innerType === "tool-result") {
    if (innerPayload?.payload?.toolCallId) {
      state.pendingToolCalls.delete(innerPayload.payload.toolCallId);
    }
    yield await processToolResult(innerPayload?.payload?.toolName, innerPayload?.payload?.result, state, context);
  }
}

// ============================================================================
// Structured Output Processing
// ============================================================================

/**
 * Process a message and return typed structured output via Mastra's structuredOutput API.
 */
export async function processStructuredMessage<T extends Record<string, unknown>>(
  userMessage: string,
  schema: z.ZodSchema<T>,
  context: GordonContext,
  threadId?: string,
  resourceId?: string,
): Promise<{ data: T; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
  const startTime = Date.now();
  logger.debug("Processing structured message", { messageLength: userMessage.length });

  const requestContext = createRequestContext(context);
  const tracingOptions = createAgentTracingOptions();
  const effectiveResourceId = resourceId || context.userId || "default";

  try {
    const groundedPrompt = await buildGroundedPrompt(userMessage, context, requestContext);
    const result = await gordonAgent().generate(groundedPrompt.messages, {
      requestContext,
      ...(threadId && effectiveResourceId ? { memory: { thread: threadId, resource: effectiveResourceId } } : {}),
      maxSteps: 20,
      modelSettings: { maxOutputTokens: MAX_OUTPUT_TOKENS_GENERATE },
      structuredOutput: { schema },
      ...groundedPrompt.requestOptions,
      ...(tracingOptions && { tracingOptions }),
    });

    const resultObj = result as unknown as { object?: T; text?: string; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } };
    if (!resultObj.object) throw new Error("Agent did not return structured output");

    recordRequest(Date.now() - startTime, true);
    const normalizedUsage = await resolveNormalizedUsage(resultObj.usage);
    recordPromptUsage(context, threadId, normalizedUsage);
    await finalizeAfterRequest(context, {
      threadId: threadId ?? context.threadId, userMessage,
      payload: { structured: true, ...normalizedUsage },
    });
    return { data: resultObj.object, usage: normalizedUsage };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error("Structured message processing error", error);
    recordRequest(Date.now() - startTime, false);
    recordError(error.name || "StructuredOutputError");
    await finalizeAfterRequest(context, {
      threadId: threadId ?? context.threadId, userMessage, error: error.message,
      payload: { structured: true, failed: true },
    });
    throw new Error(formatRecoveryGuidance(classifyRecoveryGuidance(error, context, { phase: determineWorkflowPhase(context) })));
  }
}

// ============================================================================
// Network Processing
// ============================================================================

/**
 * Process a message using Mastra's Agent Network for automatic multi-agent routing
 */
export async function* processWithNetwork(
  userMessage: string,
  context: GordonContext,
  threadId?: string,
  resourceId?: string
): AsyncGenerator<StreamEvent, void> {
  const startTime = Date.now();
  logger.debug("Starting network processing", { messageLength: userMessage.length });
  const requestContext = createRequestContext(context);

  try {
    const groundedPrompt = await buildGroundedPrompt(userMessage, context, requestContext);
    await emitEvent("agent:started", { agent: "gordon-network" });
    const tracingOptions = createAgentTracingOptions();
    const effectiveResourceId = resourceId || context.userId || "default";

    const networkResult = await gordonAgent().network(groundedPrompt.messages, {
      requestContext,
      ...(threadId && effectiveResourceId ? { memory: { thread: threadId, resource: effectiveResourceId } } : {}),
      maxSteps: 30,
      modelSettings: { maxOutputTokens: MAX_OUTPUT_TOKENS_GENERATE },
      ...groundedPrompt.requestOptions,
      ...(tracingOptions && { tracingOptions }),
    });

    let fullText = "";
    const resultObj = networkResult as unknown as {
      text?: string | (() => Promise<string>);
      usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | Promise<{ inputTokens?: number; outputTokens?: number; totalTokens?: number }>;
    };

    if (typeof resultObj.text === 'function') fullText = await resultObj.text();
    else if (typeof resultObj.text === 'string') fullText = resultObj.text;

    yield { type: "text_delta", content: fullText };

    await emitEvent("agent:stream_completed", { responseLength: fullText.length });
    const usage = await resolveNormalizedUsage(resultObj.usage);
    recordPromptUsage(context, threadId, usage);
    await finalizeAfterRequest(context, {
      threadId: threadId ?? context.threadId, userMessage, response: fullText,
      payload: { ...usage, network: true },
    });
    recordRequest(Date.now() - startTime, true);
    yield { type: "done", content: fullText, usage };

  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error("Network processing error", error);
    recordRequest(Date.now() - startTime, false);
    recordError(error.name || "UnknownError");
    await finalizeAfterRequest(context, {
      threadId: threadId ?? context.threadId, userMessage, error: error.message,
      payload: { network: true, failed: true },
    });
    yield {
      type: "error",
      error: formatRecoveryGuidance(classifyRecoveryGuidance(error, context, { phase: determineWorkflowPhase(context) })),
    };
  }
}

// ============================================================================
// Non-Streaming Message Processing (Backwards Compatible)
// ============================================================================

/**
 * Process a user message through Gordon using Mastra Agent (non-streaming).
 */
export async function processMessage(
  userMessage: string,
  context: GordonContext,
  threadId?: string,
  resourceId?: string
): Promise<{ response: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
  const startTime = Date.now();
  logger.debug("Processing message with Mastra", { messageLength: userMessage.length });
  const requestContext = createRequestContext(context);

  try {
    const groundedPrompt = await buildGroundedPrompt(userMessage, context, requestContext);
    const tracingOptions = createAgentTracingOptions();
    const effectiveResourceId = resourceId || context.userId || "default";

    const result = await gordonAgent().generate(groundedPrompt.messages, {
      requestContext,
      ...(threadId && effectiveResourceId ? { memory: { thread: threadId, resource: effectiveResourceId } } : {}),
      maxSteps: 20,
      modelSettings: { maxOutputTokens: MAX_OUTPUT_TOKENS_GENERATE },
      ...groundedPrompt.requestOptions,
      ...(tracingOptions && { tracingOptions }),
    });

    const resultObj = result as unknown as { text?: string; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } };
    const response = resultObj.text || "I'm not sure how to help with that.";

    await emitEvent("agent:message_processed", {
      userMessage: userMessage.substring(0, 100),
      responseLength: response.length,
      historyLength: 0,
    });
    recordRequest(Date.now() - startTime, true);
    const usage = await resolveNormalizedUsage(resultObj.usage);
    recordPromptUsage(context, threadId, usage);
    await finalizeAfterRequest(context, {
      threadId: threadId ?? context.threadId, userMessage, response,
      payload: { ...usage },
    });
    return { response, usage };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error("Failed to process message", error);
    recordRequest(Date.now() - startTime, false);
    recordError(error.name || "UnknownError");
    await finalizeAfterRequest(context, {
      threadId: threadId ?? context.threadId, userMessage, error: error.message,
      payload: { failed: true },
    });
    throw new Error(formatRecoveryGuidance(classifyRecoveryGuidance(error, context, { phase: determineWorkflowPhase(context) })));
  }
}

/**
 * Process a simple message without full tool access.
 */
export async function processSimpleMessage(
  userMessage: string,
  context: GordonContext
): Promise<string> {
  const startTime = Date.now();

  const inputCheck = await checkInputGuardrails(userMessage);
  if (!inputCheck.allowed) {
    logger.warn("Input blocked by guardrail", { reason: inputCheck.reason });
    recordRequest(Date.now() - startTime, false);
    recordError("InputGuardrailBlock");
    return inputCheck.reason || "Input blocked by safety guardrail.";
  }

  const requestContext = createRequestContext(context);

  try {
    const groundedPrompt = await buildGroundedPrompt(userMessage, context, requestContext);
    const tracingOptions = createAgentTracingOptions();

    const result = await gordonAgent().generate(groundedPrompt.messages, {
      requestContext,
      maxSteps: 5,
      modelSettings: { maxOutputTokens: MAX_OUTPUT_TOKENS_GENERATE },
      ...groundedPrompt.requestOptions,
      ...(tracingOptions && { tracingOptions }),
    });

    const resultObj = result as unknown as { text?: string; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } };
    const rawResponse = resultObj.text || "I'm not sure how to help with that.";
    const outputCheck = await checkOutputGuardrails(rawResponse);

    recordRequest(Date.now() - startTime, true);
    recordPromptUsage(context, context.threadId, await resolveNormalizedUsage(resultObj.usage));
    await finalizeAfterRequest(context, {
      threadId: context.threadId, userMessage, response: outputCheck.sanitized,
      payload: { simple: true },
    });
    return outputCheck.sanitized;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    recordRequest(Date.now() - startTime, false);
    recordError(error.name || "UnknownError");
    await finalizeAfterRequest(context, {
      threadId: context.threadId, userMessage, error: error.message,
      payload: { simple: true, failed: true },
    });
    throw error;
  }
}

// ============================================================================
// Quick Actions (bypass full agent loop for simple tasks)
// ============================================================================

export async function quickScan(context: GordonContext) {
  const { exchange, config } = context;
  if (!exchange) throw new Error("Exchange client not connected");
  const { scan } = await import("../../core/pipeline/scanner.ts");
  return scan(exchange, { topN: config.preferences.topNCoins, timeframes: config.preferences.defaultTimeframes });
}

export async function quickCheckPositions(context: GordonContext) {
  const { exchange } = context;
  if (!exchange) throw new Error("Exchange client not connected");
  const { runMonitorCycle } = await import("../../core/pipeline/monitor.ts");
  return runMonitorCycle(exchange);
}

// ============================================================================
// Streaming with Pipe Support (Mastra pipeTo Pattern)
// ============================================================================

export async function processMessageStreamWithPipe(
  userMessage: string,
  context: GordonContext,
  writer: StreamWriter<MessageStreamChunk>,
  threadId?: string,
  resourceId?: string
): Promise<StreamingResult<{ response: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }>> {
  const startTime = Date.now();
  let chunksWritten = 0;
  let errors = 0;
  let fullText = "";
  let finalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  try {
    await writer.write(createStartChunk("message-processing") as unknown as StreamChunk<MessageStreamChunk>);
    chunksWritten++;

    const stream = processMessageStream(userMessage, context, threadId, resourceId);
    for await (const event of stream) {
      const chunk = toMessageStreamChunk(event);
      await writer.write(createChunk(
        event.type === "error" ? "error" : "result",
        chunk,
        { source: event.agentName || "Gordon" }
      ) as StreamChunk<MessageStreamChunk>);
      chunksWritten++;

      if (event.type === "text_delta" && event.content) fullText += event.content;
      if (event.type === "done") {
        if (event.content) fullText = event.content;
        if (event.usage) finalUsage = event.usage;
      }
      if (event.type === "error") errors++;
    }

    await writer.write(createEndChunk("message-processing", { responseLength: fullText.length, usage: finalUsage }) as unknown as StreamChunk<MessageStreamChunk>);
    chunksWritten++;
    await writer.close();

    return { chunksWritten, errors, duration: Date.now() - startTime, summary: { response: fullText, usage: finalUsage } };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error("Message stream with pipe failed", error);
    await writer.write(createErrorChunk(error, "Gordon") as unknown as StreamChunk<MessageStreamChunk>);
    chunksWritten++;
    errors++;
    if (writer.abort) await writer.abort(error);
    else await writer.close();
    return { chunksWritten, errors, duration: Date.now() - startTime };
  }
}

export function createMessageStreamWorkflow(
  userMessage: string,
  context: GordonContext,
  threadId?: string,
  resourceId?: string
): {
  pipeTo: (writer: StreamWriter<MessageStreamChunk>) => Promise<StreamingResult<{ response: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }>>;
  [Symbol.asyncIterator]: () => AsyncIterator<MessageStreamChunk>;
} {
  async function* generator(): AsyncGenerator<MessageStreamChunk, void, unknown> {
    const stream = processMessageStream(userMessage, context, threadId, resourceId);
    for await (const event of stream) {
      yield toMessageStreamChunk(event);
    }
  }
  const source = generator();

  return {
    async pipeTo(writer) { return processMessageStreamWithPipe(userMessage, context, writer, threadId, resourceId); },
    [Symbol.asyncIterator]() { return source[Symbol.asyncIterator](); },
  };
}

// ============================================================================
// Parallel Execution (re-exports)
// ============================================================================

export {
  runParallel,
  runParallelAgentCalls,
  runParallelCoinAnalysis,
  runParallelTimeframeAnalysis,
  runDeepParallelAnalysis,
  runMultiCoinParallelAnalysis,
  createScanAnalyzeWorkflow,
  createWorkflowStep,
  createStreamingWorkflow,
  streamParallelAnalysis,
  streamMultiCoinAnalysis,
  createStreamingDeepAnalysis,
  createStreamingMultiCoinAnalysis,
  createConsoleWriter,
  createArrayWriter,
  createCallbackWriter,
  createMultiplexWriter,
  createTransformWriter,
  ConsoleStreamWriter,
  ArrayStreamWriter,
  CallbackStreamWriter,
  MultiplexStreamWriter,
  TransformStreamWriter,
  createChunk,
  createProgressChunk,
  createResultChunk,
  createErrorChunk,
  createStartChunk,
  createEndChunk,
  createHeartbeatChunk,
  createStreamingPipeline,
  type ParallelResult,
  type ParallelOptions,
  type AgentCallSpec,
  type AgentCallResult,
  type DeepParallelAnalysisResult,
  type MultiCoinParallelResult,
  type WorkflowStepDef,
  type ParallelScanAnalyzeResult,
  type StreamWriter,
  type StreamChunk,
  type StreamingWorkflowOptions,
  type ProgressData,
  type ResultData,
  type AnalysisChunk,
  type StreamingResult,
  type StreamingWorkflowResult,
  type StreamingParallelOptions,
} from "./parallel.ts";

// ============================================================================
// Re-exports for Backward Compatibility
// ============================================================================

// Types (from orchestrator/types.ts)
export type {
  StreamEvent,
  ProcessMessageStreamOptions,
  AgentFallbackConfig,
  AgentFallbackChain,
  ToolSecurityCheckResult,
  ProcessingOptions,
  ProcessingResultWithSummarization,
} from "./orchestrator/types.ts";

// Error handling (from orchestrator/errorHandler.ts)
export {
  DEFAULT_FALLBACK_CHAIN,
  cacheBacktestResult,
  getCachedBacktestResult,
  generateBacktestCacheKey,
} from "./orchestrator/errorHandler.ts";

// Tool security (from orchestrator/guardrailEvaluator.ts)
export {
  checkToolSecurity,
  initializeWithPermissionCheck,
} from "./orchestrator/guardrailEvaluator.ts";

// Summarization (from orchestrator/summarization.ts)
export {
  summarizeIfNeeded,
  needsSummarization,
  getSummarizationStats,
  resetSummarizer,
} from "./orchestrator/summarization.ts";

// Stream coordinator
export { createRequestContext };
export type { MessageStreamChunk } from "./orchestrator/StreamCoordinator.ts";

// Memory re-exports
export {
  ConversationSummarizer,
  createSummarizer,
  createSummarizerConfigFromMemoryConfig,
  DEFAULT_SUMMARIZER_CONFIG,
  type SummarizerConfig,
  type TradingContext,
  type SummarizationResult,
} from "../domain/memory/index.ts";
