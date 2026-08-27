// ============================================================================
// Skills — /loop for recurring cron, /batch for parallel orchestration
// ============================================================================

export interface LoopTask {
  id: string;
  command: string;
  intervalMs: number;
  lastRunAt: number;
  nextRunAt: number;
  runCount: number;
  status: "running" | "paused" | "stopped";
}
export interface BatchTask {
  id: string;
  commands: string[];
  results: any[];
  status: "running" | "completed" | "failed";
}

export class SkillRunner {
  private loops = new Map<string, { task: LoopTask; timer: ReturnType<typeof setInterval> }>();
  private batches = new Map<string, BatchTask>();

  runLoop(command: string, intervalMs: number): LoopTask {
    const id = `loop_${Date.now()}`;
    const task: LoopTask = {
      id,
      command,
      intervalMs,
      lastRunAt: 0,
      nextRunAt: Date.now() + intervalMs,
      runCount: 0,
      status: "running",
    };
    const timer = setInterval(() => {
      task.lastRunAt = Date.now();
      task.nextRunAt = Date.now() + intervalMs;
      task.runCount++;
    }, intervalMs);
    this.loops.set(id, { task, timer });
    return task;
  }

  runBatch(commands: string[]): BatchTask {
    const id = `batch_${Date.now()}`;
    const task: BatchTask = { id, commands, results: [], status: "running" };
    this.batches.set(id, task);
    // Would execute commands in parallel
    setTimeout(() => {
      task.status = "completed";
    }, 1000);
    return task;
  }

  stopLoop(taskId: string): void {
    const entry = this.loops.get(taskId);
    if (entry) {
      clearInterval(entry.timer);
      entry.task.status = "stopped";
      this.loops.delete(taskId);
    }
  }

  stopBatch(taskId: string): void {
    this.batches.delete(taskId);
  }

  listActive(): (LoopTask | BatchTask)[] {
    return [...[...this.loops.values()].map((e) => e.task), ...this.batches.values()];
  }
}
