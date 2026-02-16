import { createModuleLogger } from "../../infra/logger/index.ts";
import {
  listSchedulerTasks,
  updateSchedulerTaskRunState,
  type SchedulerTaskRecord,
} from "../store/scheduler-store.ts";

const logger = createModuleLogger("gateway-cron");

function parseEveryExpression(expr: string): number | null {
  const trimmed = expr.trim();
  const every = trimmed.match(/^@every\s+(\d+)\s*([smhd])$/i);
  if (every) {
    const value = Number(every[1]);
    const unit = every[2]?.toLowerCase();
    if (!Number.isFinite(value) || value <= 0) return null;
    if (unit === "s") return value * 1000;
    if (unit === "m") return value * 60 * 1000;
    if (unit === "h") return value * 60 * 60 * 1000;
    if (unit === "d") return value * 24 * 60 * 60 * 1000;
  }

  if (trimmed === "@hourly") return 60 * 60 * 1000;
  if (trimmed === "@daily") return 24 * 60 * 60 * 1000;

  // Minimal cron support for expressions like "*/5 * * * *"
  const stepMinute = trimmed.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
  if (stepMinute) {
    const step = Number(stepMinute[1]);
    if (Number.isFinite(step) && step > 0) {
      return step * 60 * 1000;
    }
  }

  return null;
}

export function computeNextRunAt(cronExpr: string, from = new Date()): string {
  const intervalMs = parseEveryExpression(cronExpr) ?? 60 * 60 * 1000;
  return new Date(from.getTime() + intervalMs).toISOString();
}

export interface LocalCronSchedulerOptions {
  tickIntervalMs?: number;
}

export class LocalCronScheduler {
  private readonly tickIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly onTrigger: (task: SchedulerTaskRecord) => Promise<void>;
  private running = false;

  constructor(
    onTrigger: (task: SchedulerTaskRecord) => Promise<void>,
    options: LocalCronSchedulerOptions = {},
  ) {
    this.onTrigger = onTrigger;
    this.tickIntervalMs = options.tickIntervalMs ?? 5_000;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => {
      this.tick().catch((error) => {
        logger.error("Scheduler tick failed", error as Error);
      });
    }, this.tickIntervalMs);
    logger.info("Local cron scheduler started", { tickIntervalMs: this.tickIntervalMs });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
    logger.info("Local cron scheduler stopped");
  }

  isRunning(): boolean {
    return this.running;
  }

  async tick(now = new Date()): Promise<number> {
    const tasks = listSchedulerTasks();
    const due = tasks.filter((task) => {
      if (!task.enabled) return false;
      if (!task.nextRunAt) return true;
      return Date.parse(task.nextRunAt) <= now.getTime();
    });

    for (const task of due) {
      await this.onTrigger(task);
      const lastRunAt = now.toISOString();
      const nextRunAt = computeNextRunAt(task.cronExpr, now);
      updateSchedulerTaskRunState(task.taskId, { lastRunAt, nextRunAt });
      logger.debug("Scheduler task triggered", { taskId: task.taskId, nextRunAt });
    }

    return due.length;
  }
}

