/**
 * Observability Module Index
 *
 * Exports metrics, tracing, and observability utilities
 */

export {
  // Metrics calculation
  calculateTradeMetrics,
  calculateRiskMetrics,
  calculateAgentMetrics,
  calculateSystemMetrics,
  getAllMetrics,

  // Metrics recording
  recordRequest,
  recordToolCall,
  recordError,
  recordApiCall,

  // Display
  formatMetricsReport,

  // Reset
  resetSessionMetrics,

  // Types
  type TradeMetrics,
  type RiskMetrics,
  type AgentMetrics,
  type SystemMetrics,
  type GordonMetrics,
} from "./metrics.ts";

export {
  // Initialization
  initializeTracing,
  shutdownTracing,

  // Configuration
  getTracingConfig,
  isTracingEnabled,
  getTracingStatus,

  // Span context management
  createSpanContext,
  storeSpanContext,
  getSpanContext,
  removeSpanContext,
  getCurrentSpanContext,

  // ID generation
  generateTraceId,
  generateSpanId,

  // Tracing utilities
  buildTracingOptions,
  withTracing,

  // Types
  type TracingConfig,
  type SpanContext,
  type TracingOptions,
} from "./tracing.ts";
