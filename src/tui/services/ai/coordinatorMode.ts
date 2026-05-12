// ============================================================================
// Coordinator Mode — Multi-agent orchestration for parallel analysis
//
// Spawns workers (technical, sentiment, risk), tracks their status,
// and synthesizes results. Workers report via structured notifications.
// ============================================================================

export type WorkerStatus = "pending" | "running" | "completed" | "failed" | "dismissed";

export interface WorkerTask {
  id: string;
  role: string;
  task: string;
  status: WorkerStatus;
  startedAt: number;
  completedAt?: number;
  tokenCount: number;
  cost: number;
  result?: string;
  error?: string;
}

type Listener = () => void;

let idCounter = 0;

export class CoordinatorManager {
  private workers: Map<string, WorkerTask> = new Map();
  private listeners = new Set<Listener>();

  spawnWorker(role: string, task: string): WorkerTask {
    const id = `worker_${++idCounter}_${Date.now()}`;
    const worker: WorkerTask = {
      id,
      role,
      task,
      status: "pending",
      startedAt: Date.now(),
      tokenCount: 0,
      cost: 0,
    };
    this.workers.set(id, worker);
    this.notify();
    return worker;
  }

  getWorkers(): WorkerTask[] {
    return [...this.workers.values()];
  }

  getActiveWorkers(): WorkerTask[] {
    return this.getWorkers().filter((w) => w.status === "pending" || w.status === "running");
  }

  updateWorkerStatus(id: string, status: WorkerStatus, result?: string): void {
    const worker = this.workers.get(id);
    if (!worker) return;
    worker.status = status;
    if (result) worker.result = result;
    if (status === "completed" || status === "failed") {
      worker.completedAt = Date.now();
    }
    this.notify();
  }

  dismissWorker(id: string): void {
    this.workers.delete(id);
    this.notify();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

let instance: CoordinatorManager | null = null;

export function getCoordinator(): CoordinatorManager {
  if (!instance) instance = new CoordinatorManager();
  return instance;
}
