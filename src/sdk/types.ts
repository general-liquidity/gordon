/**
 * Gordon SDK Types
 *
 * Public type surface for external developers building trading agents on
 * Gordon primitives. Re-exports the gateway protocol types that SDK
 * consumers need without exposing internal implementation details.
 */

import { z } from "zod";
import type { GatewayCommandType } from "../gateway/protocol/commands.ts";
import type { GatewayEventType } from "../gateway/protocol/events.ts";

// ============================================================================
// SDK Configuration
// ============================================================================

/**
 * Zod schema for SDK configuration validation.
 * Applied at construction time to fail fast on misconfiguration.
 */
export const SDKConfigSchema = z.object({
  /** Daemon auth token (hex string from `~/.gordon/daemon-auth.json`). */
  token: z.string().min(1, "Auth token is required."),

  /** Logical session ID. Commands sharing a session share a queue. */
  sessionId: z.string().min(1).max(128).default("sdk"),

  /**
   * IPC socket path / named pipe.
   * Defaults to the platform-appropriate path:
   * - Unix: `~/.gordon/daemon.sock`
   * - Windows: `\\\\.\\pipe\\gordon-daemon`
   */
  socketPath: z.string().optional(),

  /** Per-command IPC timeout in milliseconds. Default 30 000 (30s). */
  timeoutMs: z.number().int().min(1_000).max(300_000).default(30_000),

  /** Whether to automatically reconnect when the daemon is unreachable. */
  autoReconnect: z.boolean().default(true),

  /** Max consecutive reconnect attempts before giving up. */
  maxReconnectAttempts: z.number().int().min(0).max(100).default(5),

  /** Base delay between reconnect attempts in ms (doubled each attempt). */
  reconnectIntervalMs: z.number().int().min(100).max(60_000).default(1_000),
});

export type SDKConfig = z.infer<typeof SDKConfigSchema>;

/**
 * Input type for `createGordonSDK()`. All fields except `token` are optional
 * and will fall back to sensible defaults via the Zod schema.
 */
export type SDKConfigInput = z.input<typeof SDKConfigSchema>;

// ============================================================================
// Connection State
// ============================================================================

/**
 * Represents the lifecycle state of the SDK's IPC connection.
 *
 * Transitions:
 *   disconnected -> connecting -> connected
 *   connected    -> reconnecting -> connected | disconnected
 */
export type SDKConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

// ============================================================================
// Command Option Types
// ============================================================================

/** Options for `client.scan()`. Mirrors `ScanRunPayloadSchema`. */
export interface ScanOptions {
  /** Number of top coins to scan (1-500). Default 50. */
  topN?: number;
  /** Ordered timeframe preference. Scanner uses the first timeframe only. Default ["1h", "4h"]. */
  timeframes?: string[];
}

/** Options for `client.monitor()`. Mirrors `MonitorRunCyclePayloadSchema`. */
export interface MonitorOptions {
  /** Include alert evaluation in the cycle. Default true. */
  includeAlerts?: boolean;
}

/** Options for `client.setPermissionMode()`. Mirrors `SystemSetPermissionModePayloadSchema`. */
export interface SetPermissionModeOptions {
  /** Target permissionMode. */
  mode: "auto" | "ask" | "strict";
  /** Human-readable reason logged in the audit chain. */
  reason?: string;
}

/** Options for `client.scheduleTask()`. Mirrors `SchedulerCreateTaskPayloadSchema`. */
export interface ScheduleTaskOptions {
  /** Unique task identifier (3-96 chars). */
  taskId: string;
  /** Cron expression (5-128 chars, e.g. "0 *\/4 * * *" or "@every 4h"). */
  cron: string;
  /** The gateway command to run on each trigger. */
  commandType: GatewayCommandType;
  /** Payload passed to the command. */
  payload?: Record<string, unknown>;
  /** Whether the task is enabled. Default true. */
  enabled?: boolean;
}

/** Options for `client.healthCheck()`. Mirrors `RuntimeHealthCheckPayloadSchema`. */
export interface HealthCheckOptions {
  /** Run aggressive checks (e.g. force GC, deep state audit). Default false. */
  aggressive?: boolean;
}

/** Options for `client.reconcile()`. Mirrors `ReconcileRunPayloadSchema`. */
export interface ReconcileOptions {
  /** Force reconciliation even if positions appear in sync. Default false. */
  force?: boolean;
}

/** Options for `client.reloadPlugins()`. Mirrors `PluginReloadPayloadSchema`. */
export interface PluginReloadOptions {
  /** Reload a specific plugin by ID. Omit to reload all. */
  pluginId?: string;
}

/** Options for `client.sendMessage()`. Mirrors `ChatSendMessagePayloadSchema`. */
export interface SendMessageOptions {
  /** Associate the message with a specific thread. */
  threadId?: string;
  /** Resource ID for scoping context. */
  resourceId?: string;
}

// ============================================================================
// Command Responses
// ============================================================================

/**
 * Standard response envelope returned by every SDK command method.
 *
 * On success, `ok` is true and `data` carries the typed payload.
 * On failure, `ok` is false -- but the SDK methods will throw a typed
 * GordonSDKError rather than returning the error shape, so consumers
 * typically only see the success branch.
 */
export interface SDKCommandResponse<T = unknown> {
  /** Whether the gateway accepted and processed the command. */
  ok: boolean;
  /** Correlation ID for tracing across daemon logs. */
  correlationId: string;
  /** Queue position (if the command was enqueued). */
  queueId?: number;
  /** Typed response payload from the handler. */
  data?: T;
}

// ============================================================================
// Daemon Status
// ============================================================================

/** Returned by `client.getStatus()`. */
export interface DaemonStatus {
  /** Whether the daemon is reachable over IPC. */
  reachable: boolean;
  /** The IPC socket path that was probed. */
  socketPath: string;
}

// ============================================================================
// Scheduler Info
// ============================================================================

/** A scheduled task record as returned by `client.listTasks()`. */
export interface ScheduledTaskInfo {
  taskId: string;
  cron: string;
  commandType: GatewayCommandType;
  payload: Record<string, unknown>;
  enabled: boolean;
  nextRunAt?: string;
  lastRunAt?: string;
}

// ============================================================================
// SDK Events (client-side lifecycle events, not gateway events)
// ============================================================================

/** Event types emitted by the SDK client itself. */
export type SDKEventType =
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "reconnect_failed"
  | "error"
  | "command_sent"
  | "command_response";

/** Payload for SDK lifecycle events. */
export interface SDKEvent<T = unknown> {
  type: SDKEventType;
  timestamp: string;
  data?: T;
}

/** Callback signature for `client.onEvent()`. */
export type SDKEventHandler<T = unknown> = (event: SDKEvent<T>) => void;

/** Opaque handle returned by `client.onEvent()` for later unsubscription. */
export interface EventSubscription {
  /** Remove this subscription. Safe to call multiple times. */
  unsubscribe: () => void;
}

// ============================================================================
// Re-exported Gateway Protocol Types
// ============================================================================

export type { GatewayCommandType } from "../gateway/protocol/commands.ts";
export type { GatewayEventType } from "../gateway/protocol/events.ts";
export type { GatewayEventEnvelope } from "../gateway/protocol/events.ts";
export type { GatewayErrorCode } from "../gateway/protocol/errors.ts";
export type { GatewayError } from "../gateway/protocol/errors.ts";
export type { EnvelopeMeta } from "../gateway/protocol/envelope.ts";
export type { GatewayCommandEnvelope } from "../gateway/protocol/commands.ts";
export type { HandoffBudget } from "../gateway/handoffs/budget.ts";
export type { GatewayCapability, GatewayPrincipal } from "../gateway/security/auth.ts";
