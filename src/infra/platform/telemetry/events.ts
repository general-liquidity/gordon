/**
 * Telemetry Event Definitions
 * Typed events for anonymous usage tracking. Zero PII, zero financial data.
 */

export type TelemetryEventName =
  | "session_start"
  | "session_end"
  | "command_invoked"
  | "agent_routed"
  | "error_occurred"
  | "feature_used"
  | "uncaught_exception"
  | "unhandled_rejection";

export interface TelemetryEvent {
  event: TelemetryEventName;
  timestamp: number;
  properties: TelemetryProperties;
}

export interface TelemetryProperties {
  // Session context
  gordonVersion: string;
  bunVersion: string;
  osPlatform: string;
  osArch: string;
  isCI: boolean;
  isDocker: boolean;
  isTTY: boolean;

  // Event-specific (all optional)
  command?: string;
  agentName?: string;
  errorCode?: string;
  feature?: string;
  sessionDurationMs?: number;
  commandCount?: number;
  agentsUsed?: string[];
}
