/**
 * Gordon SDK Client
 *
 * Full-featured SDK for external developers to build trading agents on
 * Gordon's primitives. Communicates with the Gordon daemon over IPC,
 * providing typed command methods, lifecycle management with auto-reconnect,
 * and event subscription.
 *
 * @example
 * ```typescript
 * import { createGordonSDK } from "@general-liquidity/gordon-cli/sdk";
 *
 * const client = createGordonSDK({ token: "your-daemon-token" });
 *
 * await client.connect();
 *
 * // Scan the market
 * const scanResult = await client.scan({ topN: 25, timeframes: ["1h"] });
 *
 * // Arm the system for 2 hours
 * await client.arm({ durationHours: 2, reason: "Momentum trade window" });
 *
 * // Send a natural-language instruction
 * await client.sendMessage("Buy 0.1 BTC at market");
 *
 * // Subscribe to lifecycle events
 * const sub = client.onEvent("disconnected", (event) => {
 *   console.warn("Lost connection to daemon", event);
 * });
 *
 * // Cleanup
 * sub.unsubscribe();
 * await client.disconnect();
 * ```
 */

import {
  getDefaultIpcPath,
  isIpcDaemonReachable,
  sendIpcCommand,
} from "../gateway/daemon/ipc.ts";
import type { GatewayIPCResponse } from "../gateway/daemon/ipc.ts";
import type { GatewayCommandEnvelope } from "../gateway/protocol/commands.ts";
import {
  ScanRunPayloadSchema,
  MonitorRunCyclePayloadSchema,
  SystemSetPermissionModePayloadSchema,
  SchedulerCreateTaskPayloadSchema,
  SchedulerDeleteTaskPayloadSchema,
  RuntimeHealthCheckPayloadSchema,
  ReconcileRunPayloadSchema,
  PluginReloadPayloadSchema,
  ChatSendMessagePayloadSchema,
  DaemonShutdownPayloadSchema,
} from "../gateway/protocol/commands.ts";
import { createEnvelopeMeta } from "../gateway/protocol/envelope.ts";
import {
  ConnectionError,
  TimeoutError,
  ValidationError,
  createSDKErrorFromGateway,
} from "./errors.ts";
import {
  SDKConfigSchema,
  type SDKConfig,
  type SDKConfigInput,
  type SDKConnectionState,
  type SDKCommandResponse,
  type SDKEvent,
  type SDKEventType,
  type SDKEventHandler,
  type EventSubscription,
  type ScanOptions,
  type MonitorOptions,
  type SetPermissionModeOptions,
  type ScheduleTaskOptions,
  type HealthCheckOptions,
  type ReconcileOptions,
  type PluginReloadOptions,
  type SendMessageOptions,
  type DaemonStatus,
  type ScheduledTaskInfo,
} from "./types.ts";

// ============================================================================
// Internal helpers
// ============================================================================

/** Generate a unique idempotency key for each SDK command. */
function makeIdempotencyKey(): string {
  return `sdk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Sleep helper for reconnect backoff. */
function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// GordonSDKClient
// ============================================================================

/**
 * The main SDK client. Holds configuration, connection state, and an
 * internal event emitter for lifecycle notifications.
 *
 * Construct via {@link createGordonSDK} to get validated config defaults,
 * or pass a pre-validated {@link SDKConfig} directly to the constructor.
 */
export class GordonSDKClient {
  // -- Config ----------------------------------------------------------------
  private readonly config: SDKConfig;
  private readonly socketPath: string;

  // -- Connection state ------------------------------------------------------
  private _connectionState: SDKConnectionState = "disconnected";
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // -- Event subscriptions ---------------------------------------------------
  private readonly listeners = new Map<SDKEventType | "*", Set<SDKEventHandler>>();

  constructor(config: SDKConfig) {
    this.config = config;
    this.socketPath = config.socketPath ?? getDefaultIpcPath();
  }

  // ==========================================================================
  // Connection State
  // ==========================================================================

  /** Current connection lifecycle state. */
  get connectionState(): SDKConnectionState {
    return this._connectionState;
  }

  /**
   * @deprecated Use `connectionState` getter instead.
   */
  getState(): SDKConnectionState {
    return this._connectionState;
  }

  private setConnectionState(state: SDKConnectionState): void {
    const prev = this._connectionState;
    this._connectionState = state;
    if (prev !== state) {
      this.emit(state as SDKEventType, { previousState: prev });
    }
  }

  // ==========================================================================
  // Lifecycle: connect / disconnect
  // ==========================================================================

  /**
   * Verify that the daemon is reachable and mark the client as connected.
   *
   * If the daemon is not running, throws {@link ConnectionError}.
   * When `autoReconnect` is enabled the client will transparently retry
   * on subsequent command failures -- but `connect()` itself does not loop.
   */
  async connect(): Promise<void> {
    this.setConnectionState("connecting");

    const reachable = await isIpcDaemonReachable(this.socketPath);
    if (!reachable) {
      this.setConnectionState("disconnected");
      throw new ConnectionError(
        `Gordon daemon is not reachable at ${this.socketPath}. Is it running?`,
        { socketPath: this.socketPath },
      );
    }

    this.reconnectAttempt = 0;
    this.setConnectionState("connected");
  }

  /**
   * Tear down the client. Cancels any pending reconnect timer and
   * marks the state as disconnected.
   */
  async disconnect(): Promise<void> {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempt = 0;
    this.setConnectionState("disconnected");
  }

  // ==========================================================================
  // Auto-Reconnect (exponential backoff)
  // ==========================================================================

  /**
   * Attempt to re-establish the connection using exponential backoff.
   * Called internally when a command fails with a connection-level error.
   *
   * @returns true if reconnection succeeded, false if attempts exhausted.
   */
  private async attemptReconnect(): Promise<boolean> {
    if (!this.config.autoReconnect) return false;
    if (this._connectionState === "reconnecting") return false;

    this.setConnectionState("reconnecting");

    while (this.reconnectAttempt < this.config.maxReconnectAttempts) {
      this.reconnectAttempt++;
      const delay =
        this.config.reconnectIntervalMs *
        Math.pow(2, this.reconnectAttempt - 1);

      this.emit("reconnecting", {
        attempt: this.reconnectAttempt,
        maxAttempts: this.config.maxReconnectAttempts,
        nextDelayMs: delay,
      });

      await sleep(delay);

      const reachable = await isIpcDaemonReachable(this.socketPath);
      if (reachable) {
        this.reconnectAttempt = 0;
        this.setConnectionState("connected");
        return true;
      }
    }

    // Exhausted all attempts
    this.emit("reconnect_failed", {
      attempts: this.reconnectAttempt,
    });
    this.setConnectionState("disconnected");
    return false;
  }

  // ==========================================================================
  // Core IPC Transport
  // ==========================================================================

  /**
   * Build an EnvelopeMeta for outgoing commands.
   */
  private createMeta() {
    return createEnvelopeMeta({
      sessionId: this.config.sessionId,
      source: "agent",
      idempotencyKey: makeIdempotencyKey(),
    });
  }

  /**
   * Ensure the client is in a usable state before sending a command.
   * If disconnected, attempt to connect first.
   */
  private async ensureConnected(): Promise<void> {
    if (this._connectionState === "connected") return;
    if (
      this._connectionState === "disconnected" ||
      this._connectionState === "reconnecting"
    ) {
      await this.connect();
    }
  }

  /**
   * Low-level: send a typed command through IPC and handle errors.
   *
   * All typed command methods delegate here. This method:
   * 1. Ensures the client is connected (auto-connecting if needed).
   * 2. Builds the IPC request (attaching token + processImmediately).
   * 3. Sends over the Unix socket / named pipe.
   * 4. Maps IPC-level failures to ConnectionError / TimeoutError.
   * 5. Maps gateway-level failures to typed GordonSDKError subclasses.
   * 6. Emits `command_sent` and `command_response` lifecycle events.
   * 7. On connection failure with auto-reconnect, retries once after recovery.
   */
  async send<T = unknown>(
    command: GatewayCommandEnvelope["command"],
  ): Promise<SDKCommandResponse<T>> {
    await this.ensureConnected();

    const meta = this.createMeta();
    const envelope = { meta, command } as GatewayCommandEnvelope;

    this.emit("command_sent", {
      commandType: command.type,
      correlationId: meta.correlationId,
    });

    let response: GatewayIPCResponse;
    try {
      response = await sendIpcCommand({
        request: {
          token: this.config.token,
          processImmediately: true,
          envelope,
        },
        socketPath: this.socketPath,
        timeoutMs: this.config.timeoutMs,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // Distinguish timeout from connection errors
      if (message.includes("timed out")) {
        throw new TimeoutError(
          `IPC request timed out after ${this.config.timeoutMs}ms for ${command.type}.`,
          this.config.timeoutMs,
          { commandType: command.type },
        );
      }

      // Connection-level failure -- try reconnect then retry once
      if (this.config.autoReconnect && this._connectionState === "connected") {
        const recovered = await this.attemptReconnect();
        if (recovered) {
          return this.send<T>(command);
        }
      }

      throw new ConnectionError(
        `Failed to reach Gordon daemon: ${message}`,
        { socketPath: this.socketPath, commandType: command.type },
      );
    }

    this.emit("command_response", {
      commandType: command.type,
      correlationId: response.correlationId,
      ok: response.ok,
    });

    if (!response.ok) {
      if (response.error) {
        throw createSDKErrorFromGateway(response.error);
      }
      throw createSDKErrorFromGateway({
        code: "INTERNAL_ERROR",
        message: "Gateway command failed without error details.",
      });
    }

    return {
      ok: true,
      correlationId: response.correlationId,
      queueId: response.queueId,
      data: response.data as T | undefined,
    };
  }

  // ==========================================================================
  // Typed Command Methods
  // ==========================================================================

  /**
   * Send a natural-language chat message through the agent network.
   *
   * @param text - The message text (must be non-empty).
   * @param options - Optional thread/resource scoping.
   *
   * @example
   * ```typescript
   * await client.sendMessage("What's the RSI on BTCUSDT?");
   * await client.sendMessage("Show me ETH analysis", { threadId: "t-123" });
   * ```
   */
  async sendMessage(
    text: string,
    options: SendMessageOptions = {},
  ): Promise<SDKCommandResponse> {
    const parsed = ChatSendMessagePayloadSchema.safeParse({
      text,
      threadId: options.threadId,
      resourceId: options.resourceId,
    });
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid sendMessage input: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
        { issues: parsed.error.issues },
      );
    }

    return this.send({
      type: "chat.send_message",
      payload: parsed.data,
    });
  }

  /**
   * Trigger a market scan across the configured universe.
   *
   * @param options - Scan parameters (topN, timeframes).
   *
   * @example
   * ```typescript
   * const result = await client.scan({ topN: 25, timeframes: ["4h"] });
   * ```
   */
  async scan(options: ScanOptions = {}): Promise<SDKCommandResponse> {
    const parsed = ScanRunPayloadSchema.safeParse(options);
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid scan options: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
        { issues: parsed.error.issues },
      );
    }

    return this.send({
      type: "scan.run",
      payload: parsed.data,
    });
  }

  /**
   * Run a position monitoring cycle.
   *
   * @param options - Whether to include alert evaluation.
   *
   * @example
   * ```typescript
   * await client.monitor();
   * await client.monitor({ includeAlerts: false });
   * ```
   */
  async monitor(options: MonitorOptions = {}): Promise<SDKCommandResponse> {
    const parsed = MonitorRunCyclePayloadSchema.safeParse(options);
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid monitor options: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
        { issues: parsed.error.issues },
      );
    }

    return this.send({
      type: "monitor.run_cycle",
      payload: parsed.data,
    });
  }

  /**
   * Set Gordon's permission mode.
   *
   * @param options - Target mode (auto/ask/strict) and optional reason.
   *
   * @example
   * ```typescript
   * await client.setPermissionMode({ mode: "auto", reason: "Session start" });
   * await client.setPermissionMode({ mode: "ask" });    // default, ApprovalDialog per trade
   * await client.setPermissionMode({ mode: "strict" }); // read-only
   * ```
   */
  async setPermissionMode(options: SetPermissionModeOptions): Promise<SDKCommandResponse> {
    const parsed = SystemSetPermissionModePayloadSchema.safeParse(options);
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid setPermissionMode options: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
        { issues: parsed.error.issues },
      );
    }

    return this.send({
      type: "system.set_permission_mode",
      payload: parsed.data,
    });
  }

  /**
   * Create or update a scheduled task.
   *
   * @param options - Task configuration including cron expression.
   *
   * @example
   * ```typescript
   * await client.scheduleTask({
   *   taskId: "morning-scan",
   *   cron: "0 8 * * *",
   *   commandType: "scan.run",
   *   payload: { topN: 50 },
   * });
   * ```
   */
  async scheduleTask(
    options: ScheduleTaskOptions,
  ): Promise<SDKCommandResponse> {
    const parsed = SchedulerCreateTaskPayloadSchema.safeParse({
      taskId: options.taskId,
      cron: options.cron,
      commandType: options.commandType,
      payload: options.payload ?? {},
      enabled: options.enabled ?? true,
    });
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid scheduleTask options: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
        { issues: parsed.error.issues },
      );
    }

    return this.send({
      type: "scheduler.create_task",
      payload: parsed.data,
    });
  }

  /**
   * Remove a scheduled task by its ID.
   *
   * @param taskId - The unique identifier of the task to remove (3-96 chars).
   *
   * @example
   * ```typescript
   * await client.removeTask("morning-scan");
   * ```
   */
  async removeTask(taskId: string): Promise<SDKCommandResponse> {
    const parsed = SchedulerDeleteTaskPayloadSchema.safeParse({ taskId });
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid taskId: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
        { issues: parsed.error.issues },
      );
    }

    return this.send({
      type: "scheduler.delete_task",
      payload: parsed.data,
    });
  }

  /**
   * List all registered scheduled tasks.
   *
   * @example
   * ```typescript
   * const result = await client.listTasks();
   * const tasks = result.data?.tasks ?? [];
   * for (const task of tasks) {
   *   console.log(`${task.taskId}: ${task.cron} [${task.enabled ? "on" : "off"}]`);
   * }
   * ```
   */
  async listTasks(): Promise<SDKCommandResponse<{ tasks: ScheduledTaskInfo[] }>> {
    return this.send<{ tasks: ScheduledTaskInfo[] }>({
      type: "scheduler.list_tasks",
      payload: {},
    });
  }

  /**
   * Run a runtime health check on strategy engines.
   *
   * @param options - Whether to run aggressive (deeper) checks.
   *
   * @example
   * ```typescript
   * const result = await client.healthCheck({ aggressive: true });
   * console.log(result.data);
   * ```
   */
  async healthCheck(
    options: HealthCheckOptions = {},
  ): Promise<SDKCommandResponse> {
    const parsed = RuntimeHealthCheckPayloadSchema.safeParse(options);
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid healthCheck options: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
        { issues: parsed.error.issues },
      );
    }

    return this.send({
      type: "runtime.health_check",
      payload: parsed.data,
    });
  }

  /**
   * Trigger position reconciliation with the exchange.
   *
   * Compares local position state with what the exchange reports and
   * corrects any drift.
   *
   * @param options - Whether to force reconciliation even when in sync.
   *
   * @example
   * ```typescript
   * await client.reconcile({ force: true });
   * ```
   */
  async reconcile(
    options: ReconcileOptions = {},
  ): Promise<SDKCommandResponse> {
    const parsed = ReconcileRunPayloadSchema.safeParse(options);
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid reconcile options: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
        { issues: parsed.error.issues },
      );
    }

    return this.send({
      type: "reconcile.run",
      payload: parsed.data,
    });
  }

  /**
   * Hot-reload MCP plugins without restarting the daemon.
   *
   * @param options - Optionally target a single plugin by ID.
   *
   * @example
   * ```typescript
   * // Reload all plugins
   * await client.reloadPlugins();
   *
   * // Reload a specific plugin
   * await client.reloadPlugins({ pluginId: "my-custom-plugin" });
   * ```
   */
  async reloadPlugins(
    options: PluginReloadOptions = {},
  ): Promise<SDKCommandResponse> {
    const parsed = PluginReloadPayloadSchema.safeParse(options);
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid reloadPlugins options: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
        { issues: parsed.error.issues },
      );
    }

    return this.send({
      type: "plugin.reload",
      payload: parsed.data,
    });
  }

  /**
   * Request a graceful daemon shutdown.
   *
   * @param reason - Optional reason for the audit trail.
   *
   * @example
   * ```typescript
   * await client.shutdown("Maintenance window");
   * ```
   */
  async shutdown(reason?: string): Promise<SDKCommandResponse> {
    const parsed = DaemonShutdownPayloadSchema.safeParse({ reason });
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid shutdown options: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
        { issues: parsed.error.issues },
      );
    }

    return this.send({
      type: "daemon.shutdown",
      payload: parsed.data,
    });
  }

  // ==========================================================================
  // Status
  // ==========================================================================

  /**
   * Check whether the daemon is reachable over IPC.
   *
   * Unlike `connect()`, this does NOT change the client's connection state.
   * Use it as a lightweight health probe.
   *
   * @example
   * ```typescript
   * const status = await client.getStatus();
   * if (!status.reachable) {
   *   console.warn("Daemon is down!");
   * }
   * ```
   */
  async getStatus(): Promise<DaemonStatus> {
    const reachable = await isIpcDaemonReachable(this.socketPath);
    return {
      reachable,
      socketPath: this.socketPath,
    };
  }

  // ==========================================================================
  // Event Subscription
  // ==========================================================================

  /**
   * Subscribe to SDK lifecycle events.
   *
   * Returns an {@link EventSubscription} handle whose `unsubscribe()` method
   * removes the callback. Safe to call `unsubscribe()` multiple times.
   *
   * Pass `"*"` as the event type to receive all events (wildcard).
   *
   * Available event types:
   * - `"connected"` -- daemon connection established
   * - `"disconnected"` -- daemon connection lost
   * - `"reconnecting"` -- reconnect attempt in progress
   * - `"reconnect_failed"` -- all reconnect attempts exhausted
   * - `"error"` -- unrecoverable error
   * - `"command_sent"` -- command dispatched to daemon
   * - `"command_response"` -- response received from daemon
   *
   * @example
   * ```typescript
   * const sub = client.onEvent("reconnecting", (event) => {
   *   console.log(`Reconnect attempt`, event.data);
   * });
   *
   * // Wildcard: log everything
   * const allSub = client.onEvent("*", (event) => {
   *   console.log(`[SDK] ${event.type}`, event.data);
   * });
   *
   * // Cleanup
   * sub.unsubscribe();
   * allSub.unsubscribe();
   * ```
   */
  onEvent(
    eventType: SDKEventType | "*",
    callback: SDKEventHandler,
  ): EventSubscription {
    let handlers = this.listeners.get(eventType);
    if (!handlers) {
      handlers = new Set();
      this.listeners.set(eventType, handlers);
    }
    handlers.add(callback);

    let unsubscribed = false;
    return {
      unsubscribe: () => {
        if (unsubscribed) return;
        unsubscribed = true;
        handlers!.delete(callback);
        if (handlers!.size === 0) {
          this.listeners.delete(eventType);
        }
      },
    };
  }

  /**
   * Internal: emit an SDK lifecycle event to all matching subscribers.
   * Swallows errors thrown by subscriber callbacks to protect the SDK.
   */
  private emit(type: SDKEventType, data?: unknown): void {
    const event: SDKEvent = {
      type,
      timestamp: new Date().toISOString(),
      data,
    };

    // Deliver to type-specific listeners
    const typed = this.listeners.get(type);
    if (typed) {
      for (const handler of typed) {
        try {
          handler(event);
        } catch {
          // Swallow subscriber errors to protect the SDK
        }
      }
    }

    // Deliver to wildcard listeners
    const wildcard = this.listeners.get("*");
    if (wildcard) {
      for (const handler of wildcard) {
        try {
          handler(event);
        } catch {
          // Swallow subscriber errors
        }
      }
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a new Gordon SDK client with validated configuration.
 *
 * @param input - SDK configuration. Only `token` is required; all other
 *                fields fall back to sensible defaults via the Zod schema.
 * @returns A fully configured {@link GordonSDKClient} instance.
 * @throws {ValidationError} if the configuration is invalid.
 *
 * @example
 * ```typescript
 * const client = createGordonSDK({
 *   token: "abc123...",
 *   timeoutMs: 15_000,
 *   autoReconnect: true,
 * });
 * await client.connect();
 * ```
 */
export function createGordonSDK(input: SDKConfigInput): GordonSDKClient {
  const parsed = SDKConfigSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      `Invalid SDK configuration: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      { issues: parsed.error.issues },
    );
  }

  return new GordonSDKClient(parsed.data);
}

/**
 * Alias for backward compatibility with the original skeleton API.
 * @deprecated Use {@link createGordonSDK} instead.
 */
export function createGordonSDKClient(config: SDKConfig): GordonSDKClient {
  return new GordonSDKClient(config);
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export { createEnvelopeMeta } from "../gateway/protocol/envelope.ts";
export { getDefaultIpcPath } from "../gateway/daemon/ipc.ts";
