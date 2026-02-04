/**
 * Hyperliquid Module Index
 * Re-exports all Hyperliquid-related types and classes
 */

// Client and Signer
export { HyperliquidClient } from "./client.ts";
export { HyperliquidSigner, HYPERLIQUID_DOMAIN, HYPERLIQUID_TYPES } from "./signer.ts";

// Types
export type {
  EIP712Domain,
  HyperliquidAPIError,
  HyperliquidAssetInfo,
  HyperliquidMeta,
  HyperliquidAssetCtx,
  HyperliquidUserState,
  HyperliquidPosition,
  HyperliquidClearinghouseState,
  HyperliquidOrderSide,
  HyperliquidOrderType,
  HyperliquidTif,
  HyperliquidOrderRequest,
  HyperliquidOrder,
  HyperliquidOrderStatus,
  HyperliquidPlaceOrderResponse,
  HyperliquidCancelResponse,
  HyperliquidFill,
  HyperliquidUserFills,
  HyperliquidL2Book,
  HyperliquidFundingHistory,
  HyperliquidTransfer,
  HyperliquidSignedAction,
  HyperliquidOrderParams,
} from "./types.ts";

// Errors (re-exported from errors module)
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
} from "../../errors/index.ts";
