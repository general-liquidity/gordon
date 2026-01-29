/**
 * Simple Earn Tools
 * Tools for managing Binance Simple Earn products (Flexible & Locked)
 */

import { tool } from "@openai/agents";
import { z } from "zod";

import type { ToolRunContext } from "./types.ts";
import { errors } from "./types.ts";

// ============================================================================
// Product Discovery
// ============================================================================

export const getFlexibleProductsTool = tool({
  name: "get_flexible_earn_products",
  description:
    "Get list of available flexible earn products with APY rates. " +
    "Use when user asks 'what can I earn on', 'flexible savings rates', 'earn APY'.",
  parameters: z.object({
    asset: z.string().default("").describe("Filter by asset (e.g., 'USDT', 'BTC'). Empty for all."),
  }),
  async execute({ asset }, runContext: ToolRunContext) {
    const ctx = runContext?.context;
    if (!ctx?.binance) {
      return errors.noBinance;
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

export const getLockedProductsTool = tool({
  name: "get_locked_earn_products",
  description:
    "Get list of available locked earn products with higher APY rates. " +
    "Use when user asks 'locked staking options', 'higher APY', 'lock my crypto'.",
  parameters: z.object({
    asset: z.string().default("").describe("Filter by asset (e.g., 'BNB', 'ETH'). Empty for all."),
  }),
  async execute({ asset }, runContext: ToolRunContext) {
    const ctx = runContext?.context;
    if (!ctx?.binance) {
      return errors.noBinance;
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

export const getAllEarnPositionsTool = tool({
  name: "get_all_earn_positions",
  description:
    "Get ALL Simple Earn positions - both flexible AND locked, with total value summary. " +
    "This is the comprehensive view. Use when user asks 'my earn positions', 'what am I earning on', " +
    "'staking balance', 'all my earn', 'how much am I earning'.",
  parameters: z.object({}),
  async execute(_, runContext: ToolRunContext) {
    const ctx = runContext?.context;
    if (!ctx?.binance) {
      return errors.noBinance;
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
        totalValue: result.totalValue,
      };
    } catch (error) {
      return { error: `Failed to get earn positions: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Subscribe/Redeem
// ============================================================================

export const subscribeFlexibleTool = tool({
  name: "subscribe_flexible_earn",
  description:
    "Subscribe to a flexible earn product to start earning. " +
    "Use when user says 'start earning on USDT', 'put my BTC in earn', 'subscribe to flexible'. " +
    "Requires ARMED mode.",
  parameters: z.object({
    productId: z.string().describe("Product ID from get_flexible_earn_products"),
    amount: z.number().positive().describe("Amount to subscribe"),
    sourceAccount: z.enum(["SPOT", "FUND"]).default("SPOT").describe("Source wallet"),
  }),
  async execute({ productId, amount, sourceAccount }, runContext: ToolRunContext) {
    const ctx = runContext?.context;
    if (!ctx?.binance) {
      return errors.noBinance;
    }

    if (!ctx.config?.tradingMode?.armed) {
      return {
        error: "System must be ARMED to subscribe to earn products. Use 'arm' command first.",
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

export const redeemFlexibleTool = tool({
  name: "redeem_flexible_earn",
  description:
    "Redeem from a flexible earn product back to wallet. " +
    "Use when user says 'redeem my USDT', 'stop earning', 'withdraw from flexible'. " +
    "Requires ARMED mode.",
  parameters: z.object({
    productId: z.string().describe("Product ID from get_all_earn_positions"),
    amount: z.number().default(0).describe("Amount to redeem. Use 0 with redeemAll=true to redeem all."),
    redeemAll: z.boolean().default(false).describe("Redeem entire position"),
    destAccount: z.enum(["SPOT", "FUND"]).default("SPOT").describe("Destination wallet"),
  }),
  async execute({ productId, amount, redeemAll, destAccount }, runContext: ToolRunContext) {
    const ctx = runContext?.context;
    if (!ctx?.binance) {
      return errors.noBinance;
    }

    if (!ctx.config?.tradingMode?.armed) {
      return {
        error: "System must be ARMED to redeem from earn. Use 'arm' command first.",
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

export const subscribeLockedTool = tool({
  name: "subscribe_locked_earn",
  description:
    "Subscribe to a locked earn product for higher APY. " +
    "Use when user says 'lock my BNB', 'stake for 90 days', 'subscribe to locked'. " +
    "Requires ARMED mode. Funds are locked for the duration.",
  parameters: z.object({
    projectId: z.string().describe("Project ID from get_locked_earn_products"),
    amount: z.number().positive().describe("Amount to lock"),
    sourceAccount: z.enum(["SPOT", "FUND"]).default("SPOT").describe("Source wallet"),
  }),
  async execute({ projectId, amount, sourceAccount }, runContext: ToolRunContext) {
    const ctx = runContext?.context;
    if (!ctx?.binance) {
      return errors.noBinance;
    }

    if (!ctx.config?.tradingMode?.armed) {
      return {
        error: "System must be ARMED to subscribe to locked products. Use 'arm' command first.",
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

export const earnTools = [
  getFlexibleProductsTool,
  getLockedProductsTool,
  getAllEarnPositionsTool,
  subscribeFlexibleTool,
  redeemFlexibleTool,
  subscribeLockedTool,
];
