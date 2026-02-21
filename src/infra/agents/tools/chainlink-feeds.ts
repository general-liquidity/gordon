/**
 * Chainlink Data Feeds Tools
 * Mastra createTool() wrappers for on-chain Chainlink price oracles
 *
 * Tools:
 * - chainlink_read_feed: Read on-chain Data Feed price for a chain/pair
 * - chainlink_compare_prices: Compare on-chain feed vs Data Streams price
 *
 * No API key required — reads directly from on-chain aggregator contracts.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  readFeedByPair,
  readFeed,
  comparePrices,
} from "../../chainlink/index.ts";

// ============================================================================
// Tools
// ============================================================================

const chainlinkReadFeedTool = createTool({
  id: "chainlink_read_feed",
  description:
    "Read the latest price from a Chainlink on-chain Data Feed (aggregator contract). " +
    "Free — no API key needed. Reads directly from the blockchain via eth_call. " +
    "Supports multiple EVM chains: ethereum, arbitrum, base, polygon, optimism, avalanche, bnb. " +
    "You can specify a pair (e.g., ETH/USD) or a custom aggregator address.",
  inputSchema: z.object({
    chain: z
      .string()
      .default("ethereum")
      .describe('EVM chain name (e.g., "ethereum", "arbitrum", "base", "polygon")'),
    pair: z
      .string()
      .optional()
      .describe('Price pair (e.g., "ETH/USD", "BTC/USD"). Use this OR aggregatorAddress.'),
    aggregatorAddress: z
      .string()
      .optional()
      .describe("Custom aggregator proxy contract address (0x...). Use this OR pair."),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    data: z.unknown().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ chain, pair, aggregatorAddress }) => {
    try {
      if (aggregatorAddress) {
        const result = await readFeed(chain, aggregatorAddress, pair);
        return { success: true, data: result };
      }
      if (pair) {
        const result = await readFeedByPair(chain, pair);
        return { success: true, data: result };
      }
      return { success: false, error: "Provide either 'pair' or 'aggregatorAddress'." };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
});

const chainlinkComparePricesTool = createTool({
  id: "chainlink_compare_prices",
  description:
    "Compare a Chainlink on-chain Data Feed price with the Chainlink Data Streams price for the same pair. " +
    "Shows the delta percentage between the two sources. Useful for detecting price manipulation or confirming fair value. " +
    "Data Streams requires API keys; on-chain feed is free.",
  inputSchema: z.object({
    pair: z
      .string()
      .describe('Price pair to compare (e.g., "ETH/USD", "BTC/USD")'),
    chain: z
      .string()
      .default("ethereum")
      .describe('Chain to read on-chain feed from (default: "ethereum")'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    data: z.unknown().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ pair, chain }) => {
    try {
      const result = await comparePrices(pair, chain);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
});

// ============================================================================
// Export as keyed object (Mastra tool format)
// ============================================================================

export const chainlinkFeedsTools = {
  chainlink_read_feed: chainlinkReadFeedTool,
  chainlink_compare_prices: chainlinkComparePricesTool,
};
