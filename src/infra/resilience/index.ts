/**
 * Resilience Module
 * Error recovery and fallback strategies for API resilience
 */

// Core resilience patterns
export {
  // Retry
  withRetry,
  // Fallback wrappers
  withFallback,
  withFallbackSimple,
  // Circuit breaker
  CircuitBreaker,
  CircuitBreakerOpenError,
  // Utilities
  getGlobalCircuitBreaker,
  resetAllCircuitBreakers,
  getAllCircuitBreakerStats,
  clearFallbackCache,
  // Types
  type FallbackOptions,
  type ResilientResult,
  type CircuitState,
  type CircuitBreakerStats,
} from "./fallback.ts";

// Pre-configured Binance fallbacks
export {
  // Price operations
  getPrice,
  resilientGetPrice,
  resilientGetAvgPrice,
  getPrices,
  resilientGetPrices,
  // Order book operations
  getOrderBook,
  resilientGetOrderBook,
  resilientGetBookTicker,
  // Spread operations
  getSpread,
  resilientGetSpread,
  // Ticker operations
  get24hrTickers,
  resilientGet24hrTickers,
  getTopSymbols,
  resilientGetTopSymbols,
  // Factory
  createResilientBinanceApi,
  // Types
  type SpreadData,
} from "./binance-fallbacks.ts";
