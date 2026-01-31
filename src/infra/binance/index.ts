/**
 * Binance API Adapter
 * Re-exports all Binance-related types, client, and utilities
 */

// Types
export type {
  // Core types
  BinanceAccountInfo,
  BinanceBalance,
  BinanceKline,
  BinanceOrder,
  BinanceSymbolInfo,
  BinanceAPIError,
  BinanceTicker24hr,
  BinancePriceTicker,
  OrderSide,
  OrderType,
  OrderStatus,
  TimeInForce,
  OrderParams,
  ExchangePermissions,
  SymbolFilter,
  PriceFilter,
  LotSizeFilter,
  MinNotionalFilter,
  GenericFilter,
  // Market data types
  BinanceOrderBook,
  BinanceRecentTrade,
  BinanceAggTrade,
  BinanceAvgPrice,
  BinanceBookTicker,
  // Trading types
  OCOOrderParams,
  BinanceOCOOrder,
  BinanceOrderList,
  BinanceCancelReplaceResult,
  // Wallet types
  BinanceCoinInfo,
  BinanceNetwork,
  BinanceAccountSnapshot,
  TransferType,
  BinanceTransferResponse,
  BinanceTransferHistory,
  BinanceDustTransfer,
  BinanceDustLog,
  BinanceAssetDividend,
  BinanceAssetDetail,
  BinanceTradeFee,
  BinanceUserAsset,
  BinanceDepositAddress,
  BinanceDustableAsset,
  BinanceWalletBalance,
  // Simple Earn types
  BinanceFlexibleProduct,
  BinanceLockedProduct,
  BinanceLockedPosition,
  BinanceEarnSubscription,
  BinanceEarnRedemption,
  BinanceEarnSubscriptionRecord,
  BinanceEarnRedemptionRecord,
  BinanceTrade,
  BinanceDeposit,
  BinanceWithdrawal,
  BinanceEarnPosition,
  BinanceAPIRestrictions,
} from "./types.ts";

// Client
export { BinanceClient } from "./client.ts";

// WebSocket
export {
  BinanceWebSocket,
  createBinanceWebSocket,
  DEFAULT_WS_CONFIG,
  type WSConfig,
  type ConnectionState,
  type ConnectionStatus,
  type WSEventMap,
  type TickerUpdate,
  type TradeUpdate,
  type KlineUpdate,
  type DepthUpdate,
} from "./websocket.ts";

// Re-export errors for backward compatibility
export { BinanceError, RateLimitError, BinanceAuthError, InsufficientBalanceError, InvalidSymbolError } from "../../errors/index.ts";

// Permissions
export {
  verifyPermissions,
  validatePermissions,
  checkAndValidatePermissions,
  formatPermissionsDisplay,
  clearPermissionCache,
  checkPermissionsOnInit,
  validateOperation,
} from "./permissions.ts";
export type { PermissionValidationResult, PermissionInitResult } from "./permissions.ts";
