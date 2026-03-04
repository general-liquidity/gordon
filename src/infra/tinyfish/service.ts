import { computeNextRunAt } from "../../gateway/scheduler/local-cron.ts";
import { deleteSchedulerTask, upsertSchedulerTask } from "../../gateway/store/scheduler-store.ts";
import { safeAppendAudit } from "../../gateway/store/audit-log-store.ts";
import { TinyfishClient, summarizeTinyfishResult } from "./client.ts";
import {
  deleteTinyfishMonitor,
  getTinyfishMonitor,
  recordTinyfishMonitorRun,
  upsertTinyfishMonitor,
} from "./monitor-store.ts";
import type { TinyfishMonitorRecord, TinyfishRunRequest, TinyfishRunResponse } from "./types.ts";

export function slugifyTinyfishMonitorId(input: string): string {
  return input
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "tinyfish-monitor";
}

export function buildTinyfishTaskId(monitorId: string): string {
  return `tinyfish-monitor-${monitorId}`;
}

export function normalizeTinyfishSchedule(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "hourly") return "@hourly";
  if (trimmed === "daily") return "@daily";
  if (trimmed.startsWith("every:")) {
    return `@every ${trimmed.slice("every:".length)}`;
  }
  if (trimmed.startsWith("@")) return trimmed;
  return trimmed;
}

export function buildTinyfishRequest(input: {
  url: string;
  goal: string;
  browserProfile?: string;
  proxyCountry?: string;
  allowAuthenticated?: boolean;
  metadata?: Record<string, unknown>;
}): TinyfishRunRequest {
  return {
    url: input.url,
    goal: input.goal,
    browserProfile: input.browserProfile,
    proxyCountry: input.proxyCountry,
    allowAuthenticated: input.allowAuthenticated ?? false,
    metadata: input.metadata,
  };
}

export async function runTinyfishResearch(input: TinyfishRunRequest): Promise<TinyfishRunResponse> {
  const client = new TinyfishClient();
  return client.run(input);
}

export function scheduleTinyfishMonitor(input: {
  monitorId?: string;
  name?: string;
  url: string;
  goal: string;
  schedule: string;
  browserProfile?: string;
  proxyCountry?: string;
  allowAuthenticated?: boolean;
  enabled?: boolean;
  createdBy?: string;
  correlationId?: string;
}): TinyfishMonitorRecord {
  const monitorId = input.monitorId ?? slugifyTinyfishMonitorId(`${input.name ?? ""}-${input.url}`);
  const cronExpr = normalizeTinyfishSchedule(input.schedule);
  const monitor = upsertTinyfishMonitor({
    monitorId,
    name: input.name,
    url: input.url,
    goal: input.goal,
    cronExpr,
    browserProfile: input.browserProfile,
    proxyCountry: input.proxyCountry,
    allowAuthenticated: input.allowAuthenticated,
    enabled: input.enabled,
    createdBy: input.createdBy,
  });

  upsertSchedulerTask({
    taskId: buildTinyfishTaskId(monitorId),
    cronExpr,
    commandType: "tinyfish.monitor.run",
    payload: { monitorId },
    enabled: monitor.enabled,
    nextRunAt: computeNextRunAt(cronExpr),
  });

  safeAppendAudit({
    eventType: "tinyfish.monitor.scheduled",
    actor: input.createdBy ?? "system",
    correlationId: input.correlationId,
    payload: {
      monitorId,
      url: input.url,
      cronExpr,
      allowAuthenticated: input.allowAuthenticated ?? false,
    },
  });

  return monitor;
}

export function removeTinyfishMonitor(input: {
  monitorId: string;
  actor?: string;
  correlationId?: string;
}): boolean {
  deleteSchedulerTask(buildTinyfishTaskId(input.monitorId));
  const deleted = deleteTinyfishMonitor(input.monitorId);
  safeAppendAudit({
    eventType: "tinyfish.monitor.removed",
    actor: input.actor ?? "system",
    correlationId: input.correlationId,
    payload: { monitorId: input.monitorId, deleted },
  });
  return deleted;
}

export async function executeTinyfishMonitorRun(input: {
  monitorId: string;
  correlationId?: string;
  actor?: string;
}): Promise<{ success: boolean; monitor?: TinyfishMonitorRecord; response?: TinyfishRunResponse; error?: string; summary?: string }> {
  const monitor = getTinyfishMonitor(input.monitorId);
  if (!monitor) {
    return { success: false, error: `Tinyfish monitor '${input.monitorId}' not found.` };
  }
  if (!monitor.enabled) {
    return { success: false, monitor, error: `Tinyfish monitor '${input.monitorId}' is disabled.` };
  }

  const startedAt = new Date().toISOString();
  try {
    const response = await runTinyfishResearch(
      buildTinyfishRequest({
        url: monitor.url,
        goal: monitor.goal,
        browserProfile: monitor.browserProfile,
        proxyCountry: monitor.proxyCountry,
        allowAuthenticated: monitor.allowAuthenticated,
        metadata: { monitorId: monitor.monitorId, source: "monitor" },
      }),
    );
    const finishedAt = new Date().toISOString();
    const summary = response.summary ?? summarizeTinyfishResult(response.result ?? response.raw);
    recordTinyfishMonitorRun({
      monitorId: monitor.monitorId,
      status: response.success ? "SUCCESS" : "FAILURE",
      summary,
      result: response.result ?? response.raw,
      error: response.error,
      startedAt,
      finishedAt,
    });
    safeAppendAudit({
      eventType: "tinyfish.monitor.run",
      actor: input.actor ?? "daemon",
      correlationId: input.correlationId,
      payload: {
        monitorId: monitor.monitorId,
        success: response.success,
        summary,
      },
    });
    return {
      success: response.success,
      monitor,
      response,
      summary,
      error: response.error,
    };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : String(error);
    recordTinyfishMonitorRun({
      monitorId: monitor.monitorId,
      status: "FAILURE",
      summary: message,
      error: message,
      startedAt,
      finishedAt,
    });
    safeAppendAudit({
      eventType: "tinyfish.monitor.run",
      actor: input.actor ?? "daemon",
      correlationId: input.correlationId,
      payload: {
        monitorId: monitor.monitorId,
        success: false,
        error: message,
      },
    });
    return { success: false, monitor, error: message, summary: message };
  }
}
