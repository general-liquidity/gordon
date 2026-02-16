import { createModuleLogger } from "../../infra/logger/index.ts";
import { bootstrapV07 } from "../../core/bootstrap.ts";
import { createEnvelopeMeta, type GatewayCommandType } from "../protocol/index.ts";
import { safeAppendAudit } from "../store/audit-log-store.ts";
import { GatewayRuntime, GatewayContextResolver } from "../runtime/index.ts";
import { startGatewayIpcServer } from "./ipc.ts";
import { LocalCronScheduler } from "../scheduler/index.ts";
import { ReconciliationLoop } from "../reconciliation/index.ts";
import { getOrCreateDaemonToken } from "../security/index.ts";
import { initMCPTools, enableMCPHotReload, disableMCPHotReload } from "../../infra/mcp/client.ts";

const logger = createModuleLogger("gateway-daemon");

export interface GatewayDaemonHandle {
  stop: () => Promise<void>;
  socketPath: string;
  authToken: string;
}

export async function startGatewayDaemonProcess(): Promise<GatewayDaemonHandle> {
  await bootstrapV07();
  await initMCPTools().catch(() => ({}));
  enableMCPHotReload(5000);

  const contextResolver = new GatewayContextResolver();
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

  const authToken = await getOrCreateDaemonToken();
  const ipc = await startGatewayIpcServer({ runtime });

  const scheduler = new LocalCronScheduler(async (task) => {
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
  });
  scheduler.start();

  const reconciler = new ReconciliationLoop(async () => {
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
  reconciler.start();

  safeAppendAudit({
    eventType: "daemon.started",
    actor: "daemon",
    payload: { socketPath: ipc.socketPath },
  });

  logger.info("Gateway daemon started", {
    socketPath: ipc.socketPath,
    scheduler: scheduler.isRunning(),
    reconciliationLoop: reconciler.isRunning(),
  });

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    reconciler.stop();
    scheduler.stop();
    disableMCPHotReload();
    await ipc.close();
    safeAppendAudit({
      eventType: "daemon.stopped",
      actor: "daemon",
      payload: { socketPath: ipc.socketPath },
    });
    logger.info("Gateway daemon stopped");
  };

  stopSelf = stop;

  return {
    socketPath: ipc.socketPath,
    authToken,
    stop,
  };
}
