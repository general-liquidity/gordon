/**
 * Local span seam (no-op).
 *
 * This module previously implemented a lightweight tracer with a
 * pluggable `Backend` interface (a seam a real OTel exporter could be
 * registered into). External telemetry export has been removed from
 * this open-source build, so the tracer is now a pure local no-op.
 *
 * The exported surface (types + `startSpan` / `withSpan` / span methods)
 * is preserved so the tool-metrics wrapper and any other callers keep
 * compiling. Spans do nothing and are never dispatched anywhere; local
 * structured logging lives in `src/infra/logger/logger.ts`.
 */

import { join } from "node:path";
import { homedir } from "node:os";

export const OTEL_FLAG_ENV = "GORDON_OTEL";
export const OTEL_PATH_ENV = "GORDON_OTEL_TRACES_PATH";

export type AttributeValue = string | number | boolean | null;
export type SpanStatus = "unset" | "ok" | "error";

export interface SpanRecord {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  attributes: Record<string, AttributeValue>;
  events: Array<{ name: string; attributes: Record<string, AttributeValue>; timestampMs: number }>;
  status: SpanStatus;
  statusMessage: string | null;
  startTimeMs: number;
  endTimeMs: number | null;
  durationMs: number | null;
  error?: { name: string; message: string; stack?: string } | null;
}

export interface Span {
  readonly traceId: string;
  readonly spanId: string;
  setAttribute(key: string, value: AttributeValue): void;
  setStatus(status: SpanStatus, message?: string): void;
  recordError(err: unknown): void;
  addEvent(name: string, attributes?: Record<string, AttributeValue>): void;
  end(): SpanRecord;
}

export interface Backend {
  onSpanEnd(span: SpanRecord): void;
}

/** Retained for API compatibility. Always false — no external export. */
export function isOtelEnabled(_env: NodeJS.ProcessEnv = process.env): boolean {
  return false;
}

export function defaultTracesPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[OTEL_PATH_ENV];
  if (override && override.length > 0) return override;
  return join(homedir(), ".gordon", "otel-traces.jsonl");
}

const NOOP_SPAN_RECORD: SpanRecord = {
  traceId: "00000000000000000000000000000000",
  spanId: "0000000000000000",
  parentSpanId: null,
  name: "noop",
  attributes: {},
  events: [],
  status: "unset",
  statusMessage: null,
  startTimeMs: 0,
  endTimeMs: 0,
  durationMs: 0,
};

const NOOP_SPAN: Span = {
  traceId: NOOP_SPAN_RECORD.traceId,
  spanId: NOOP_SPAN_RECORD.spanId,
  setAttribute() {},
  setStatus() {},
  recordError() {},
  addEvent() {},
  end() {
    return NOOP_SPAN_RECORD;
  },
};

/** No-op backend factory retained for API compatibility. */
export function createJsonlBackend(_path?: string): Backend {
  return { onSpanEnd() {} };
}

/** No-op — backend registration is disabled (no external export). */
export function registerBackend(_backend: Backend): void {}

/** No-op — retained for tests/callers. */
export function resetTracerForTesting(): void {}

export interface StartSpanOptions {
  attributes?: Record<string, AttributeValue>;
  parentSpanId?: string | null;
  traceId?: string;
  now?: () => number;
  backends?: Backend[];
  forceEnabled?: boolean;
}

export function startSpan(_name: string, _opts: StartSpanOptions = {}): Span {
  return NOOP_SPAN;
}

/**
 * Wrap an async function. The span is a no-op; the function runs and its
 * result is returned, and thrown errors propagate as before.
 */
export async function withSpan<T>(
  _name: string,
  _attrs: Record<string, AttributeValue>,
  fn: (span: Span) => Promise<T>,
  _opts: Omit<StartSpanOptions, "attributes"> = {},
): Promise<T> {
  return fn(NOOP_SPAN);
}

/** No active trace context — always null. */
export function getActiveTraceContext(): { traceId: string; spanId: string } | null {
  return null;
}
