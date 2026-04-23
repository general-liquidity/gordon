/**
 * Thinking Phase — tool-free pre-action reasoning pass
 *
 * Performs a lightweight LLM call before the main action phase to reason
 * about the user's intent, relevant tools/agents, and hidden constraints.
 * No tools are available during this call — pure internal deliberation.
 *
 * Based on OPENDEV paper §2.2.6: Extended ReAct with thinking phase.
 */

import type { GordonContext } from "./types.ts";
import type { Message } from "../ai/llm/types.ts";
import {
  resolveLegacyModelRouteForWorkflowPhase,
  determineWorkflowPhase,
} from "./workflowPhase.ts";
import { createModuleLogger } from "../logger/index.ts";

const logger = createModuleLogger("thinking-phase");

// ============================================================================
// Types
// ============================================================================

export type ThinkingDepth = "off" | "low" | "medium" | "high";

export interface ThinkingResult {
  trace: string;
  depth: ThinkingDepth;
  tokensUsed?: number;
  skipped: boolean;
  skipReason?: string;
}

// ============================================================================
// Constants
// ============================================================================

const THINKING_SYSTEM_PROMPT = `You are an internal reasoning step for Gordon, an AI trading assistant. Analyze the user request and current context. Identify: (1) what the user actually wants, (2) which agent or tools are most relevant, (3) any hidden constraints or risks. Output one concise paragraph under 100 words. No bullet points. No tool calls. Pure internal reasoning only.`;

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
  // Explicit config override
  const configDepth = (context.config as Record<string, unknown>).thinkingDepth as ThinkingDepth | undefined;
  const envDepth = process.env.GORDON_THINKING_DEPTH as ThinkingDepth | undefined;
  const requested = configDepth ?? envDepth;

  if (requested && ["off", "low", "medium", "high"].includes(requested)) {
    return requested;
  }

  return "off";
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
  if (depth === "off") {
    return { trace: "", depth, skipped: true, skipReason: "thinking disabled" };
  }

  // Auto-skip for fast phases even if depth was explicitly set
  const phase = determineWorkflowPhase(context);
  if (SKIP_PHASES.has(phase)) {
    return { trace: "", depth, skipped: true, skipReason: `phase ${phase} does not benefit from thinking` };
  }

  try {
    const route = resolveLegacyModelRouteForWorkflowPhase("compaction"); // fast model

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

    const trace = response.content?.trim() ?? "";
    logger.debug("Thinking phase complete", {
      depth,
      phase,
      traceLength: trace.length,
      tokensUsed: response.usage?.totalTokens,
    });

    return {
      trace,
      depth,
      tokensUsed: response.usage?.totalTokens,
      skipped: false,
    };
  } catch (error) {
    const message = (error as Error).message ?? String(error);
    logger.warn("Thinking phase failed, continuing without trace", { error: message });
    return { trace: "", depth, skipped: true, skipReason: message };
  }
}
