/**
 * Tracing seam (local no-op).
 *
 * External telemetry export (Mastra Observability + OTLP exporter to Axiom /
 * Logfire) has been removed from this open-source build. The module keeps its
 * exported surface — span-context helpers, id generators, `getMastraInstance`,
 * `initializeTracing`/`shutdownTracing`, `getTracingConfig`/`getTracingStatus`
 * — so callers keep compiling, but nothing is exported off-box.
 * `getMastraInstance()` always returns null and `initializeTracing()` is inert.
 * Local structured logging lives in `src/infra/logger/logger.ts`.
 */

import { createModuleLogger } from "../../logger/index.ts";
import { isEnabled as isTelemetryConsentEnabled } from "../telemetry/telemetry.ts";

const logger = createModuleLogger("tracing");

// ============================================================================
// Types
// ============================================================================

export interface TracingConfig {
  serviceName: string;
  endpoint: string;
  headers: Record<string, string>;
  enabled: boolean;
  requested: boolean;
  reviewed: boolean;
  consentEnabled: boolean;
}

export interface SpanContext {
  traceId: string;
  spanId: string;
}

export interface TracingOptions {
  traceId?: string;
  parentSpanId?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

// ============================================================================
// State
// ============================================================================

let tracingInitialized = false;
let tracingConfig: TracingConfig | null = null;

// Retained for API compatibility with getMastraInstance()/getTracingStatus().
// Always null now that external observability export is removed.
let _mastraInstance: import("@mastra/core").Mastra | null = null;

// Track active spans for context propagation (backward compat)
const activeSpans = new Map<string, SpanContext>();

// ============================================================================
// Configuration
// ============================================================================

/**
 * Get tracing configuration from environment.
 *
 * External export has been removed, so `enabled` is always false and
 * `endpoint`/`headers` are empty. The `requested`/`reviewed`/`consentEnabled`
 * fields are retained so the doctor/telemetry status readouts still reflect
 * operator env, but nothing is ever exported.
 */
export function getTracingConfig(): TracingConfig {
  const requested = process.env.OTEL_TRACING_ENABLED === "true";
  const reviewed = process.env.GORDON_TRACING_REVIEWED === "true";
  const consentEnabled = isTelemetryConsentEnabled();
  return {
    serviceName: process.env.OTEL_SERVICE_NAME || "gordon-trading",
    endpoint: "",
    headers: {},
    enabled: false,
    requested,
    reviewed,
    consentEnabled,
  };
}

/**
 * Check if tracing is enabled
 */
export function isTracingEnabled(): boolean {
  const config = getTracingConfig();
  return config.enabled;
}

// ============================================================================
// Span ID Generation
// ============================================================================

/**
 * Generate a random hex string of specified length
 */
function generateHexId(length: number): string {
  const bytes = new Uint8Array(length / 2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Generate a new trace ID (32 hex characters)
 */
export function generateTraceId(): string {
  return generateHexId(32);
}

/**
 * Generate a new span ID (16 hex characters)
 */
export function generateSpanId(): string {
  return generateHexId(16);
}

// ============================================================================
// Span Context Management
// ============================================================================

/**
 * Create a new span context for tracing
 */
export function createSpanContext(parentContext?: SpanContext): SpanContext {
  return {
    traceId: parentContext?.traceId || generateTraceId(),
    spanId: generateSpanId(),
  };
}

/**
 * Store a span context for later retrieval
 */
export function storeSpanContext(key: string, context: SpanContext): void {
  activeSpans.set(key, context);
}

/**
 * Retrieve a stored span context
 */
export function getSpanContext(key: string): SpanContext | undefined {
  return activeSpans.get(key);
}

/**
 * Remove a stored span context
 */
export function removeSpanContext(key: string): void {
  activeSpans.delete(key);
}

/**
 * Get the current active span context (most recent)
 */
export function getCurrentSpanContext(): SpanContext | undefined {
  const keys = Array.from(activeSpans.keys());
  if (keys.length === 0) return undefined;
  const lastKey = keys[keys.length - 1];
  if (!lastKey) return undefined;
  return activeSpans.get(lastKey);
}

// ============================================================================
// Tracing Options Builder
// ============================================================================

/**
 * Build tracing options for Mastra agent calls.
 * These are passed to agent.generate()/stream() and used by Mastra's
 * internal getOrCreateSpan() to link spans into a trace.
 */
export function buildTracingOptions(options?: {
  parentContext?: SpanContext;
  metadata?: Record<string, unknown>;
  tags?: string[];
}): TracingOptions {
  const spanContext = createSpanContext(options?.parentContext);

  return {
    traceId: spanContext.traceId,
    parentSpanId: options?.parentContext?.spanId,
    metadata: options?.metadata,
    tags: options?.tags,
  };
}

// ============================================================================
// Mastra Observability Instance
// ============================================================================

/**
 * Get the Mastra instance for agent registration.
 * Agents registered via `mastra.addAgent()` get observability spans
 * automatically (agent_run, tool_call, etc.).
 *
 * Returns null if tracing is disabled or not yet initialized.
 */
export function getMastraInstance(): import("@mastra/core").Mastra | null {
  return _mastraInstance;
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize tracing.
 *
 * External telemetry export (Mastra observability + OTLP exporter to Axiom /
 * Logfire) has been removed from this open-source build. This is now a no-op
 * that records local span context only; nothing is exported off-box.
 * Retained so existing callers (`index.tsx`, `/telemetry enable`) still resolve.
 */
export async function initializeTracing(): Promise<void> {
  tracingConfig = getTracingConfig();
  _mastraInstance = null;
  tracingInitialized = true;
  logger.debug("Tracing disabled — external export removed from this build");
}

/**
 * Shutdown tracing and flush any pending spans
 */
export async function shutdownTracing(): Promise<void> {
  if (!tracingInitialized) {
    return;
  }

  logger.debug("Shutting down tracing");
  activeSpans.clear();

  if (_mastraInstance) {
    try {
      const obs = (_mastraInstance as any).observability;
      if (obs && typeof obs.shutdown === "function") {
        await obs.shutdown();
      }
    } catch (err) {
      logger.debug("Observability shutdown error (non-fatal)", { error: String(err) });
    }
    _mastraInstance = null;
  }

  tracingInitialized = false;
  logger.debug("Tracing shutdown complete");
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get tracing status for diagnostics
 */
export function getTracingStatus(): {
  initialized: boolean;
  enabled: boolean;
  config: TracingConfig | null;
  activeSpanCount: number;
  mastraWired: boolean;
} {
  return {
    initialized: tracingInitialized,
    enabled: tracingConfig?.enabled ?? false,
    config: tracingConfig,
    activeSpanCount: activeSpans.size,
    mastraWired: _mastraInstance !== null,
  };
}

/**
 * Create a traced operation wrapper.
 *
 * With Mastra observability enabled, agent.generate()/stream() calls
 * automatically create spans. Use this for custom non-agent operations.
 */
export async function withTracing<T>(
  operationName: string,
  fn: (context: SpanContext) => Promise<T>,
  options?: { parentContext?: SpanContext; metadata?: Record<string, unknown> }
): Promise<T> {
  const spanContext = createSpanContext(options?.parentContext);
  const spanKey = `${operationName}-${spanContext.spanId}`;

  storeSpanContext(spanKey, spanContext);

  try {
    logger.debug("Starting traced operation", {
      operation: operationName,
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
    });

    const result = await fn(spanContext);

    logger.debug("Traced operation completed", {
      operation: operationName,
      traceId: spanContext.traceId,
    });

    return result;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error("Traced operation failed", error, {
      operationName,
      traceId: spanContext.traceId,
    });
    throw error;
  } finally {
    removeSpanContext(spanKey);
  }
}
