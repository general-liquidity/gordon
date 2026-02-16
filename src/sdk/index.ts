import type { GatewayCommandEnvelope, GatewayCommandType } from "../gateway/protocol/commands.ts";
import { createEnvelopeMeta } from "../gateway/protocol/envelope.ts";
import { getDefaultIpcPath, sendIpcCommand, isIpcDaemonReachable } from "../gateway/daemon/ipc.ts";
import type { GatewayIPCResponse } from "../gateway/daemon/ipc.ts";
import { ConnectionError, TimeoutError, createSDKErrorFromGateway } from "./errors.ts";
import type {
  SDKConfig,
  SDKConnectionState,
  SDKEventType,
  SDKEventHandler,
  SDKEvent,
  ScanOptions,
  MonitorOptions,
  ArmOptions,
  DisarmOptions,
  ScheduleTaskOptions,
  HealthCheckOptions,
  ReconcileOptions,
  PluginReloadOptions,
  DaemonStatus,
  SDKCommandResponse,
} from "./types.ts";

export class GordonSDKClient {
  private readonly token: string;
  private readonly sessionId: string;
  private readonly socketPath: string;
  private readonly timeoutMs: number;
  private readonly autoReconnect: boolean;
  private readonly maxReconnectAttempts: number;
  private readonly reconnectIntervalMs: number;

  private state: SDKConnectionState = "disconnected";
  private reconnectAttempts = 0;
  private listeners = new Map<SDKEventType, Set<SDKEventHandler>>();

  constructor(config: SDKConfig) {
    this.token = config.token;
    this.sessionId = config.sessionId ?? `sdk_${Date.now()}`;
    this.socketPath = config.socketPath ?? getDefaultIpcPath();
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.autoReconnect = config.autoReconnect ?? true;
    this.maxReconnectAttempts = config.maxReconnectAttempts ?? 5;
    this.reconnectIntervalMs = config.reconnectIntervalMs ?? 2_000;
  }

  // ── Lifecycle ──────────────────────────────────────────────

  async connect(): Promise<void> {
    this.setState("connecting");
    const reachable = await isIpcDaemonReachable(this.socketPath);
    if (!reachable) {
      this.setState("disconnected");
      throw new ConnectionError(`Daemon not reachable at ${this.socketPath}`);
    }
    this.reconnectAttempts = 0;
    this.setState("connected");
  }

  disconnect(): void {
    this.setState("disconnected");
    this.reconnectAttempts = 0;
  }

  getState(): SDKConnectionState {
    return this.state;
  }

  // ── Events ─────────────────────────────────────────────────

  onEvent(type: SDKEventType, handler: SDKEventHandler): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(handler);
    return () => this.listeners.get(type)?.delete(handler);
  }

  private emit(type: SDKEventType, data?: unknown): void {
    const event: SDKEvent = { type, timestamp: new Date().toISOString(), data };
    this.listeners.get(type)?.forEach((h) => h(event));
  }

  private setState(newState: SDKConnectionState): void {
    this.state = newState;
    if (newState === "connected") this.emit("connected");
    else if (newState === "disconnected") this.emit("disconnected");
    else if (newState === "reconnecting") this.emit("reconnecting");
  }

  // ── Core send ──────────────────────────────────────────────

  private async send<T = unknown>(
    commandType: GatewayCommandType,
    payload: Record<string, unknown>,
  ): Promise<SDKCommandResponse<T>> {
    await this.ensureConnected();

    const envelope: GatewayCommandEnvelope = {
      meta: createEnvelopeMeta({
        sessionId: this.sessionId,
        source: "agent",
        idempotencyKey: `sdk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      }),
      command: { type: commandType, payload } as GatewayCommandEnvelope["command"],
    };

    this.emit("command_sent", { commandType, payload });

    let response: GatewayIPCResponse;
    try {
      response = await sendIpcCommand({
        socketPath: this.socketPath,
        request: { token: this.token, processImmediately: true, envelope },
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      if (this.autoReconnect) await this.tryReconnect();
      if (err instanceof Error && err.message.includes("timed out")) {
        throw new TimeoutError(`Command ${commandType} timed out after ${this.timeoutMs}ms`, this.timeoutMs);
      }
      throw new ConnectionError(err instanceof Error ? err.message : String(err));
    }

    this.emit("command_response", response);

    if (!response.ok && response.error) {
      throw createSDKErrorFromGateway(response.error);
    }

    return response as SDKCommandResponse<T>;
  }

  private async ensureConnected(): Promise<void> {
    if (this.state === "connected") return;
    if (this.state === "disconnected" || this.state === "reconnecting") {
      await this.connect();
    }
  }

  private async tryReconnect(): Promise<void> {
    if (!this.autoReconnect || this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.setState("disconnected");
      throw new ConnectionError(
        `Failed to reconnect after ${this.reconnectAttempts} attempts`,
      );
    }
    this.setState("reconnecting");
    this.reconnectAttempts++;
    await new Promise((r) => setTimeout(r, this.reconnectIntervalMs * this.reconnectAttempts));
    try {
      await this.connect();
    } catch {
      // connect() sets state, caller will handle
    }
  }

  // ── Commands ───────────────────────────────────────────────

  async sendMessage(text: string, threadId?: string): Promise<SDKCommandResponse> {
    return this.send("chat.send_message", { text, threadId });
  }

  async scan(options?: ScanOptions): Promise<SDKCommandResponse> {
    return this.send("scan.run", {
      topN: options?.topN ?? 50,
      timeframes: options?.timeframes ?? ["1h", "4h"],
    });
  }

  async monitor(options?: MonitorOptions): Promise<SDKCommandResponse> {
    return this.send("monitor.run_cycle", {
      includeAlerts: options?.includeAlerts ?? true,
    });
  }

  async arm(options?: ArmOptions): Promise<SDKCommandResponse> {
    return this.send("system.arm", {
      durationHours: options?.durationHours ?? 1,
      reason: options?.reason,
    });
  }

  async disarm(options?: DisarmOptions): Promise<SDKCommandResponse> {
    return this.send("system.disarm", { reason: options?.reason });
  }

  async scheduleTask(options: ScheduleTaskOptions): Promise<SDKCommandResponse> {
    return this.send("scheduler.create_task", {
      taskId: options.taskId,
      cron: options.cron,
      commandType: options.commandType,
      payload: options.payload ?? {},
      enabled: options.enabled ?? true,
    });
  }

  async removeTask(taskId: string): Promise<SDKCommandResponse> {
    return this.send("scheduler.delete_task", { taskId });
  }

  async listTasks(): Promise<SDKCommandResponse> {
    return this.send("scheduler.list_tasks", {});
  }

  async healthCheck(options?: HealthCheckOptions): Promise<SDKCommandResponse> {
    return this.send("runtime.health_check", {
      aggressive: options?.aggressive ?? false,
    });
  }

  async reconcile(options?: ReconcileOptions): Promise<SDKCommandResponse> {
    return this.send("reconcile.run", { force: options?.force ?? false });
  }

  async reloadPlugins(options?: PluginReloadOptions): Promise<SDKCommandResponse> {
    return this.send("plugin.reload", { pluginId: options?.pluginId });
  }

  async shutdown(reason?: string): Promise<SDKCommandResponse> {
    return this.send("daemon.shutdown", { reason });
  }

  async getStatus(): Promise<DaemonStatus> {
    const isReachable = await isIpcDaemonReachable(this.socketPath);
    return { reachable: isReachable, socketPath: this.socketPath };
  }
}

export function createGordonSDKClient(config: SDKConfig): GordonSDKClient {
  return new GordonSDKClient(config);
}
