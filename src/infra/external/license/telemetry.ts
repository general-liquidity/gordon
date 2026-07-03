/**
 * License Telemetry
 *
 * Batches usage events and flushes them via the Supabase heartbeat
 * endpoint. Fire-and-forget — never blocks the main thread.
 *
 * Events tracked: startup, activation, command_run, scan_completed,
 * trade_placed, trade_closed, error.
 *
 * Never tracked: exchange keys, API keys, trade amounts, PnL, symbols, PII.
 */

import { VERSION } from "../../../cli.ts";
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  HEARTBEAT_INTERVAL_MS,
  API_TIMEOUT_MS,
  type TelemetryEvent,
  type HeartbeatResponse,
  type VersionPolicy,
} from "./types.ts";

// ============================================================================
// Version Policy Capture
// ============================================================================

/**
 * Latest version policy returned by the server. Captured on every heartbeat
 * so the license module can enforce hard/soft version gates on the next tick.
 */
let latestVersionPolicy: VersionPolicy | null = null;
const versionPolicyListeners: Array<(p: VersionPolicy) => void> = [];

export function getLatestVersionPolicy(): VersionPolicy | null {
  return latestVersionPolicy;
}

/**
 * Register a callback that fires whenever a new version policy arrives.
 * Used by license/index.ts to enforce immediately when the policy changes
 * (e.g. user starts Gordon, heartbeat fires, server says minVersion=1.0.0,
 * client is 0.9.0 → exit immediately rather than wait for next startup).
 */
export function onVersionPolicy(listener: (p: VersionPolicy) => void): () => void {
  versionPolicyListeners.push(listener);
  return () => {
    const idx = versionPolicyListeners.indexOf(listener);
    if (idx !== -1) versionPolicyListeners.splice(idx, 1);
  };
}

function captureVersionPolicy(policy: VersionPolicy): void {
  latestVersionPolicy = policy;
  for (const listener of versionPolicyListeners) {
    try {
      listener(policy);
    } catch {
      // Listener errors must never break the heartbeat path
    }
  }
}

// ============================================================================
// Entitlement (Plan) Capture
// ============================================================================

/**
 * Latest entitlement tier reported by the server. Captured on every heartbeat
 * so the license module can answer getActivePlan() without a fresh network
 * call. Empty/blank values are ignored so a malformed response never downgrades
 * a known plan mid-session.
 */
let latestPlan: string | null = null;

export function getLatestPlan(): string | null {
  return latestPlan;
}

export function recordHeartbeatPlan(plan: string | null | undefined): void {
  if (typeof plan === "string" && plan.trim().length > 0) {
    latestPlan = plan.trim();
  }
}

// ============================================================================
// Constants
// ============================================================================

const MAX_QUEUE_SIZE = 500;

// ============================================================================
// State
// ============================================================================

let token: string | null = null;
let eventQueue: TelemetryEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

// ============================================================================
// Public API
// ============================================================================

/**
 * Start the heartbeat timer. Called after license validation.
 */
export function startHeartbeat(licenseToken: string): void {
  // Enforce HTTPS on the license server URL
  if (!SUPABASE_URL.startsWith("https://")) {
    return; // Silently refuse to send telemetry over insecure connection
  }

  token = licenseToken;

  if (flushTimer) return; // already running

  flushTimer = setInterval(() => {
    flush().catch(() => {});
  }, HEARTBEAT_INTERVAL_MS);

  // Don't keep the process alive just for telemetry
  if (flushTimer.unref) flushTimer.unref();
}

/**
 * Stop the heartbeat timer and flush remaining events.
 */
export async function stopHeartbeat(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  await flush();
}

/**
 * Track a usage event. Fire-and-forget, never throws.
 */
export function trackEvent(type: string, metadata?: Record<string, unknown>): void {
  // Drop events if queue is at capacity to prevent unbounded memory growth
  if (eventQueue.length >= MAX_QUEUE_SIZE) return;

  eventQueue.push({
    type,
    metadata,
    timestamp: new Date().toISOString(),
  });

  // Auto-flush if queue gets large
  if (eventQueue.length >= 20) {
    flush().catch(() => {});
  }
}

// ============================================================================
// Flush
// ============================================================================

async function flush(): Promise<void> {
  if (!token || eventQueue.length === 0) return;

  const batch = eventQueue.splice(0);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/heartbeat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "apikey": SUPABASE_ANON_KEY,
        "x-gordon-token": token,
      },
      body: JSON.stringify({
        events: batch,
        cliVersion: VERSION,
      }),
      signal: controller.signal,
    });

    if (res.ok) {
      const data = (await res.json()) as HeartbeatResponse;

      // Print announcements (e.g., "Update available!")
      if (data.announcements?.length) {
        for (const msg of data.announcements) {
          console.log(`\n  [gordon] ${msg}`);
        }
      }

      // Capture version policy — fires registered listeners which enforce
      // hard/soft version gates and the kill switch.
      if (data.versionPolicy) {
        captureVersionPolicy(data.versionPolicy);
      }

      // Capture entitlement tier so getActivePlan() reflects the latest
      // heartbeat without another round-trip.
      recordHeartbeatPlan(data.plan);
    } else {
      // Re-queue on failure, respecting the cap
      requeue(batch);
    }
  } catch {
    // Network error — re-queue, respecting the cap
    requeue(batch);
  } finally {
    clearTimeout(timeout);
  }
}

function requeue(batch: TelemetryEvent[]): void {
  const available = MAX_QUEUE_SIZE - eventQueue.length;
  if (available > 0) {
    // Keep only as many as we have room for (newest events already in queue take priority)
    eventQueue.unshift(...batch.slice(0, available));
  }
  // If no room, drop the batch — better than OOM
}
