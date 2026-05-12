/**
 * Base L2 On-Chain Signal Tools (Mastra Format)
 * Tools for on-chain trading signals: whale detection, DEX volume, new tokens, pressure analysis
 *
 * Data sources:
 * - Basescan / Etherscan V2 API (token transfers, holders) — requires BASESCAN_API_KEY
 * - DexScreener API (DEX pairs, volume, new listings) — no key needed
 *
 * Tools:
 * - scan_base_whale_transfers: Detect large token movements
 * - get_base_dex_pairs: Get DEX pair data for a token
 * - scan_base_volume_spikes: Find tokens with unusual volume
 * - scan_base_new_tokens: Discover newly listed tokens
 * - track_base_wallet: Track token transfers for a wallet
 * - get_base_token_holders: Get top holders for a token
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  detectWhaleTransfers,
  detectVolumeSpikes,
  detectNewListings,
  analyzeDexPressure,
} from "../../../../protocols/base/signals.ts";
import { getTokenTransfers, getTopTokenHolders, isBasescanConfigured } from "../../../../protocols/base/basescan.ts";
import { getBasePairs, searchBasePairs } from "../../../../protocols/base/dexscreener.ts";

// ============================================================================
// Whale Transfer Detection
// ============================================================================

export const scanBaseWhaleTransfersTool = createTool({
  id: "scan_base_whale_transfers",
  description:
    "Scan for large token transfers (whale movements) on Base L2. " +
    "Detects big USDC, WETH, and other major token movements. " +
    "Requires BASESCAN_API_KEY. " +
    "Use when user asks 'any whale activity on Base', 'large transfers', 'who is moving big money on Base'.",
  inputSchema: z.object({
    minAmount: z.number().optional().describe("Minimum token amount to flag (default: 50000 for stablecoins)"),
    limit: z.number().optional().describe("Max transfers to fetch per token (default: 50)"),
  }),
  outputSchema: z.object({
    signals: z.array(z.object({
      from: z.string(),
      to: z.string(),
      token: z.string(),
      tokenSymbol: z.string(),
      amount: z.number(),
      hash: z.string(),
      timestamp: z.number(),
    })).optional(),
    count: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ minAmount, limit }) => {
    if (!isBasescanConfigured()) {
      return { error: "BASESCAN_API_KEY not configured. Get a free key at basescan.org." };
    }

    try {
      const signals = await detectWhaleTransfers({ minAmount, limit });
      return { signals, count: signals.length };
    } catch (error) {
      return { error: `Failed to scan whale transfers: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// DEX Pair Data
// ============================================================================

export const getBaseDexPairsTool = createTool({
  id: "get_base_dex_pairs",
  description:
    "Get DEX pair data for a token on Base L2 — price, volume, liquidity, buy/sell pressure. " +
    "Covers all Base DEXs (Uniswap V3, Aerodrome, SushiSwap, etc.). No API key needed. " +
    "Use when user asks 'what DEX pairs for TOKEN', 'onchain price', 'DEX volume for TOKEN on Base'.",
  inputSchema: z.object({
    query: z.string().describe("Token address (0x...) or search query (e.g., 'BRETT', 'WETH/USDC')"),
  }),
  outputSchema: z.object({
    pairs: z.array(z.object({
      pairAddress: z.string(),
      dex: z.string(),
      baseToken: z.string(),
      quoteToken: z.string(),
      priceUsd: z.string(),
      volumeH1: z.number(),
      volumeH24: z.number(),
      liquidityUsd: z.number(),
      priceChangeH1: z.number(),
      priceChangeH24: z.number(),
      buysH1: z.number(),
      sellsH1: z.number(),
      url: z.string(),
    })).optional(),
    count: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ query }) => {
    try {
      const isAddress = /^0x[a-fA-F0-9]{40}$/.test(query);
      const pairs = isAddress ? await getBasePairs(query) : await searchBasePairs(query);

      return {
        count: pairs.length,
        pairs: pairs.slice(0, 20).map((p) => ({
          pairAddress: p.pairAddress,
          dex: p.dexId,
          baseToken: `${p.baseToken.symbol} (${p.baseToken.address})`,
          quoteToken: `${p.quoteToken.symbol} (${p.quoteToken.address})`,
          priceUsd: p.priceUsd,
          volumeH1: p.volume?.h1 ?? 0,
          volumeH24: p.volume?.h24 ?? 0,
          liquidityUsd: p.liquidity?.usd ?? 0,
          priceChangeH1: p.priceChange?.h1 ?? 0,
          priceChangeH24: p.priceChange?.h24 ?? 0,
          buysH1: p.txns?.h1?.buys ?? 0,
          sellsH1: p.txns?.h1?.sells ?? 0,
          url: p.url,
        })),
      };
    } catch (error) {
      return { error: `Failed to get DEX pairs: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Volume Spike Detection
// ============================================================================

export const scanBaseVolumeSpikesTool = createTool({
  id: "scan_base_volume_spikes",
  description:
    "Find Base tokens with unusual volume spikes — hourly volume significantly above 24h average. " +
    "No API key needed (uses DexScreener). " +
    "Use when user asks 'any volume spikes on Base', 'unusual activity', 'what's pumping on Base DEXs'.",
  inputSchema: z.object({
    tokenAddresses: z.array(z.string()).optional().describe("Specific token addresses to check. Default: scans major tokens."),
    spikeThreshold: z.number().optional().describe("Minimum spike multiple (default: 3x average)"),
    minLiquidityUsd: z.number().optional().describe("Minimum liquidity to filter noise (default: 10000)"),
  }),
  outputSchema: z.object({
    signals: z.array(z.object({
      tokenSymbol: z.string(),
      token: z.string(),
      pairAddress: z.string(),
      dex: z.string(),
      volumeH1: z.number(),
      volumeH24: z.number(),
      spikeMultiple: z.number(),
      priceUsd: z.string(),
      priceChangeH1: z.number(),
      liquidityUsd: z.number(),
    })).optional(),
    count: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ tokenAddresses, spikeThreshold, minLiquidityUsd }) => {
    try {
      const signals = await detectVolumeSpikes({ tokenAddresses, spikeThreshold, minLiquidityUsd });
      return { signals, count: signals.length };
    } catch (error) {
      return { error: `Failed to scan volume spikes: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// New Token Listings
// ============================================================================

export const scanBaseNewTokensTool = createTool({
  id: "scan_base_new_tokens",
  description:
    "Discover newly listed token pairs on Base DEXs within the last N hours. " +
    "Filters out low-liquidity tokens to reduce rug-pull noise. No API key needed. " +
    "Use when user asks 'new tokens on Base', 'recent Base launches', 'what just listed on Base DEXs'.",
  inputSchema: z.object({
    maxAgeHours: z.number().optional().describe("Maximum listing age in hours (default: 24)"),
    minLiquidityUsd: z.number().optional().describe("Minimum liquidity in USD (default: 5000)"),
  }),
  outputSchema: z.object({
    listings: z.array(z.object({
      tokenSymbol: z.string(),
      tokenName: z.string(),
      token: z.string(),
      pairAddress: z.string(),
      dex: z.string(),
      priceUsd: z.string(),
      liquidityUsd: z.number(),
      volumeH24: z.number(),
      ageHours: z.number(),
    })).optional(),
    count: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ maxAgeHours, minLiquidityUsd }) => {
    try {
      const listings = await detectNewListings({ maxAgeHours, minLiquidityUsd });
      return { listings, count: listings.length };
    } catch (error) {
      return { error: `Failed to scan new tokens: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Wallet Tracking
// ============================================================================

export const trackBaseWalletTool = createTool({
  id: "track_base_wallet",
  description:
    "Track recent token transfers for a specific Base wallet address. " +
    "Shows what a wallet has been buying/selling. Requires BASESCAN_API_KEY. " +
    "Use when user asks 'what is this wallet doing', 'track wallet 0x...', 'wallet activity'.",
  inputSchema: z.object({
    address: z.string().describe("Base wallet address to track (0x...)"),
    limit: z.number().optional().describe("Number of recent transfers (default: 50)"),
  }),
  outputSchema: z.object({
    address: z.string().optional(),
    transfers: z.array(z.object({
      direction: z.string(),
      token: z.string(),
      amount: z.string(),
      counterparty: z.string(),
      hash: z.string(),
      timestamp: z.number(),
    })).optional(),
    count: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ address, limit }) => {
    if (!isBasescanConfigured()) {
      return { error: "BASESCAN_API_KEY not configured. Get a free key at basescan.org." };
    }

    try {
      const transfers = await getTokenTransfers({ address, offset: limit ?? 50, sort: "desc" });

      return {
        address,
        count: transfers.length,
        transfers: transfers.map((tx) => ({
          direction: tx.to.toLowerCase() === address.toLowerCase() ? "IN" : "OUT",
          token: `${tx.tokenSymbol} (${tx.contractAddress})`,
          amount: (parseFloat(tx.value) / Math.pow(10, tx.tokenDecimal)).toFixed(4),
          counterparty: tx.to.toLowerCase() === address.toLowerCase() ? tx.from : tx.to,
          hash: tx.hash,
          timestamp: tx.timestamp,
        })),
      };
    } catch (error) {
      return { error: `Failed to track wallet: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Token Holders
// ============================================================================

export const getBaseTokenHoldersTool = createTool({
  id: "get_base_token_holders",
  description:
    "Get top holders for a Base token. Shows concentration and identifies large holders. " +
    "Requires BASESCAN_API_KEY. " +
    "Use when user asks 'who holds TOKEN', 'token holder distribution', 'whale concentration'.",
  inputSchema: z.object({
    contractAddress: z.string().describe("ERC-20 token contract address on Base (0x...)"),
    limit: z.number().optional().describe("Number of top holders (default: 20)"),
  }),
  outputSchema: z.object({
    token: z.string().optional(),
    holders: z.array(z.object({
      address: z.string(),
      balance: z.string(),
      share: z.number(),
    })).optional(),
    count: z.number().optional(),
    topHolderConcentration: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ contractAddress, limit }) => {
    if (!isBasescanConfigured()) {
      return { error: "BASESCAN_API_KEY not configured. Get a free key at basescan.org." };
    }

    try {
      const holders = await getTopTokenHolders(contractAddress, { offset: limit ?? 20 });

      const top10Share = holders.slice(0, 10).reduce((sum, h) => sum + h.share, 0);

      return {
        token: contractAddress,
        holders,
        count: holders.length,
        topHolderConcentration: Math.round(top10Share * 100) / 100,
      };
    } catch (error) {
      return { error: `Failed to get token holders: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Export as Mastra tool object
// ============================================================================

export const baseSignalTools = {
  scan_base_whale_transfers: scanBaseWhaleTransfersTool,
  get_base_dex_pairs: getBaseDexPairsTool,
  scan_base_volume_spikes: scanBaseVolumeSpikesTool,
  scan_base_new_tokens: scanBaseNewTokensTool,
  track_base_wallet: trackBaseWalletTool,
  get_base_token_holders: getBaseTokenHoldersTool,
};
