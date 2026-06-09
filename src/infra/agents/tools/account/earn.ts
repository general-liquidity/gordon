/**
 * Simple Earn Tools (Mastra Format)
 * Tools for managing Binance Simple Earn products (Flexible & Locked)
 *
 * Migrated from OpenAI Agents SDK format to Mastra format.
 * Key differences:
 * - tool() -> createTool()
 * - name -> id
 * - parameters -> inputSchema
 * - Context access via first parameter destructuring
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { getGordonContext, isBinanceVenue, type MastraExecutionContext } from "../types.ts";

// ============================================================================
// Error Messages
// ============================================================================

const errors = {
  noExchange: { error: "Exchange client not connected. Please run setup first." },
  binanceOnly: { error: "Simple Earn is currently supported only on Binance." },
};

// ============================================================================
// Product Discovery
// ============================================================================

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
        })
      )
      .optional(),
    message: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ asset }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }
    if (!ctx.binance || !isBinanceVenue(ctx.exchange.exchangeId)) {
      return errors.binanceOnly;
    }

    try {
      const result = await ctx.binance.getFlexibleProducts({ asset: asset || undefined, size: 50 });

      if (result.rows.length === 0) {
        return { message: asset ? `No flexible products found for ${asset}.` : "No flexible products available." };
      }

      return {
        total: result.total,
        products: result.rows
          .filter((p) => p.canPurchase)
          .slice(0, 20)
          .map((p) => ({
            asset: p.asset,
            productId: p.productId,
            apy: (parseFloat(p.latestAnnualPercentageRate) * 100).toFixed(2) + "%",
            minPurchase: p.minPurchaseAmount,
            canRedeem: p.canRedeem,
            isSoldOut: p.isSoldOut,
            hot: p.hot,
          })),
      };
    } catch (error) {
      return { error: `Failed to get flexible products: ${(error as Error).message}` };
    }
  },
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
        })
      )
      .optional(),
    message: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ asset }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }
    if (!ctx.binance || !isBinanceVenue(ctx.exchange.exchangeId)) {
      return errors.binanceOnly;
    }

    try {
      const result = await ctx.binance.getLockedProducts({ asset: asset || undefined, size: 50 });

      if (result.rows.length === 0) {
        return { message: asset ? `No locked products found for ${asset}.` : "No locked products available." };
      }

      return {
        total: result.total,
        products: result.rows
          .filter((p) => !p.detail.isSoldOut)
          .slice(0, 20)
          .map((p) => ({
            asset: p.detail.asset,
            projectId: p.projectId,
            duration: p.detail.duration + " days",
            apy: (parseFloat(p.detail.apr) * 100).toFixed(2) + "%",
            minAmount: p.quota.minimum,
            maxAmount: p.quota.totalPersonalQuota,
            renewable: p.detail.renewable,
          })),
      };
    } catch (error) {
      return { error: `Failed to get locked products: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Position Management
// ============================================================================

export const getAllEarnPositionsTool = createTool({
  id: "get_all_earn_positions",
  description:
    "Get ALL Simple Earn positions - both flexible AND locked, with total value summary. " +
    "This is the comprehensive view. Use when user asks 'my earn positions', 'what am I earning on', " +
    "'staking balance', 'all my earn', 'how much am I earning'.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    flexible: z
      .array(
        z.object({
          asset: z.string(),
          amount: z.string(),
          apy: z.string(),
          productName: z.string(),
        })
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
        })
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
  execute: async (_input, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }
    if (!ctx.binance || !isBinanceVenue(ctx.exchange.exchangeId)) {
      return errors.binanceOnly;
    }

    try {
      const result = await ctx.binance.getAllEarnPositions();

      const hasPositions = result.flexible.length > 0 || result.locked.length > 0;

      if (!hasPositions) {
        return {
          message: "You have no active earn positions. Use 'get_flexible_earn_products' to see available options.",
          flexible: [],
          locked: [],
        };
      }

      // Transform totalValue to expected format
      const totalValue = Array.isArray(result.totalValue)
        ? result.totalValue.reduce((acc: { flexible?: string; locked?: string; total?: string }, item: { asset?: string; amount?: number }) => {
            if (item.asset === "flexible") acc.flexible = String(item.amount ?? 0);
            else if (item.asset === "locked") acc.locked = String(item.amount ?? 0);
            else if (item.asset === "total") acc.total = String(item.amount ?? 0);
            return acc;
          }, {})
        : result.totalValue;

      return {
        flexible: result.flexible.map((p) => ({
          asset: p.asset,
          amount: p.totalAmount,
          apy: (parseFloat(p.apy) * 100).toFixed(2) + "%",
          productName: p.productName,
        })),
        locked: result.locked.map((p) => ({
          asset: p.asset,
          amount: p.amount,
          apy: (parseFloat(p.APY) * 100).toFixed(2) + "%",
          duration: p.duration + " days",
          daysRemaining: p.duration - p.accrualDays,
          redeemDate: p.redeemDate,
          autoRenew: p.isAutoRenew,
        })),
        totalValue,
      };
    } catch (error) {
      return { error: `Failed to get earn positions: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Subscribe/Redeem
// ============================================================================

export const subscribeFlexibleTool = createTool({
  id: "subscribe_flexible_earn",
  description:
    "Subscribe to a flexible earn product to start earning. " +
    "Use when user says 'start earning on USDT', 'put my BTC in earn', 'subscribe to flexible'. " +
    "Requires permissionMode not 'strict'.",
  inputSchema: z.object({
    productId: z.string().describe("Product ID from get_flexible_earn_products"),
    amount: z.number().positive().describe("Amount to subscribe"),
    sourceAccount: z.enum(["SPOT", "FUND"]).default("SPOT").describe("Source wallet"),
  }),
  outputSchema: z.object({
    success: z.boolean().optional(),
    message: z.string().optional(),
    purchaseId: z.number().optional(),
    productId: z.string().optional(),
    amount: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ productId, amount, sourceAccount }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }
    if (!ctx.binance || !isBinanceVenue(ctx.exchange.exchangeId)) {
      return errors.binanceOnly;
    }

    if (ctx.config?.permissionMode === "strict") {
      return {
        error: "permissionMode must not be 'strict' to subscribe to earn products. Use /auto or /ask.",
        productId,
        amount,
      };
    }

    try {
      const result = await ctx.binance.subscribeFlexible(productId, amount, sourceAccount);

      return {
        success: result.success,
        message: `Successfully subscribed ${amount} to flexible earn.`,
        purchaseId: result.purchaseId,
      };
    } catch (error) {
      return { error: `Failed to subscribe: ${(error as Error).message}` };
    }
  },
});

export const redeemFlexibleTool = createTool({
  id: "redeem_flexible_earn",
  description:
    "Redeem from a flexible earn product back to wallet. " +
    "Use when user says 'redeem my USDT', 'stop earning', 'withdraw from flexible'. " +
    "Requires permissionMode not 'strict'.",
  inputSchema: z.object({
    productId: z.string().describe("Product ID from get_all_earn_positions"),
    amount: z.number().default(0).describe("Amount to redeem. Use 0 with redeemAll=true to redeem all."),
    redeemAll: z.boolean().default(false).describe("Redeem entire position"),
    destAccount: z.enum(["SPOT", "FUND"]).default("SPOT").describe("Destination wallet"),
  }),
  outputSchema: z.object({
    success: z.boolean().optional(),
    message: z.string().optional(),
    redeemId: z.number().optional(),
    productId: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ productId, amount, redeemAll, destAccount }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }
    if (!ctx.binance || !isBinanceVenue(ctx.exchange.exchangeId)) {
      return errors.binanceOnly;
    }

    if (ctx.config?.permissionMode === "strict") {
      return {
        error: "permissionMode must not be 'strict' to redeem from earn. Use /auto or /ask.",
        productId,
      };
    }

    try {
      const result = await ctx.binance.redeemFlexible(productId, { amount, redeemAll, destAccount });

      return {
        success: result.success,
        message: redeemAll
          ? "Successfully redeemed entire position."
          : `Successfully redeemed ${amount} from flexible earn.`,
        redeemId: result.redeemId,
      };
    } catch (error) {
      return { error: `Failed to redeem: ${(error as Error).message}` };
    }
  },
});

export const subscribeLockedTool = createTool({
  id: "subscribe_locked_earn",
  description:
    "Subscribe to a locked earn product for higher APY. " +
    "Use when user says 'lock my BNB', 'stake for 90 days', 'subscribe to locked'. " +
    "Requires permissionMode not 'strict'. Funds are locked for the duration.",
  inputSchema: z.object({
    projectId: z.string().describe("Project ID from get_locked_earn_products"),
    amount: z.number().positive().describe("Amount to lock"),
    sourceAccount: z.enum(["SPOT", "FUND"]).default("SPOT").describe("Source wallet"),
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
  execute: async ({ projectId, amount, sourceAccount }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }
    if (!ctx.binance || !isBinanceVenue(ctx.exchange.exchangeId)) {
      return errors.binanceOnly;
    }

    if (ctx.config?.permissionMode === "strict") {
      return {
        error: "permissionMode must not be 'strict' to subscribe to locked products. Use /auto or /ask.",
        projectId,
        amount,
      };
    }

    try {
      const result = await ctx.binance.subscribeLocked(projectId, amount, sourceAccount);

      return {
        success: result.success,
        message: `Successfully locked ${amount} in earn product.`,
        purchaseId: result.purchaseId,
        warning: "Your funds are now locked for the product duration.",
      };
    } catch (error) {
      return { error: `Failed to subscribe to locked: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// History
// ============================================================================

export const getEarnHistoryTool = createTool({
  id: "get_earn_history",
  description:
    "Get earn subscription and redemption history. " +
    "Use when user asks 'earn history', 'past subscriptions', 'redemption history', 'when did I stake?'.",
  inputSchema: z.object({
    type: z
      .enum(["subscriptions", "redemptions", "both"])
      .default("both")
      .describe("What type of history to fetch"),
    asset: z.string().optional().describe("Filter by asset (e.g., 'USDT', 'BTC')"),
    limit: z
      .number()
      .min(1)
      .max(50)
      .default(20)
      .describe("Max records to return per type"),
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
          })
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
          })
        ),
      })
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ type, asset, limit }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }
    if (!ctx.binance || !isBinanceVenue(ctx.exchange.exchangeId)) {
      return errors.binanceOnly;
    }

    try {
      const options = { asset: asset || undefined, size: limit };

      const result: {
        subscriptions?: { count: number; records: { amount: string; asset: string; time: string; purchaseId: number; sourceAccount: string; status: string }[] };
        redemptions?: { count: number; records: { amount: string; asset: string; time: string; redeemId: number; destAccount: string; status: string }[] };
      } = {};

      if (type === "subscriptions" || type === "both") {
        const subs = await ctx.binance.getFlexibleSubscriptionHistory(options);
        result.subscriptions = {
          count: subs.total,
          records: subs.rows.slice(0, limit).map((r) => ({
            amount: r.amount,
            asset: r.asset,
            time: new Date(r.time).toISOString(),
            purchaseId: r.purchaseId,
            sourceAccount: r.sourceAccount,
            status: r.status,
          })),
        };
      }

      if (type === "redemptions" || type === "both") {
        const reds = await ctx.binance.getFlexibleRedemptionHistory(options);
        result.redemptions = {
          count: reds.total,
          records: reds.rows.slice(0, limit).map((r) => ({
            amount: r.amount,
            asset: r.asset,
            time: new Date(r.time).toISOString(),
            redeemId: r.redeemId,
            destAccount: r.destAccount,
            status: r.status,
          })),
        };
      }

      return result;
    } catch (error) {
      return { error: `Failed to get earn history: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Export as Object (Mastra format)
// ============================================================================

/**
 * Earn tools exported as an object for Mastra Agent
 * This is the format expected by Mastra's Agent class
 */
export const earnTools = {
  get_flexible_earn_products: getFlexibleProductsTool,
  get_locked_earn_products: getLockedProductsTool,
  get_all_earn_positions: getAllEarnPositionsTool,
  subscribe_flexible_earn: subscribeFlexibleTool,
  redeem_flexible_earn: redeemFlexibleTool,
  subscribe_locked_earn: subscribeLockedTool,
  get_earn_history: getEarnHistoryTool,
};
