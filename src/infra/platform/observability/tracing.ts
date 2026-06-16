/**
 * OpenTelemetry Tracing Module (Mastra Native Observability)
 *
 * Uses Mastra's Observability framework with OtelExporter for Axiom.
 * Creates a minimal Mastra instance to wire observability into agents,
 * enabling automatic agent-level span creation (agent_run, tool_call, etc.)
 * with SensitiveDataFilter for redacting API keys from exported traces.
 *
 * Environment Variables:
 * - OTEL_TRACING_ENABLED: Enable/disable tracing (default: false)
 * - GORDON_TRACING_REVIEWED: Secondary explicit review gate required for export (default: false)
 * - OTEL_EXPORTER_OTLP_ENDPOINT: OTLP endpoint URL (default: https://api.axiom.co/v1/traces)
 * - OTEL_EXPORTER_OTLP_HEADERS: Auth headers (e.g. "Authorization=Bearer xxx,X-Axiom-Dataset=gordon-traces")
 * - OTEL_SERVICE_NAME: Service name for traces (default: gordon-trading)
 *
 * Tracing also follows the user's telemetry consent state from `/telemetry enable`.
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
let tracingReviewWarningShown = false;
let tracingConsentWarningShown = false;

// Mastra instance for wiring observability to agents
let _mastraInstance: import("@mastra/core").Mastra | null = null;

// Track active spans for context propagation (backward compat)
const activeSpans = new Map<string, SpanContext>();

// ============================================================================
// Configuration
// ============================================================================

/**
 * Parse OTLP headers from comma-separated "Key=Value" string
 */
function parseOtlpHeaders(raw?: string): Record<string, string> {
  if (!raw) return {};
  const headers: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const idx = pair.indexOf("=");
    if (idx > 0) {
      headers[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    }
  }
  return headers;
}

export type TracingTarget = "custom" | "logfire" | "axiom";

/**
 * Resolve the OTLP export destination + auth headers. Precedence:
 *   1. Explicit `OTEL_EXPORTER_OTLP_ENDPOINT` — any OTLP backend, full control.
 *   2. Pydantic Logfire — set `LOGFIRE_TOKEN` (write token). Region via
 *      `LOGFIRE_BASE_URL` (default US `https://logfire-us.pydantic.dev`). Gordon's
 *      OTel spans (agent_run, tool_call, LLM calls) then land in Logfire with no
 *      hand-crafted OTLP env strings.
 *   3. Axiom default.
 */
export function resolveExporterTarget(): { target: TracingTarget; endpoint: string; headers: Record<string, string> } {
  const explicit = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (explicit) {
    return { target: "custom", endpoint: explicit, headers: parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS) };
  }
  const logfireToken = process.env.LOGFIRE_TOKEN;
  if (logfireToken) {
    const base = (process.env.LOGFIRE_BASE_URL || "https://logfire-us.pydantic.dev").replace(/\/+$/, "");
    return { target: "logfire", endpoint: `${base}/v1/traces`, headers: { Authorization: logfireToken } };
  }
  return {
    target: "axiom",
    endpoint: "https://api.axiom.co/v1/traces",
    headers: parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
  };
}

/**
 * Get tracing configuration from environment
 */
export function getTracingConfig(): TracingConfig {
  const requested = process.env.OTEL_TRACING_ENABLED === "true";
  const reviewed = process.env.GORDON_TRACING_REVIEWED === "true";
  const consentEnabled = isTelemetryConsentEnabled();
  const { endpoint, headers } = resolveExporterTarget();
  return {
    serviceName: process.env.OTEL_SERVICE_NAME || "gordon-trading",
    endpoint,
    headers,
    enabled: requested && reviewed && consentEnabled,
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
 * Initialize Mastra-native observability tracing.
 *
 * Creates an Observability instance with:
 * - OtelExporter: Sends Mastra spans to Axiom via OTLP
 * - SensitiveDataFilter: Redacts API keys/secrets from exported spans
 *
 * Then creates a minimal Mastra instance so agents can be registered
 * and automatically produce traced spans.
 *
 * Set these env vars to enable:
 *   OTEL_TRACING_ENABLED=true
 *   GORDON_TRACING_REVIEWED=true
 *   OTEL_EXPORTER_OTLP_ENDPOINT=https://api.axiom.co/v1/traces
 *   OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer <AXIOM_TOKEN>,X-Axiom-Dataset=gordon-traces
 *
 * The local install must also have telemetry consent enabled.
 */
export async function initializeTracing(): Promise<void> {
  const nextConfig = getTracingConfig();
  const hadMastraInstance = _mastraInstance !== null;
  const configChanged = !tracingConfig
    || tracingConfig.enabled !== nextConfig.enabled
    || tracingConfig.requested !== nextConfig.requested
    || tracingConfig.reviewed !== nextConfig.reviewed
    || tracingConfig.consentEnabled !== nextConfig.consentEnabled
    || tracingConfig.serviceName !== nextConfig.serviceName
    || tracingConfig.endpoint !== nextConfig.endpoint
    || JSON.stringify(tracingConfig.headers) !== JSON.stringify(nextConfig.headers);

  if (hadMastraInstance && configChanged) {
    await shutdownTracing();
  } else if (tracingInitialized && !configChanged) {
    logger.debug("Tracing already initialized");
    return;
  }

  tracingConfig = nextConfig;

  if (!tracingConfig.enabled) {
    if (tracingConfig.requested && !tracingConfig.reviewed && !tracingReviewWarningShown) {
      logger.warn(
        "OTEL tracing was requested but remains disabled until GORDON_TRACING_REVIEWED=true is set.",
      );
      tracingReviewWarningShown = true;
    } else if (
      tracingConfig.requested
      && tracingConfig.reviewed
      && !tracingConfig.consentEnabled
      && !tracingConsentWarningShown
    ) {
      logger.warn(
        "OTEL tracing was requested and reviewed, but remains blocked until telemetry consent is enabled.",
      );
      tracingConsentWarningShown = true;
    } else {
      logger.debug(
        "Tracing disabled (set OTEL_TRACING_ENABLED=true, GORDON_TRACING_REVIEWED=true, and enable telemetry consent to export)",
      );
    }
    tracingInitialized = true;
    return;
  }

  logger.info("Initializing Mastra observability tracing", {
    serviceName: tracingConfig.serviceName,
    endpoint: tracingConfig.endpoint,
  });

  try {
    // Lazy imports to avoid loading heavy OTEL deps when tracing is disabled
    const [
      { Observability, SensitiveDataFilter },
      { OtelExporter },
      { Mastra },
    ] = await Promise.all([
      import("@mastra/observability"),
      import("@mastra/otel-exporter"),
      import("@mastra/core"),
    ]);

    const otelExporter = new OtelExporter({
      provider: {
        custom: {
          endpoint: tracingConfig.endpoint,
          headers: tracingConfig.headers,
          protocol: "http/protobuf" as const,
        },
      },
      resourceAttributes: {
        "service.name": tracingConfig.serviceName,
        "service.version": process.env.npm_package_version || "unknown",
      },
    });

    const observability = new Observability({
      configs: {
        default: {
          serviceName: tracingConfig.serviceName,
          exporters: [otelExporter],
          spanOutputProcessors: [
            new SensitiveDataFilter({
              sensitiveFields: [
                "apikey", "secret", "token", "authorization",
                "bearer", "password", "privatekey", "credential",
              ],
              redactionStyle: "partial",
            }),
          ],
        },
      },
    });

    // Create Mastra instance with observability + storage.
    // Storage is required for agent approval snapshots (per Mastra docs:
    // "Configure a storage provider on your Mastra instance or you'll see
    // a 'snapshot not found' error").
    // Agents are registered later via getMastraInstance().addAgent().
    let storageProvider: import("@mastra/core/storage").MastraCompositeStore | undefined;
    try {
      const { createMastraStorageConfig } = await import("../../agents/memory/mastraStorage.ts");
      const dbUrl = process.env.DATABASE_URL || "file:gordon.db";
      const config = createMastraStorageConfig({ storeId: "gordon-mastra", dbUrl, enableVector: false });
      storageProvider = config.storage;
    } catch {
      // Storage optional — approval snapshots won't persist but agent still works
    }
    _mastraInstance = new Mastra({
      observability,
      ...(storageProvider ? { storage: storageProvider } : {}),
    });

    try {
      const { registerAllAgentsForTracing } = await import("../../agents/agentHelpers.ts");
      await registerAllAgentsForTracing();
    } catch {
      // Agent registration is best-effort when tracing starts before agents load
    }

    tracingInitialized = true;
    logger.info("Mastra observability tracing initialized");
  } catch (err) {
    logger.error(
      "Failed to initialize Mastra observability",
      err instanceof Error ? err : new Error(String(err)),
    );
    tracingInitialized = true; // Mark as initialized to avoid retries
  }
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
