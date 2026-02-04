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

// Coinbase-specific errors
export {
  CoinbaseError,
  CoinbaseRateLimitError,
  CoinbaseAuthError,
  CoinbaseInsufficientBalanceError,
  CoinbaseInvalidProductError,
  CoinbaseConnectionError,
  createCoinbaseError,
} from "./coinbase.ts";

// Kraken-specific errors
export {
  KrakenError,
  KrakenRateLimitError,
  KrakenAuthError,
  KrakenInsufficientBalanceError,
  KrakenInvalidPairError,
  KrakenConnectionError,
  createKrakenError,
} from "./kraken.ts";

// Hyperliquid-specific errors
export {
  HyperliquidError,
  WalletSigningError,
  InvalidWalletError,
  HyperliquidRateLimitError,
  InsufficientMarginError,
  HyperliquidInvalidAssetError,
  HyperliquidConnectionError,
  HyperliquidNotSupportedError,
  createHyperliquidError,
} from "./hyperliquid.ts";

// Bitfinex-specific errors
export {
  BitfinexError,
  BitfinexRateLimitError,
  BitfinexAuthError,
  BitfinexInsufficientBalanceError,
  BitfinexInvalidSymbolError,
  BitfinexConnectionError,
  createBitfinexError,
} from "./bitfinex.ts";
