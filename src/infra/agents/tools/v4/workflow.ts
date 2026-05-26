/**
 * V4 Workflow + Delegation Tools — 4 tools.
 *
 *   - skill              → meta-tool, workflow knowledge loader
 *   - delegate_subagent  → FW7 subagent dispatch
 *   - ask_user           → operator elicitation
 *   - schedule_task      → autonomous-loop / proactive radar / cron
 *
 * `skill` is the ONE meta-tool in V4 (besides compute_*) — workflow
 * recipes loaded on demand. Matches Vibe-Trading + Anthropic's
 * progressive disclosure pattern.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
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
    _execContext?: MastraExecutionContext,
  ) => {
    // Stub — proper implementation calls into existing skill-loader.ts.
    return {
      action: args.action,
      skills: args.action === "list" ? [] : undefined,
      skill: args.action === "load" ? null : undefined,
    };
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
    // Stub — proper implementation routes through the existing FW7
    // dispatcher (task-dispatch.ts).
    return {
      status: "disabled" as const,
      subagentId: "n/a",
      summary: "V4 delegate_subagent — wire to existing task-dispatch.ts",
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
    _execContext?: MastraExecutionContext,
  ) => {
    // Stub — proper implementation routes through the existing askUserTools.
    return {
      answer: "[V4 ask_user — wire to existing askUserTools]",
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
    // Stub — proper implementation routes to swing-mandate / autonomous-loop.
    return {
      success: true,
      action: args.action,
      mandates: args.action === "list" ? [] : undefined,
    };
  },
});

export const v4WorkflowTools = {
  skill: skillTool,
  delegate_subagent: delegateSubagentTool,
  ask_user: askUserTool,
  schedule_task: scheduleTaskTool,
};
