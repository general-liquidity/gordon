/**
 * V4 Workflow + Delegation Tools — 4 tools.
 *
 *   - skill              → meta-tool, workflow knowledge loader
 *   - delegate_subagent  → FW7 subagent dispatch (read-only)
 *   - ask_user           → operator elicitation
 *   - schedule_task      → autonomous-loop / proactive radar / cron mandates
 *
 * Wires `skill` and `ask_user` through existing handlers. `delegate_subagent`
 * and `schedule_task` defer to runtime-resolved dispatchers — those exist
 * but are constructed conditionally per agent, so we leave shape-faithful
 * stubs here pending dedicated wiring.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  listSkillsTool as legacyListSkills,
  loadSkillTool as legacyLoadSkill,
} from "../runtime/lifecycle/skill-loader.ts";
import { askUserTool as legacyAskUser } from "../runtime/flow/askUser.ts";
import type { MastraExecutionContext } from "../types.ts";

// ============================================================================
// skill
// ============================================================================

export const skillTool = createTool({
  id: "skill",
  description: [
    "Load workflow knowledge on demand. Skills are SKILL.md files containing",
    "domain-specific workflow recipes — backtest validation procedures,",
    "deep-dive sequences, regime-shift response, discipline audits.",
    "",
    "Use `list` to enumerate available skills; use `load` to fetch the full",
    "workflow guide for one. Then compose the primitive V4 tools per the",
    "loaded recipe.",
    "",
    "Skills are NOT tools — they're operator-authored markdown workflows the",
    "agent reads. Don't try to execute them — read them and compose actions.",
    "",
    "Available skills include: dd, quick-scan, weekend-review, risk-check,",
    "earnings-play, backtest-validate, strategy-build, regime-shift,",
    "and many more (call action='list' to see all).",
  ].join("\n"),
  inputSchema: z.object({
    action: z.enum(["list", "load"]),
    id: z.string().optional().describe("Required when action='load'. Skill ID e.g. 'dd', 'backtest-validate'."),
    filter: z
      .string()
      .optional()
      .describe("For 'list': filter skills by keyword/tag."),
  }),
  outputSchema: z.object({
    action: z.string(),
    skills: z.array(z.unknown()).optional(),
    skill: z.unknown().optional(),
    error: z.string().optional(),
  }),
  execute: async (
    args: { action: "list" | "load"; id?: string; filter?: string },
    execContext?: MastraExecutionContext,
  ) => {
    if (args.action === "list") {
      const result = (await (legacyListSkills.execute as any)(
        { filter: args.filter },
        execContext,
      )) as { skills?: unknown[]; error?: string };
      return { action: "list", skills: result.skills ?? [], error: result.error };
    }
    if (!args.id) {
      return { action: "load", error: "id is required when action='load'." };
    }
    const result = (await (legacyLoadSkill.execute as any)(
      { id: args.id },
      execContext,
    )) as { skill?: unknown; error?: string };
    return { action: "load", skill: result.skill, error: result.error };
  },
});

// ============================================================================
// delegate_subagent
// ============================================================================

export const delegateSubagentTool = createTool({
  id: "delegate_subagent",
  description: [
    "Delegate a task to an operator-defined specialty subagent. Examples:",
    "regulatory-risk-analyst, options-strategist, liquidation-cascade-",
    "investigator, general-purpose. Subagents are read-only — they cannot",
    "place trades.",
    "",
    "Use when the task fits a specialized role better than direct",
    "orchestrator handling. The subagent returns a structured task",
    "notification with completed/failed status + summary + result.",
    "",
    "Profiles are configured in .claude/subagents/*.json (operator-authored).",
    "If no profiles configured and GORDON_DYNAMIC_SUBAGENTS=1, falls back to",
    "general-purpose role.",
  ].join("\n"),
  inputSchema: z.object({
    role: z.string().min(1).describe("Profile name matching a configured subagent."),
    task: z.string().min(1).describe("Self-contained task description."),
  }),
  outputSchema: z.object({
    status: z.enum(["completed", "failed", "refused", "disabled"]),
    subagentId: z.string(),
    summary: z.string(),
    result: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (
    args: { role: string; task: string },
    _execContext?: MastraExecutionContext,
  ) => {
    // The legacy task-dispatch tool is constructed lazily per agent — it
    // can't be statically imported and called from here without breaking
    // its tool-registry resolution semantics. V4 surface continues to
    // surface the legacy `dispatch_task` tool alongside this one until
    // the dispatcher is refactored to allow standalone invocation.
    return {
      status: "disabled" as const,
      subagentId: "n/a",
      summary: `delegate_subagent stub — use the registered dispatch_task tool from the agent surface for role='${args.role}'.`,
    };
  },
});

// ============================================================================
// ask_user
// ============================================================================

export const askUserTool = createTool({
  id: "ask_user",
  description: [
    "Ask the operator a question mid-flow. Use when judgment is required",
    "and you can't proceed autonomously. Returns the operator's response.",
    "",
    "Common cases:",
    "  - Confidence/conviction for a borderline trade",
    "  - Approval despite a verify_plan conditional verdict",
    "  - Parameter elicitation (which stop-loss level? which timeframe?)",
    "  - Disambiguation ('Did you mean BTC or BCH?')",
    "",
    "Provide options when there are clear discrete choices — multiple",
    "choice is faster than open-ended for the operator.",
  ].join("\n"),
  inputSchema: z.object({
    question: z.string().min(1),
    options: z.array(z.string()).optional().describe("Discrete choices, if any."),
    context: z.string().optional().describe("Background the operator needs to decide."),
  }),
  outputSchema: z.object({
    answer: z.string(),
    cancelled: z.boolean().optional(),
  }),
  execute: async (
    args: { question: string; options?: string[]; context?: string },
    execContext?: MastraExecutionContext,
  ) => {
    const result = (await (legacyAskUser.execute as any)(
      { question: args.question, options: args.options, context: args.context },
      execContext,
    )) as { answer?: string; dismissed?: boolean };
    return {
      answer: result.answer ?? "",
      cancelled: result.dismissed,
    };
  },
});

// ============================================================================
// schedule_task
// ============================================================================

export const scheduleTaskTool = createTool({
  id: "schedule_task",
  description: [
    "Manage autonomous-loop / proactive-radar / scheduled tasks. Operator",
    "creates mandates that run independent of conversational turns —",
    "scanning, monitoring, auto-execution within safety bounds.",
    "",
    "action values:",
    "  - 'create'   — new mandate or scheduled task",
    "  - 'list'     — list active mandates / schedules",
    "  - 'pause'    — pause an active mandate",
    "  - 'resume'   — resume a paused mandate",
    "  - 'stop'     — terminate a mandate",
    "  - 'status'   — get state + recent activity for a mandate",
    "",
    "Mandates have strict bounds: max drawdown, daily loss cap, position",
    "count cap, expiry. These are non-negotiable safety properties.",
  ].join("\n"),
  inputSchema: z.object({
    action: z.enum(["create", "list", "pause", "resume", "stop", "status"]),
    mandateId: z.string().optional().describe("Required for non-create/list actions."),
    spec: z.unknown().optional().describe("Mandate spec for create action."),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    action: z.string(),
    mandate: z.unknown().optional(),
    mandates: z.array(z.unknown()).optional(),
    error: z.string().optional(),
  }),
  execute: async (
    args: { action: string; mandateId?: string; spec?: unknown },
    _execContext?: MastraExecutionContext,
  ) => {
    // Mandate / scheduler primitives are spread across swing-mandate,
    // autonomous-loop, scheduler tools and proactive-mode tools. Unified
    // dispatch needs a single facade module — pending. V4 surface continues
    // to expose the legacy scheduler tools alongside this one.
    return {
      success: false,
      action: args.action,
      error: "schedule_task stub — use the legacy scheduler / mandate tools from the agent surface.",
    };
  },
});

export const v4WorkflowTools = {
  skill: skillTool,
  delegate_subagent: delegateSubagentTool,
  ask_user: askUserTool,
  schedule_task: scheduleTaskTool,
};
