/**
 * Base L2 Chain Integration - Core Types
 * Types for Base Onchain Registry API, chain data, and token information
 */

// ============================================================================
// Base Network Configuration
// ============================================================================

export const BASE_CHAIN_CONFIG = {
  mainnet: {
    chainId: 8453,
    name: "Base Mainnet",
    rpc: "https://mainnet.base.org",
    flashblocksRpc: "https://mainnet-preconf.base.org",
    explorer: "https://basescan.org",
    blockscout: "https://base.blockscout.com",
    currency: "ETH",
  },
  testnet: {
    chainId: 84532,
    name: "Base Sepolia",
    rpc: "https://sepolia.base.org",
    flashblocksRpc: "https://sepolia-preconf.base.org",
    explorer: "https://sepolia-explorer.base.org",
    currency: "ETH",
  },
} as const;

/** Well-known Base token addresses */
export const BASE_TOKENS = {
  ETH: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", // Native ETH sentinel for CDP Swap API
  USDC: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  WETH: "0x4200000000000000000000000000000000000006",
  DAI: "0x50c5725949a6f0c72e6c4a641f24049a917db0cb",
  cbETH: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
  USDbC: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
  AERO: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
} as const;

// ============================================================================
// Onchain Registry API Types
// ============================================================================

/** Registry API base URL */
export const REGISTRY_API_BASE = "https://base.org/api/registry";

/** Registry entry categories */
export type RegistryCategory = "Games" | "Social" | "Creators" | "Finance" | "Media";

/** Registry curation levels */
export type RegistryCuration = "Featured" | "Curated" | "Community";

/** Registry CTA types */
export type RegistryCTA = "Play" | "Mint" | "Buy" | "Trade" | "Explore";

/** Registry entry content */
export interface RegistryEntryContent {
  title: string;
  short_description: string;
  full_description: string;
  image_url: string;
  target_url: string;
  cta_text: RegistryCTA;
  function_signature: string;
  contract_address: string;
  token_id: string;
  token_amount: string;
  featured: boolean;
  creator_name: string;
  creator_image_url: string;
  curation: string;
  start_ts: string;
  expiration_ts: string;
}

/** Registry entry */
export interface RegistryEntry {
  id: string;
  category: RegistryCategory;
  content: RegistryEntryContent;
  updated_at: string | null;
  created_at: string;
}

/** Pagination info from registry API */
export interface RegistryPagination {
  total_records: number;
  current_page: number;
  total_pages: number;
  limit: number;
}

/** Registry entries response */
export interface RegistryEntriesResponse {
  data: RegistryEntry[];
  pagination: RegistryPagination;
}

/** Registry featured response */
export interface RegistryFeaturedResponse {
  data: RegistryEntry;
}

/** Registry query parameters */
export interface RegistryQueryParams {
  page?: number;
  limit?: number;
  category?: RegistryCategory[];
  curation?: RegistryCuration;
}

// ============================================================================
// Base Chain Data Types (via public RPC / block explorer APIs)
// ============================================================================

/** Base gas price info */
export interface BaseGasPrice {
  /** Gas price in Gwei */
  gasPrice: number;
  /** Estimated L1 data fee in Gwei */
  l1DataFee: number;
  /** Total estimated cost in ETH for a standard transfer */
  estimatedTransferCostETH: number;
  /** Timestamp */
  timestamp: number;
}

/** Base token info from explorer */
export interface BaseTokenInfo {
  contractAddress: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply?: string;
  /** Price in USD if available */
  priceUsd?: number;
  /** 24h volume if available */
  volume24h?: number;
}

/** Base address balance */
export interface BaseAddressBalance {
  address: string;
  balanceETH: number;
  balanceWei: string;
  tokens: BaseTokenBalance[];
}

/** Individual token balance */
export interface BaseTokenBalance {
  contractAddress: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: string;
  balanceFormatted: number;
  priceUsd?: number;
  valueUsd?: number;
}

/** Base block info (simplified) */
export interface BaseBlockInfo {
  number: number;
  timestamp: number;
  gasUsed: number;
  gasLimit: number;
  baseFeePerGas: number;
  transactionCount: number;
}

// ============================================================================
// Base DeFi Types
// ============================================================================

/** DEX pool info */
export interface BaseDexPool {
  pairAddress: string;
  token0: { address: string; symbol: string; name: string };
  token1: { address: string; symbol: string; name: string };
  reserve0: string;
  reserve1: string;
  totalLiquidity: number;
  volume24h?: number;
  fee?: number;
  dex: string;
}

/** Token transfer event */
export interface BaseTokenTransfer {
  from: string;
  to: string;
  value: string;
  contractAddress: string;
  tokenSymbol: string;
  tokenName: string;
  tokenDecimal: number;
  blockNumber: number;
  timestamp: number;
  hash: string;
}

/** Token holder entry */
export interface BaseTokenHolder {
  address: string;
  balance: string;
  share: number;
}

// ============================================================================
// DexScreener Types
// ============================================================================

/** DexScreener timeframe-based metrics */
export interface DexScreenerTimeframes {
  m5: number;
  h1: number;
  h6: number;
  h24: number;
}

/** DexScreener transaction counts per timeframe */
export interface DexScreenerTxns {
  m5: { buys: number; sells: number };
  h1: { buys: number; sells: number };
  h6: { buys: number; sells: number };
  h24: { buys: number; sells: number };
}

/** DexScreener pair data */
export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceNative: string;
  priceUsd: string;
  txns: DexScreenerTxns;
  volume: DexScreenerTimeframes;
  priceChange: DexScreenerTimeframes;
  liquidity: { usd: number; base: number; quote: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
}

/** DexScreener token profile (new listings) */
export interface DexScreenerTokenProfile {
  url: string;
  chainId: string;
  tokenAddress: string;
  icon?: string;
  header?: string;
  description?: string;
  links?: { label?: string; type?: string; url: string }[];
}

// ============================================================================
// Signal Types
// ============================================================================

/** Whale transfer signal */
export interface WhaleTransferSignal {
  from: string;
  to: string;
  token: string;
  tokenSymbol: string;
  amount: number;
  valueUsd?: number;
  hash: string;
  timestamp: number;
}

/** DEX volume spike signal */
export interface VolumeSpikeSignal {
  token: string;
  tokenSymbol: string;
  pairAddress: string;
  dex: string;
  volumeH1: number;
  volumeH24: number;
  spikeMultiple: number;
  priceUsd: string;
  priceChangeH1: number;
  liquidityUsd: number;
}

/** New token listing signal */
export interface NewListingSignal {
  token: string;
  tokenSymbol: string;
  tokenName: string;
  pairAddress: string;
  dex: string;
  priceUsd: string;
  liquidityUsd: number;
  volumeH24: number;
  createdAt: number;
  ageHours: number;
}

/** DEX buy/sell pressure signal */
export interface DexPressureSignal {
  token: string;
  tokenSymbol: string;
  priceUsd: string;
  buysH1: number;
  sellsH1: number;
  buysH24: number;
  sellsH24: number;
  buyPressureH1: number;
  buyPressureH24: number;
  volumeH1: number;
  volumeH24: number;
  priceChangeH1: number;
  priceChangeH24: number;
}
