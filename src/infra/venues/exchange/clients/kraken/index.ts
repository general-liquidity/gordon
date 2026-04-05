/**
 * Kraken Module Index
 * Re-exports all Kraken-related types and classes
 */

// Client
export { KrakenClient } from "./client.ts";

// Types
export type {
  KrakenResponse,
  KrakenAssetInfo,
  KrakenAssetPair,
  KrakenTicker,
  KrakenOHLC,
  KrakenOrderBook,
  KrakenBalance,
  KrakenExtendedBalance,
  KrakenTradeBalance,
  KrakenOrder,
  KrakenOrderDescription,
  KrakenOrderType,
  KrakenOrderSide,
  KrakenOrderStatus,
  KrakenAddOrderResponse,
  KrakenCancelOrderResponse,
  KrakenTrade,
  KrakenLedgerEntry,
  KrakenDepositMethod,
  KrakenDepositAddress,
  KrakenDepositStatus,
  KrakenWithdrawInfo,
  KrakenWithdrawStatus,
  KrakenServerTime,
  KrakenSystemStatus,
} from "./types.ts";

// Errors (re-exported from errors module)
export {
  KrakenError,
  KrakenRateLimitError,
  KrakenAuthError,
  KrakenInsufficientBalanceError,
  KrakenInvalidPairError,
  KrakenConnectionError,
  createKrakenError,
} from "../../../../../errors/index.ts";
