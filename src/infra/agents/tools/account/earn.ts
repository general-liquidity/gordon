/**
 * Simple Earn tools — Binance SAPI surface (stubbed under CCXT-only runtime).
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { getGordonContext, type MastraExecutionContext } from "../types.ts";

const errors = {
  noExchange: { error: "Exchange client not connected. Please run setup first." },
  ccxtUnsupported: {
    error: "Simple Earn requires Binance SAPI; not available via CCXT adapter.",
  },
};

function earnUnavailable(execContext: MastraExecutionContext) {
  const ctx = getGordonContext(execContext);
  if (!ctx?.exchange) return errors.noExchange;
  return errors.ccxtUnsupported;
}

export const getFlexibleProductsTool = createTool({
  id: "get_flexible_earn_products",
  description:
    "Get list of available flexible earn products with APY rates. " +
    "Use when user asks 'what can I earn on', 'flexible savings rates', 'earn APY'.",
  inputSchema: z.object({
    asset: z.string().default("").describe("Filter by asset (e.g., 'USDT', 'BTC'). Empty for all."),
  }),
  outputSchema: z.object({
    total: z.number().optional(),
    products: z
      .array(
        z.object({
          asset: z.string(),
          productId: z.string(),
          apy: z.string(),
          minPurchase: z.string(),
          canRedeem: z.boolean(),
          isSoldOut: z.boolean(),
          hot: z.boolean(),
        }),
      )
      .optional(),
    message: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (_input, execContext) => earnUnavailable(execContext),
});

export const getLockedProductsTool = createTool({
  id: "get_locked_earn_products",
  description:
    "Get list of available locked earn products with higher APY rates. " +
    "Use when user asks 'locked staking options', 'higher APY', 'lock my crypto'.",
  inputSchema: z.object({
    asset: z.string().default("").describe("Filter by asset (e.g., 'BNB', 'ETH'). Empty for all."),
  }),
  outputSchema: z.object({
    total: z.number().optional(),
    products: z
      .array(
        z.object({
          asset: z.string(),
          projectId: z.string(),
          duration: z.string(),
          apy: z.string(),
          minAmount: z.string(),
          maxAmount: z.string(),
          renewable: z.boolean(),
        }),
      )
      .optional(),
    message: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (_input, execContext) => earnUnavailable(execContext),
});

export const getAllEarnPositionsTool = createTool({
  id: "get_all_earn_positions",
  description:
    "Get ALL Simple Earn positions - both flexible AND locked, with total value summary.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    flexible: z
      .array(
        z.object({
          asset: z.string(),
          amount: z.string(),
          apy: z.string(),
          productName: z.string(),
        }),
      )
      .optional(),
    locked: z
      .array(
        z.object({
          asset: z.string(),
          amount: z.string(),
          apy: z.string(),
          duration: z.string(),
          daysRemaining: z.number(),
          redeemDate: z.string(),
          autoRenew: z.boolean(),
        }),
      )
      .optional(),
    totalValue: z
      .object({
        flexible: z.string().optional(),
        locked: z.string().optional(),
        total: z.string().optional(),
      })
      .optional(),
    message: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (_input, execContext) => earnUnavailable(execContext),
});

export const subscribeFlexibleTool = createTool({
  id: "subscribe_flexible_earn",
  description: "Subscribe to a flexible earn product to start earning.",
  inputSchema: z.object({
    productId: z.string(),
    amount: z.number().positive(),
    sourceAccount: z.enum(["SPOT", "FUND"]).default("SPOT"),
  }),
  outputSchema: z.object({
    success: z.boolean().optional(),
    message: z.string().optional(),
    purchaseId: z.number().optional(),
    productId: z.string().optional(),
    amount: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async (_input, execContext) => earnUnavailable(execContext),
});

export const redeemFlexibleTool = createTool({
  id: "redeem_flexible_earn",
  description: "Redeem from a flexible earn product back to wallet.",
  inputSchema: z.object({
    productId: z.string(),
    amount: z.number().default(0),
    redeemAll: z.boolean().default(false),
    destAccount: z.enum(["SPOT", "FUND"]).default("SPOT"),
  }),
  outputSchema: z.object({
    success: z.boolean().optional(),
    message: z.string().optional(),
    redeemId: z.number().optional(),
    productId: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (_input, execContext) => earnUnavailable(execContext),
});

export const subscribeLockedTool = createTool({
  id: "subscribe_locked_earn",
  description: "Subscribe to a locked earn product for higher APY.",
  inputSchema: z.object({
    projectId: z.string(),
    amount: z.number().positive(),
    sourceAccount: z.enum(["SPOT", "FUND"]).default("SPOT"),
  }),
  outputSchema: z.object({
    success: z.boolean().optional(),
    message: z.string().optional(),
    purchaseId: z.number().optional(),
    warning: z.string().optional(),
    projectId: z.string().optional(),
    amount: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async (_input, execContext) => earnUnavailable(execContext),
});

export const getEarnHistoryTool = createTool({
  id: "get_earn_history",
  description: "Get earn subscription and redemption history.",
  inputSchema: z.object({
    type: z.enum(["subscriptions", "redemptions", "both"]).default("both"),
    asset: z.string().optional(),
    limit: z.number().min(1).max(50).default(20),
  }),
  outputSchema: z.object({
    subscriptions: z
      .object({
        count: z.number(),
        records: z.array(
          z.object({
            amount: z.string(),
            asset: z.string(),
            time: z.string(),
            purchaseId: z.number(),
            sourceAccount: z.string(),
            status: z.string(),
          }),
        ),
      })
      .optional(),
    redemptions: z
      .object({
        count: z.number(),
        records: z.array(
          z.object({
            amount: z.string(),
            asset: z.string(),
            time: z.string(),
            redeemId: z.number(),
            destAccount: z.string(),
            status: z.string(),
          }),
        ),
      })
      .optional(),
    error: z.string().optional(),
  }),
  execute: async (_input, execContext) => earnUnavailable(execContext),
});

export const earnTools = {
  get_flexible_earn_products: getFlexibleProductsTool,
  get_locked_earn_products: getLockedProductsTool,
  get_all_earn_positions: getAllEarnPositionsTool,
  subscribe_flexible_earn: subscribeFlexibleTool,
  redeem_flexible_earn: redeemFlexibleTool,
  subscribe_locked_earn: subscribeLockedTool,
  get_earn_history: getEarnHistoryTool,
};
