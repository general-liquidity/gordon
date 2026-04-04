/**
 * Hyperliquid API Types
 * Based on Hyperliquid REST API documentation
 *
 * Note: Hyperliquid is a perpetuals-only DEX using wallet-based authentication
 */

// ============================================================================
// EIP-712 Signing Types
// ============================================================================

export interface EIP712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

export const HYPERLIQUID_DOMAIN: EIP712Domain = {
  name: "HyperliquidSignTransaction",
  version: "1",
  chainId: 42161, // Arbitrum
  verifyingContract: "0x0000000000000000000000000000000000000000",
};

// ============================================================================
// API Response Types
// ============================================================================

export interface HyperliquidAPIError {
  error: string;
  code?: string;
}

// ============================================================================
// Asset/Market Types
// ============================================================================

export interface HyperliquidAssetInfo {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  onlyIsolated: boolean;
}

export interface HyperliquidMeta {
  universe: HyperliquidAssetInfo[];
}

export interface HyperliquidAssetCtx {
  funding: string;
  openInterest: string;
  prevDayPx: string;
  dayNtlVlm: string;
  premium: string;
  oraclePx: string;
  markPx: string;
  midPx: string;
  impactPxs: [string, string];
}

// ============================================================================
// Account Types
// ============================================================================

export interface HyperliquidUserState {
  assetPositions: HyperliquidPosition[];
  crossMarginSummary: {
    accountValue: string;
    totalNtlPos: string;
    totalRawUsd: string;
    totalMarginUsed: string;
  };
  marginSummary: {
    accountValue: string;
    totalNtlPos: string;
    totalRawUsd: string;
    totalMarginUsed: string;
  };
  withdrawable: string;
}

export interface HyperliquidPosition {
  position: {
    coin: string;
    entryPx: string | null;
    leverage: {
      type: string;
      value: number;
    };
    liquidationPx: string | null;
    marginUsed: string;
    maxTradeSzs: [string, string];
    positionValue: string;
    returnOnEquity: string;
    szi: string;
    unrealizedPnl: string;
  };
  type: string;
}

export interface HyperliquidClearinghouseState {
  assetPositions: HyperliquidPosition[];
  crossMarginSummary: {
    accountValue: string;
    totalNtlPos: string;
    totalRawUsd: string;
    totalMarginUsed: string;
  };
}

// ============================================================================
// Order Types
// ============================================================================

export type HyperliquidOrderSide = "B" | "A"; // B = Buy, A = Ask (Sell)

export type HyperliquidOrderType =
  | "limit"
  | "market"
  | "stop_market"
  | "stop_limit"
  | "take_profit_market"
  | "take_profit_limit";

export type HyperliquidTif = "Gtc" | "Ioc" | "Alo"; // Good til cancel, Immediate or cancel, Add liquidity only

export interface HyperliquidOrderRequest {
  a: number; // asset index
  b: boolean; // is buy
  p: string; // price
  s: string; // size
  r: boolean; // reduce only
  t: {
    limit: {
      tif: HyperliquidTif;
    };
  } | {
    trigger: {
      triggerPx: string;
      isMarket: boolean;
      tpsl: "tp" | "sl";
    };
  };
  c?: string; // client order id (cloid)
}

export interface HyperliquidOrder {
  coin: string;
  side: HyperliquidOrderSide;
  limitPx: string;
  sz: string;
  oid: number;
  timestamp: number;
  origSz: string;
  cloid?: string;
}

export interface HyperliquidOrderStatus {
  order: HyperliquidOrder;
  status: "open" | "filled" | "canceled" | "triggered" | "rejected" | "marginCanceled";
  statusTimestamp: number;
}

export interface HyperliquidPlaceOrderResponse {
  status: "ok" | "err";
  response?: {
    type: "order";
    data: {
      statuses: Array<{
        resting?: { oid: number };
        filled?: { oid: number; totalSz: string; avgPx: string };
        error?: string;
      }>;
    };
  };
  error?: string;
}

export interface HyperliquidCancelResponse {
  status: "ok" | "err";
  response?: {
    type: "cancel";
    data: {
      statuses: string[];
    };
  };
  error?: string;
}

// ============================================================================
// Fill/Trade Types
// ============================================================================

export interface HyperliquidFill {
  coin: string;
  px: string;
  sz: string;
  side: HyperliquidOrderSide;
  time: number;
  startPosition: string;
  dir: string;
  closedPnl: string;
  hash: string;
  oid: number;
  crossed: boolean;
  fee: string;
  tid: number;
  feeToken: string;
}

export interface HyperliquidUserFills {
  fills: HyperliquidFill[];
}

// ============================================================================
// Order Book Types
// ============================================================================

export interface HyperliquidL2Book {
  coin: string;
  levels: [
    Array<{ px: string; sz: string; n: number }>, // bids
    Array<{ px: string; sz: string; n: number }>  // asks
  ];
  time: number;
}

// ============================================================================
// Funding Types
// ============================================================================

export interface HyperliquidFundingHistory {
  coin: string;
  fundingRate: string;
  premium: string;
  time: number;
}

// ============================================================================
// Transfer Types
// ============================================================================

export interface HyperliquidTransfer {
  hash: string;
  delta: {
    type: string;
    usdc: string;
  };
  time: number;
}

// ============================================================================
// Signed Action Types
// ============================================================================

export interface HyperliquidSignedAction {
  action: Record<string, unknown>;
  nonce: number;
  signature: {
    r: string;
    s: string;
    v: number;
  };
  vaultAddress?: string;
}

// ============================================================================
// Order Params (for adapter)
// ============================================================================

export interface HyperliquidOrderParams {
  coin: string;
  isBuy: boolean;
  price: string;
  size: string;
  reduceOnly?: boolean;
  orderType?: HyperliquidOrderType;
  clientOrderId?: string;
  triggerPrice?: string;
}
