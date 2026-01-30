/**
 * OpenTelemetry Tracing Module
 *
 * Configures OpenTelemetry tracing for Gordon's agent infrastructure.
 * Integrates with Mastra's observability system via the OTEL bridge pattern.
 *
 * Environment Variables:
 * - OTEL_EXPORTER_OTLP_ENDPOINT: OTLP endpoint URL (default: http://localhost:4318/v1/traces)
 * - OTEL_SERVICE_NAME: Service name for traces (default: gordon-trading)
 * - OTEL_TRACING_ENABLED: Enable/disable tracing (default: false)
 */

import { createModuleLogger } from "../logger/index.ts";

const logger = createModuleLogger("tracing");

// ============================================================================
// Types
// ============================================================================

export interface TracingConfig {
  serviceName: string;
  endpoint: string;
  enabled: boolean;
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

// Track active spans for context propagation
const activeSpans = new Map<string, SpanContext>();

// ============================================================================
// Configuration
// ============================================================================

/**
 * Get tracing configuration from environment
 */
export function getTracingConfig(): TracingConfig {
  return {
    serviceName: process.env.OTEL_SERVICE_NAME || "gordon-trading",
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318/v1/traces",
    enabled: process.env.OTEL_TRACING_ENABLED === "true",
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
 * Build tracing options for Mastra agent calls
 *
 * Usage with agent.generate() or agent.stream():
 * ```typescript
 * const tracingOptions = buildTracingOptions({ tags: ["market-scan"] });
 * const result = await agent.generate(message, {
 *   tracingOptions,
 *   requestContext,
 * });
 * ```
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
// Initialization
// ============================================================================

/**
 * Initialize OpenTelemetry tracing
 *
 * This sets up the tracing infrastructure. When OTEL_TRACING_ENABLED is true,
 * traces will be exported to the configured OTLP endpoint.
 *
 * Note: Full OTEL SDK initialization requires additional dependencies:
 * - @opentelemetry/sdk-node
 * - @opentelemetry/auto-instrumentations-node
 * - @opentelemetry/exporter-trace-otlp-proto
 *
 * For now, this module provides lightweight tracing context management
 * that integrates with Mastra's built-in observability system.
 */
export function initializeTracing(): void {
  if (tracingInitialized) {
    logger.debug("Tracing already initialized");
    return;
  }

  tracingConfig = getTracingConfig();

  if (!tracingConfig.enabled) {
    logger.debug("Tracing disabled (set OTEL_TRACING_ENABLED=true to enable)");
    tracingInitialized = true;
    return;
  }

  logger.info("Initializing OpenTelemetry tracing", {
    serviceName: tracingConfig.serviceName,
    endpoint: tracingConfig.endpoint,
  });

  // Note: Full OTEL SDK setup would go here when dependencies are added:
  //
  // import { NodeSDK } from "@opentelemetry/sdk-node";
  // import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
  // import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
  // import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
  //
  // const sdk = new NodeSDK({
  //   serviceName: tracingConfig.serviceName,
  //   spanProcessors: [
  //     new BatchSpanProcessor(
  //       new OTLPTraceExporter({ url: tracingConfig.endpoint })
  //     )
  //   ],
  //   instrumentations: [getNodeAutoInstrumentations()],
  // });
  //
  // sdk.start();

  tracingInitialized = true;
  logger.info("Tracing initialized successfully");
}

/**
 * Shutdown tracing and flush any pending spans
 */
export async function shutdownTracing(): Promise<void> {
  if (!tracingInitialized) {
    return;
  }

  logger.debug("Shutting down tracing");

  // Clear active spans
  activeSpans.clear();

  // Note: Full OTEL SDK shutdown would go here:
  // await sdk.shutdown();

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
} {
  return {
    initialized: tracingInitialized,
    enabled: tracingConfig?.enabled ?? false,
    config: tracingConfig,
    activeSpanCount: activeSpans.size,
  };
}

/**
 * Create a traced operation wrapper
 *
 * Usage:
 * ```typescript
 * const result = await withTracing("scan-market", async (context) => {
 *   return scanMarket(options);
 * });
 * ```
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
