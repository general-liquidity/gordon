/**
 * HIP-3 Builder-Deployed Perpetuals Support
 *
 * Enables trading stocks (TSLA, NVDA, AAPL), commodities (GOLD, SILVER, OIL),
 * and indices (USA500) on Hyperliquid via builder-deployed perp dexes.
 *
 * Key differences from standard Hyperliquid perps:
 * - Asset indices are builder-relative: globalIndex = dexOffset + localIndex
 *   where dexOffset = 110000 + dexIdx * 10000
 * - Collateral is USDT0 (not USDC) for the "cash" dex
 * - Order signing uses the same EIP-712 Agent scheme but with builder-resolved
 *   asset indices
 * - Dex/asset resolution requires querying perpDexs + per-dex meta endpoints
 *
 * Reference: fintool-main/src/hip3.rs (Rust reference implementation)
 */

import type {
  HIP3AssetInfo,
  HIP3CategorizedAsset,
  HIP3AssetCategory,
  HIP3Quote,
  HIP3OrderParams,
  HIP3OrderResult,
  HIP3DexMeta,
} from "./hip3-types.ts";
import { HyperliquidError } from "../../../../../errors/index.ts";
import { createModuleLogger } from "../../../../logger/index.ts";

const logger = createModuleLogger("hip3");

// ============================================================================
// Constants
// ============================================================================

const INFO_URL = "https://api.hyperliquid.xyz/info";
const EXCHANGE_URL = "https://api.hyperliquid.xyz/exchange";

/** Default builder dex for stock/commodity perps */
const DEFAULT_DEX = "cash";

/** Default collateral for the "cash" dex */
const DEFAULT_COLLATERAL = "USDT0";

// ============================================================================
// HIP-3 Asset Catalog
// ============================================================================

/**
 * Static catalog of known HIP-3 assets.
 *
 * assetIndex here is the LOCAL index within the dex (not the global index).
 * Global index = dexOffset + assetIndex, resolved at runtime via perpDexs API.
 */
export const HIP3_ASSETS: ReadonlyMap<string, HIP3CategorizedAsset> = new Map<
  string,
  HIP3CategorizedAsset
>([
  // Stocks
  [
    "TSLA",
    {
      symbol: "TSLA",
      displayName: "Tesla Inc.",
      category: "Stocks",
      assetIndex: 0,
      builder: DEFAULT_DEX,
      collateral: DEFAULT_COLLATERAL,
      minSize: 0.01,
      tickSize: 0.01,
      maxLeverage: 5,
    },
  ],
  [
    "NVDA",
    {
      symbol: "NVDA",
      displayName: "NVIDIA Corp.",
      category: "Stocks",
      assetIndex: 1,
      builder: DEFAULT_DEX,
      collateral: DEFAULT_COLLATERAL,
      minSize: 0.01,
      tickSize: 0.01,
      maxLeverage: 5,
    },
  ],
  [
    "AAPL",
    {
      symbol: "AAPL",
      displayName: "Apple Inc.",
      category: "Stocks",
      assetIndex: 2,
      builder: DEFAULT_DEX,
      collateral: DEFAULT_COLLATERAL,
      minSize: 0.01,
      tickSize: 0.01,
      maxLeverage: 5,
    },
  ],
  [
    "GOOGL",
    {
      symbol: "GOOGL",
      displayName: "Alphabet Inc.",
      category: "Stocks",
      assetIndex: 3,
      builder: DEFAULT_DEX,
      collateral: DEFAULT_COLLATERAL,
      minSize: 0.01,
      tickSize: 0.01,
      maxLeverage: 5,
    },
  ],
  [
    "AMZN",
    {
      symbol: "AMZN",
      displayName: "Amazon.com Inc.",
      category: "Stocks",
      assetIndex: 4,
      builder: DEFAULT_DEX,
      collateral: DEFAULT_COLLATERAL,
      minSize: 0.01,
      tickSize: 0.01,
      maxLeverage: 5,
    },
  ],
  [
    "META",
    {
      symbol: "META",
      displayName: "Meta Platforms Inc.",
      category: "Stocks",
      assetIndex: 5,
      builder: DEFAULT_DEX,
      collateral: DEFAULT_COLLATERAL,
      minSize: 0.01,
      tickSize: 0.01,
      maxLeverage: 5,
    },
  ],
  [
    "MSFT",
    {
      symbol: "MSFT",
      displayName: "Microsoft Corp.",
      category: "Stocks",
      assetIndex: 6,
      builder: DEFAULT_DEX,
      collateral: DEFAULT_COLLATERAL,
      minSize: 0.01,
      tickSize: 0.01,
      maxLeverage: 5,
    },
  ],
  // Commodities
  [
    "GOLD",
    {
      symbol: "GOLD",
      displayName: "Gold",
      category: "Commodities",
      assetIndex: 7,
      builder: DEFAULT_DEX,
      collateral: DEFAULT_COLLATERAL,
      minSize: 0.001,
      tickSize: 0.01,
      maxLeverage: 10,
    },
  ],
  [
    "SILVER",
    {
      symbol: "SILVER",
      displayName: "Silver",
      category: "Commodities",
      assetIndex: 8,
      builder: DEFAULT_DEX,
      collateral: DEFAULT_COLLATERAL,
      minSize: 0.01,
      tickSize: 0.001,
      maxLeverage: 10,
    },
  ],
  [
    "OIL",
    {
      symbol: "OIL",
      displayName: "Crude Oil",
      category: "Commodities",
      assetIndex: 9,
      builder: DEFAULT_DEX,
      collateral: DEFAULT_COLLATERAL,
      minSize: 0.01,
      tickSize: 0.01,
      maxLeverage: 10,
    },
  ],
  [
    "NATGAS",
    {
      symbol: "NATGAS",
      displayName: "Natural Gas",
      category: "Commodities",
      assetIndex: 10,
      builder: DEFAULT_DEX,
      collateral: DEFAULT_COLLATERAL,
      minSize: 0.1,
      tickSize: 0.001,
      maxLeverage: 10,
    },
  ],
  // Indices
  [
    "USA500",
    {
      symbol: "USA500",
      displayName: "S&P 500 Index",
      category: "Indices",
      assetIndex: 11,
      builder: DEFAULT_DEX,
      collateral: DEFAULT_COLLATERAL,
      minSize: 0.001,
      tickSize: 0.01,
      maxLeverage: 10,
    },
  ],
]);

/** Ordered categories for UI display */
export const HIP3_CATEGORIES: readonly HIP3AssetCategory[] = [
  "Stocks",
  "Commodities",
  "Indices",
] as const;

// ============================================================================
// Asset Lookup
// ============================================================================

/**
 * Check if a symbol is a HIP-3 builder-deployed asset
 */
export function isHIP3Asset(symbol: string): boolean {
  return HIP3_ASSETS.has(symbol.toUpperCase());
}

/**
 * Get static info for a HIP-3 asset
 * @throws HyperliquidError if the symbol is not a known HIP-3 asset
 */
export function getHIP3AssetInfo(symbol: string): HIP3AssetInfo {
  const upper = symbol.toUpperCase();
  const asset = HIP3_ASSETS.get(upper);
  if (!asset) {
    throw new HyperliquidError(
      `Unknown HIP-3 asset: ${symbol}. Available: ${[...HIP3_ASSETS.keys()].join(", ")}`,
      "HIP3_UNKNOWN_ASSET"
    );
  }
  return asset;
}

/**
 * Get all HIP-3 assets for a given category
 */
export function getHIP3AssetsByCategory(
  category: HIP3AssetCategory
): HIP3CategorizedAsset[] {
  return [...HIP3_ASSETS.values()].filter((a) => a.category === category);
}

/**
 * Get all known HIP-3 symbols
 */
export function getAllHIP3Symbols(): string[] {
  return [...HIP3_ASSETS.keys()];
}

// ============================================================================
// Dex Resolution (runtime — queries Hyperliquid API)
// ============================================================================

/**
 * Resolve the global dex offset for a builder dex.
 * Global offset = 110000 + dexIdx * 10000
 *
 * Mirrors fintool hip3.rs::get_dex_offset
 */
export async function resolveDexOffset(dex: string): Promise<number> {
  const response = await fetch(INFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "perpDexs" }),
  });

  if (!response.ok) {
    throw new HyperliquidError(
      `Failed to fetch perpDexs: HTTP ${response.status}`,
      "HIP3_API_ERROR"
    );
  }

  const dexes = (await response.json()) as Array<{ name: string } | null>;

  let dexIdx = 0;
  for (const entry of dexes) {
    if (entry === null) continue; // skip main dex (null entry)
    if (entry.name === dex) {
      return 110000 + dexIdx * 10000;
    }
    dexIdx++;
  }

  throw new HyperliquidError(
    `HIP-3 dex '${dex}' not found`,
    "HIP3_DEX_NOT_FOUND"
  );
}

/**
 * Resolve the local asset index and szDecimals for an asset within a dex.
 *
 * Mirrors fintool hip3.rs::get_asset_in_dex
 */
export async function resolveAssetInDex(
  dex: string,
  assetName: string
): Promise<{ localIndex: number; szDecimals: number }> {
  const response = await fetch(INFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "meta", dex }),
  });

  if (!response.ok) {
    throw new HyperliquidError(
      `Failed to fetch dex meta for '${dex}': HTTP ${response.status}`,
      "HIP3_API_ERROR"
    );
  }

  const meta = (await response.json()) as {
    universe?: Array<{ name: string; szDecimals?: number }>;
  };

  if (meta.universe) {
    for (let i = 0; i < meta.universe.length; i++) {
      const asset = meta.universe[i];
      if (asset && asset.name === assetName) {
        return {
          localIndex: i,
          szDecimals: asset.szDecimals ?? 4,
        };
      }
    }
  }

  throw new HyperliquidError(
    `Asset '${assetName}' not found in HIP-3 dex '${dex}'`,
    "HIP3_ASSET_NOT_FOUND"
  );
}

/**
 * Resolve the global asset index for a HIP-3 asset.
 * globalIndex = dexOffset + localIndex
 *
 * Mirrors fintool hip3.rs::resolve_hip3_asset
 */
export async function resolveHIP3GlobalIndex(
  symbol: string
): Promise<{ globalIndex: number; szDecimals: number }> {
  const info = getHIP3AssetInfo(symbol);
  const [offset, assetData] = await Promise.all([
    resolveDexOffset(info.builder),
    resolveAssetInDex(info.builder, symbol),
  ]);

  return {
    globalIndex: offset + assetData.localIndex,
    szDecimals: assetData.szDecimals,
  };
}

/**
 * Fetch full dex metadata including universe and collateral info.
 */
export async function fetchDexMeta(dex: string): Promise<HIP3DexMeta> {
  const [offsetResult, metaResponse] = await Promise.all([
    resolveDexOffset(dex),
    fetch(INFO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "meta", dex }),
    }),
  ]);

  if (!metaResponse.ok) {
    throw new HyperliquidError(
      `Failed to fetch meta for dex '${dex}': HTTP ${metaResponse.status}`,
      "HIP3_API_ERROR"
    );
  }

  const meta = (await metaResponse.json()) as {
    universe?: Array<{
      name: string;
      szDecimals?: number;
      maxLeverage?: number;
    }>;
    collateralToken?: number;
  };

  return {
    name: dex,
    indexOffset: offsetResult,
    collateralTokenIndex: meta.collateralToken ?? 0,
    collateralTokenName: DEFAULT_COLLATERAL,
    universe: (meta.universe ?? []).map((a) => ({
      name: a.name,
      szDecimals: a.szDecimals ?? 4,
      maxLeverage: a.maxLeverage ?? 5,
    })),
  };
}

// ============================================================================
// Quote Fetching
// ============================================================================

/**
 * Fetch a real-time quote for a HIP-3 asset.
 *
 * Uses the per-dex metaAndAssetCtxs endpoint to get price, volume,
 * open interest, and funding rate.
 */
export async function getHIP3Quote(symbol: string): Promise<HIP3Quote> {
  const upper = symbol.toUpperCase();
  const info = getHIP3AssetInfo(upper);

  logger.info("Fetching HIP-3 quote", { symbol: upper, dex: info.builder });

  const response = await fetch(INFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "metaAndAssetCtxs", dex: info.builder }),
  });

  if (!response.ok) {
    throw new HyperliquidError(
      `Failed to fetch HIP-3 quote for ${upper}: HTTP ${response.status}`,
      "HIP3_API_ERROR"
    );
  }

  const data = (await response.json()) as [
    { universe: Array<{ name: string }> },
    Array<{
      funding: string;
      openInterest: string;
      prevDayPx: string;
      dayNtlVlm: string;
      oraclePx: string;
      markPx: string;
      midPx: string;
    }>,
  ];

  const [meta, assetCtxs] = data;
  const universe = meta.universe;

  // Find our asset in the universe
  let assetIdx = -1;
  for (let i = 0; i < universe.length; i++) {
    if (universe[i]?.name === upper) {
      assetIdx = i;
      break;
    }
  }

  if (assetIdx < 0 || !assetCtxs[assetIdx]) {
    throw new HyperliquidError(
      `HIP-3 asset '${upper}' not found in dex '${info.builder}' universe`,
      "HIP3_ASSET_NOT_FOUND"
    );
  }

  const ctx = assetCtxs[assetIdx]!;

  return {
    symbol: upper,
    price: parseFloat(ctx.midPx || ctx.markPx || "0"),
    volume24h: parseFloat(ctx.dayNtlVlm || "0"),
    openInterest: parseFloat(ctx.openInterest || "0"),
    fundingRate: parseFloat(ctx.funding || "0"),
    prevDayPrice: parseFloat(ctx.prevDayPx || "0"),
    oraclePrice: parseFloat(ctx.oraclePx || "0"),
  };
}

/**
 * Fetch quotes for all known HIP-3 assets in a single API call.
 * Returns a map of symbol -> HIP3Quote. Assets that fail to resolve
 * are silently omitted.
 */
export async function getAllHIP3Quotes(): Promise<Map<string, HIP3Quote>> {
  const results = new Map<string, HIP3Quote>();

  // Group assets by builder dex to minimize API calls
  const dexAssets = new Map<string, string[]>();
  for (const [sym, info] of HIP3_ASSETS) {
    const existing = dexAssets.get(info.builder) ?? [];
    existing.push(sym);
    dexAssets.set(info.builder, existing);
  }

  for (const [dex, symbols] of dexAssets) {
    try {
      const response = await fetch(INFO_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "metaAndAssetCtxs", dex }),
      });

      if (!response.ok) {
        logger.warn("Failed to fetch quotes for dex", { dex, status: response.status });
        continue;
      }

      const data = (await response.json()) as [
        { universe: Array<{ name: string }> },
        Array<{
          funding: string;
          openInterest: string;
          prevDayPx: string;
          dayNtlVlm: string;
          oraclePx: string;
          markPx: string;
          midPx: string;
        }>,
      ];

      const [meta, assetCtxs] = data;
      const nameToIdx = new Map<string, number>();
      for (let i = 0; i < meta.universe.length; i++) {
        const name = meta.universe[i]?.name;
        if (name) nameToIdx.set(name, i);
      }

      for (const sym of symbols) {
        const idx = nameToIdx.get(sym);
        if (idx === undefined || !assetCtxs[idx]) continue;

        const ctx = assetCtxs[idx]!;
        results.set(sym, {
          symbol: sym,
          price: parseFloat(ctx.midPx || ctx.markPx || "0"),
          volume24h: parseFloat(ctx.dayNtlVlm || "0"),
          openInterest: parseFloat(ctx.openInterest || "0"),
          fundingRate: parseFloat(ctx.funding || "0"),
          prevDayPrice: parseFloat(ctx.prevDayPx || "0"),
          oraclePrice: parseFloat(ctx.oraclePx || "0"),
        });
      }
    } catch (err) {
      logger.warn("Error fetching HIP-3 quotes for dex", {
        dex,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

/**
 * Fetch the L2 order book for a HIP-3 asset.
 */
export async function getHIP3L2Book(symbol: string): Promise<{
  bids: Array<{ px: string; sz: string; n: number }>;
  asks: Array<{ px: string; sz: string; n: number }>;
}> {
  const upper = symbol.toUpperCase();
  const info = getHIP3AssetInfo(upper);

  const response = await fetch(INFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "l2Book", coin: upper, dex: info.builder }),
  });

  if (!response.ok) {
    throw new HyperliquidError(
      `Failed to fetch L2 book for ${upper}: HTTP ${response.status}`,
      "HIP3_API_ERROR"
    );
  }

  const book = (await response.json()) as {
    levels: [
      Array<{ px: string; sz: string; n: number }>,
      Array<{ px: string; sz: string; n: number }>,
    ];
  };

  return {
    bids: book.levels[0] ?? [],
    asks: book.levels[1] ?? [],
  };
}

// ============================================================================
// Price/Size Formatting (matches fintool hip3.rs wire format)
// ============================================================================

/**
 * Format a float for wire — 8 decimal places, strip trailing zeros.
 * Must match the SDK's float_to_string_for_hashing exactly.
 */
function floatToWireString(val: number): string {
  return val
    .toFixed(8)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
}

/**
 * Format size for wire — truncate to szDecimals, then wire format.
 */
export function sizeToWire(val: number, szDecimals: number): string {
  const factor = Math.pow(10, szDecimals);
  const truncated = Math.floor(val * factor + 1e-9) / factor;
  return floatToWireString(truncated);
}

/**
 * Format price for wire — round to 5 sig figs (tick size rule).
 */
export function priceToWire(price: number): string {
  if (price === 0) return "0";
  const magnitude = Math.floor(Math.log10(Math.abs(price)));
  const decimals = Math.max(0, 4 - magnitude);
  const factor = Math.pow(10, decimals);
  const rounded = Math.round(price * factor) / factor;
  return floatToWireString(rounded);
}

// ============================================================================
// Order Placement
// ============================================================================

/**
 * Place a HIP-3 perp order.
 *
 * This builds the order action, resolves the global asset index, and submits
 * to the exchange endpoint. Actual EIP-712 signing is handled by HyperliquidSigner.
 *
 * Signing flow (mirrors fintool hip3.rs::place_order):
 * 1. Resolve global asset index: dexOffset + localIndex
 * 2. Build order action with wire-formatted price/size
 * 3. Msgpack-serialize action + timestamp BE bytes + 0x00 (no vault)
 * 4. Keccak256 hash -> connectionId
 * 5. EIP-712 sign Agent { source: "a"|"b", connectionId }
 * 6. POST { action, nonce, signature, vaultAddress: null } to /exchange
 *
 * NOTE: Full signing requires ethers.js + msgpack. This implementation
 * provides the action construction and API call structure. The actual
 * signing is delegated to HyperliquidClient.exchangeRequest or can be
 * done directly with HyperliquidSigner.
 */
export async function placeHIP3Order(
  params: HIP3OrderParams,
  signer?: {
    signAction: (
      action: Record<string, unknown>,
      nonce: number
    ) => Promise<{ r: string; s: string; v: number }>;
  }
): Promise<HIP3OrderResult> {
  const upper = params.symbol.toUpperCase();
  const info = getHIP3AssetInfo(upper);

  logger.info("Placing HIP-3 order", {
    symbol: upper,
    side: params.side,
    size: params.size,
    price: params.price,
    dex: info.builder,
  });

  // Resolve global asset index
  const { globalIndex, szDecimals } = await resolveHIP3GlobalIndex(upper);

  // Build order wire format
  const orderWire = {
    a: globalIndex,
    b: params.side === "buy",
    p: priceToWire(params.price),
    s: sizeToWire(params.size, szDecimals),
    r: params.reduceOnly ?? false,
    t: {
      limit: {
        tif: params.tif ?? "Gtc",
      },
    },
    ...(params.cloid ? { c: params.cloid } : {}),
  };

  const action: Record<string, unknown> = {
    type: "order",
    orders: [orderWire],
    grouping: "na",
  };

  const nonce = Date.now();

  // If no signer provided, return a stub result indicating signing is needed
  if (!signer) {
    logger.warn("No signer provided — returning unsigned order action", {
      globalIndex,
      action,
    });
    return {
      orderId: null,
      status: "error",
      filledSize: 0,
      avgPrice: 0,
      error:
        "No signer provided. Pass a HyperliquidSigner to placeHIP3Order to sign and submit.",
    };
  }

  // Sign the action
  const signature = await signer.signAction(action, nonce);

  // Submit to exchange
  const payload = {
    action,
    nonce,
    signature,
    vaultAddress: null,
  };

  const response = await fetch(EXCHANGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = (await response.json()) as {
    status: "ok" | "err";
    response?: {
      type: string;
      data: {
        statuses: Array<{
          resting?: { oid: number };
          filled?: { oid: number; totalSz: string; avgPx: string };
          error?: string;
        }>;
      };
    };
    error?: string;
  };

  if (data.status === "err") {
    const errMsg =
      data.error ??
      (typeof data.response === "string"
        ? data.response
        : "Unknown HIP-3 order error");
    logger.error("HIP-3 order rejected", undefined, { error: errMsg });
    return {
      orderId: null,
      status: "error",
      filledSize: 0,
      avgPrice: 0,
      error: errMsg,
    };
  }

  // Parse order status from response
  const orderStatus = data.response?.data?.statuses?.[0];
  if (!orderStatus) {
    return {
      orderId: null,
      status: "error",
      filledSize: 0,
      avgPrice: 0,
      error: "No status in response",
    };
  }

  if (orderStatus.error) {
    return {
      orderId: null,
      status: "error",
      filledSize: 0,
      avgPrice: 0,
      error: orderStatus.error,
    };
  }

  if (orderStatus.filled) {
    return {
      orderId: orderStatus.filled.oid,
      status: "filled",
      filledSize: parseFloat(orderStatus.filled.totalSz),
      avgPrice: parseFloat(orderStatus.filled.avgPx),
    };
  }

  if (orderStatus.resting) {
    return {
      orderId: orderStatus.resting.oid,
      status: "resting",
      filledSize: 0,
      avgPrice: 0,
    };
  }

  return {
    orderId: null,
    status: "error",
    filledSize: 0,
    avgPrice: 0,
    error: "Unexpected order status format",
  };
}

/**
 * Update leverage for a HIP-3 asset.
 */
export async function updateHIP3Leverage(
  symbol: string,
  leverage: number,
  isCross: boolean,
  signer?: {
    signAction: (
      action: Record<string, unknown>,
      nonce: number
    ) => Promise<{ r: string; s: string; v: number }>;
  }
): Promise<{ status: string; error?: string }> {
  const upper = symbol.toUpperCase();
  const { globalIndex } = await resolveHIP3GlobalIndex(upper);

  const action: Record<string, unknown> = {
    type: "updateLeverage",
    asset: globalIndex,
    isCross,
    leverage,
  };

  if (!signer) {
    return { status: "error", error: "No signer provided" };
  }

  const nonce = Date.now();
  const signature = await signer.signAction(action, nonce);

  const response = await fetch(EXCHANGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, nonce, signature, vaultAddress: null }),
  });

  const data = (await response.json()) as {
    status: string;
    response?: string;
  };

  if (data.status === "err") {
    return {
      status: "error",
      error:
        typeof data.response === "string"
          ? data.response
          : "Leverage update failed",
    };
  }

  return { status: "ok" };
}
