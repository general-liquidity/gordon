/**
 * DefiLlama API Types
 * Types for the yields.llama.fi and coins.llama.fi APIs
 */

/** Pool yield data from yields.llama.fi/pools */
export interface DefiLlamaPool {
  chain: string;
  project: string;
  symbol: string;
  tvlUsd: number;
  apyBase: number | null;
  apyReward: number | null;
  apy: number;
  rewardTokens: string[] | null;
  pool: string;
  apyPct1D: number | null;
  apyPct7D: number | null;
  apyPct30D: number | null;
  stablecoin: boolean;
  ilRisk: string;
  exposure: string;
  predictions: {
    predictedClass: string;
    predictedProbability: number;
    binnedConfidence: number;
  } | null;
  poolMeta: string | null;
  mu: number | null;
  sigma: number | null;
  count: number | null;
  outlier: boolean;
  underlyingTokens: string[] | null;
  il7d: number | null;
  apyBase7d: number | null;
  apyMean30d: number | null;
  volumeUsd1d: number | null;
  volumeUsd7d: number | null;
}

/** Response from yields.llama.fi/pools */
export interface DefiLlamaPoolsResponse {
  status: string;
  data: DefiLlamaPool[];
}

/** Token price from coins.llama.fi */
export interface DefiLlamaTokenPrice {
  decimals: number;
  symbol: string;
  price: number;
  timestamp: number;
  confidence: number;
}

/** Response from coins.llama.fi/prices/current */
export interface DefiLlamaPricesResponse {
  coins: Record<string, DefiLlamaTokenPrice>;
}
