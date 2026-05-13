/**
 * Lightweight OpenTelemetry-compatible tracer (GORDON_OTEL).
 *
 * Port of item 10 from the harness-engineering Tier 3 plan, L11.
 *
 * This is a **thin** wrapper, not a full OTel SDK integration. The goal
 * is to introduce span semantics into Gordon's tool/event paths without
 * a heavy dependency. The shape mirrors the OTel `Span` / `Tracer` API
 * so a real `@opentelemetry/api` backend can be swapped in later by
 * implementing the `Backend` interface.
 *
 *   - When the flag is off: all calls are no-ops (zero allocations).
 *   - When the flag is on with no backend: spans land in a JSONL file
 *     at `~/.gordon/otel-traces.jsonl` for offline analysis.
 *   - When a custom backend is registered: spans dispatch there too.
 *
 * Span semantics:
 *   - `startSpan(name, attrs)` returns a `Span` with `setAttribute`,
 *     `setStatus`, `recordError`, `addEvent`, `end`.
 *   - `withSpan(name, attrs, fn)` wraps an async function and auto-ends
 *     the span (recording any thrown error as the status).
 *
 * Trace correlation:
 *   - `traceId` is a 32-hex-char id, `spanId` is 16-hex-char.
 *   - A `parentSpanId` field lets callers nest spans.
 *   - A `runWithSpan` helper sets an AsyncLocalStorage parent so nested
 *     `startSpan` calls inherit the parent automatically.
 *
 * The module deliberately does NOT auto-instrument anything — wiring
 * into `instrumentedTools.ts` is a separate hot-path change.
 */

import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

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

export function isOtelEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[OTEL_FLAG_ENV] === "1" || env[OTEL_FLAG_ENV] === "true";
}

export function defaultTracesPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[OTEL_PATH_ENV];
  if (override && override.length > 0) return override;
  return join(homedir(), ".gordon", "otel-traces.jsonl");
}

function generateTraceId(): string {
  return randomBytes(16).toString("hex");
}

function generateSpanId(): string {
  return randomBytes(8).toString("hex");
}

function ensureParentDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Default JSONL backend — appends span records to a file.
 * Useful for offline trace analysis without standing up Jaeger.
 */
export function createJsonlBackend(path?: string): Backend {
  const target = path ?? defaultTracesPath();
  return {
    onSpanEnd(span: SpanRecord): void {
      ensureParentDir(target);
      appendFileSync(target, JSON.stringify(span) + "\n", "utf8");
    },
  };
}

/**
 * No-op span. Returned when the flag is off so callers can write
 * `startSpan(...)` unconditionally without paying the cost when disabled.
 */
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

const spanContext = new AsyncLocalStorage<{ traceId: string; spanId: string }>();

let activeBackends: Backend[] = [];
let backendsInitialized = false;

function getBackends(): Backend[] {
  if (!backendsInitialized) {
    if (isOtelEnabled()) {
      activeBackends.push(createJsonlBackend());
    }
    backendsInitialized = true;
  }
  return activeBackends;
}

/** Register an additional backend (e.g. real OTel exporter). */
export function registerBackend(backend: Backend): void {
  getBackends();
  activeBackends.push(backend);
}

/** Reset for tests. */
export function resetTracerForTesting(): void {
  activeBackends = [];
  backendsInitialized = false;
}

export interface StartSpanOptions {
  attributes?: Record<string, AttributeValue>;
  /** Override active parent. */
  parentSpanId?: string | null;
  /** Override trace id (used to continue an existing trace across boundaries). */
  traceId?: string;
  /** Inject a clock for tests. */
  now?: () => number;
  /**
   * When provided, span events are routed only to this backend list.
   * Default: globally registered backends.
   */
  backends?: Backend[];
  /** Force-enable for tests even without the flag. */
  forceEnabled?: boolean;
}

export function startSpan(name: string, opts: StartSpanOptions = {}): Span {
  const enabled = opts.forceEnabled === true || isOtelEnabled();
  if (!enabled) return NOOP_SPAN;

  const parent = spanContext.getStore();
  const traceId = opts.traceId ?? parent?.traceId ?? generateTraceId();
  const spanId = generateSpanId();
  const parentSpanId = opts.parentSpanId ?? parent?.spanId ?? null;
  const now = opts.now ?? Date.now;

  const record: SpanRecord = {
    traceId,
    spanId,
    parentSpanId,
    name,
    attributes: { ...(opts.attributes ?? {}) },
    events: [],
    status: "unset",
    statusMessage: null,
    startTimeMs: now(),
    endTimeMs: null,
    durationMs: null,
  };

  let ended = false;
  const backends = opts.backends ?? getBackends();

  const span: Span = {
    traceId,
    spanId,
    setAttribute(key, value) {
      if (ended) return;
      record.attributes[key] = value;
    },
    setStatus(status, message) {
      if (ended) return;
      record.status = status;
      record.statusMessage = message ?? null;
    },
    recordError(err) {
      if (ended) return;
      record.status = "error";
      if (err instanceof Error) {
        record.error = { name: err.name, message: err.message, stack: err.stack };
        record.statusMessage = err.message;
      } else {
        record.error = { name: "unknown", message: String(err) };
        record.statusMessage = String(err);
      }
    },
    addEvent(eventName, attributes = {}) {
      if (ended) return;
      record.events.push({ name: eventName, attributes, timestampMs: now() });
    },
    end() {
      if (ended) return record;
      ended = true;
      record.endTimeMs = now();
      record.durationMs = record.endTimeMs - record.startTimeMs;
      for (const b of backends) {
        try {
          b.onSpanEnd(record);
        } catch {
          // backend failures must not break instrumented code
        }
      }
      return record;
    },
  };

  return span;
}

/**
 * Wrap an async function in a span. Auto-records thrown errors as
 * span status and re-throws. Nested `startSpan` calls inside `fn`
 * inherit `span` as parent via AsyncLocalStorage.
 */
export async function withSpan<T>(
  name: string,
  attrs: Record<string, AttributeValue>,
  fn: (span: Span) => Promise<T>,
  opts: Omit<StartSpanOptions, "attributes"> = {},
): Promise<T> {
  const span = startSpan(name, { ...opts, attributes: attrs });
  try {
    const result = await spanContext.run(
      { traceId: span.traceId, spanId: span.spanId },
      () => fn(span),
    );
    if (span !== NOOP_SPAN) span.setStatus("ok");
    return result;
  } catch (err) {
    if (span !== NOOP_SPAN) span.recordError(err);
    throw err;
  } finally {
    span.end();
  }
}

/** Read current trace context (e.g. for cross-process propagation). */
export function getActiveTraceContext(): { traceId: string; spanId: string } | null {
  return spanContext.getStore() ?? null;
}
