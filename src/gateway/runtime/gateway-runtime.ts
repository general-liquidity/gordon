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
import { reconcileWithExchange } from "../../services/reconciliation-exchange.service.ts";
import { reloadMCPTools } from "../../infra/mcp/client.ts";
import { computeNextRunAt } from "../scheduler/index.ts";
import { PortfolioContextBuilder } from "../../core/risk-kernel/portfolio-context.ts";
import { evaluateBaselineCircuitBreakers } from "../circuit-breakers/index.ts";
import { computeCircuitBreakerLiveData } from "../circuit-breakers/data-provider.ts";
import { generateCircuitBreakerProof } from "../advanced/circuit-breaker-proof.ts";
import { RegimeWatcher } from "../../core/regime/watcher.ts";
import { EvolutionLoop } from "../../core/genome/evolution-loop.ts";
import { FeedbackLoop } from "../../core/learning/feedback-loop.ts";
import { ExecutionSessionManager } from "../../core/execution/session-manager.ts";
import { parseExecutionIntent } from "../../core/execution/intent-parser.ts";
import { getTrade } from "../../infra/storage/trades.ts";
import { executeEmergencyLiquidation } from "../../core/safety/emergency-liquidation.ts";
import { cleanupStalePositions } from "../../core/positions/cleanup.ts";
import { getAutonomousLoopStatus, runAutonomousCycleOnce } from "../../core/autonomous-loop.ts";

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

      // Also clean up stale positions
      let positionCleanup;
      try {
        positionCleanup = await cleanupStalePositions();
      } catch {
        positionCleanup = { expired: 0, byState: {} };
      }

      return { actions, count: actions.length, positionCleanup };
    });

    this.registerHandler("reconcile.run", async (envelope) => {
      const context = await this.deps.resolveContext(envelope.meta.sessionId);
      if (!context.exchange) {
        throw new Error("Reconciliation requires exchange credentials.");
      }
      const result = await reconcileWithExchange(context.exchange);

      // Refresh StrategyRuntime capital after reconciliation
      try {
        const details = await context.exchange.getFullAccountDetails();
        StrategyRuntime.getInstance().setTotalCapital(details.totalUsdtValue);
      } catch {
        // Logged inside getFullAccountDetails
      }

      return result;
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

    this.registerHandler("circuit_breaker.evaluate", async (envelope) => {
      const context = await this.deps.resolveContext(envelope.meta.sessionId);

      if (!context.exchange) {
        return { evaluated: false, reason: "No exchange available" };
      }

      const builder = new PortfolioContextBuilder();
      const portfolioContext = await builder.buildFromExchange(context.exchange);

      const liveData = await computeCircuitBreakerLiveData(
        context.exchange,
        portfolioContext.openPositions,
      );

      const runtime = StrategyRuntime.getInstance();
      const portfolioState = runtime.getPortfolioState();

      const input = {
        portfolioDrawdownPercent: portfolioState.portfolio_drawdown_percent,
        maxPortfolioDrawdownPercent: context.config?.riskManagement?.maxDrawdownPercent ?? 15,
        correlationShockPercent: liveData.correlationShockPercent,
        maxCorrelationShockPercent: 15,
        liquidityGapBps: liveData.liquidityGapBps,
        maxLiquidityGapBps: 250,
      };

      const result = evaluateBaselineCircuitBreakers(input);

      if (result.open) {
        // Auto-disarm and generate cryptographic proof
        const config = await loadConfig();
        const updated = { ...config, mode: "SAFE" as const, armedUntil: null };
        await saveConfig(updated);

        const proof = generateCircuitBreakerProof(input);

        safeAppendAudit({
          eventType: "circuit_breaker.tripped",
          actor: "daemon",
          payload: {
            triggers: result.triggers,
            proof: proof.commitment,
            autoDisarmed: true,
          },
        });

        logger.warn("Circuit breakers tripped, system auto-disarmed", {
          triggers: result.triggers.map((t) => t.name),
        });

        // Emergency liquidation: cancel orders + close positions + pause slots
        let liquidation;
        try {
          liquidation = await executeEmergencyLiquidation(context.exchange, result.triggers);
        } catch (liqErr) {
          logger.error("Emergency liquidation failed", liqErr as Error);
          liquidation = { error: (liqErr as Error).message };
        }

        return {
          evaluated: true,
          tripped: true,
          triggers: result.triggers,
          proof,
          autoDisarmed: true,
          liquidation,
        };
      }

      return { evaluated: true, tripped: false, triggers: [] };
    });

    // ---- v0.75 Feature Handlers ----

    this.registerHandler("regime.check", async (envelope) => {
      const context = await this.deps.resolveContext(envelope.meta.sessionId);
      if (!context.exchange) {
        return { checked: false, reason: "No exchange available" };
      }
      const watcher = RegimeWatcher.getInstance();
      const result = await watcher.tick(context.exchange);
      return result;
    });

    this.registerHandler("evolution.tick", async (envelope) => {
      const context = await this.deps.resolveContext(envelope.meta.sessionId);
      if (!context.exchange) {
        return { ticked: false, reason: "No exchange available" };
      }
      const payload = envelope.command.payload as { force?: boolean };
      const loop = EvolutionLoop.getInstance();
      const result = await loop.tick(context.exchange, payload.force ?? false);
      return result;
    });

    this.registerHandler("learning.analyze_trade", async (envelope) => {
      const context = await this.deps.resolveContext(envelope.meta.sessionId);
      if (!context.exchange) {
        return { analyzed: false, reason: "No exchange available" };
      }
      const payload = envelope.command.payload as { tradeId: string };
      const trade = getTrade(payload.tradeId);
      if (!trade) {
        return { analyzed: false, reason: `Trade ${payload.tradeId} not found` };
      }
      const feedbackLoop = FeedbackLoop.getInstance();
      await feedbackLoop.onTradeClosed(trade, context.exchange);
      return { analyzed: true, tradeId: payload.tradeId };
    });

    this.registerHandler("execution.start_intent", async (envelope) => {
      const context = await this.deps.resolveContext(envelope.meta.sessionId);
      if (!context.exchange) {
        return { started: false, reason: "No exchange available" };
      }
      const payload = envelope.command.payload as Record<string, unknown>;

      // Validate required fields
      if (!payload.symbol || typeof payload.symbol !== "string") {
        return { started: false, reason: "Missing or invalid 'symbol'" };
      }
      if (!payload.side || (payload.side !== "BUY" && payload.side !== "SELL")) {
        return { started: false, reason: "Missing or invalid 'side' (must be BUY or SELL)" };
      }
      if (!payload.totalQuantity || typeof payload.totalQuantity !== "number" || payload.totalQuantity <= 0) {
        return { started: false, reason: "Missing or invalid 'totalQuantity' (must be positive number)" };
      }
      if (!payload.algorithm || !["TWAP", "VWAP", "ICEBERG"].includes(payload.algorithm as string)) {
        return { started: false, reason: "Missing or invalid 'algorithm' (must be TWAP, VWAP, or ICEBERG)" };
      }

      const symbol = payload.symbol as string;
      const side = payload.side as "BUY" | "SELL";
      const totalQuantity = payload.totalQuantity as number;
      const algorithm = payload.algorithm as "TWAP" | "VWAP" | "ICEBERG";
      const config = (payload.config ?? {}) as Record<string, unknown>;

      const intent = parseExecutionIntent(
        `Execute ${algorithm} for ${symbol}`,
        symbol,
        side,
        totalQuantity,
      );
      // Override parsed algorithm with explicit one
      intent.algorithm = algorithm;
      // Merge any explicit config
      Object.assign(intent.config, config);

      const sessionManager = ExecutionSessionManager.getInstance();
      const session = await sessionManager.startSession(intent, context.exchange);
      return { started: true, sessionId: session.sessionId, intent: session.intent };
    });

    // ---- Capital Refresh (Task #85) ----

    this.registerHandler("capital.refresh", async (envelope) => {
      const context = await this.deps.resolveContext(envelope.meta.sessionId);
      if (!context.exchange) {
        return { refreshed: false, reason: "No exchange available" };
      }
      try {
        const details = await context.exchange.getFullAccountDetails();
        const runtime = StrategyRuntime.getInstance();
        runtime.setTotalCapital(details.totalUsdtValue);
        return {
          refreshed: true,
          totalCapital: details.totalUsdtValue,
          timestamp: new Date().toISOString(),
        };
      } catch (err) {
        return {
          refreshed: false,
          reason: (err as Error).message,
        };
      }
    });

    // ---- Autonomous Cycle (Task #84) ----

    this.registerHandler("autonomous.run_cycle", async (envelope) => {
      const context = await this.deps.resolveContext(envelope.meta.sessionId);
      if (!context.exchange) {
        return { ran: false, reason: "No exchange available" };
      }

      const status = getAutonomousLoopStatus();
      if (!status.isRunning) {
        return { ran: false, reason: "Autonomous loop not active. Start via create_swing_mandate + start_autonomous_mode." };
      }
      if (status.isPaused) {
        return { ran: false, reason: "Autonomous loop is paused." };
      }

      try {
        const report = await runAutonomousCycleOnce();
        return { ran: true, report };
      } catch (err) {
        return { ran: false, reason: (err as Error).message };
      }
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
