/**
 * Uniswap V3 Subgraph Types
 * Type definitions for The Graph's Uniswap V3 subgraph responses.
 *
 * Used by UniswapSubgraph client to provide market data (candles, tickers,
 * swap history, pool analytics) that the Trading API doesn't offer.
 */

// ============================================================================
// Subgraph Entity Types
// ============================================================================

export interface SubgraphToken {
  id: string;
  symbol: string;
  name: string;
  decimals: string;
}

export interface SubgraphPool {
  id: string;
  feeTier: string;
  liquidity: string;
  sqrtPrice: string;
  tick: string;
  token0Price: string;
  token1Price: string;
  totalValueLockedUSD: string;
  volumeUSD: string;
  token0: SubgraphToken;
  token1: SubgraphToken;
}

export interface SubgraphPoolDayData {
  date: number;
  open: string;
  high: string;
  low: string;
  close: string;
  token0Price: string;
  token1Price: string;
  volumeUSD: string;
  volumeToken0: string;
  volumeToken1: string;
  tvlUSD: string;
}

export interface SubgraphPoolHourData {
  periodStartUnix: number;
  open: string;
  high: string;
  low: string;
  close: string;
  token0Price: string;
  token1Price: string;
  volumeUSD: string;
  volumeToken0: string;
  volumeToken1: string;
  tvlUSD: string;
}

export interface SubgraphSwap {
  id: string;
  timestamp: string;
  amount0: string;
  amount1: string;
  amountUSD: string;
  sender: string;
  recipient: string;
  sqrtPriceX96: string;
  tick: string;
}

export interface SubgraphTokenDayData {
  date: number;
  priceUSD: string;
  volumeUSD: string;
  open: string;
  high: string;
  low: string;
  close: string;
}

export interface SubgraphTokenWithDayData {
  id: string;
  symbol: string;
  name: string;
  volumeUSD: string;
  totalValueLockedUSD: string;
  tokenDayDatas: SubgraphTokenDayData[];
}

export interface SubgraphTokenHourData {
  periodStartUnix: number;
  token: { id: string };
  volume: string;
  volumeUSD: string;
  totalValueLocked: string;
  totalValueLockedUSD: string;
  priceUSD: string;
  feesUSD: string;
  open: string;
  high: string;
  low: string;
  close: string;
}

export interface SubgraphBundle {
  id: string;
  ethPriceUSD: string;
}

export interface SubgraphFactory {
  id: string;
  poolCount: string;
  txCount: string;
  totalVolumeUSD: string;
  totalVolumeETH: string;
  totalFeesUSD: string;
  totalFeesETH: string;
  totalValueLockedUSD: string;
  totalValueLockedETH: string;
  owner: string;
}

export interface SubgraphTick {
  id: string;
  tickIdx: string;
  poolAddress: string;
  liquidityGross: string;
  liquidityNet: string;
  price0: string;
  price1: string;
  volumeToken0: string;
  volumeToken1: string;
  volumeUSD: string;
  feesUSD: string;
}

export interface SubgraphTickDayData {
  id: string;
  date: number;
  tick: { tickIdx: string };
  liquidityGross: string;
  liquidityNet: string;
  volumeToken0: string;
  volumeToken1: string;
  volumeUSD: string;
  feesUSD: string;
}

export interface SubgraphTickHourData {
  id: string;
  periodStartUnix: number;
  tick: { tickIdx: string };
  liquidityGross: string;
  liquidityNet: string;
  volumeToken0: string;
  volumeToken1: string;
  volumeUSD: string;
  feesUSD: string;
}

export interface SubgraphTransaction {
  id: string;
  blockNumber: string;
  timestamp: string;
  gasUsed: string;
  gasPrice: string;
}

export interface SubgraphMint {
  id: string;
  transaction: { id: string; timestamp: string };
  timestamp: string;
  pool: { id: string };
  token0: SubgraphToken;
  token1: SubgraphToken;
  owner: string;
  sender: string;
  origin: string;
  amount: string;
  amount0: string;
  amount1: string;
  amountUSD: string;
  tickLower: string;
  tickUpper: string;
  logIndex: string;
}

export interface SubgraphBurn {
  id: string;
  transaction: { id: string; timestamp: string };
  timestamp: string;
  pool: { id: string };
  token0: SubgraphToken;
  token1: SubgraphToken;
  owner: string;
  origin: string;
  amount: string;
  amount0: string;
  amount1: string;
  amountUSD: string;
  tickLower: string;
  tickUpper: string;
  logIndex: string;
}

export interface SubgraphCollect {
  id: string;
  transaction: { id: string; timestamp: string };
  timestamp: string;
  pool: { id: string };
  owner: string;
  amount0: string;
  amount1: string;
  amountUSD: string;
  tickLower: string;
  tickUpper: string;
  logIndex: string;
}

export interface SubgraphFlash {
  id: string;
  transaction: { id: string; timestamp: string };
  timestamp: string;
  pool: { id: string };
  sender: string;
  recipient: string;
  amount0: string;
  amount1: string;
  amountUSD: string;
  amount0Paid: string;
  amount1Paid: string;
  logIndex: string;
}

export interface SubgraphPosition {
  id: string;
  owner: string;
  pool: { id: string; token0: SubgraphToken; token1: SubgraphToken };
  token0: SubgraphToken;
  token1: SubgraphToken;
  tickLower: { tickIdx: string; price0: string; price1: string };
  tickUpper: { tickIdx: string; price0: string; price1: string };
  liquidity: string;
  depositedToken0: string;
  depositedToken1: string;
  withdrawnToken0: string;
  withdrawnToken1: string;
  collectedFeesToken0: string;
  collectedFeesToken1: string;
  transaction: { id: string; timestamp: string };
}

export interface SubgraphPositionSnapshot {
  id: string;
  owner: string;
  pool: { id: string };
  position: { id: string };
  blockNumber: string;
  timestamp: string;
  liquidity: string;
  depositedToken0: string;
  depositedToken1: string;
  withdrawnToken0: string;
  withdrawnToken1: string;
  collectedFeesToken0: string;
  collectedFeesToken1: string;
  transaction: { id: string };
}

export interface SubgraphUniswapDayData {
  id: string;
  date: number;
  volumeETH: string;
  volumeUSD: string;
  feesUSD: string;
  txCount: string;
  tvlUSD: string;
}

// ============================================================================
// Resolved Pool (with inversion tracking)
// ============================================================================

/** Tracks whether tokenIn maps to token0 or token1 in the subgraph pool */
export interface ResolvedPool {
  pool: SubgraphPool;
  /** true when tokenIn is actually token1 (prices need inversion) */
  isInverted: boolean;
}

// ============================================================================
// GraphQL Response Wrappers
// ============================================================================

export interface SubgraphResponse<T> {
  data: T;
  errors?: Array<{ message: string }>;
}

export interface PoolsQueryResult {
  pools: SubgraphPool[];
}

export interface PoolQueryResult {
  pool: SubgraphPool | null;
}

export interface PoolDayDatasResult {
  poolDayDatas: SubgraphPoolDayData[];
}

export interface PoolHourDatasResult {
  poolHourDatas: SubgraphPoolHourData[];
}

export interface SwapsResult {
  swaps: SubgraphSwap[];
}

export interface TokensResult {
  tokens: SubgraphTokenWithDayData[];
}

export interface BundleResult {
  bundle: SubgraphBundle | null;
}

export interface FactoryResult {
  factory: SubgraphFactory | null;
}

export interface TicksResult {
  ticks: SubgraphTick[];
}

export interface TickDayDatasResult {
  tickDayDatas: SubgraphTickDayData[];
}

export interface TickHourDatasResult {
  tickHourDatas: SubgraphTickHourData[];
}

export interface TokenHourDatasResult {
  tokenHourDatas: SubgraphTokenHourData[];
}

export interface MintsResult {
  mints: SubgraphMint[];
}

export interface BurnsResult {
  burns: SubgraphBurn[];
}

export interface CollectsResult {
  collects: SubgraphCollect[];
}

export interface FlashesResult {
  flashes: SubgraphFlash[];
}

export interface PositionsResult {
  positions: SubgraphPosition[];
}

export interface PositionSnapshotsResult {
  positionSnapshots: SubgraphPositionSnapshot[];
}

export interface UniswapDayDatasResult {
  uniswapDayDatas: SubgraphUniswapDayData[];
}

// ============================================================================
// V3 Subgraph IDs by Chain (Decentralized Gateway)
// ============================================================================

export const V3_SUBGRAPH_IDS: Record<number, string> = {
  1:     "5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV",  // Ethereum
  10:    "Cghf4LfVqPiFw6fp6Y5X5Ubc8UpmUhSfJL82zwiBFLaj",  // Optimism
  56:    "F85MNzUGYqgSHSHRGgeVMNsdnW1KtZSVgFULumXRZTw2",  // BSC
  137:   "3hCPRGf4z88VC5rsBKU5AA9FBBq5nF3jbKJG7VZCbhjm",  // Polygon
  8453:  "43Hwfi3dJSoGpyas9VwNoDAv55yjgGrPpNSmbQZArzMG",  // Base
  42161: "FbCGRftH4a3yZugY7TnbYgPJVEv2LvMT6oF1fxPe9aJM",  // Arbitrum
  42220: "ESdrTJ3twMwWVoQ1hUE2u7PugEHX3QkenudD6aXCkDQ4",  // Celo
  43114: "GVH9h9KZ9CqheUEL93qMbq7QwgoBu32QXQDPR6bev4Eo",  // Avalanche
  81457: "2LHovKznvo8YmKC9ZprPjsYAZDCc4K5q4AYz8s3cnQn1",  // Blast
};
