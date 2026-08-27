import { createModuleLogger } from "../../infra/logger/index.ts";
import { installProductionGuards } from "../../infra/safety/installProductionGuards.ts";
import { bootstrapV07 } from "../../core/lifecycle/bootstrap.ts";
import { createEnvelopeMeta, type GatewayCommandType } from "../protocol/index.ts";
import { safeAppendAudit } from "../store/audit-log-store.ts";
import { GatewayRuntime, getGatewayContextResolver } from "../runtime/index.ts";
import { startGatewayIpcServer } from "./ipc.ts";
import { LocalCronScheduler, computeNextRunAt } from "../scheduler/index.ts";
import { ReconciliationLoop } from "../reconciliation/index.ts";
import { getOrCreateDaemonToken } from "../security/index.ts";
import {
  initMCPTools,
  enableMCPHotReload,
  disableMCPHotReload,
} from "../../infra/ai/mcp/client.ts";
import { StrategyRuntime } from "../../core/runtime/engine.ts";
import { upsertSchedulerTask } from "../store/scheduler-store.ts";
import { resetOrphanedRunningCommands } from "../store/command-queue-store.ts";
import { appendActionLogEntry } from "../../infra/action-log/index.ts";
import { reconcileWithExchange } from "../../services/reconciliation-exchange.service.ts";
import { repairProtectiveOrders } from "../../core/pipeline/executor.ts";
import { listPlans } from "../../infra/storage/entities/plans.ts";
import { closeDatabase } from "../../infra/storage/database.ts";
import { resetMemoryManager } from "../../core/memory/index.ts";
import { resetSubscriptionRegistry } from "../../events/index.ts";

const logger = createModuleLogger("gateway-daemon");

function safeAppendActionLog(input: Parameters<typeof appendActionLogEntry>[0]): void {
  try {
    appendActionLogEntry(input);
  } catch (error) {
    logger.warn("Daemon action-log write failed", {
      title: input.title,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export interface GatewayDaemonHandle {
  stop: () => Promise<void>;
  socketPath: string;
  authToken: string;
}

export interface GatewayDaemonStartOptions {
  socketPath?: string;
  /**
   * Exercise bootstrap, stores, runtime, scheduler and IPC without loading
   * MCP servers or resolving an execution venue. Intended for isolated
   * startup validation only.
   */
  validationOnly?: boolean;
}

export async function startGatewayDaemonProcess(
  options: GatewayDaemonStartOptions = {},
): Promise<GatewayDaemonHandle> {
  const validationOnly = options.validationOnly ?? false;
  installProductionGuards();
  await bootstrapV07();

  // A previous daemon process that crashed mid-execution leaves queue entries
  // stuck in 'running', blocking that session forever. Recover them before
  // any command processing can start.
  const orphanReset = resetOrphanedRunningCommands();
  if (orphanReset.requeued > 0 || orphanReset.failed > 0) {
    logger.warn("Recovered orphaned running queue entries from previous daemon process", {
      requeued: orphanReset.requeued,
      failed: orphanReset.failed,
      entries: orphanReset.entries,
    });
    safeAppendAudit({
      eventType: "daemon.queue_orphans_reset",
      actor: "daemon",
      payload: {
        requeued: orphanReset.requeued,
        failed: orphanReset.failed,
        entries: orphanReset.entries,
      },
    });
  }

  const contextResolver = getGatewayContextResolver();
  let stopSelf: (() => Promise<void>) | null = null;
  let shutdownRequested = false;
  const requestShutdown = (): void => {
    if (shutdownRequested) return;
    shutdownRequested = true;
    // Delay shutdown slightly so IPC can flush daemon.shutdown response.
    setTimeout(() => {
      Promise.resolve(stopSelf?.())
        .catch((error) => logger.error("Daemon shutdown cleanup failed", error as Error))
        .finally(() => process.exit(0));
    }, 50);
  };
  const runtime = new GatewayRuntime({
    resolveContext: (sessionId) => contextResolver.resolve(sessionId),
    requireAuth: true,
    onDaemonShutdown: requestShutdown,
  });

  // Initialize StrategyRuntime and sync capital from exchange. Validation
  // mode deliberately never resolves a venue, making account reads and order
  // repair structurally unreachable.
  const strategyRuntime = StrategyRuntime.getInstance();
  if (!validationOnly) {
    try {
      const initCtx = await contextResolver.resolve("daemon");
      if (initCtx.exchange) {
        const details = await initCtx.exchange.getFullAccountDetails();
        // Support multiple quote currencies (USDT, USDC, EUR, etc.)
        const totalCapital =
          details.totalUsdtValue ??
          (details as any).totalUsdcValue ??
          (details as any).totalValue ??
          0;
        if (totalCapital === 0) {
          logger.warn(
            "Could not determine total capital — no supported quote currency found in account details",
          );
        }
        strategyRuntime.setTotalCapital(totalCapital);
        logger.info("StrategyRuntime initialized with exchange equity", {
          totalCapital: totalCapital.toFixed(2),
        });
      }
    } catch (error) {
      logger.warn("Could not sync initial capital from exchange", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Synchronous startup reconciliation: positions/orders state must be
  // trusted before the IPC server or scheduler can run any new commands.
  // After reconciling, repair protective orders (stops/TPs) for every plan
  // that was mid-execution when the previous process died.
  if (!validationOnly) {
    try {
      const startupCtx = await contextResolver.resolve("daemon");
      if (startupCtx.exchange) {
        const reconciliation = await reconcileWithExchange(startupCtx.exchange);
        logger.info("Startup reconciliation complete", {
          success: reconciliation.success,
          tradesReconciled: reconciliation.tradesReconciled,
          ordersUpdated: reconciliation.ordersUpdated,
          errors: reconciliation.errors.length,
          warnings: reconciliation.warnings.length,
        });
        safeAppendAudit({
          eventType: "daemon.startup_reconciliation",
          actor: "daemon",
          payload: {
            success: reconciliation.success,
            tradesReconciled: reconciliation.tradesReconciled,
            ordersUpdated: reconciliation.ordersUpdated,
            errors: reconciliation.errors,
            warnings: reconciliation.warnings,
          },
        });

        for (const plan of listPlans({ status: "EXECUTING" })) {
          try {
            const repair = await repairProtectiveOrders(plan.id, startupCtx.exchange);
            logger.info("Protective-order repair after restart", {
              planId: plan.id,
              repaired: repair.repaired,
              placed: repair.placed,
              reason: repair.reason,
            });
            safeAppendAudit({
              eventType: "daemon.protective_orders_repaired",
              actor: "daemon",
              payload: { planId: plan.id, ...repair },
            });
          } catch (error) {
            logger.error("Protective-order repair failed", error as Error, { planId: plan.id });
          }
        }
      } else {
        logger.warn("Startup reconciliation skipped — no exchange configured");
      }
    } catch (error) {
      logger.error(
        "Startup reconciliation failed — local state may be stale until the next reconciliation cycle",
        error as Error,
      );
      safeAppendAudit({
        eventType: "daemon.startup_reconciliation_failed",
        actor: "daemon",
        payload: { error: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  let authToken = "";
  let ipc: Awaited<ReturnType<typeof startGatewayIpcServer>> | null = null;
  let scheduler: LocalCronScheduler | null = null;
  let reconciler: ReconciliationLoop | null = null;
  let mcpHotReloadEnabled = false;
  let cleanedUp = false;

  const cleanup = async (announceStop: boolean): Promise<unknown[]> => {
    if (cleanedUp) return [];
    cleanedUp = true;
    const failures: unknown[] = [];
    const attempt = (operation: () => void): void => {
      try {
        operation();
      } catch (error) {
        failures.push(error);
      }
    };
    if (reconciler) attempt(() => reconciler?.stop());
    if (scheduler) attempt(() => scheduler?.stop());
    if (mcpHotReloadEnabled) {
      attempt(() => disableMCPHotReload());
      mcpHotReloadEnabled = false;
    }
    if (ipc) {
      try {
        await ipc.close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (announceStop && ipc) {
      safeAppendAudit({
        eventType: "daemon.stopped",
        actor: "daemon",
        payload: { socketPath: ipc.socketPath },
      });
      safeAppendActionLog({
        sessionId: "daemon",
        resourceId: "daemon",
        entryType: "daemon_event",
        title: "Daemon stopped",
        content: `Gateway daemon stopped on ${ipc.socketPath}`,
        payload: { socketPath: ipc.socketPath },
      });
    }
    try {
      await runtime.disposeAsync();
    } catch (error) {
      failures.push(error);
    }
    attempt(() => resetSubscriptionRegistry());
    attempt(() => resetMemoryManager());
    attempt(() => closeDatabase());
    return failures;
  };

  try {
    if (!validationOnly) {
      await initMCPTools().catch((err) => {
        logger.warn("MCP tools initialization failed — MCP tools will be unavailable", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
      // Mark first so a partially initialized watcher is disabled if its
      // constructor throws after acquiring a timer or filesystem handle.
      mcpHotReloadEnabled = true;
      enableMCPHotReload(5000);
    }
    authToken = await getOrCreateDaemonToken();

    ipc = await startGatewayIpcServer({
      runtime,
      ...(options.socketPath ? { socketPath: options.socketPath } : {}),
    });

    scheduler = new LocalCronScheduler(
      async (task) => {
        const envelope = {
          meta: createEnvelopeMeta({
            sessionId: "daemon",
            source: "scheduler",
          }),
          command: {
            type: task.commandType as GatewayCommandType,
            payload: task.payload,
          },
        };
        await runtime.submitCommand(envelope, { token: authToken, processImmediately: true });
      },
      {
        shouldRun: validationOnly ? (task) => task.taskId === "__health_check" : undefined,
      },
    );

    // Validation mode exercises the scheduler with the inert health task only.
    // Autonomous/evolution/capital tasks are absent rather than merely relying
    // on the short validation window to end before their first tick.
    upsertSchedulerTask({
      taskId: "__health_check",
      cronExpr: "@every 30s",
      commandType: "runtime.health_check",
      payload: {},
      enabled: true,
      nextRunAt: computeNextRunAt("@every 30s"),
    });
    if (!validationOnly) {
      upsertSchedulerTask({
        taskId: "__circuit_breaker_eval",
        cronExpr: "@every 60s",
        commandType: "circuit_breaker.evaluate",
        payload: {},
        enabled: true,
        nextRunAt: computeNextRunAt("@every 60s"),
      });
      upsertSchedulerTask({
        taskId: "__regime_check",
        cronExpr: "@every 5m",
        commandType: "regime.check",
        payload: {},
        enabled: true,
        nextRunAt: computeNextRunAt("@every 5m"),
      });
      upsertSchedulerTask({
        taskId: "__evolution_tick",
        cronExpr: "@every 1h",
        commandType: "evolution.tick",
        payload: {},
        enabled: true,
        nextRunAt: computeNextRunAt("@every 1h"),
      });
      upsertSchedulerTask({
        taskId: "__capital_refresh",
        cronExpr: "@every 5m",
        commandType: "capital.refresh",
        payload: {},
        enabled: true,
        nextRunAt: computeNextRunAt("@every 5m"),
      });
      upsertSchedulerTask({
        taskId: "__autonomous_cycle",
        cronExpr: "@every 15m",
        commandType: "autonomous.run_cycle",
        payload: {},
        enabled: true,
        nextRunAt: computeNextRunAt("@every 15m"),
      });
    }

    if (validationOnly) {
      // Drive the real scheduler once instead of only proving its timer starts.
      // Its task predicate is the containment boundary for stale persisted tasks.
      await scheduler.tick(new Date(Date.now() + 31_000));
    }
    scheduler.start();

    reconciler = new ReconciliationLoop(async () => {
      const envelope = {
        meta: createEnvelopeMeta({
          sessionId: "daemon",
          source: "reconciler",
        }),
        command: {
          type: "reconcile.run" as const,
          payload: { force: false },
        },
      };
      await runtime.submitCommand(envelope, { token: authToken, processImmediately: true });
    });
    if (!validationOnly) reconciler.start();

    safeAppendAudit({
      eventType: "daemon.started",
      actor: "daemon",
      payload: { socketPath: ipc.socketPath, validationOnly },
    });
    safeAppendActionLog({
      sessionId: "daemon",
      resourceId: "daemon",
      entryType: "daemon_event",
      title: "Daemon started",
      content: `Gateway daemon started on ${ipc.socketPath}`,
      payload: {
        socketPath: ipc.socketPath,
        builtInSchedulerTasks: validationOnly ? ["__health_check"] : listBuiltInTaskIds(),
        validationOnly,
      },
    });

    logger.info("Gateway daemon started", {
      socketPath: ipc.socketPath,
      scheduler: scheduler.isRunning(),
      reconciliationLoop: reconciler.isRunning(),
      validationOnly,
    });

    const stop = async (): Promise<void> => {
      const failures = await cleanup(true);
      logger.info("Gateway daemon stopped");
      if (failures.length > 0) {
        throw new AggregateError(failures, "Gateway daemon stopped with cleanup failures");
      }
    };

    stopSelf = stop;

    return {
      socketPath: ipc.socketPath,
      authToken,
      stop,
    };
  } catch (error) {
    const failures = await cleanup(false);
    throw new AggregateError(
      [error, ...failures],
      failures.length > 0
        ? "Gateway daemon startup failed and cleanup also reported failures"
        : "Gateway daemon startup failed; initialized resources were rolled back",
    );
  }
}

function listBuiltInTaskIds(): string[] {
  return [
    "__health_check",
    "__circuit_breaker_eval",
    "__regime_check",
    "__evolution_tick",
    "__capital_refresh",
    "__autonomous_cycle",
  ];
}
