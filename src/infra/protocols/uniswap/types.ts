/**
 * Uniswap Trading API Types
 * Based on https://docs.uniswap.org/api/trading/integration-guide
 */

// ============================================================================
// API Error Types
// ============================================================================

export interface UniswapAPIError {
  error: string;
  message: string;
  details?: Record<string, unknown>;
}

// ============================================================================
// Quote Types
// ============================================================================

export interface UniswapQuoteRequest {
  type: "EXACT_INPUT" | "EXACT_OUTPUT";
  amount: string;
  tokenInChainId: number;
  tokenOutChainId: number;
  tokenIn: string;
  tokenOut: string;
  swapper: string;
  slippageTolerance?: string;
  autoSlippage?: string;
  routingPreference?: "BEST_PRICE" | "FASTEST" | "CLASSIC";
  protocols?: string[];
  urgency?: number;
  /** Request Permit2 data: 'EXACT' or 'FULL' */
  permitAmount?: "EXACT" | "FULL";
  gasStrategies?: unknown[];
}

/** Options for getQuote — caller-facing config */
export interface UniswapQuoteOptions {
  type?: "EXACT_INPUT" | "EXACT_OUTPUT";
  slippageTolerance?: string;
  routingPreference?: "BEST_PRICE" | "FASTEST" | "CLASSIC";
  /** Request Permit2 data for gasless approvals */
  permitAmount?: "EXACT" | "FULL";
  /** Cross-chain: destination chain ID (defaults to same chain) */
  tokenOutChainId?: number;
}

export interface UniswapQuoteResponse {
  requestId: string;
  /** Routing type chosen by the API (CLASSIC, DUTCH_V2, PRIORITY, etc.) */
  routing: UniswapRoutingType | string;
  quote: {
    input?: { amount: string; token: string };
    output?: { amount: string; token: string };
    amountIn?: string;
    amountOut?: string;
    gasEstimate?: string;
    gasEstimateUSD?: string;
    gasFeeEstimate?: { usd: string };
    route?: unknown[][];
    routeString?: string;
    quoteId?: string;
    [key: string]: unknown;
  };
  /** Permit2 typed data for EIP-712 signing */
  permitData?: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    values: Record<string, unknown>;
  };
}

// ============================================================================
// Swap Types
// ============================================================================

export interface UniswapSwapRequest {
  quote: UniswapQuoteResponse["quote"];
  /** EIP-712 signature — must be present with permitData or both omitted */
  signature?: string;
  /** Permit2 data — must be present with signature or both omitted */
  permitData?: UniswapQuoteResponse["permitData"];
  /** Safety mode: 'SAFE' (default) or 'RELAXED' */
  safelyMode?: "SAFE" | "RELAXED";
  /** Unix timestamp deadline for the swap */
  deadline?: number;
  /** Simulate the transaction before returning */
  simulateTransaction?: boolean;
  /** Refresh gas price to current network conditions */
  refreshGasPrice?: boolean;
}

export interface UniswapSwapResponse {
  requestId: string;
  swap: UniswapSwapTransaction;
  /** Reasons the transaction might fail */
  txFailureReasons?: string[];
}

export interface UniswapSwapTransaction {
  to: string;
  from: string;
  data: string;
  value: string;
  gasLimit?: string;
  chainId: number;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  gasPrice?: string;
}

// ============================================================================
// Approval Types
// ============================================================================

export interface UniswapApprovalRequest {
  walletAddress: string;
  token: string;
  amount: string;
  chainId: number;
  urgency?: number;
  includeGasInfo?: boolean;
  tokenOut?: string;
  tokenOutChainId?: number;
}

export interface UniswapApprovalResponse {
  approval: {
    to: string;
    data: string;
    value: string;
    gasLimit?: string;
  } | null;
  cancel?: {
    to: string;
    data: string;
    value: string;
  } | null;
  gasFeeEstimate?: { usd: string };
}

// ============================================================================
// Chain Constants
// ============================================================================

export const NATIVE_TOKEN = "0x0000000000000000000000000000000000000000";

/** Add 15% buffer to gas estimates per Uniswap docs recommendation */
export const GAS_BUFFER_PERCENT = 0.15;

export const WRAPPED_NATIVE: Record<number, string> = {
  1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",       // WETH (Ethereum)
  10: "0x4200000000000000000000000000000000000006",      // WETH (Optimism)
  56: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",     // WBNB (BSC)
  137: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",    // WMATIC (Polygon)
  8453: "0x4200000000000000000000000000000000000006",    // WETH (Base)
  42161: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",  // WETH (Arbitrum)
  43114: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",  // WAVAX (Avalanche)
};

export const USDC_ADDRESSES: Record<number, string> = {
  1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  10: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  56: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
  137: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  43114: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
};

export const SUPPORTED_CHAIN_IDS = [1, 10, 56, 130, 137, 143, 196, 324, 480, 1868, 8453, 42161, 42220, 43114, 81457, 7777777];

export const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum",
  10: "Optimism",
  56: "BNB Chain",
  130: "Unichain",
  137: "Polygon",
  143: "Monad",
  196: "X Layer",
  324: "zkSync",
  480: "World Chain",
  1868: "Soneium",
  8453: "Base",
  42161: "Arbitrum",
  42220: "Celo",
  43114: "Avalanche",
  81457: "Blast",
  7777777: "Zora",
};

/** Chains that support UniswapX (for DutchLimit orders) */
export const UNISWAPX_CHAINS = [1, 42161, 8453, 130]; // Mainnet, Arbitrum, Base, Unichain

/**
 * Routing types returned by the Trading API in the quote response.
 * BEST_PRICE routing automatically considers all types; CLASSIC forces AMM-only.
 */
export type UniswapRoutingType =
  | "CLASSIC"     // Standard AMM swap through Uniswap pools
  | "DUTCH_V2"    // UniswapX Dutch auction V2
  | "DUTCH_V3"    // UniswapX Dutch auction V3
  | "PRIORITY"    // MEV-protected priority order (Base, Unichain)
  | "DUTCH_LIMIT" // UniswapX Dutch limit order
  | "LIMIT_ORDER" // Limit order
  | "WRAP"        // ETH → WETH
  | "UNWRAP"      // WETH → ETH
  | "BRIDGE"      // Cross-chain bridge
  | "QUICKROUTE"; // Fast approximation quote

/** Whether a routing type is a UniswapX off-chain order (vs on-chain tx) */
export function isUniswapXRouting(routing: string): boolean {
  return ["DUTCH_V2", "DUTCH_V3", "DUTCH_LIMIT", "PRIORITY"].includes(routing);
}

// ============================================================================
// Token List Types
// ============================================================================

/** A single token entry from the Uniswap token list */
export interface TokenInfo {
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
}

/** Raw token entry from tokens.uniswap.org (includes extensions) */
export interface RawTokenListEntry {
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
  extensions?: {
    bridgeInfo?: Record<string, { tokenAddress: string }>;
  };
}

/** Top-level structure of the Uniswap default token list */
export interface UniswapTokenListResponse {
  name: string;
  timestamp: string;
  version: { major: number; minor: number; patch: number };
  tokens: RawTokenListEntry[];
}
