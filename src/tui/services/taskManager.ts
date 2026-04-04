// ============================================================================
// Task Manager — Background task lifecycle management
//
// Task types: analysis, backtest, strategy, dream, shell.
// States: pending → running → completed/failed/killed.
// ============================================================================

export type TaskType = "analysis" | "backtest" | "strategy" | "dream" | "shell";
export type TaskStatus = "pending" | "running" | "completed" | "failed" | "killed";

export interface ManagedTask {
  id: string;
  type: TaskType;
  title: string;
  status: TaskStatus;
  startedAt: number;
  completedAt?: number;
  result?: any;
  error?: string;
  isBackgrounded: boolean;
}

type Listener = () => void;

let idCounter = 0;

export class TaskManager {
  private tasks: Map<string, ManagedTask> = new Map();
  private listeners = new Set<Listener>();

  createTask(type: TaskType, title: string, execute: () => Promise<any>): ManagedTask {
    const id = `task_${++idCounter}_${Date.now()}`;
    const task: ManagedTask = {
      id,
      type,
      title,
      status: "running",
      startedAt: Date.now(),
      isBackgrounded: false,
    };
    this.tasks.set(id, task);
    this.notify();

    // Run the task
    execute()
      .then((result) => {
        task.status = "completed";
        task.result = result;
        task.completedAt = Date.now();
        this.notify();
      })
      .catch((err) => {
        task.status = "failed";
        task.error = err instanceof Error ? err.message : String(err);
        task.completedAt = Date.now();
        this.notify();
      });

    return task;
  }

  listTasks(): ManagedTask[] {
    return [...this.tasks.values()];
  }

  getTask(id: string): ManagedTask | null {
    return this.tasks.get(id) ?? null;
  }

  killTask(id: string): void {
    const task = this.tasks.get(id);
    if (task && (task.status === "running" || task.status === "pending")) {
      task.status = "killed";
      task.completedAt = Date.now();
      this.notify();
    }
  }

  backgroundTask(id: string): void {
    const task = this.tasks.get(id);
    if (task) {
      task.isBackgrounded = true;
      this.notify();
    }
  }

  foregroundTask(id: string): void {
    const task = this.tasks.get(id);
    if (task) {
      task.isBackgrounded = false;
      this.notify();
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

let instance: TaskManager | null = null;

export function getTaskManager(): TaskManager {
  if (!instance) instance = new TaskManager();
  return instance;
}
