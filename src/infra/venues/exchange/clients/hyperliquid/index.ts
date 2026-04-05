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

// HIP-3 Builder-Deployed Perpetuals
export {
  HIP3_ASSETS,
  HIP3_CATEGORIES,
  isHIP3Asset,
  getHIP3AssetInfo,
  getHIP3AssetsByCategory,
  getAllHIP3Symbols,
  resolveDexOffset,
  resolveAssetInDex,
  resolveHIP3GlobalIndex,
  fetchDexMeta,
  getHIP3Quote,
  getAllHIP3Quotes,
  getHIP3L2Book,
  sizeToWire,
  priceToWire,
  placeHIP3Order,
  updateHIP3Leverage,
} from "./hip3.ts";

export type {
  HIP3AssetInfo,
  HIP3CategorizedAsset,
  HIP3AssetCategory,
  HIP3Quote,
  HIP3OrderParams,
  HIP3OrderResult,
  HIP3DexMeta,
} from "./hip3-types.ts";

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
} from "../../../../../errors/index.ts";
