/**
 * Bitfinex Module Index
 * Re-exports all Bitfinex-related types and classes
 */

// Client
export { BitfinexClient } from "./client.ts";

// Types
export type {
  BitfinexAPIError,
  BitfinexTicker,
  BitfinexTickerParsed,
  BitfinexCandle,
  BitfinexOrderBookEntry,
  BitfinexOrderBookParsed,
  BitfinexPublicTrade,
  BitfinexWallet,
  BitfinexWalletParsed,
  BitfinexOrderType,
  BitfinexOrderStatus,
  BitfinexOrder,
  BitfinexOrderParsed,
  BitfinexUserTrade,
  BitfinexUserTradeParsed,
  BitfinexMovement,
  BitfinexMovementParsed,
  BitfinexSymbolDetails,
  BitfinexOrderParams,
  BitfinexOrderResponse,
} from "./types.ts";

// Errors (re-exported from errors module)
export {
  BitfinexError,
  BitfinexRateLimitError,
  BitfinexAuthError,
} from "../../errors/index.ts";
