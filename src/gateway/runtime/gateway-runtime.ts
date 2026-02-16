import { createModuleLogger } from "../../infra/logger/index.ts";
import { loadConfig, saveConfig } from "../../infra/storage/config.ts";
import { processMessage, quickCheckPositions, quickScan } from "../../infra/agents/orchestrator.ts";
import type { GordonContext } from "../../infra/agents/types.ts";
import {
  createGatewayError,
  validateGatewayCommand,
  type GatewayCommandEnvelope,
  type GatewayCommandType,
} from "../protocol/index.ts";
import {
  completeIdempotencyKey,
  failIdempotencyKey,
  reserveIdempotencyKey,
  safeAppendAudit,
} from "../store/index.ts";
import {
  checkAndRegisterNonce,
  principalHasCapability,
  requiredCapabilityForCommand,
  resolvePrincipalFromToken,
} from "../security/index.ts";
import { CommandQueueManager } from "../queue/index.ts";
import {
  deleteSchedulerTask,
  listSchedulerTasks,
  upsertSchedulerTask,
} from "../store/scheduler-store.ts";
import { StrategyRuntime } from "../../core/runtime/engine.ts";
import { reconcileWithBinance } from "../../services/reconciliation.service.ts";
import { reloadMCPTools } from "../../infra/mcp/client.ts";
import { computeNextRunAt } from "../scheduler/index.ts";

const logger = createModuleLogger("gateway-runtime");

export interface GatewayCommandResponse {
  ok: boolean;
  correlationId: string;
  queueId?: number;
  data?: unknown;
  error?: ReturnType<typeof createGatewayError>;
}

export interface GatewayRuntimeDeps {
  resolveContext: (sessionId: string) => Promise<GordonContext>;
  requireAuth?: boolean;
  onDaemonShutdown?: () => Promise<void> | void;
}

export class GatewayRuntime {
  private readonly queue: CommandQueueManager;
  private readonly deps: Required<GatewayRuntimeDeps>;
  private readonly handlers = new Map<GatewayCommandType, (envelope: GatewayCommandEnvelope) => Promise<unknown>>();

  constructor(deps: GatewayRuntimeDeps) {
    this.deps = {
      requireAuth: deps.requireAuth ?? false,
      resolveContext: deps.resolveContext,
      onDaemonShutdown: deps.onDaemonShutdown ?? (() => undefined),
    };
    this.queue = new CommandQueueManager({
      maxPendingPerSession: 256,
      retryBackoffMs: 1_500,
    });
    this.registerDefaultHandlers();
  }

  private registerDefaultHandlers(): void {
    this.registerHandler("chat.send_message", async (envelope) => {
      const context = await this.deps.resolveContext(envelope.meta.sessionId);
      const payload = envelope.command.payload as { text: string; threadId?: string; resourceId?: string };
      const result = await processMessage(
        payload.text,
        context,
        payload.threadId ?? context.threadId,
        payload.resourceId ?? context.userId,
      );
      return result;
    });

    this.registerHandler("scan.run", async (envelope) => {
      const context = await this.deps.resolveContext(envelope.meta.sessionId);
      return quickScan({
        ...context,
        config: {
          ...context.config,
          preferences: {
            ...context.config.preferences,
            topNCoins: (envelope.command.payload as { topN?: number }).topN ?? context.config.preferences.topNCoins,
            defaultTimeframes:
              (envelope.command.payload as { timeframes?: string[] }).timeframes ??
              context.config.preferences.defaultTimeframes,
          },
        },
      });
    });

    this.registerHandler("monitor.run_cycle", async (envelope) => {
      const context = await this.deps.resolveContext(envelope.meta.sessionId);
      return quickCheckPositions(context);
    });

    this.registerHandler("system.arm", async (envelope) => {
      const payload = envelope.command.payload as { durationHours?: number; reason?: string };
      const config = await loadConfig();
      const expiresAt = new Date(Date.now() + (payload.durationHours ?? 1) * 60 * 60 * 1000).toISOString();
      const updated = { ...config, mode: "ARMED" as const, armedUntil: expiresAt };
      await saveConfig(updated);
      return { mode: updated.mode, armedUntil: updated.armedUntil, reason: payload.reason };
    });

    this.registerHandler("system.disarm", async (envelope) => {
      const payload = envelope.command.payload as { reason?: string };
      const config = await loadConfig();
      const updated = { ...config, mode: "SAFE" as const, armedUntil: null };
      await saveConfig(updated);
      return { mode: updated.mode, armedUntil: updated.armedUntil, reason: payload.reason };
    });

    this.registerHandler("scheduler.create_task", async (envelope) => {
      const payload = envelope.command.payload as {
        taskId: string;
        cron: string;
        commandType: GatewayCommandType;
        payload: Record<string, unknown>;
        enabled?: boolean;
      };
      return upsertSchedulerTask({
        taskId: payload.taskId,
        cronExpr: payload.cron,
        commandType: payload.commandType,
        payload: payload.payload,
        enabled: payload.enabled ?? true,
        nextRunAt: computeNextRunAt(payload.cron),
      });
    });

    this.registerHandler("scheduler.delete_task", async (envelope) => {
      const payload = envelope.command.payload as { taskId: string };
      return { deleted: deleteSchedulerTask(payload.taskId) };
    });

    this.registerHandler("scheduler.list_tasks", async () => {
      return { tasks: listSchedulerTasks() };
    });

    this.registerHandler("runtime.health_check", async () => {
      const runtime = StrategyRuntime.getInstance();
      const actions = runtime.runHealthCheck();
      return { actions, count: actions.length };
    });

    this.registerHandler("reconcile.run", async (envelope) => {
      const context = await this.deps.resolveContext(envelope.meta.sessionId);
      if (!context.binance) {
        throw new Error("Reconciliation requires Binance client credentials.");
      }
      return reconcileWithBinance(context.binance);
    });

    this.registerHandler("plugin.reload", async () => {
      const tools = await reloadMCPTools();
      return {
        reloaded: true,
        toolCount: Object.keys(tools).length,
      };
    });

    this.registerHandler("daemon.shutdown", async () => {
      await this.deps.onDaemonShutdown();
      return { shuttingDown: true };
    });

  }

  registerHandler(type: GatewayCommandType, handler: (envelope: GatewayCommandEnvelope) => Promise<unknown>): void {
    this.handlers.set(type, handler);
    this.queue.registerHandler(type, async ({ envelope }) => handler(envelope));
  }

  async submitCommand(
    commandInput: unknown,
    options: {
      token?: string;
      processImmediately?: boolean;
    } = {},
  ): Promise<GatewayCommandResponse> {
    const validated = validateGatewayCommand(commandInput);
    if (!validated.ok) {
      return {
        ok: false,
        correlationId: "n/a",
        error: validated.error,
      };
    }

    const envelope = validated.value;
    const capability = requiredCapabilityForCommand(envelope.command.type);

    if (this.deps.requireAuth) {
      const principal = await resolvePrincipalFromToken(options.token);
      if (!principal || !principalHasCapability(principal, capability)) {
        const error = createGatewayError("AUTH_REQUIRED", "Authentication required or capability missing.", {
          requiredCapability: capability,
          commandType: envelope.command.type,
        });
        this.logFailure(envelope, error.code, error.message);
        return { ok: false, correlationId: envelope.meta.correlationId, error };
      }
    }

    const replay = checkAndRegisterNonce({
      nonce: envelope.meta.requestId,
      sessionId: envelope.meta.sessionId,
      ttlSeconds: 300,
    });
    if (!replay.ok) {
      const error = createGatewayError("REPLAY_DETECTED", replay.reason ?? "Replay detected.");
      this.logFailure(envelope, error.code, error.message);
      return { ok: false, correlationId: envelope.meta.correlationId, error };
    }

    const idempotency = reserveIdempotencyKey({
      idempotencyKey: envelope.meta.idempotencyKey,
      sessionId: envelope.meta.sessionId,
      commandType: envelope.command.type,
      payload: envelope.command.payload,
    });
    if (idempotency.status === "conflict") {
      const error = createGatewayError("IDEMPOTENCY_CONFLICT", idempotency.reason);
      this.logFailure(envelope, error.code, error.message);
      return { ok: false, correlationId: envelope.meta.correlationId, error };
    }
    if (idempotency.status === "replayed") {
      return {
        ok: true,
        correlationId: envelope.meta.correlationId,
        data: idempotency.response,
      };
    }

    const queued = this.queue.enqueue(envelope);
    if (!queued.ok) {
      const error = createGatewayError(
        "QUEUE_BACKPRESSURE",
        "Queue limit reached for this session.",
        { ...queued.info },
        true,
      );
      this.logFailure(envelope, error.code, error.message);
      return { ok: false, correlationId: envelope.meta.correlationId, error };
    }

    safeAppendAudit({
      eventType: "command.accepted",
      actor: "gateway",
      correlationId: envelope.meta.correlationId,
      payload: {
        queueId: queued.queueId,
        commandType: envelope.command.type,
        sessionId: envelope.meta.sessionId,
      },
    });

    if (options.processImmediately !== false) {
      await this.queue.drainSession(envelope.meta.sessionId, 32);
    }

    const result = {
      accepted: true,
      queueId: queued.queueId,
      commandType: envelope.command.type,
    };
    completeIdempotencyKey({
      idempotencyKey: envelope.meta.idempotencyKey,
      response: result,
    });

    return {
      ok: true,
      correlationId: envelope.meta.correlationId,
      queueId: queued.queueId,
      data: result,
    };
  }

  async processSession(sessionId: string): Promise<number> {
    return this.queue.drainSession(sessionId, 64);
  }

  getQueueDepth(sessionId: string): { pending: number; running: number; failed: number; limit: number } {
    return this.queue.getDepth(sessionId);
  }

  private logFailure(envelope: GatewayCommandEnvelope, code: string, message: string): void {
    safeAppendAudit({
      eventType: "command.rejected",
      actor: "gateway",
      correlationId: envelope.meta.correlationId,
      payload: {
        commandType: envelope.command.type,
        code,
        message,
      },
    });
    failIdempotencyKey({
      idempotencyKey: envelope.meta.idempotencyKey,
      error: `${code}: ${message}`,
    });
    logger.warn("Gateway command rejected", {
      commandType: envelope.command.type,
      correlationId: envelope.meta.correlationId,
      code,
      message,
    });
  }
}
