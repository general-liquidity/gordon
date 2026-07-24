/**
 * Thinking Phase — tool-free pre-action reasoning pass
 *
 * Performs a lightweight LLM call before the main action phase to reason
 * about the user's intent, relevant tools/agents, and hidden constraints.
 * No tools are available during this call — pure internal deliberation.
 *
 * Based on OPENDEV paper §2.2.6: Extended ReAct with thinking phase.
 */

import type { GordonContext } from "../types.ts";
import type { Message } from "../../ai/llm/types.ts";
import {
  resolveWorkflowPhaseModelRoute,
  determineWorkflowPhase,
} from "./workflowPhase.ts";
import { createModuleLogger } from "../../logger/index.ts";
import { recordPhaseLLMCost } from "../../platform/costTracker.ts";
import {
  withTimelineEntry,
  generateTimelineAgentId,
  estimateTokensFromMessages,
} from "../wiring/timelineWiring.ts";

const logger = createModuleLogger("thinking-phase");

// ============================================================================
// Types
// ============================================================================

export type ThinkingDepth = "off" | "low" | "medium" | "high";
export type ThinkingDepthSource = "override" | "config" | "env" | "phase" | "default";

export interface ThinkingDepthResolution {
  depth: ThinkingDepth;
  source: ThinkingDepthSource;
  reason: string;
}

export interface ThinkingResult {
  trace: string;
  depth: ThinkingDepth;
  tokensUsed?: number;
  skipped: boolean;
  skipReason?: string;
  /** Wall-clock duration of the tool-free thinking LLM call (ms). */
  thinkingDurationMs?: number;
  /** Wall-clock duration of the gate evaluation (ms). */
  gateDurationMs?: number;
}

const THINKING_DEPTHS = new Set<ThinkingDepth>(["off", "low", "medium", "high"]);

function normalizeThinkingDepth(value: unknown): ThinkingDepth | null {
  return typeof value === "string" && THINKING_DEPTHS.has(value as ThinkingDepth)
    ? value as ThinkingDepth
    : null;
}

export function thinkingDepthForPhase(phase: ReturnType<typeof determineWorkflowPhase>): ThinkingDepth {
  switch (phase) {
    case "scan":
    case "ops":
    case "compaction":
      return "off";
    case "analysis":
      return "low";
    case "planning":
    case "execution":
      return "medium";
    case "critique":
      return "high";
    default:
      return "off";
  }
}

export function resolveThinkingDepth(
  options: {
    context?: Pick<GordonContext, "config">;
    phase?: ReturnType<typeof determineWorkflowPhase>;
    overrideDepth?: ThinkingDepth;
  },
): ThinkingDepthResolution {
  const overrideDepth = normalizeThinkingDepth(options.overrideDepth);
  if (overrideDepth) {
    return { depth: overrideDepth, source: "override", reason: `overrideDepth=${overrideDepth}` };
  }

  const configDepth = normalizeThinkingDepth(
    (options.context?.config as Record<string, unknown> | undefined)?.thinkingDepth,
  );
  if (configDepth) {
    return { depth: configDepth, source: "config", reason: `config.thinkingDepth=${configDepth}` };
  }

  const envDepth = normalizeThinkingDepth(process.env.GORDON_THINKING_DEPTH);
  if (envDepth) {
    return { depth: envDepth, source: "env", reason: `GORDON_THINKING_DEPTH=${envDepth}` };
  }

  if (options.phase) {
    const depth = thinkingDepthForPhase(options.phase);
    return { depth, source: "phase", reason: `phase=${options.phase}` };
  }

  return { depth: "off", source: "default", reason: "default=off" };
}

/**
 * Decide whether a request should trigger the dedicated tool-free thinking
 * pre-pass. Used as the gate when GORDON_TOOL_FREE_THINKING is enabled — the
 * paper's "thinking phase" only fires for non-trivial requests so we don't
 * pay 2-8s on routine asks.
 *
 * Triggers (any of):
 *   - User message > 200 characters
 *   - thinkingDepth is "medium" or "high" (explicitly opted in)
 *   - phase is planning, execution, or critique (high-stakes)
 */
export function shouldRunToolFreeThinking(
  userMessage: string,
  context: GordonContext,
): { run: boolean; reason: string } {
  // Default-on: reasoning passes ship on out-of-box, throttled by the cost
  // budget. Operators force-off for a cheap run via GORDON_TOOL_FREE_THINKING=0.
  const flag = process.env.GORDON_TOOL_FREE_THINKING;
  if (flag === "0" || flag === "false") {
    return { run: false, reason: "GORDON_TOOL_FREE_THINKING disabled (=0/false)" };
  }
  const phase = determineWorkflowPhase(context);
  const resolution = resolveThinkingDepth({ context, phase });
  if (
    (resolution.source === "config" || resolution.source === "env" || resolution.source === "override") &&
    resolution.depth === "off"
  ) {
    return { run: false, reason: `${resolution.reason} disables tool-free thinking` };
  }
  if (typeof userMessage === "string" && userMessage.length > 200) {
    return { run: true, reason: "user message > 200 chars" };
  }
  if (
    (resolution.source === "config" || resolution.source === "env" || resolution.source === "override") &&
    (resolution.depth === "medium" || resolution.depth === "high")
  ) {
    return { run: true, reason: `thinkingDepth=${resolution.depth}` };
  }
  if (phase === "planning" || phase === "execution" || phase === "critique") {
    return { run: true, reason: `phase=${phase}` };
  }
  return { run: false, reason: "below complexity threshold" };
}

/**
 * Prepend a thinking trace into the messages bound for the tool-enabled
 * action LLM call. The trace is added as a system message so the action
 * model treats it as authoritative reasoning context.
 *
 * Returns the messages array unchanged when the trace is empty.
 */
export function prependThinkingTrace<T extends { role: string; content: unknown }>(
  messages: T[],
  trace: string,
): T[] {
  const trimmed = trace?.trim();
  if (!trimmed) return messages;
  const block = `[GORDON_THINKING_TRACE]\n${trimmed}`;
  // Insert AFTER existing system messages so the trace sits next to other
  // grounding context, but before any user/assistant turns.
  let lastSystemIdx = -1;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === "system") lastSystemIdx = i;
    else break;
  }
  const insertAt = lastSystemIdx + 1;
  const traceMessage = { role: "system", content: block } as unknown as T;
  return [...messages.slice(0, insertAt), traceMessage, ...messages.slice(insertAt)];
}

// ============================================================================
// Constants
// ============================================================================

const THINKING_SYSTEM_PROMPT = `You are an internal reasoning step for Gordon, an AI trading assistant. Reason about the request before committing to a direction. Per the Stanford finding that "thinking longer in a single context" recovers most multi-agent benefits inside a single-agent pass, work through these in order:
(1) Identify ambiguities — what is underspecified? where could a literal read diverge from what the user actually means?
(2) List 2–3 candidate interpretations of the user's actual goal, ordered by likelihood given the context (venue, mandate, recent activity, permission mode).
(3) Briefly test each candidate against the context — which best fits the grounded state? what would invalidate it?
(4) Note the most relevant agent/tools and any hidden constraints, risks, or invariants that apply.
Output one concise paragraph under 120 words. No bullet points. No tool calls. Pure internal reasoning only.`;

const MAX_TOKENS_BY_DEPTH: Record<Exclude<ThinkingDepth, "off">, number> = {
  low: 150,
  medium: 250,
  high: 400,
};

/** Phases where thinking adds no value — skip automatically */
const SKIP_PHASES = new Set(["scan", "ops", "compaction"]);

// ============================================================================
// Public API
// ============================================================================

/**
 * Determine thinking depth from context configuration or env.
 * Default is "off" — a separate pre-call adds ~2-8s to every response with
 * minimal benefit for most queries. Enable via GORDON_THINKING_DEPTH env var
 * or `thinkingDepth` in config for complex analysis/planning sessions.
 */
export function getThinkingDepthFromContext(context: GordonContext): ThinkingDepth {
  return resolveThinkingDepth({
    context,
    phase: determineWorkflowPhase(context),
  }).depth;
}

/**
 * Run the tool-free thinking phase before the main action LLM call.
 *
 * @param userMessage  - Raw or sanitized user message
 * @param recentMessages - Last N messages from conversation history
 * @param context - Gordon context (provides llm client + config)
 * @param depth - Thinking depth level
 */
export async function runThinkingPhase(
  userMessage: string,
  recentMessages: Message[],
  context: GordonContext,
  depth: ThinkingDepth,
): Promise<ThinkingResult> {
  return withTimelineEntry(
    {
      agentId: generateTimelineAgentId("thinking"),
      agentName: `thinking@${depth}`,
      agentType: "thinking",
      initialTokens: estimateTokensFromMessages(
        recentMessages.map((m) => ({ content: String(m.content) })),
      ),
    },
    () => runThinkingPhaseInner(userMessage, recentMessages, context, depth),
  );
}

async function runThinkingPhaseInner(
  userMessage: string,
  recentMessages: Message[],
  context: GordonContext,
  depth: ThinkingDepth,
): Promise<ThinkingResult> {
  const gateStart = Date.now();
  if (depth === "off") {
    return {
      trace: "",
      depth,
      skipped: true,
      skipReason: "thinking disabled",
      gateDurationMs: Date.now() - gateStart,
    };
  }

  // Auto-skip for fast phases even if depth was explicitly set
  const phase = determineWorkflowPhase(context);
  if (SKIP_PHASES.has(phase)) {
    return {
      trace: "",
      depth,
      skipped: true,
      skipReason: `phase ${phase} does not benefit from thinking`,
      gateDurationMs: Date.now() - gateStart,
    };
  }
  const gateDurationMs = Date.now() - gateStart;

  const callStart = Date.now();
  try {
    const route = resolveWorkflowPhaseModelRoute("compaction"); // fast model

    // Build a compact context snapshot (avoid token explosion)
    const contextSnapshot = JSON.stringify(
      {
        permissionMode: context.config.permissionMode,
        credentialProfile: context.credentialProfile,
        exchange: context.exchange?.exchangeId,
        broker: context.broker?.brokerId,
        phase,
      },
      null,
      0,
    ).slice(0, 600);

    const recentTail = recentMessages
      .slice(-3)
      .map((m) => `${m.role}: ${String(m.content).slice(0, 200)}`)
      .join("\n");

    const userContent = [
      `Context: ${contextSnapshot}`,
      `User request: ${userMessage}`,
      recentTail ? `Recent messages:\n${recentTail}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const maxTokens = MAX_TOKENS_BY_DEPTH[depth as Exclude<ThinkingDepth, "off">];

    const response = await context.llm.chatWithConfig(
      [
        { role: "system", content: THINKING_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      {
        provider: route.provider,
        model: route.model,
        temperature: 0.3,
        maxTokens,
      },
    );

    recordPhaseLLMCost(response.usage, route.model);
    const trace = response.content?.trim() ?? "";
    const thinkingDurationMs = Date.now() - callStart;
    logger.debug("Thinking phase complete", {
      depth,
      phase,
      traceLength: trace.length,
      tokensUsed: response.usage?.totalTokens,
      thinkingDurationMs,
      gateDurationMs,
    });

    return {
      trace,
      depth,
      tokensUsed: response.usage?.totalTokens,
      skipped: false,
      thinkingDurationMs,
      gateDurationMs,
    };
  } catch (error) {
    const message = (error as Error).message ?? String(error);
    logger.warn("Thinking phase failed, continuing without trace", { error: message });
    return {
      trace: "",
      depth,
      skipped: true,
      skipReason: message,
      thinkingDurationMs: Date.now() - callStart,
      gateDurationMs,
    };
  }
}
