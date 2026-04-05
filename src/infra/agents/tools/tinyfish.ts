import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { auditLog } from "../../platform/audit/index.ts";
import { safeAppendAudit } from "../../../gateway/store/audit-log-store.ts";
import { listTinyfishMonitorRuns, listTinyfishMonitors } from "../../external/tinyfish/monitor-store.ts";
import {
  buildTinyfishRequest,
  executeTinyfishMonitorRun,
  removeTinyfishMonitor,
  scheduleTinyfishMonitor,
} from "../../external/tinyfish/service.ts";
import { TinyfishClient } from "../../external/tinyfish/client.ts";
import { getGordonContext, type MastraExecutionContext } from "./types.ts";

function getTinyfishActor(execContext?: MastraExecutionContext): string {
  const ctx = getGordonContext(execContext);
  return ctx?.userId ?? "system";
}

const tinyfishAvailabilitySchema = z.object({
  configured: z.boolean(),
  error: z.string().optional(),
});

const tinyfishRunSchema = z.object({
  success: z.boolean(),
  status: z.string().optional(),
  runId: z.string().optional(),
  summary: z.string().optional(),
  result: z.unknown().optional(),
  raw: z.unknown().optional(),
  error: z.string().optional(),
});

function ensureTinyfishConfigured() {
  const client = new TinyfishClient();
  if (!client.isConfigured()) {
    return { configured: false, error: "Tinyfish not configured. Set TINYFISH_API_KEY." } as const;
  }
  return { configured: true, client } as const;
}

export const tinyfishWebResearchTool = createTool({
  id: "tinyfish_web_research",
  description:
    "Run browser-native web research with Tinyfish against dynamic websites. " +
    "Use for due diligence, protocol research, exchange announcement pages, or pages that require real browser execution.",
  inputSchema: z.object({
    url: z.string().url(),
    goal: z.string().min(5).max(2000),
    browserProfile: z.string().min(1).max(100).optional(),
    proxyCountry: z.string().min(2).max(32).optional(),
  }),
  outputSchema: tinyfishRunSchema.extend(tinyfishAvailabilitySchema.shape),
  execute: async ({ url, goal, browserProfile, proxyCountry }, execContext: MastraExecutionContext) => {
    const availability = ensureTinyfishConfigured();
    if (!availability.configured) return availability;

    const actor = getTinyfishActor(execContext);
    try {
      const response = await availability.client.run(
        buildTinyfishRequest({
          url,
          goal,
          browserProfile,
          proxyCountry,
          allowAuthenticated: false,
          metadata: { actor, mode: "research" },
        }),
      );
      auditLog.success(actor, "WEB_RESEARCH_RUN", { url, goal, authenticated: false }, { metadata: { tool: "tinyfish_web_research" } });
      safeAppendAudit({
        eventType: "tinyfish.web_research.run",
        actor,
        payload: { url, goal, authenticated: false, success: response.success },
      });
      return { configured: true, ...response };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      auditLog.failure(actor, "WEB_RESEARCH_RUN", { url, goal, authenticated: false }, message, {
        metadata: { tool: "tinyfish_web_research" },
      });
      safeAppendAudit({
        eventType: "tinyfish.web_research.run",
        actor,
        payload: { url, goal, authenticated: false, success: false, error: message },
      });
      return { configured: true, success: false, error: message };
    }
  },
});

export const tinyfishOperatorAutomationTool = createTool({
  id: "tinyfish_operator_automation",
  description:
    "Run a guarded Tinyfish browser automation against authenticated or operator-sensitive sites. " +
    "Requires explicit confirmation and is intended for human-approved operational workflows only.",
  inputSchema: z.object({
    url: z.string().url(),
    goal: z.string().min(5).max(2000),
    browserProfile: z.string().min(1).max(100).optional(),
    proxyCountry: z.string().min(2).max(32).optional(),
    confirm: z.boolean().default(false),
    allowAuthenticated: z.boolean().default(false),
  }),
  outputSchema: tinyfishRunSchema.extend(tinyfishAvailabilitySchema.shape),
  execute: async (
    { url, goal, browserProfile, proxyCountry, confirm, allowAuthenticated },
    execContext: MastraExecutionContext,
  ) => {
    const actor = getTinyfishActor(execContext);
    if (!confirm || !allowAuthenticated) {
      const reason = "Tinyfish operator automation requires confirm=true and allowAuthenticated=true.";
      auditLog.blocked(actor, "WEB_AUTOMATION_RUN", { url, goal, confirm, allowAuthenticated }, reason, {
        metadata: { tool: "tinyfish_operator_automation" },
      });
      safeAppendAudit({
        eventType: "tinyfish.web_automation.run",
        actor,
        payload: { url, goal, confirm, allowAuthenticated, blocked: true, reason },
      });
      return {
        configured: true,
        success: false,
        error: reason,
      };
    }

    const availability = ensureTinyfishConfigured();
    if (!availability.configured) return availability;

    try {
      const response = await availability.client.run(
        buildTinyfishRequest({
          url,
          goal,
          browserProfile,
          proxyCountry,
          allowAuthenticated: true,
          metadata: { actor, mode: "operator-automation", confirmed: true },
        }),
      );
      auditLog.success(actor, "WEB_AUTOMATION_RUN", { url, goal, confirm, allowAuthenticated }, {
        metadata: { tool: "tinyfish_operator_automation" },
      });
      safeAppendAudit({
        eventType: "tinyfish.web_automation.run",
        actor,
        payload: { url, goal, confirm, allowAuthenticated, success: response.success },
      });
      return { configured: true, ...response };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      auditLog.failure(actor, "WEB_AUTOMATION_RUN", { url, goal, confirm, allowAuthenticated }, message, {
        metadata: { tool: "tinyfish_operator_automation" },
      });
      safeAppendAudit({
        eventType: "tinyfish.web_automation.run",
        actor,
        payload: { url, goal, confirm, allowAuthenticated, success: false, error: message },
      });
      return { configured: true, success: false, error: message };
    }
  },
});

export const tinyfishScheduleMonitorTool = createTool({
  id: "tinyfish_schedule_monitor",
  description:
    "Schedule a recurring Tinyfish web monitor for dynamic pages like listings, governance, protocol updates, or campaign pages.",
  inputSchema: z.object({
    monitorId: z.string().min(3).max(64).optional(),
    name: z.string().min(1).max(120).optional(),
    url: z.string().url(),
    goal: z.string().min(5).max(2000),
    schedule: z.string().min(3).max(64).describe("Examples: hourly, daily, every:6h, @every 30m"),
    browserProfile: z.string().min(1).max(100).optional(),
    proxyCountry: z.string().min(2).max(32).optional(),
    allowAuthenticated: z.boolean().default(false),
    enabled: z.boolean().default(true),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    monitorId: z.string().optional(),
    taskId: z.string().optional(),
    cronExpr: z.string().optional(),
    nextRunAt: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (
    { monitorId, name, url, goal, schedule, browserProfile, proxyCountry, allowAuthenticated, enabled },
    execContext: MastraExecutionContext,
  ) => {
    const availability = ensureTinyfishConfigured();
    if (!availability.configured) return { success: false, error: availability.error };

    const actor = getTinyfishActor(execContext);
    try {
      const monitor = scheduleTinyfishMonitor({
        monitorId,
        name,
        url,
        goal,
        schedule,
        browserProfile,
        proxyCountry,
        allowAuthenticated,
        enabled,
        createdBy: actor,
      });
      auditLog.success(actor, "WEB_MONITOR_SCHEDULE", { monitorId: monitor.monitorId, url, schedule }, {
        metadata: { tool: "tinyfish_schedule_monitor" },
      });
      return {
        success: true,
        monitorId: monitor.monitorId,
        taskId: `tinyfish-monitor-${monitor.monitorId}`,
        cronExpr: monitor.cronExpr,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      auditLog.failure(actor, "WEB_MONITOR_SCHEDULE", { monitorId, url, schedule }, message, {
        metadata: { tool: "tinyfish_schedule_monitor" },
      });
      return { success: false, error: message };
    }
  },
});

export const tinyfishListMonitorsTool = createTool({
  id: "tinyfish_list_monitors",
  description: "List configured Tinyfish web monitors and their current scheduling state.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    success: z.boolean(),
    monitors: z.array(z.object({
      monitorId: z.string(),
      name: z.string().optional(),
      url: z.string(),
      goal: z.string(),
      cronExpr: z.string(),
      enabled: z.boolean(),
      allowAuthenticated: z.boolean(),
      lastRunAt: z.string().optional(),
      lastStatus: z.enum(["SUCCESS", "FAILURE"]).optional(),
      lastSummary: z.string().optional(),
    })),
  }),
  execute: async () => ({
    success: true,
    monitors: listTinyfishMonitors(),
  }),
});

export const tinyfishRemoveMonitorTool = createTool({
  id: "tinyfish_remove_monitor",
  description: "Delete a scheduled Tinyfish web monitor and its scheduler task.",
  inputSchema: z.object({
    monitorId: z.string().min(3).max(64),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    error: z.string().optional(),
  }),
  execute: async ({ monitorId }, execContext: MastraExecutionContext) => {
    const actor = getTinyfishActor(execContext);
    const deleted = removeTinyfishMonitor({ monitorId, actor });
    if (deleted) {
      auditLog.success(actor, "WEB_MONITOR_REMOVE", { monitorId }, { metadata: { tool: "tinyfish_remove_monitor" } });
      return { success: true };
    }
    const error = `Tinyfish monitor '${monitorId}' not found.`;
    auditLog.failure(actor, "WEB_MONITOR_REMOVE", { monitorId }, error, { metadata: { tool: "tinyfish_remove_monitor" } });
    return { success: false, error };
  },
});

export const tinyfishGetMonitorRunsTool = createTool({
  id: "tinyfish_get_monitor_runs",
  description: "Get the recent execution history for a Tinyfish web monitor.",
  inputSchema: z.object({
    monitorId: z.string().min(3).max(64),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    runs: z.array(z.object({
      id: z.number(),
      monitorId: z.string(),
      status: z.enum(["SUCCESS", "FAILURE"]),
      summary: z.string().optional(),
      error: z.string().optional(),
      startedAt: z.string(),
      finishedAt: z.string(),
      createdAt: z.string(),
      result: z.unknown().optional(),
    })),
  }),
  execute: async ({ monitorId, limit }) => ({
    success: true,
    runs: listTinyfishMonitorRuns(monitorId, limit),
  }),
});

export const tinyfishRunMonitorNowTool = createTool({
  id: "tinyfish_run_monitor_now",
  description: "Run a configured Tinyfish web monitor immediately without waiting for its next scheduled execution.",
  inputSchema: z.object({
    monitorId: z.string().min(3).max(64),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    summary: z.string().optional(),
    error: z.string().optional(),
    response: tinyfishRunSchema.optional(),
  }),
  execute: async ({ monitorId }, execContext: MastraExecutionContext) => {
    const actor = getTinyfishActor(execContext);
    const result = await executeTinyfishMonitorRun({ monitorId, actor });
    if (result.success) {
      auditLog.success(actor, "WEB_MONITOR_RUN", { monitorId }, { metadata: { tool: "tinyfish_run_monitor_now" } });
    } else {
      auditLog.failure(actor, "WEB_MONITOR_RUN", { monitorId }, result.error ?? "Tinyfish monitor run failed", {
        metadata: { tool: "tinyfish_run_monitor_now" },
      });
    }
    return {
      success: result.success,
      summary: result.summary,
      error: result.error,
      response: result.response,
    };
  },
});

export const tinyfishTools = {
  tinyfish_web_research: tinyfishWebResearchTool,
  tinyfish_operator_automation: tinyfishOperatorAutomationTool,
  tinyfish_schedule_monitor: tinyfishScheduleMonitorTool,
  tinyfish_list_monitors: tinyfishListMonitorsTool,
  tinyfish_remove_monitor: tinyfishRemoveMonitorTool,
  tinyfish_get_monitor_runs: tinyfishGetMonitorRunsTool,
  tinyfish_run_monitor_now: tinyfishRunMonitorNowTool,
};
