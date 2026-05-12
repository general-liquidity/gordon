/**
 * Query Harness — Unified Agent Loop Wrapper
 *
 * Claude Code pattern: QueryEngine owns the query lifecycle. The harness
 * composes all the pieces (context, permissions, tools, processors, compaction)
 * into a single configurable entry point.
 *
 * For Gordon: wraps the Mastra agent stream with all our custom layers.
 * SDK and plugin authors use this instead of calling the agent directly.
 *
 * Usage:
 *   const harness = createQueryHarness(config);
 *   for await (const event of harness.submit("What's BTC doing?")) {
 *     // Process streaming events
 *   }
 */

import type { GordonConfig } from "../../types/config.ts";
import { getCompactionTrigger, type CompactionDecision } from "../context/compactionTrigger.ts";
import { getConversationBudget } from "../context/conversationBudget.ts";
import { getCostTracker } from "../platform/costTracker.ts";
import { runHooks } from "../hooks/engine.ts";
import { quickPermissionCheck } from "../permissions/racing.ts";
import type { PermissionRule } from "../permissions/rules.ts";
import { buildSkillMetadataSection, resolveSkillInvocation } from "../skills/index.ts";
import { formatMemoriesForPrompt } from "../memory/sessionMemory.ts";
import { emitAgentEvent } from "../agents/streaming/coordinator.ts";
import { createEvent } from "../agents/streaming/events.ts";
import { formatFeedbackForPrompt } from "../trading/ops/feedbackLoop.ts";

// ============================================================================
// Types
// ============================================================================

export interface HarnessConfig {
  /** Session ID for persistence. */
  sessionId: string;
  /** Gordon config (loaded from layered settings). */
  config: GordonConfig;
  /** Permission rules (loaded from settings + session). */
  permissionRules?: PermissionRule[];
  /** Custom system prompt append. */
  appendSystemPrompt?: string;
  /** Max turns before auto-compact. */
  maxTurns?: number;
  /** Max budget in USD. */
  maxBudgetUsd?: number;
  /** Model override for this session. */
  modelOverride?: string;
}

export interface HarnessState {
  /** Current turn number. */
  turn: number;
  /** Total tokens used. */
  totalTokens: number;
  /** Total cost in USD. */
  totalCostUsd: number;
  /** Whether compaction has run this session. */
  compacted: boolean;
  /** Last compaction decision. */
  lastCompactionDecision?: CompactionDecision;
  /** Pending approvals count. */
  pendingApprovals: number;
}

export type HarnessEvent =
  | { type: "text"; content: string; agent?: string }
  | { type: "tool_start"; toolName: string; args?: unknown }
  | { type: "tool_end"; toolName: string; success: boolean; durationMs: number }
  | { type: "compaction"; action: string; tokensBefore: number; tokensAfter?: number }
  | { type: "approval_required"; toolName: string; riskTier: string }
  | { type: "skill_invoked"; skillId: string; context: string }
  | { type: "error"; message: string; recoverable: boolean }
  | { type: "done"; content: string; usage: { input: number; output: number } };

// ============================================================================
// Harness
// ============================================================================

export class QueryHarness {
  private config: HarnessConfig;
  private state: HarnessState;
  private iteration: number = 0;

  constructor(config: HarnessConfig) {
    this.config = config;
    this.state = {
      turn: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      compacted: false,
      pendingApprovals: 0,
    };
  }

  /**
   * Build the system prompt with all composed elements.
   */
  buildSystemPrompt(): string {
    const parts: string[] = [];

    // Session memory
    const memories = formatMemoriesForPrompt();
    if (memories) parts.push(memories);

    // Available skills
    const skills = buildSkillMetadataSection("Gordon");
    if (skills) parts.push(skills);

    // Pattern feedback (evaluation loop — strong/weak patterns)
    const feedback = formatFeedbackForPrompt();
    if (feedback) parts.push(feedback);

    // Custom append
    if (this.config.appendSystemPrompt) {
      parts.push(this.config.appendSystemPrompt);
    }

    return parts.join("\n\n");
  }

  /**
   * Pre-process user input: resolve skills, check permissions.
   */
  async preProcess(input: string): Promise<{
    processedInput: string;
    skillInvoked?: string;
    blocked?: { reason: string };
  }> {
    // Check if input is a skill invocation
    if (input.startsWith("/")) {
      const parts = input.slice(1).split(/\s+/);
      const skillName = parts[0] ?? "";
      const args = parts.slice(1).join(" ");
      const invocation = resolveSkillInvocation(skillName, args);
      if (invocation) {
        emitAgentEvent(createEvent("start", this.iteration, {
          query: `Skill: ${invocation.skillId}`,
        }));
        return {
          processedInput: invocation.prompt,
          skillInvoked: invocation.skillId,
        };
      }
    }

    // Run pre-message hooks
    const hookResult = await runHooks("SessionStart", { message: input } as any);
    if (hookResult.action === "block") {
      return { processedInput: input, blocked: { reason: hookResult.reason ?? "Blocked by hook" } };
    }

    return { processedInput: input };
  }

  /**
   * Post-process after API response: check compaction, track costs.
   */
  postProcess(usage: { inputTokens: number; outputTokens: number }): void {
    this.state.turn++;
    this.state.totalTokens += usage.inputTokens + usage.outputTokens;

    // Track costs
    const modelId = this.config.modelOverride ?? this.config.config.modelConfig?.model ?? "unknown";
    getCostTracker(this.config.sessionId).record({
      modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
    this.state.totalCostUsd = getCostTracker().snapshot().totalCostUsd;

    // Check compaction trigger
    const decision = getCompactionTrigger().check(usage.inputTokens);
    this.state.lastCompactionDecision = decision;
    if (decision.action !== "none") {
      emitAgentEvent(createEvent("context_warning", this.iteration, {
        currentTokens: decision.projection.currentTokens,
        threshold: decision.projection.contextWindow,
        message: decision.projection.recommendation,
      }));
    }

    // Check budget
    if (this.config.maxBudgetUsd && this.state.totalCostUsd >= this.config.maxBudgetUsd) {
      emitAgentEvent(createEvent("error", this.iteration, {
        message: `Budget limit reached: $${this.state.totalCostUsd.toFixed(4)} >= $${this.config.maxBudgetUsd}`,
        recoverable: false,
      }));
    }

    this.iteration++;
  }

  /**
   * Quick permission check for a tool call.
   */
  checkToolPermission(toolName: string, args: unknown): "allow" | "deny" | "ask" {
    const result = quickPermissionCheck(
      this.config.permissionRules ?? [],
      toolName,
      args,
    );
    return result?.decision ?? "ask";
  }

  /**
   * Get current harness state.
   */
  getState(): Readonly<HarnessState> {
    return { ...this.state };
  }

  /**
   * Get the cost tracker for this session.
   */
  getCosts() {
    return getCostTracker(this.config.sessionId).snapshot();
  }

  /**
   * Reset harness state (new session).
   */
  reset(): void {
    this.state = {
      turn: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      compacted: false,
      pendingApprovals: 0,
    };
    this.iteration = 0;
    getCompactionTrigger().reset();
    getConversationBudget().reset();
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createQueryHarness(config: HarnessConfig): QueryHarness {
  return new QueryHarness(config);
}
