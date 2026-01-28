/**
 * Binance API Adapter
 * Re-exports all Binance-related types, client, and utilities
 */

// Types
export type {
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
} from "./types.ts";

// Client
export { BinanceClient, BinanceError } from "./client.ts";

// Permissions
export {
  verifyPermissions,
  validatePermissions,
  checkAndValidatePermissions,
  formatPermissionsDisplay,
} from "./permissions.ts";
export type { PermissionValidationResult } from "./permissions.ts";
