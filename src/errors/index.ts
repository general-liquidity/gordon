/**
 * Error Types Index
 * Centralized error handling for Gordon
 */

// Base errors
export {
  GordonError,
  ConfigurationError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  InvalidStateError,
  isGordonError,
  wrapError,
} from "./base.ts";

// Binance-specific errors
export {
  BinanceError,
  RateLimitError,
  BinanceAuthError,
  InsufficientBalanceError,
  InvalidSymbolError,
  OrderWouldTriggerError,
  BinanceConnectionError,
  createBinanceError,
} from "./binance.ts";

// Trading-specific errors
export {
  InsufficientFundsError,
  InvalidPlanError,
  TradingModeError,
  PlanNotFoundError,
  TradeNotFoundError,
  TradeNotModifiableError,
  RiskLimitExceededError,
  AnalysisError,
} from "./trading.ts";
