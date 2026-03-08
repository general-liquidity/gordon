/**
 * Account Tools (Mastra Format)
 * Tools for viewing portfolio, balances, and account details
 *
 * Migrated from OpenAI Agents SDK format to Mastra format.
 * Key changes:
 * - tool() -> createTool()
 * - name -> id
 * - parameters -> inputSchema
 * - Context access via (input, execContext) -> getGordonContext(execContext)
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { listTrades } from "../../storage/trades.ts";
import { getGordonContext, isBinanceFamily, type MastraExecutionContext } from "./types.ts";

// ============================================================================
// Error Messages
// ============================================================================

const errors = {
  noExchange: { error: "No active trading venue is connected. Please run setup first." },
};

// Helper
const getActiveTrades = () => listTrades({ status: "OPEN" });

// ============================================================================
// Get Portfolio Tool
// ============================================================================

export const getPortfolioTool = createTool({
  id: "get_portfolio",
  description:
    "Get the current portfolio value and balances from the active exchange. " +
    "Use when user asks 'what's my balance?' or 'how much do I have?'",
  inputSchema: z.object({}),
  outputSchema: z.object({
    marketFamily: z.enum(["crypto", "stocks"]).optional(),
    venueRoute: z.enum(["exchange", "broker"]).optional(),
    quoteCurrency: z.string().optional(),
    capabilities: z.object({
      supportsQuotes: z.boolean(),
      supportsBidAsk: z.boolean(),
      supportsOrderBook: z.boolean(),
      supportsSessionCalendar: z.boolean(),
      supportsExtendedHours: z.boolean(),
      supportsHistoricalBars: z.boolean(),
    }).optional(),
    totalValue: z.number().optional(),
    holdings: z.array(z.object({
      asset: z.string(),
      free: z.number(),
      locked: z.number(),
      marketValue: z.number().optional(),
      quoteCurrency: z.string().optional(),
      usdtValue: z.number(),
      wallet: z.string(),
      note: z.string().optional(),
    })).optional(),
    openTrades: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async (_input, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange && !ctx?.broker) {
      return errors.noExchange;
    }

    if (ctx.broker && !ctx.exchange) {
      const [account, positions] = await Promise.all([
        ctx.broker.getAccount(),
        ctx.broker.getPositions(),
      ]);

      const holdings = [
        {
          asset: account.currency,
          free: account.cash,
          locked: 0,
          usdtValue: account.cash,
          wallet: "broker_cash",
          note: "Broker cash balance",
        },
        ...positions.map((position) => ({
          asset: position.symbol,
          free: position.qty,
          locked: 0,
          usdtValue: position.marketValue,
          wallet: "broker_position",
          note: `${position.side} position · avg ${position.avgEntryPrice.toFixed(2)}`,
        })),
      ];

      return {
        marketFamily: "stocks" as const,
        venueRoute: "broker" as const,
        quoteCurrency: account.currency,
        capabilities: {
          supportsQuotes: true,
          supportsBidAsk: true,
          supportsOrderBook: false,
          supportsSessionCalendar: true,
          supportsExtendedHours: Boolean(ctx.broker.capabilities?.supportsExtendedHours),
          supportsHistoricalBars: Boolean(ctx.broker.capabilities?.supportsHistoricalBars),
        },
        totalValue: account.portfolioValue,
        holdings: holdings.slice(0, 15).map((holding) => ({
          ...holding,
          marketValue: holding.usdtValue,
          quoteCurrency: account.currency,
        })),
        openTrades: positions.length,
      };
    }

    const allBalances = await ctx.exchange!.getAllBalances();

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
            const price = await ctx.exchange!.getPrice(`${balance.asset}USDT`);
            usdtValue = total * price;
          } catch {
            holdings.push({
              asset: balance.asset,
              free: balance.free,
              locked: balance.locked,
              usdtValue: 0,
              wallet: "spot",
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
            wallet: "spot",
          });
          totalValue += usdtValue;
        }
      }
    }

    holdings.sort((a, b) => b.usdtValue - a.usdtValue);

    return {
      totalValue,
      marketFamily: "crypto" as const,
      venueRoute: "exchange" as const,
      quoteCurrency: "USD",
      capabilities: {
        supportsQuotes: true,
        supportsBidAsk: true,
        supportsOrderBook: true,
        supportsSessionCalendar: false,
        supportsExtendedHours: false,
        supportsHistoricalBars: true,
      },
      holdings: holdings.slice(0, 15).map((holding) => ({
        ...holding,
        marketValue: holding.usdtValue,
        quoteCurrency: "USD",
      })),
      openTrades: getActiveTrades().length,
    };
  },
});

// ============================================================================
// Full Account Details Tool
// ============================================================================

export const getAccountDetailsTool = createTool({
  id: "get_account_details",
  description:
    "Get comprehensive account details including commission rates, permissions, trade history, " +
    "deposit/withdrawal history, earn positions, and API restrictions. " +
    "Use when user asks 'show all my details', 'account history', 'full account info'",
  inputSchema: z.object({
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
  outputSchema: z.object({
    accountType: z.string().optional(),
    uid: z.number().optional(),
    commissionRates: z.object({
      maker: z.string(),
      taker: z.string(),
    }).optional(),
    permissions: z.object({
      canTrade: z.boolean(),
      canWithdraw: z.boolean(),
      canDeposit: z.boolean(),
      accountPermissions: z.array(z.string()),
    }).optional(),
    apiKeyPermissions: z.object({
      ipRestrict: z.boolean(),
      enableReading: z.boolean(),
      enableSpotTrading: z.boolean(),
      enableWithdrawals: z.boolean(),
      enableFutures: z.boolean(),
      enableMargin: z.boolean(),
      createdAt: z.string(),
    }).optional(),
    recentTrades: z.array(z.object({
      symbol: z.string(),
      side: z.string(),
      price: z.number(),
      quantity: z.number(),
      quoteQty: z.number(),
      commission: z.string(),
      time: z.string(),
      isMaker: z.boolean(),
    })).optional(),
    totalTradesReturned: z.number().optional(),
    deposits: z.array(z.object({
      coin: z.string(),
      amount: z.number(),
      network: z.string(),
      status: z.string(),
      txId: z.string().nullable(),
      time: z.string(),
    })).optional(),
    withdrawals: z.array(z.object({
      coin: z.string(),
      amount: z.number(),
      fee: z.number(),
      network: z.string(),
      status: z.string(),
      address: z.string(),
      applyTime: z.string(),
      completeTime: z.string().nullable(),
    })).optional(),
    earnPositions: z.array(z.object({
      asset: z.string(),
      totalAmount: z.number(),
      freeAmount: z.number(),
      lockedAmount: z.number(),
      apy: z.string(),
      productName: z.string(),
    })).optional(),
    summary: z.object({
      totalDeposits: z.number(),
      totalWithdrawals: z.number(),
      totalRecentTrades: z.number(),
      earnPositionsCount: z.number(),
    }).optional(),
    error: z.string().optional(),
  }),
  execute: async (
    { includeTradeHistory, includeDepositHistory, includeWithdrawalHistory, includeEarnPositions },
    execContext: MastraExecutionContext
  ) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    try {
      if (!ctx.binance || !isBinanceFamily(ctx.exchange.exchangeId)) {
        const details = await ctx.exchange.getFullAccountDetails();
        return {
          accountType: details.accountInfo.accountType,
          permissions: {
            canTrade: details.accountInfo.canTrade,
            canWithdraw: details.accountInfo.canWithdraw,
            canDeposit: details.accountInfo.canDeposit,
            accountPermissions: [],
          },
          summary: {
            totalDeposits: 0,
            totalWithdrawals: 0,
            totalRecentTrades: 0,
            earnPositionsCount: 0,
          },
        };
      }

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
// Get Account Snapshot Tool
// ============================================================================

export const getAccountSnapshotTool = createTool({
  id: "get_account_snapshot",
  description:
    "Get daily account snapshots showing historical portfolio value. " +
    "Use when user asks 'portfolio history', 'how was my balance yesterday', " +
    "'account snapshots', 'daily balance history'.",
  inputSchema: z.object({
    days: z
      .number()
      .min(1)
      .max(30)
      .default(7)
      .describe("Number of days of snapshots to retrieve"),
    type: z
      .enum(["SPOT", "MARGIN", "FUTURES"])
      .default("SPOT")
      .describe("Account type"),
  }),
  outputSchema: z.object({
    snapshots: z.array(z.object({
      date: z.string(),
      totalBtcValue: z.string(),
      topAssets: z.array(z.object({
        asset: z.string(),
        free: z.string(),
        locked: z.string(),
      })),
    })).optional(),
    count: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async (
    { days, type },
    execContext: MastraExecutionContext
  ) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) return errors.noExchange;
    if (!ctx.binance || ctx.exchange.exchangeId !== "binance") {
      return { error: "Account snapshots are currently supported only on Binance." };
    }

    try {
      const snapshot = await ctx.binance.getAccountSnapshot(type, days);

      if (snapshot.code !== 200) {
        return { error: `Binance API error: ${snapshot.msg}` };
      }

      const snapshots = snapshot.snapshotVos.map((s) => {
        const activeBalances = s.data.balances
          .filter((b) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
          .sort((a, b) =>
            (parseFloat(b.free) + parseFloat(b.locked)) -
            (parseFloat(a.free) + parseFloat(a.locked))
          )
          .slice(0, 10)
          .map((b) => ({
            asset: b.asset,
            free: b.free,
            locked: b.locked,
          }));

        return {
          date: new Date(s.updateTime).toISOString(),
          totalBtcValue: s.data.totalAssetOfBtc,
          topAssets: activeBalances,
        };
      });

      return {
        snapshots,
        count: snapshots.length,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Failed to fetch account snapshots",
      };
    }
  },
});

// ============================================================================
// Export as Object (Mastra format)
// ============================================================================

/**
 * Account tools exported as an object for Mastra Agent
 * This is the format expected by Mastra's Agent class
 *
 * NOTE: get_flexible_positions was removed as duplicate of get_all_earn_positions
 * in earn.ts which is more comprehensive (covers both flexible AND locked positions)
 */
export const accountTools = {
  get_portfolio: getPortfolioTool,
  get_account_details: getAccountDetailsTool,
  get_account_snapshot: getAccountSnapshotTool,
};
