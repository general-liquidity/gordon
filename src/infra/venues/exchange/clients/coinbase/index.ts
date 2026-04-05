/**
 * Coinbase Module Index
 * Re-exports all Coinbase-related types and classes
 */

// Client
export { CoinbaseClient } from "./client.ts";

// Types
export type {
  CoinbaseAccount,
  CoinbaseAccountsResponse,
  CoinbaseProduct,
  CoinbaseProductsResponse,
  CoinbaseProductBook,
  CoinbaseCandle,
  CoinbaseCandlesResponse,
  CoinbaseOrder,
  CoinbaseOrdersResponse,
  CoinbaseCreateOrderRequest,
  CoinbaseCreateOrderResponse,
  CoinbaseCancelOrdersResponse,
  CoinbaseFill,
  CoinbaseFillsResponse,
  CoinbaseOrderSide,
  CoinbaseOrderType,
  CoinbaseOrderStatus,
  CoinbaseTimeInForce,
  CoinbaseOrderConfiguration,
  CoinbaseOrderParams,
  CoinbaseAPIError,
  CoinbaseTransaction,
  CoinbaseV2Account,
  CoinbaseV2PaginatedResponse,
  CoinbaseV2Response,
  CoinbaseV2CryptoCurrency,
  CoinbaseV2SendRequest,
  CoinbaseV2Pagination,
} from "./types.ts";

// Errors (re-exported from errors module)
export {
  CoinbaseError,
  CoinbaseRateLimitError,
  CoinbaseAuthError,
  CoinbaseInsufficientBalanceError,
  CoinbaseInvalidProductError,
  CoinbaseConnectionError,
  createCoinbaseError,
} from "../../../../../errors/index.ts";
