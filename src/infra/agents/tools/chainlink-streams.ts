/**
 * Chainlink Data Streams Tools
 * Mastra createTool() wrappers for Chainlink Data Streams REST API
 *
 * Tools:
 * - chainlink_get_price: Get latest price for a pair
 * - chainlink_get_price_at: Get price at a specific timestamp
 * - chainlink_bulk_prices: Get prices for multiple pairs
 * - chainlink_list_feeds: List available Data Streams feed IDs
 *
 * All tools gracefully handle the case where Chainlink API keys are not configured.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  isStreamsConfigured,
  getLatestReport,
  getReportAtTimestamp,
  getBulkReports,
  listStreamFeeds,
} from "../../chainlink/index.ts";

// ============================================================================
// Tools
// ============================================================================

const chainlinkGetPriceTool = createTool({
  id: "chainlink_get_price",
  description:
    "Get the latest institutional-grade price for a crypto pair from Chainlink Data Streams. " +
    "Returns price, bid, ask, and timestamp. Supports BTC/USD, ETH/USD, SOL/USD, LINK/USD, and more. " +
    "Requires CHAINLINK_API_KEY and CHAINLINK_API_SECRET.",
  inputSchema: z.object({
    pair: z
      .string()
      .describe('Price pair (e.g., "BTC/USD", "ETH/USD") or raw Chainlink feed ID (0x...)'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    data: z.unknown().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ pair }) => {
    if (!isStreamsConfigured()) {
      return {
        success: false,
        error: "Chainlink Data Streams not configured. Set CHAINLINK_API_KEY and CHAINLINK_API_SECRET.",
      };
    }
    try {
      const report = await getLatestReport(pair);
      return { success: true, data: report };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
});

const chainlinkGetPriceAtTool = createTool({
  id: "chainlink_get_price_at",
  description:
    "Get a historical Chainlink Data Streams price at a specific timestamp. " +
    "Useful for checking what the price was at a particular moment in time.",
  inputSchema: z.object({
    pair: z
      .string()
      .describe('Price pair (e.g., "BTC/USD") or raw feed ID (0x...)'),
    timestamp: z
      .number()
      .describe("Unix timestamp in seconds to query the price at"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    data: z.unknown().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ pair, timestamp }) => {
    if (!isStreamsConfigured()) {
      return {
        success: false,
        error: "Chainlink Data Streams not configured. Set CHAINLINK_API_KEY and CHAINLINK_API_SECRET.",
      };
    }
    try {
      const report = await getReportAtTimestamp(pair, timestamp);
      return { success: true, data: report };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
});

const chainlinkBulkPricesTool = createTool({
  id: "chainlink_bulk_prices",
  description:
    "Get latest prices for multiple crypto pairs in a single Chainlink Data Streams API call. " +
    "More efficient than calling chainlink_get_price multiple times.",
  inputSchema: z.object({
    pairs: z
      .array(z.string())
      .min(1)
      .max(20)
      .describe('Array of price pairs (e.g., ["BTC/USD", "ETH/USD", "SOL/USD"])'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    data: z.unknown().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ pairs }) => {
    if (!isStreamsConfigured()) {
      return {
        success: false,
        error: "Chainlink Data Streams not configured. Set CHAINLINK_API_KEY and CHAINLINK_API_SECRET.",
      };
    }
    try {
      const reports = await getBulkReports(pairs);
      return { success: true, data: reports };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
});

const chainlinkListFeedsTool = createTool({
  id: "chainlink_list_feeds",
  description:
    "List all available Chainlink Data Streams feed IDs and their corresponding pairs. " +
    "Use this to discover which crypto pairs are available for price queries.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    success: z.boolean(),
    data: z.unknown().optional(),
  }),
  execute: async () => {
    const feeds = listStreamFeeds();
    return { success: true, data: feeds };
  },
});

// ============================================================================
// Export as keyed object (Mastra tool format)
// ============================================================================

export const chainlinkStreamsTools = {
  chainlink_get_price: chainlinkGetPriceTool,
  chainlink_get_price_at: chainlinkGetPriceAtTool,
  chainlink_bulk_prices: chainlinkBulkPricesTool,
  chainlink_list_feeds: chainlinkListFeedsTool,
};
