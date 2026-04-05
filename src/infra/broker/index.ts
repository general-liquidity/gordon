/**
 * Broker Abstraction Layer
 *
 * Unified stock/options broker interface for Gordon.
 *
 * Supported brokers (current):
 * - Alpaca
 * - Webull
 * - Schwab
 * - Tradier
 * - TradeStation
 * - tastytrade
 * - Trading 212
 * - E*TRADE
 * - Interactive Brokers
 */

export * from "./types.ts";
export { BrokerFactory } from "./factory.ts";
export { loadOAuthBrokerCredentials, brokerSupportsOAuth } from "./oauth-bridge.ts";
export {
  runBrokerBenchmarks,
  validateBenchmarkReport,
  formatBenchmarkSummary,
} from "./benchmarks.ts";
export {
  BROKER_INCLUSION_GATE,
  getBrokerInclusionDecision,
  getFailedCriteria,
  validateBrokerInclusionGate,
  assertBrokerPassesInclusionGate,
} from "./inclusion-gate.ts";
export { AlpacaAdapter } from "./adapters/alpaca.ts";
export { WebullAdapter } from "./adapters/webull.ts";
export { SchwabAdapter } from "./adapters/schwab.ts";
export { TradierAdapter } from "./adapters/tradier.ts";
export { TradeStationAdapter } from "./adapters/tradestation.ts";
export { TastytradeAdapter } from "./adapters/tastytrade.ts";
export { Trading212Adapter } from "./adapters/trading212.ts";
export { EtradeAdapter } from "./adapters/etrade.ts";
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
