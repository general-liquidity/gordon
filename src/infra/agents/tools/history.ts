/**
 * History Tools (Mastra Format)
 * Tools for viewing trade history, deposits, and withdrawals
 *
 * Migrated from OpenAI Agents SDK format to Mastra format.
 * Key differences:
 * - tool() -> createTool()
 * - name -> id
 * - parameters -> inputSchema
 * - Added outputSchema for better LLM routing
 * - Context access via first parameter destructuring
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import type { GordonContext } from "../types.ts";

// ============================================================================
// Error Messages
// ============================================================================

const errors = {
  noBinance: { error: "Binance client not connected. Please run setup first." },
};

// ============================================================================
// Trade History Tool
// ============================================================================

export const getTradeHistoryTool = createTool({
  id: "get_trade_history",
  description:
    "Get trade history for a specific symbol or all recent trades. " +
    "Use when user asks 'show my trades', 'trade history for BTC', 'what did I trade?'",
  inputSchema: z.object({
    symbol: z
      .string()
      .default("")
      .describe("Trading pair symbol (e.g., 'BTCUSDT'). Leave empty for all recent trades."),
    limit: z.number().min(1).max(100).default(20).describe("Max trades to return"),
  }),
  outputSchema: z.object({
    message: z.string().optional(),
    trades: z.array(
      z.object({
        symbol: z.string(),
        side: z.enum(["BUY", "SELL"]),
        price: z.number(),
        quantity: z.number(),
        quoteQty: z.number(),
        commission: z.string(),
        time: z.string(),
        isMaker: z.boolean(),
      })
    ).optional(),
    stats: z.object({
      totalTrades: z.number(),
      totalBuyVolume: z.string(),
      totalSellVolume: z.string(),
      avgTradeSize: z.string(),
    }).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context, symbol, limit }) => {
    const ctx = context as GordonContext;
    if (!ctx?.binance) {
      return errors.noBinance;
    }

    try {
      let trades;
      if (symbol && symbol.trim() !== "") {
        const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
          ? symbol.toUpperCase()
          : `${symbol.toUpperCase()}USDT`;
        trades = await ctx.binance.getTradeHistory(normalizedSymbol, limit);
      } else {
        trades = await ctx.binance.getAllTradeHistory(limit);
      }

      if (trades.length === 0) {
        return { message: "No trade history found", trades: [] };
      }

      let totalBuyVolume = 0;
      let totalSellVolume = 0;
      let totalCommission = 0;

      const formattedTrades = trades.map((t) => {
        const quoteQty = parseFloat(t.quoteQty);
        if (t.isBuyer) {
          totalBuyVolume += quoteQty;
        } else {
          totalSellVolume += quoteQty;
        }
        totalCommission += parseFloat(t.commission);

        return {
          symbol: t.symbol,
          side: t.isBuyer ? "BUY" as const : "SELL" as const,
          price: parseFloat(t.price),
          quantity: parseFloat(t.qty),
          quoteQty,
          commission: `${parseFloat(t.commission).toFixed(6)} ${t.commissionAsset}`,
          time: new Date(t.time).toISOString(),
          isMaker: t.isMaker,
        };
      });

      return {
        trades: formattedTrades,
        stats: {
          totalTrades: trades.length,
          totalBuyVolume: totalBuyVolume.toFixed(2),
          totalSellVolume: totalSellVolume.toFixed(2),
          avgTradeSize: ((totalBuyVolume + totalSellVolume) / trades.length).toFixed(2),
        },
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Failed to fetch trade history",
      };
    }
  },
});

// ============================================================================
// Deposit/Withdrawal History Tool
// ============================================================================

export const getTransferHistoryTool = createTool({
  id: "get_transfer_history",
  description:
    "Get deposit and withdrawal history. " +
    "Use when user asks 'show deposits', 'withdrawal history', 'transfer history'",
  inputSchema: z.object({
    type: z
      .enum(["deposits", "withdrawals", "both"])
      .default("both")
      .describe("Type of transfers to show"),
    limit: z.number().min(1).max(50).default(10).describe("Max records to return per type"),
  }),
  outputSchema: z.object({
    deposits: z.array(
      z.object({
        coin: z.string(),
        amount: z.number(),
        network: z.string(),
        status: z.string(),
        txId: z.string().nullable(),
        time: z.string(),
      })
    ).optional(),
    totalDeposits: z.number().optional(),
    withdrawals: z.array(
      z.object({
        coin: z.string(),
        amount: z.number(),
        fee: z.number(),
        network: z.string(),
        status: z.string(),
        address: z.string(),
        applyTime: z.string(),
        completeTime: z.string().nullable(),
      })
    ).optional(),
    totalWithdrawals: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context, type, limit }) => {
    const ctx = context as GordonContext;
    if (!ctx?.binance) {
      return errors.noBinance;
    }

    try {
      const response: Record<string, unknown> = {};

      if (type === "deposits" || type === "both") {
        const deposits = await ctx.binance.getDepositHistory(limit);
        const statusMap: Record<number, string> = { 0: "pending", 1: "success", 6: "credited" };
        response.deposits = deposits.map((d) => ({
          coin: d.coin,
          amount: parseFloat(d.amount),
          network: d.network,
          status: statusMap[d.status] || `status_${d.status}`,
          txId: d.txId ? `${d.txId.slice(0, 16)}...` : null,
          time: new Date(d.insertTime).toISOString(),
        }));
        response.totalDeposits = deposits.length;
      }

      if (type === "withdrawals" || type === "both") {
        const withdrawals = await ctx.binance.getWithdrawalHistory(limit);
        const wStatusMap: Record<number, string> = {
          0: "email_sent", 1: "cancelled", 2: "awaiting_approval",
          3: "rejected", 4: "processing", 5: "failure", 6: "completed",
        };
        response.withdrawals = withdrawals.map((w) => ({
          coin: w.coin,
          amount: parseFloat(w.amount),
          fee: parseFloat(w.transactionFee),
          network: w.network,
          status: wStatusMap[w.status] || `status_${w.status}`,
          address: `${w.address.slice(0, 10)}...${w.address.slice(-6)}`,
          applyTime: w.applyTime,
          completeTime: w.completeTime || null,
        }));
        response.totalWithdrawals = withdrawals.length;
      }

      return response;
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Failed to fetch transfer history",
      };
    }
  },
});

// ============================================================================
// Export as Object (Mastra format)
// ============================================================================

/**
 * History tools exported as an object for Mastra Agent
 * This is the format expected by Mastra's Agent class
 */
export const historyTools = {
  get_trade_history: getTradeHistoryTool,
  get_transfer_history: getTransferHistoryTool,
};
