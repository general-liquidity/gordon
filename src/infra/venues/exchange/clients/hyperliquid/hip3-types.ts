/**
 * HIP-3 Builder-Deployed Perpetuals — Type Definitions
 *
 * HIP-3 perps are deployed by builder addresses on Hyperliquid.
 * They use separate asset indices (offset 110000+), builder-specific EIP-712
 * domains, and collateral tokens other than USDC (typically USDT0).
 *
 * Reference: fintool hip3.rs — resolve_hip3_asset, place_order
 */

// ============================================================================
// Asset Info
// ============================================================================

/** Static metadata for a HIP-3 asset */
export interface HIP3AssetInfo {
  /** Trading symbol (e.g. "TSLA", "GOLD") */
  symbol: string;
  /** Asset index within the builder's dex (local index, not global) */
  assetIndex: number;
  /** Builder/deployer dex name (e.g. "cash") */
  builder: string;
  /** Collateral token (e.g. "USDT0") */
  collateral: string;
  /** Minimum order size */
  minSize: number;
  /** Price tick size (5 sig figs rule) */
  tickSize: number;
}

// ============================================================================
// Quote
// ============================================================================

/** Real-time quote for a HIP-3 asset */
export interface HIP3Quote {
  /** Trading symbol */
  symbol: string;
  /** Current mark/mid price */
  price: number;
  /** 24h notional volume */
  volume24h: number;
  /** Open interest in contracts */
  openInterest: number;
  /** Current funding rate */
  fundingRate: number;
  /** Previous day's price (for computing 24h change) */
  prevDayPrice: number;
  /** Oracle price */
  oraclePrice: number;
}

// ============================================================================
// Order Params
// ============================================================================

/** Parameters for placing a HIP-3 order */
export interface HIP3OrderParams {
  /** Trading symbol (e.g. "TSLA") */
  symbol: string;
  /** Order side */
  side: "buy" | "sell";
  /** Order size in contracts */
  size: number;
  /** Limit price (required — market orders use aggressive limit) */
  price: number;
  /** Leverage multiplier (optional, uses account default) */
  leverage?: number;
  /** If true, only reduces existing position */
  reduceOnly?: boolean;
  /** Time in force: Gtc (default), Ioc, Alo */
  tif?: "Gtc" | "Ioc" | "Alo";
  /** Client order ID */
  cloid?: string;
}

// ============================================================================
// Order Result
// ============================================================================

/** Result of a HIP-3 order placement */
export interface HIP3OrderResult {
  /** Order ID assigned by exchange (if resting) */
  orderId: number | null;
  /** Order status */
  status: "resting" | "filled" | "error";
  /** Filled size (if any fill occurred) */
  filledSize: number;
  /** Average fill price (if any fill occurred) */
  avgPrice: number;
  /** Error message (if status is "error") */
  error?: string;
}

// ============================================================================
// Asset Category
// ============================================================================

/** Category for grouping HIP-3 assets in the UI */
export type HIP3AssetCategory = "Stocks" | "Commodities" | "Indices";

/** HIP-3 asset with category for UI display */
export interface HIP3CategorizedAsset extends HIP3AssetInfo {
  /** Display name (e.g. "Tesla Inc.") */
  displayName: string;
  /** Asset category */
  category: HIP3AssetCategory;
  /** Max leverage allowed */
  maxLeverage: number;
}

// ============================================================================
// Dex Metadata
// ============================================================================

/** Metadata for a HIP-3 dex (builder deployment) */
export interface HIP3DexMeta {
  /** Dex name (e.g. "cash") */
  name: string;
  /** Global asset index offset (110000 + dexIdx * 10000) */
  indexOffset: number;
  /** Collateral token index in spotMeta */
  collateralTokenIndex: number;
  /** Collateral token name (e.g. "USDT0") */
  collateralTokenName: string;
  /** Universe of assets in this dex */
  universe: Array<{
    name: string;
    szDecimals: number;
    maxLeverage: number;
  }>;
}
