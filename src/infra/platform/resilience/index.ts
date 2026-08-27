/**
 * Resilience Module
 * Error recovery and fallback strategies for API resilience
 */

export {
  withRetry,
  withFallback,
  withFallbackSimple,
  CircuitBreaker,
  CircuitBreakerOpenError,
  getGlobalCircuitBreaker,
  resetAllCircuitBreakers,
  getAllCircuitBreakerStats,
  clearFallbackCache,
  type FallbackOptions,
  type ResilientResult,
  type CircuitState,
  type CircuitBreakerStats,
} from "./fallback.ts";
