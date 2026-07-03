/**
 * Broker Abstraction Layer
 *
 * Unified stock/options broker interface for Gordon.
 *
 * Supported brokers (current):
 * - Alpaca
 * - tastytrade
 * - Interactive Brokers
 */

export * from "./types.ts";
export { BrokerFactory } from "./factory.ts";
export { loadOAuthBrokerCredentials, brokerSupportsOAuth } from "./auth/oauth-bridge.ts";
export {
  runBrokerBenchmarks,
  validateBenchmarkReport,
  formatBenchmarkSummary,
} from "./quality/benchmarks.ts";
export {
  BROKER_INCLUSION_GATE,
  getBrokerInclusionDecision,
  getFailedCriteria,
  validateBrokerInclusionGate,
  assertBrokerPassesInclusionGate,
} from "./quality/inclusion-gate.ts";
export { AlpacaAdapter } from "./adapters/alpaca.ts";
export { TastytradeAdapter } from "./adapters/tastytrade.ts";
export { IbkrAdapter } from "./adapters/ibkr.ts";

export type {
  BrokerAdapter,
  BrokerId,
  BrokerCredentials,
  BrokerCapabilities,
  BrokerAccount,
  BrokerClock,
  BrokerPosition,
  BrokerOrder,
  BrokerOrderRequest,
  BrokerOrderListParams,
  BrokerOrderSide,
  BrokerOrderType,
  BrokerOrderStatus,
  BrokerQuote,
} from "./types.ts";
