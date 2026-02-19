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
  recordNetworkRouting,
  recordError,
  recordApiCall,

  // Per-agent metrics
  recordAgentCall,
  getAgentMetrics,
  getAgentHealthReport,
  formatAgentHealthReport,

  // Rate limiting
  checkRateLimit,
  recordRateLimitedCall,
  enforceRateLimit,
  getRateLimitStatus,
  resetRateLimit,
  resetAllRateLimits,
  getRateLimitViolations,

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
  type PerAgentMetrics,
  type AgentHealthReport,
  type AgentCallRecord,
  type RateLimitResult,
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
  getTracer,

  // Types
  type TracingConfig,
  type SpanContext,
  type TracingOptions,
} from "./tracing.ts";
