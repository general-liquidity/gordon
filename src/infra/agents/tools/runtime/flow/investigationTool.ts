/**
 * Investigation + Fork tools — operator-facing Mastra tools that wrap
 * the runInvestigation + forkContext primitives with the LLM-only
 * synthesis agentStep adapter.
 *
 * Surfaces:
 *   /investigate <task>  → spawn isolated synthesis sub-agent
 *   /fork <task>         → inherit parent context + spawn fork
 *
 * Both tools:
 *   - Use the synthesis-only agentStep (LLM call, no tool execution)
 *   - Honor the hardcoded investigation safety deny-list
 *   - Register with the context-timeline registry so the operator
 *     sees them appear/disappear during long sessions
 *   - Fork additionally writes audit-trail entries to
 *     ~/.gordon/fork-audit.jsonl (override path via
 *     GORDON_FORK_AUDIT_PATH, disable entirely via
 *     GORDON_FORK_AUDIT_DISABLED=1)
 *
 * Limitation today: synthesis-only sub-agents cannot run tools. They
 * can REFERENCE prior tool results from the parent conversation (for
 * fork) or reason about a topic the orchestrator hands them
 * (for investigation), but they don't fire tool calls themselves.
 * Tool-using sub-agents are deferred to S27 (Mastra agentStep
 * adapter) in docs/harness-deferred-wiring.md.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { GORDON_DIR } from "../../../../storage/paths.ts";
import { getGordonContext, type MastraExecutionContext } from "../../types.ts";
import { resolveLegacyModelRouteForWorkflowPhase } from "../../../cognition/workflowPhase.ts";
import {
  runInvestigation,
  type InvestigationResult,
} from "../../../investigation.ts";
import {
  forkContext,
  type ContextForkAuditEntry,
} from "../../../contextFork.ts";
import { createSynthesisAgentStepFromChatWithConfig } from "../../../wiring/synthesisAgentStep.ts";
import {
  withTimelineEntry,
  generateTimelineAgentId,
  estimateTokensFromMessages,
  reportTimelineProgress,
} from "../../../wiring/timelineWiring.ts";

// ============================================================================
// Audit trail for forks
// ============================================================================

function defaultForkAuditPath(): string {
  return process.env.GORDON_FORK_AUDIT_PATH ?? join(GORDON_DIR, "fork-audit.jsonl");
}

function forkAuditDisabled(): boolean {
  return process.env.GORDON_FORK_AUDIT_DISABLED === "1";
}

function appendForkAudit(entry: ContextForkAuditEntry): void {
  if (forkAuditDisabled()) return;
  try {
    const path = defaultForkAuditPath();
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(path, JSON.stringify(entry) + "\n");
  } catch {
    // Audit failure must not break the fork
  }
}

// ============================================================================
// Investigation Tool
// ============================================================================

const errors = {
  noLlm: { error: "LLM client not available in context. Cannot run investigation." },
};

export const investigateTool = createTool({
  id: "investigate",
  description:
    "Spawn an isolated synthesis sub-agent on a bounded task. The sub-agent runs in its own context, " +
    "cannot call execution tools (read-only by construction), and returns ONLY its synthesis. " +
    "Use when you want to delegate a focused analytical task without polluting the main conversation context. " +
    "Examples: 'summarize the bull case for AAPL given what we've discussed', 'compare the risk profiles of " +
    "BTCUSDT vs ETHUSDT mentioned earlier'.",
  inputSchema: z.object({
    task: z.string().min(3).describe("The synthesis task for the sub-agent."),
    maxToolCalls: z.number().int().min(1).max(50).default(20).describe("Tool-call budget cap (informational; sub-agent runs synthesis-only today)."),
    allowedTools: z
      .array(z.string())
      .default([])
      .describe("Optional list of tool ids the sub-agent should reference. Tools never execute in the sub-agent — they're surfaced as context only."),
  }),
  outputSchema: z.object({
    synthesis: z.string(),
    toolCallCount: z.number(),
    deniedTools: z.array(z.string()),
    budgetExhausted: z.boolean(),
    durationMs: z.number(),
    rounds: z.number(),
    error: z.string().optional(),
  }),
  execute: async ({ task, maxToolCalls, allowedTools }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.llm) return errors.noLlm;

    const route = resolveLegacyModelRouteForWorkflowPhase("compaction");
    const agentStep = createSynthesisAgentStepFromChatWithConfig(
      ctx.llm.chatWithConfig.bind(ctx.llm),
      {
        provider: route.provider,
        model: route.model,
        temperature: 0.3,
        maxTokens: 2000,
      },
    );

    const agentId = generateTimelineAgentId("investigate");
    const result = await withTimelineEntry(
      {
        agentId,
        agentName: `investigate: ${task.slice(0, 40)}`,
        agentType: "investigation",
        initialTokens: estimateTokensFromMessages([{ content: task }]),
      },
      async () => {
        const investigation: InvestigationResult = await runInvestigation(
          { task, maxToolCalls, allowedTools },
          { agentStep },
        );
        reportTimelineProgress(agentId, {
          tokenEstimate: estimateTokensFromMessages([{ content: investigation.synthesis }]),
          toolCallCount: investigation.toolCallCount,
        });
        return investigation;
      },
    );

    return {
      synthesis: result.synthesis,
      toolCallCount: result.toolCallCount,
      deniedTools: result.deniedTools,
      budgetExhausted: result.budgetExhausted,
      durationMs: result.durationMs,
      rounds: result.rounds,
    };
  },
});

// ============================================================================
// Fork Tool
// ============================================================================

const forkErrors = {
  noLlm: { error: "LLM client not available in context. Cannot run fork." },
  noHistory: { error: "No parent message history available to fork from." },
};

export const forkContextTool = createTool({
  id: "fork_context",
  description:
    "Fork the current conversation context into an isolated sub-agent that performs a synthesis task. " +
    "The fork inherits the orchestrator's recent message history (with safety-sensitive content stripped " +
    "by default — rationale entries, permission grants, evidence bundles, execution records). " +
    "Returns ONLY the synthesis; the fork's intermediate work doesn't pollute the main context. " +
    "Logs to ~/.gordon/fork-audit.jsonl. Examples: 'take everything we've said about BTCUSDT and " +
    "produce a structured pros/cons list', 'deepen the analysis we started on the regime transition'.",
  inputSchema: z.object({
    task: z.string().min(3).describe("The synthesis task for the fork."),
    parentMessages: z
      .array(
        z.object({
          role: z.enum(["system", "user", "assistant"]),
          content: z.string(),
        }),
      )
      .describe("Parent conversation messages to inherit. Caller is responsible for supplying these."),
    stripSafetyMessages: z
      .boolean()
      .default(true)
      .describe("Strip messages containing safety markers (rationale, permission grants, execution records). Default true."),
    maxToolCalls: z.number().int().min(1).max(50).default(20),
    allowedTools: z.array(z.string()).default([]),
  }),
  outputSchema: z.object({
    synthesis: z.string(),
    inheritedMessageCount: z.number(),
    strippedMessageCount: z.number(),
    deniedTools: z.array(z.string()),
    toolCallCount: z.number(),
    budgetExhausted: z.boolean(),
    durationMs: z.number(),
    rounds: z.number(),
    error: z.string().optional(),
  }),
  execute: async (
    { task, parentMessages, stripSafetyMessages, maxToolCalls, allowedTools },
    execContext: MastraExecutionContext,
  ) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.llm) return forkErrors.noLlm;
    if (!parentMessages || parentMessages.length === 0) return forkErrors.noHistory;

    const route = resolveLegacyModelRouteForWorkflowPhase("compaction");
    const agentStep = createSynthesisAgentStepFromChatWithConfig(
      ctx.llm.chatWithConfig.bind(ctx.llm),
      {
        provider: route.provider,
        model: route.model,
        temperature: 0.3,
        maxTokens: 2000,
      },
    );

    const agentId = generateTimelineAgentId("fork");
    const result = await withTimelineEntry(
      {
        agentId,
        agentName: `fork: ${task.slice(0, 40)}`,
        agentType: "fork",
        initialTokens: estimateTokensFromMessages(parentMessages),
      },
      () =>
        forkContext(
          {
            task,
            parentMessages,
            stripSafetyMessages,
            maxToolCalls,
            allowedTools,
          },
          {
            agentStep,
            auditHook: (entry) => appendForkAudit(entry),
          },
        ),
    );

    reportTimelineProgress(agentId, {
      toolCallCount: result.toolCallCount,
      tokenEstimate: estimateTokensFromMessages([{ content: result.synthesis }]),
    });

    return {
      synthesis: result.synthesis,
      inheritedMessageCount: result.inheritedMessageCount,
      strippedMessageCount: result.strippedMessageCount,
      deniedTools: result.deniedTools,
      toolCallCount: result.toolCallCount,
      budgetExhausted: result.budgetExhausted,
      durationMs: result.durationMs,
      rounds: result.rounds,
    };
  },
});

export const investigationTools = {
  investigate: investigateTool,
  fork_context: forkContextTool,
};
