/**
 * Parallel Startup
 *
 * Claude Code pattern: spawn heavy startup tasks in parallel during import
 * time. Config loading, OAuth token refresh, MCP server init, and exchange
 * pings all happen concurrently instead of sequentially.
 *
 * Usage: Call `runParallelStartup()` early in the boot sequence. It returns
 * a StartupResult promise that resolves when all tasks are done (or timed out).
 * Individual task results are available even if some fail.
 */

import { createModuleLogger } from "../logger/index.ts";

const logger = createModuleLogger("parallel-startup");

// ============================================================================
// Types
// ============================================================================

export interface StartupTask<T = unknown> {
  id: string;
  label: string;
  /** The async work to run. */
  run: () => Promise<T>;
  /** If true, failure of this task doesn't fail the overall startup. Default true. */
  optional?: boolean;
  /** Max time before this task is killed. Default 10s. */
  timeoutMs?: number;
}

export interface TaskResult<T = unknown> {
  id: string;
  label: string;
  success: boolean;
  result?: T;
  error?: string;
  durationMs: number;
  timedOut: boolean;
}

export interface StartupResult {
  totalDurationMs: number;
  tasks: TaskResult[];
  /** True if all required (non-optional) tasks succeeded. */
  allRequiredSucceeded: boolean;
}

// ============================================================================
// Executor
// ============================================================================

/**
 * Run a set of startup tasks in parallel with per-task timeouts.
 */
export async function runParallelStartup(tasks: StartupTask[]): Promise<StartupResult> {
  const start = Date.now();

  logger.info(`Starting ${tasks.length} parallel startup tasks`, {
    tasks: tasks.map((t) => t.id),
  });

  const promises = tasks.map((task) => executeWithTimeout(task));
  const results = await Promise.all(promises);

  const totalDurationMs = Date.now() - start;
  const allRequiredSucceeded = results.every(
    (r) => r.success || tasks.find((t) => t.id === r.id)?.optional !== false,
  );

  const failedRequired = results.filter(
    (r) => !r.success && tasks.find((t) => t.id === r.id)?.optional === false,
  );

  if (failedRequired.length > 0) {
    logger.error("Required startup tasks failed", {
      failed: failedRequired.map((r) => `${r.id}: ${r.error}`),
    });
  }

  logger.info(`Parallel startup complete in ${totalDurationMs}ms`, {
    succeeded: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    timedOut: results.filter((r) => r.timedOut).length,
  });

  return { totalDurationMs, tasks: results, allRequiredSucceeded };
}

async function executeWithTimeout<T>(task: StartupTask<T>): Promise<TaskResult<T>> {
  const timeoutMs = task.timeoutMs ?? 10_000;
  const start = Date.now();

  try {
    const result = await Promise.race([task.run(), timeout(timeoutMs)]);

    if (result === TIMEOUT_SENTINEL) {
      logger.warn(`Startup task '${task.id}' timed out after ${timeoutMs}ms`);
      return {
        id: task.id,
        label: task.label,
        success: false,
        error: `Timed out after ${timeoutMs}ms`,
        durationMs: Date.now() - start,
        timedOut: true,
      };
    }

    return {
      id: task.id,
      label: task.label,
      success: true,
      result: result as T,
      durationMs: Date.now() - start,
      timedOut: false,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.warn(`Startup task '${task.id}' failed: ${errorMsg}`);
    return {
      id: task.id,
      label: task.label,
      success: false,
      error: errorMsg,
      durationMs: Date.now() - start,
      timedOut: false,
    };
  }
}

const TIMEOUT_SENTINEL = Symbol("timeout");

function timeout(ms: number): Promise<typeof TIMEOUT_SENTINEL> {
  return new Promise((resolve) => setTimeout(() => resolve(TIMEOUT_SENTINEL), ms));
}

// ============================================================================
// Pre-built Task Factories
// ============================================================================

/** Create a startup task for loading config. */
export function configLoadTask(loader: () => Promise<unknown>): StartupTask {
  return {
    id: "config",
    label: "Load configuration",
    run: loader,
    optional: false,
    timeoutMs: 5_000,
  };
}

/** Create a startup task for refreshing OAuth tokens. */
export function oauthRefreshTask(refresher: () => Promise<unknown>): StartupTask {
  return {
    id: "oauth-refresh",
    label: "Refresh OAuth tokens",
    run: refresher,
    optional: true,
    timeoutMs: 10_000,
  };
}

/** Create a startup task for initializing MCP servers. */
export function mcpInitTask(init: () => Promise<unknown>): StartupTask {
  return {
    id: "mcp-init",
    label: "Initialize MCP servers",
    run: init,
    optional: true,
    timeoutMs: 15_000,
  };
}

/** Create a startup task for testing exchange connectivity. */
export function exchangePingTask(exchangeId: string, ping: () => Promise<unknown>): StartupTask {
  return {
    id: `ping-${exchangeId}`,
    label: `Ping ${exchangeId}`,
    run: ping,
    optional: true,
    timeoutMs: 8_000,
  };
}

/** Create a startup task for loading session memory. */
export function memoryLoadTask(loader: () => Promise<unknown>): StartupTask {
  return {
    id: "memory",
    label: "Load session memory",
    run: loader,
    optional: true,
    timeoutMs: 3_000,
  };
}
