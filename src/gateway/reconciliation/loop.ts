import { createModuleLogger } from "../../infra/logger/index.ts";

const logger = createModuleLogger("gateway-reconciliation-loop");

export interface ReconciliationLoopOptions {
  intervalMs?: number;
}

export class ReconciliationLoop {
  private timer: ReturnType<typeof setInterval> | null = null;
  private runPromise: Promise<void> | null = null;
  private readonly intervalMs: number;
  private readonly onRun: () => Promise<void>;

  constructor(onRun: () => Promise<void>, options: ReconciliationLoopOptions = {}) {
    this.onRun = onRun;
    this.intervalMs = options.intervalMs ?? 5 * 60 * 1000;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.intervalMs);
    logger.info("Reconciliation loop started", { intervalMs: this.intervalMs });
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.runPromise = null;
    logger.info("Reconciliation loop stopped");
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  private runOnce(): Promise<void> {
    if (this.runPromise) {
      logger.debug("Skipping reconciliation tick because previous run is still active");
      return this.runPromise;
    }

    const pending = this.onRun()
      .catch((error) => {
        logger.error("Reconciliation loop iteration failed", error as Error);
      })
      .finally(() => {
        if (this.runPromise === pending) {
          this.runPromise = null;
        }
      });

    this.runPromise = pending;
    return pending;
  }
}
