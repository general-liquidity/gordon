/**
 * Multi-Sink Event Router
 *
 * Claude Code pattern: instead of one telemetry pipe, fan events out to
 * multiple typed sinks (crash / usage / metrics / audit). Each sink decides
 * whether it accepts an event via accepts() and ships it via send(). The
 * router is fire-and-forget and never blocks the caller.
 *
 * Why split sinks:
 *   - Crash reports and usage metrics have different retention, sampling, PII
 *     posture, and backends. Mixing them makes everything brittle.
 *   - Each sink can be enabled/disabled independently via env or config.
 *   - New sinks can be added without changing the recording call sites.
 *
 * Built-in sinks live below (LocalCrashSink, LocalUsageSink). External sinks
 * (custom) register via registerSink() at startup.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { GORDON_DIR } from "../../storage/paths.ts";
import { createModuleLogger } from "../../logger/index.ts";
import type { TelemetryEvent } from "./events.ts";

const logger = createModuleLogger("telemetry-sinks");

// ============================================================================
// Types
// ============================================================================

export type EventCategory = "crash" | "usage" | "metric" | "audit";

export interface RoutedEvent {
  category: EventCategory;
  event: TelemetryEvent;
}

export interface TelemetrySink {
  name: string;
  /** Should this sink consume the event? */
  accepts(event: RoutedEvent): boolean;
  /** Ship the event. Must not throw — log and swallow internally. */
  send(event: RoutedEvent): Promise<void> | void;
  /** Optional cleanup on shutdown (flush buffers, close handles). */
  shutdown?: () => Promise<void> | void;
}

// ============================================================================
// Built-in: Local Crash Sink
// ============================================================================

class LocalCrashSink implements TelemetrySink {
  readonly name = "local-crash";
  private readonly file = path.join(GORDON_DIR, "telemetry", "crashes.jsonl");

  accepts(event: RoutedEvent): boolean {
    return event.category === "crash";
  }

  send(event: RoutedEvent): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.appendFileSync(this.file, `${JSON.stringify(event.event)}\n`, "utf-8");
    } catch (err) {
      logger.warn("LocalCrashSink write failed", { err: String(err) });
    }
  }
}

// ============================================================================
// Built-in: Local Usage Sink
// ============================================================================

class LocalUsageSink implements TelemetrySink {
  readonly name = "local-usage";
  private readonly file = path.join(GORDON_DIR, "telemetry", "usage.jsonl");

  accepts(event: RoutedEvent): boolean {
    return event.category === "usage" || event.category === "metric";
  }

  send(event: RoutedEvent): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.appendFileSync(this.file, `${JSON.stringify(event.event)}\n`, "utf-8");
    } catch (err) {
      logger.warn("LocalUsageSink write failed", { err: String(err) });
    }
  }
}

// ============================================================================
// Router
// ============================================================================

const sinks: TelemetrySink[] = [];
let routerInitialized = false;

/** Register an additional sink. Idempotent by name. */
export function registerSink(sink: TelemetrySink): void {
  if (sinks.find((s) => s.name === sink.name)) return;
  sinks.push(sink);
}

/** Initialize built-in sinks. Idempotent. */
export function initSinks(): void {
  if (routerInitialized) return;
  routerInitialized = true;
  registerSink(new LocalCrashSink());
  registerSink(new LocalUsageSink());
}

/**
 * Categorize a raw telemetry event by name. Crash events live in their own
 * lane; everything else is treated as usage metrics.
 */
export function categorize(event: TelemetryEvent): EventCategory {
  const name = event.event;
  if (
    name === "uncaught_exception" ||
    name === "unhandled_rejection" ||
    name === "error_occurred"
  ) {
    return "crash";
  }
  if (
    name === "session_start" ||
    name === "session_end" ||
    name === "command_invoked" ||
    name === "agent_routed" ||
    name === "feature_used"
  ) {
    return "usage";
  }
  return "metric";
}

/**
 * Route an event to all matching sinks. Fire-and-forget — never blocks.
 * Errors per-sink are isolated; a failing sink doesn't affect others.
 */
export function routeEvent(event: TelemetryEvent): void {
  if (!routerInitialized) initSinks();
  const routed: RoutedEvent = { category: categorize(event), event };
  for (const sink of sinks) {
    if (!sink.accepts(routed)) continue;
    try {
      const result = sink.send(routed);
      if (result instanceof Promise) {
        result.catch((err) => {
          logger.warn("Sink send rejected", { sink: sink.name, err: String(err) });
        });
      }
    } catch (err) {
      logger.warn("Sink send threw", { sink: sink.name, err: String(err) });
    }
  }
}

/** Shut down all sinks. Best-effort. */
export async function shutdownSinks(): Promise<void> {
  for (const sink of sinks) {
    if (!sink.shutdown) continue;
    try {
      await Promise.resolve(sink.shutdown());
    } catch (err) {
      logger.warn("Sink shutdown failed", { sink: sink.name, err: String(err) });
    }
  }
}

/** For tests + observability. */
export function listSinks(): Array<{ name: string }> {
  return sinks.map((s) => ({ name: s.name }));
}

export function resetSinks(): void {
  sinks.length = 0;
  routerInitialized = false;
}
