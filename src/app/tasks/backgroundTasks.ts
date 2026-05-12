import type { SchedulerTaskRecord } from "../../gateway/store/scheduler-store.ts";
import type { TaskTreeNode, TaskTreeState } from "./taskTree.ts";

export interface BackgroundAutonomousStatus {
  isRunning: boolean;
  isPaused: boolean;
  mandate: {
    id: string;
    timeframe?: string;
    symbols?: string[];
  } | null;
  sessionId: string;
  cycleCount: number;
  totalOpportunities: number;
  lastCycleTime: string | null;
  nextCycleTime: string | null;
}

export interface BackgroundStatusResponse {
  daemon: {
    running: boolean;
  };
  scheduler: {
    tasks: SchedulerTaskRecord[];
  };
  autonomous: BackgroundAutonomousStatus;
}

export function buildBackgroundTaskTreeSignature(input: BackgroundStatusResponse | null): string {
  if (!input) {
    return "offline";
  }

  const tasks = sortSchedulerTasks(input.scheduler.tasks);
  return JSON.stringify({
    daemon: input.daemon.running,
    scheduler: tasks.map((task) => ({
      taskId: task.taskId,
      enabled: task.enabled,
      cronExpr: task.cronExpr,
      nextRunAt: task.nextRunAt,
      lastRunAt: task.lastRunAt,
    })),
    autonomous: {
      isRunning: input.autonomous.isRunning,
      isPaused: input.autonomous.isPaused,
      mandateId: input.autonomous.mandate?.id ?? null,
      timeframe: input.autonomous.mandate?.timeframe ?? null,
      symbols: input.autonomous.mandate?.symbols ?? [],
      cycleCount: input.autonomous.cycleCount,
      totalOpportunities: input.autonomous.totalOpportunities,
      lastCycleTime: input.autonomous.lastCycleTime,
      nextCycleTime: input.autonomous.nextCycleTime,
    },
  });
}

const BUILT_IN_TASK_LABELS: Record<string, string> = {
  "__health_check": "Health check",
  "__circuit_breaker_eval": "Circuit breaker evaluation",
  "__regime_check": "Regime check",
  "__evolution_tick": "Evolution tick",
  "__capital_refresh": "Capital refresh",
  "__autonomous_cycle": "Autonomous cycle trigger",
};

function createNode(
  id: string,
  parentId: string | null,
  kind: TaskTreeNode["kind"],
  label: string,
  status: TaskTreeNode["status"],
  detail?: string,
): TaskTreeNode {
  const now = Date.now();
  return {
    id,
    parentId,
    kind,
    label,
    status,
    detail,
    startedAt: now,
    endedAt: status === "running" || status === "pending" || status === "queued" ? undefined : now,
  };
}

function humanizeTaskId(taskId: string): string {
  return taskId
    .replace(/^__/, "")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatShortTime(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatSchedulerTaskDetail(task: SchedulerTaskRecord): string {
  const parts = [task.cronExpr];
  const nextRun = formatShortTime(task.nextRunAt);
  const lastRun = formatShortTime(task.lastRunAt);
  if (nextRun) {
    parts.push(`next ${nextRun}`);
  }
  if (lastRun) {
    parts.push(`last ${lastRun}`);
  }
  return parts.join(" · ");
}

function getSchedulerTaskStatus(task: SchedulerTaskRecord): TaskTreeNode["status"] {
  if (!task.enabled) return "blocked";
  return "queued";
}

function sortSchedulerTasks(tasks: SchedulerTaskRecord[]): SchedulerTaskRecord[] {
  return [...tasks].sort((left, right) => {
    const leftBuiltIn = left.taskId.startsWith("__");
    const rightBuiltIn = right.taskId.startsWith("__");
    if (leftBuiltIn !== rightBuiltIn) {
      return leftBuiltIn ? -1 : 1;
    }
    return left.taskId.localeCompare(right.taskId);
  });
}

function formatAutonomousDetail(status: BackgroundAutonomousStatus): string {
  if (!status.isRunning) {
    return "No active mandate";
  }

  const parts: string[] = [];
  if (status.mandate?.timeframe) {
    parts.push(status.mandate.timeframe);
  }
  if (status.mandate?.symbols && status.mandate.symbols.length > 0) {
    parts.push(`${status.mandate.symbols.length} symbol${status.mandate.symbols.length === 1 ? "" : "s"}`);
  }
  parts.push(`${status.cycleCount} cycle${status.cycleCount === 1 ? "" : "s"}`);
  if (status.totalOpportunities > 0) {
    parts.push(`${status.totalOpportunities} opportunities`);
  }
  const nextCycle = formatShortTime(status.nextCycleTime);
  if (nextCycle) {
    parts.push(`next ${nextCycle}`);
  }
  return parts.join(" · ");
}

function getAutonomousStatus(status: BackgroundAutonomousStatus): TaskTreeNode["status"] {
  if (!status.isRunning) return "pending";
  if (status.isPaused) return "blocked";
  return "running";
}

export function buildBackgroundTaskTree(input: BackgroundStatusResponse | null): TaskTreeState | null {
  if (!input?.daemon.running) {
    return null;
  }

  const runId = `background_${Date.now()}`;
  const rootId = "background_root";
  const daemonId = "background_daemon";
  const schedulerId = "background_scheduler";
  const autonomousId = "background_autonomous";
  const sortedTasks = sortSchedulerTasks(input.scheduler.tasks);

  const nodes: TaskTreeNode[] = [
    createNode(
      rootId,
      null,
      "request",
      "Background work",
      "running",
      `${sortedTasks.length} scheduled task${sortedTasks.length === 1 ? "" : "s"}`,
    ),
    createNode(
      daemonId,
      rootId,
      "family",
      "Daemon",
      "running",
      "Local background services online",
    ),
    createNode(
      schedulerId,
      daemonId,
      "family",
      "Scheduler",
      "running",
      `${sortedTasks.length} task${sortedTasks.length === 1 ? "" : "s"} registered`,
    ),
    createNode(
      autonomousId,
      daemonId,
      "family",
      "Autonomous swing trading",
      getAutonomousStatus(input.autonomous),
      formatAutonomousDetail(input.autonomous),
    ),
  ];

  for (const task of sortedTasks) {
    const label = BUILT_IN_TASK_LABELS[task.taskId] ?? humanizeTaskId(task.taskId);
    nodes.push(
      createNode(
        `background_task_${task.taskId}`,
        schedulerId,
        "tool",
        label,
        getSchedulerTaskStatus(task),
        formatSchedulerTaskDetail(task),
      ),
    );
  }

  return {
    runId,
    rootId,
    inputPreview: "Background work",
    nodes,
  };
}
