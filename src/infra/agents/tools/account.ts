/**
 * Account Tools
 * Tools for viewing portfolio, balances, and account details
 */

import { tool } from "@openai/agents";
import { z } from "zod";

import { listTrades } from "../../storage/trades.ts";
import type { ToolRunContext } from "./types.ts";
import { errors } from "./types.ts";

// Helper
const getActiveTrades = () => listTrades({ status: "OPEN" });

// ============================================================================
// Get Portfolio Tool
// ============================================================================

export const getPortfolioTool = tool({
  name: "get_portfolio",
  description:
    "Get the current portfolio value and balances from Binance (both Spot and Funding wallets). " +
    "Use when user asks 'what's my balance?' or 'how much do I have?'",
  parameters: z.object({}),
  async execute(_: Record<string, never>, runContext: ToolRunContext) {
    const ctx = runContext?.context;
    if (!ctx?.binance) {
      return errors.noBinance;
    }

    const allBalances = await ctx.binance.getAllBalances();

    let totalValue = 0;
    const holdings: Array<{ asset: string; free: number; locked: number; usdtValue: number; wallet: string; note?: string }> = [];

    const stablecoins = ["USDT", "USD", "USDC", "BUSD", "TUSD", "USDP", "FDUSD"];

    for (const balance of allBalances) {
      const total = balance.free + balance.locked;

      if (total > 0) {
        let usdtValue = 0;

        if (stablecoins.includes(balance.asset)) {
          usdtValue = total;
        } else {
          try {
            const price = await ctx.binance.getPrice(`${balance.asset}USDT`);
            usdtValue = total * price;
          } catch {
            holdings.push({
              asset: balance.asset,
              free: balance.free,
              locked: balance.locked,
              usdtValue: 0,
              wallet: balance.wallet,
              note: "No USD price available",
            });
            continue;
          }
        }

        if (usdtValue > 0.01) {
          holdings.push({
            asset: balance.asset,
            free: balance.free,
            locked: balance.locked,
            usdtValue,
            wallet: balance.wallet,
          });
          totalValue += usdtValue;
        }
      }
    }

    holdings.sort((a, b) => b.usdtValue - a.usdtValue);

    return {
      totalValue,
      holdings: holdings.slice(0, 15),
      openTrades: getActiveTrades().length,
    };
  },
});

// ============================================================================
// Full Account Details Tool
// ============================================================================

export const getAccountDetailsTool = tool({
  name: "get_account_details",
  description:
    "Get comprehensive account details including commission rates, permissions, trade history, " +
    "deposit/withdrawal history, earn positions, and API restrictions. " +
    "Use when user asks 'show all my details', 'account history', 'full account info'",
  parameters: z.object({
    includeTradeHistory: z
      .boolean()
      .default(true)
      .describe("Include recent trade history"),
    includeDepositHistory: z
      .boolean()
      .default(true)
      .describe("Include deposit history"),
    includeWithdrawalHistory: z
      .boolean()
      .default(true)
      .describe("Include withdrawal history"),
    includeEarnPositions: z
      .boolean()
      .default(true)
      .describe("Include Simple Earn positions"),
  }),
  async execute(
    { includeTradeHistory, includeDepositHistory, includeWithdrawalHistory, includeEarnPositions },
    runContext: ToolRunContext
  ) {
    const ctx = runContext?.context;
    if (!ctx?.binance) {
      return errors.noBinance;
    }

    try {
      const fullDetails = await ctx.binance.getFullAccountDetails();
      const { account, apiRestrictions, recentTrades, deposits, withdrawals, earnPositions } = fullDetails;

      const response: Record<string, unknown> = {
        accountType: account.accountType,
        uid: account.uid,
        commissionRates: {
          maker: `${(parseFloat(account.commissionRates.maker) * 100).toFixed(3)}%`,
          taker: `${(parseFloat(account.commissionRates.taker) * 100).toFixed(3)}%`,
        },
        permissions: {
          canTrade: account.canTrade,
          canWithdraw: account.canWithdraw,
          canDeposit: account.canDeposit,
          accountPermissions: account.permissions,
        },
      };

      if (apiRestrictions) {
        response.apiKeyPermissions = {
          ipRestrict: apiRestrictions.ipRestrict,
          enableReading: apiRestrictions.enableReading,
          enableSpotTrading: apiRestrictions.enableSpotAndMarginTrading,
          enableWithdrawals: apiRestrictions.enableWithdrawals,
          enableFutures: apiRestrictions.enableFutures,
          enableMargin: apiRestrictions.enableMargin,
          createdAt: new Date(apiRestrictions.createTime).toISOString(),
        };
      }

      if (includeTradeHistory && recentTrades.length > 0) {
        response.recentTrades = recentTrades.slice(0, 10).map((t) => ({
          symbol: t.symbol,
          side: t.isBuyer ? "BUY" : "SELL",
          price: parseFloat(t.price),
          quantity: parseFloat(t.qty),
          quoteQty: parseFloat(t.quoteQty),
          commission: `${parseFloat(t.commission)} ${t.commissionAsset}`,
          time: new Date(t.time).toISOString(),
          isMaker: t.isMaker,
        }));
        response.totalTradesReturned = recentTrades.length;
      }

      if (includeDepositHistory && deposits.length > 0) {
        const statusMap: Record<number, string> = { 0: "pending", 1: "success", 6: "credited" };
        response.deposits = deposits.slice(0, 10).map((d) => ({
          coin: d.coin,
          amount: parseFloat(d.amount),
          network: d.network,
          status: statusMap[d.status] || `status_${d.status}`,
          txId: d.txId ? `${d.txId.slice(0, 10)}...` : null,
          time: new Date(d.insertTime).toISOString(),
        }));
      }

      if (includeWithdrawalHistory && withdrawals.length > 0) {
        const wStatusMap: Record<number, string> = {
          0: "email_sent", 1: "cancelled", 2: "awaiting_approval",
          3: "rejected", 4: "processing", 5: "failure", 6: "completed",
        };
        response.withdrawals = withdrawals.slice(0, 10).map((w) => ({
          coin: w.coin,
          amount: parseFloat(w.amount),
          fee: parseFloat(w.transactionFee),
          network: w.network,
          status: wStatusMap[w.status] || `status_${w.status}`,
          address: `${w.address.slice(0, 10)}...${w.address.slice(-6)}`,
          applyTime: w.applyTime,
          completeTime: w.completeTime || null,
        }));
      }

      if (includeEarnPositions && earnPositions.length > 0) {
        response.earnPositions = earnPositions.map((e) => ({
          asset: e.asset,
          totalAmount: parseFloat(e.totalAmount),
          freeAmount: parseFloat(e.freeAmount),
          lockedAmount: parseFloat(e.lockedAmount),
          apy: `${parseFloat(e.apy)}%`,
          productName: e.productName,
        }));
      }

      response.summary = {
        totalDeposits: deposits.length,
        totalWithdrawals: withdrawals.length,
        totalRecentTrades: recentTrades.length,
        earnPositionsCount: earnPositions.length,
      };

      return response;
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Failed to fetch account details",
      };
    }
  },
});

// ============================================================================
// Earn Positions Tool
// ============================================================================

export const getEarnPositionsTool = tool({
  name: "get_flexible_positions",
  description:
    "Get Simple Earn FLEXIBLE positions only (quick access). " +
    "For comprehensive earn info including LOCKED positions, use get_all_earn_positions instead. " +
    "Use for quick check: 'flexible savings balance', 'quick earn check'.",
  parameters: z.object({}),
  async execute(_: Record<string, never>, runContext: ToolRunContext) {
    const ctx = runContext?.context;
    if (!ctx?.binance) {
      return errors.noBinance;
    }

    try {
      const positions = await ctx.binance.getEarnPositions();

      if (positions.length === 0) {
        return {
          message: "No earn positions found. You can earn interest on your crypto through Binance Simple Earn.",
          positions: [],
        };
      }

      let totalValue = 0;
      const formattedPositions = positions.map((p) => {
        const total = parseFloat(p.totalAmount);
        totalValue += total;
        return {
          asset: p.asset,
          totalAmount: total,
          freeAmount: parseFloat(p.freeAmount),
          lockedAmount: parseFloat(p.lockedAmount),
          apy: `${(parseFloat(p.apy) * 100).toFixed(2)}%`,
          rewardAsset: p.rewardAsset,
          productName: p.productName,
        };
      });

      return {
        positions: formattedPositions,
        totalPositions: positions.length,
        summary: `You have ${positions.length} earn position(s) active.`,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Failed to fetch earn positions",
      };
    }
  },
});

export const accountTools = [
  getPortfolioTool,
  getAccountDetailsTool,
  getEarnPositionsTool,
];
