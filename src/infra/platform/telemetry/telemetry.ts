/**
 * Telemetry Module
 *
 * Strict opt-in anonymous usage analytics for Gordon CLI.
 * - No data sent until user explicitly opts in
 * - No PII, no financial data, no wallet addresses, no API keys
 * - Respects DO_NOT_TRACK env var (consoledonottrack.com standard)
 * - Debug mode prints events locally instead of sending
 * - Non-blocking: never delays startup or crashes the app
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { GORDON_DIR } from "../../storage/paths.ts";
import { VERSION } from "../../../cli.ts";
import type { TelemetryEvent, TelemetryEventName, TelemetryProperties } from "./events.ts";

// ============================================================================
// Constants
// ============================================================================

const TELEMETRY_STATE_FILE = path.join(GORDON_DIR, ".telemetry");
const TELEMETRY_ENDPOINT = "https://telemetry.gordon.sh/api/v1/record";
const FLUSH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_QUEUE_SIZE = 50;
const FETCH_TIMEOUT_MS = 3000;

// ============================================================================
// State
// ============================================================================

interface TelemetryState {
  enabled: boolean;
  anonymousId: string;
  salt: string;
  notifiedAt: number | null; // timestamp when first-run notice was shown
}

let state: TelemetryState | null = null;
let eventQueue: TelemetryEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let sessionStartTime = Date.now();

// ============================================================================
// State Management
// ============================================================================

function loadState(): TelemetryState {
  if (state) return state;

  try {
    if (fs.existsSync(TELEMETRY_STATE_FILE)) {
      const data = fs.readFileSync(TELEMETRY_STATE_FILE, "utf-8");
      state = JSON.parse(data);
      return state!;
    }
  } catch {
    // Corrupted file, reset
  }

  // Default: disabled until user opts in
  state = {
    enabled: false,
    anonymousId: crypto.randomBytes(16).toString("hex"),
    salt: crypto.randomBytes(16).toString("hex"),
    notifiedAt: null,
  };

  saveState(state);
  return state;
}

function saveState(s: TelemetryState): void {
  try {
    fs.mkdirSync(GORDON_DIR, { recursive: true });
    fs.writeFileSync(TELEMETRY_STATE_FILE, JSON.stringify(s, null, 2), "utf-8");
  } catch {
    // Non-critical
  }
}

// ============================================================================
// Consent Checks
// ============================================================================

/**
 * Check if telemetry is forcibly disabled via environment.
 */
function isEnvDisabled(): boolean {
  return (
    process.env.DO_NOT_TRACK === "1" ||
    process.env.GORDON_TELEMETRY_DISABLED === "1"
  );
}

/**
 * Check if telemetry is enabled (opt-in + not env-disabled).
 */
export function isEnabled(): boolean {
  if (isEnvDisabled()) return false;
  return loadState().enabled;
}

/**
 * Check if we're in debug mode (print events, don't send).
 */
function isDebugMode(): boolean {
  return process.env.GORDON_TELEMETRY_DEBUG === "1";
}

// ============================================================================
// Consent Management
// ============================================================================

/**
 * Enable telemetry (user explicitly opts in).
 */
export function enable(): void {
  const s = loadState();
  s.enabled = true;
  s.notifiedAt = s.notifiedAt ?? Date.now();
  saveState(s);
  state = s;
  startFlushTimer();
}

/**
 * Disable telemetry and clear queued events.
 */
export function disable(): void {
  const s = loadState();
  s.enabled = false;
  saveState(s);
  state = s;
  eventQueue = [];
  stopFlushTimer();
}

/**
 * Get current telemetry status for display.
 */
export function getStatus(): {
  enabled: boolean;
  envDisabled: boolean;
  anonymousId: string;
  queuedEvents: number;
} {
  const s = loadState();
  return {
    enabled: s.enabled && !isEnvDisabled(),
    envDisabled: isEnvDisabled(),
    anonymousId: s.anonymousId,
    queuedEvents: eventQueue.length,
  };
}

// ============================================================================
// System Info (collected once per session)
// ============================================================================

let cachedSystemInfo: Pick<
  TelemetryProperties,
  "gordonVersion" | "bunVersion" | "osPlatform" | "osArch" | "isCI" | "isDocker" | "isTTY"
> | null = null;

function getSystemInfo(): typeof cachedSystemInfo & {} {
  if (cachedSystemInfo) return cachedSystemInfo;

  cachedSystemInfo = {
    gordonVersion: VERSION,
    bunVersion: typeof Bun !== "undefined" ? Bun.version : "unknown",
    osPlatform: os.platform(),
    osArch: os.arch(),
    isCI: !!(
      process.env.CI ||
      process.env.CONTINUOUS_INTEGRATION ||
      process.env.GITHUB_ACTIONS ||
      process.env.GITLAB_CI ||
      process.env.JENKINS_HOME
    ),
    isDocker: fs.existsSync("/.dockerenv") || fs.existsSync("/run/.containerenv"),
    isTTY: !!process.stdout.isTTY,
  };

  return cachedSystemInfo;
}

// ============================================================================
// Event Recording
// ============================================================================

/**
 * Record a telemetry event. No-op if telemetry is disabled.
 */
export function record(
  event: TelemetryEventName,
  properties?: Partial<TelemetryProperties>,
): void {
  if (!isEnabled() && !isDebugMode()) return;

  const fullEvent: TelemetryEvent = {
    event,
    timestamp: Date.now(),
    properties: {
      ...getSystemInfo(),
      ...properties,
    },
  };

  if (isDebugMode()) {
    console.error(`[telemetry] ${JSON.stringify(fullEvent)}`);
    return;
  }

  // Drop oldest events if queue exceeds max size to prevent unbounded memory growth
  if (eventQueue.length >= MAX_QUEUE_SIZE) {
    eventQueue.shift();
  }
  eventQueue.push(fullEvent);

  // Auto-flush if queue is full
  if (eventQueue.length >= MAX_QUEUE_SIZE) {
    flush().catch(() => {});
  }
}

/**
 * Record session start.
 */
export function recordSessionStart(): void {
  sessionStartTime = Date.now();
  record("session_start");
}

/**
 * Record session end with duration.
 */
export function recordSessionEnd(commandCount?: number, agentsUsed?: string[]): void {
  record("session_end", {
    sessionDurationMs: Date.now() - sessionStartTime,
    commandCount,
    agentsUsed,
  });
}

/**
 * Record a slash command invocation.
 */
export function recordCommand(command: string): void {
  record("command_invoked", { command });
}

/**
 * Record an agent routing event.
 */
export function recordAgentRoute(agentName: string): void {
  record("agent_routed", { agentName });
}

/**
 * Record an error (code only, no message).
 */
export function recordError(errorCode: string): void {
  record("error_occurred", { errorCode });
}

/**
 * Record a feature usage event.
 */
export function recordFeature(feature: string): void {
  record("feature_used", { feature });
}

// ============================================================================
// Transport
// ============================================================================

/**
 * Flush queued events to the telemetry endpoint.
 * Best-effort: single attempt, short timeout, no retries.
 */
export async function flush(): Promise<void> {
  if (eventQueue.length === 0) return;
  if (!isEnabled()) {
    eventQueue = [];
    return;
  }

  const events = [...eventQueue];
  eventQueue = [];

  const s = loadState();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    await fetch(TELEMETRY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        anonymousId: s.anonymousId,
        sessionId: crypto.randomUUID(),
        events,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
  } catch {
    // Silently swallow — telemetry must never break the app
  }
}

// ============================================================================
// Lifecycle
// ============================================================================

function startFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    flush().catch(() => {});
  }, FLUSH_INTERVAL_MS);
  // Unref so it doesn't keep the process alive
  if (flushTimer && typeof flushTimer === "object" && "unref" in flushTimer) {
    (flushTimer as NodeJS.Timeout).unref();
  }
}

function stopFlushTimer(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}

/**
 * Initialize telemetry. Call once at startup.
 * Starts the flush timer if telemetry is enabled.
 */
export function init(): void {
  if (isEnabled()) {
    startFlushTimer();
    recordSessionStart();
  }
}

/**
 * Shutdown telemetry. Flushes remaining events.
 * Call during graceful shutdown.
 */
export async function shutdown(): Promise<void> {
  stopFlushTimer();
  if (isEnabled()) {
    await flush();
  }
}
