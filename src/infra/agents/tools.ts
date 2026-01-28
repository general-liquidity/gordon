/**
 * Agent Tools
 * Wraps Gordon's core functionality as tools for the OpenAI Agents SDK
 */

import { tool, type RunContext } from "@openai/agents";
import { z } from "zod";

import { scan } from "../../core/scanner.ts";
import { analyze } from "../../core/analyzer.ts";
import { generatePlan } from "../../core/planner.ts";
import { executePlan, cancelTrade, closeTrade } from "../../core/executor.ts";
import { validatePlan } from "../../core/validator.ts";
import { runMonitorCycle, type MonitorResult } from "../../core/monitor.ts";
import { explain, getPresetExplanation } from "../../core/explainer.ts";
import { loadConfig, saveConfig } from "../storage/config.ts";
import { listPlans, getPlan, updatePlan } from "../storage/plans.ts";
import { listTrades, getTrade } from "../storage/trades.ts";

import type { GordonContext } from "./types.ts";

// Helper functions
const getAllPlans = () => listPlans();
const getActiveTrades = () => listTrades({ status: "OPEN" });

// Preset topics for explanations
const PRESET_TOPICS = ["rsi", "macd", "support", "resistance", "stop_loss", "take_profit", "dca", "risk_reward"];

// ============================================================================
// Market Scanning Tool
// ============================================================================

export const scanMarketTool = tool({
  name: "scan_market",
  description:
    "Scan the market for trading opportunities. Finds coins near support with bullish signals. " +
    "Use this when the user wants to find trading opportunities or asks 'what should I buy?'",
  parameters: z.object({
    topN: z
      .number()
      .min(10)
      .max(200)
      .default(50)
      .describe("Number of top coins by volume to scan"),
    timeframes: z
      .array(z.string())
      .default(["1h", "4h"])
      .describe("Timeframes to analyze"),
  }),
  async execute({ topN, timeframes }, runContext: RunContext<GordonContext> | undefined) {
    const ctx = runContext?.context;
    if (!ctx?.binance) {
      return { error: "Binance client not connected. Please configure API keys." };
    }

    const result = await scan(ctx.binance, { topN, timeframes });

    // Return a summarized result for the LLM
    return {
      timestamp: result.timestamp,
      coinsScanned: result.coins.length,
      opportunities: result.coins
        .filter((c) => c.setupDetected)
        .slice(0, 10)
        .map((c) => ({
          symbol: c.symbol,
          price: c.price,
          change24h: c.change24h,
          setupConfidence: c.setupConfidence,
          bias: c.bias,
          risk: c.risk,
        })),
    };
  },
});

// ============================================================================
// Coin Analysis Tool
// ============================================================================

export const analyzeCoinTool = tool({
  name: "analyze_coin",
  description:
    "Perform deep analysis on a specific coin/trading pair. " +
    "Use this when the user asks about a specific coin like 'analyze BTC' or 'what about ETH?'",
  parameters: z.object({
    symbol: z
      .string()
      .describe("Trading pair symbol (e.g., 'BTCUSDT', 'ETHUSDT')"),
    timeframes: z
      .array(z.string())
      .default(["1h", "4h", "1d"])
      .describe("Timeframes to analyze"),
  }),
  async execute({ symbol, timeframes }, runContext: RunContext<GordonContext> | undefined) {
    const ctx = runContext?.context;
    if (!ctx?.binance) {
      return { error: "Binance client not connected. Please configure API keys." };
    }

    // Normalize symbol (add USDT if not present)
    const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
      ? symbol.toUpperCase()
      : `${symbol.toUpperCase()}USDT`;

    const result = await analyze(ctx.binance, normalizedSymbol, {
      timeframes: timeframes ?? ["1h", "4h", "1d"],
    });

    return {
      symbol: result.symbol,
      price: result.price,
      trend: result.trend,
      setupDetected: result.setupDetected,
      setupConfidence: result.setupConfidence,
      supports: result.supports.slice(0, 3).map((s) => ({
        price: s.price,
        strength: s.strength,
      })),
      resistances: result.resistances.slice(0, 3).map((r) => ({
        price: r.price,
        strength: r.strength,
      })),
      indicators: {
        rsi: result.indicators.rsi,
        macdState: result.macdState,
        volumeTrend: result.volumeTrend,
      },
      recommendation:
        result.setupDetected && result.setupConfidence >= 0.6
          ? "Good setup detected - consider creating a plan"
          : result.setupDetected
            ? "Weak setup detected - wait for better entry"
            : "No setup detected - keep watching",
    };
  },
});

// ============================================================================
// Plan Generation Tool
// ============================================================================

export const createPlanTool = tool({
  name: "create_plan",
  description:
    "Create a trading plan for a specific coin based on analysis. " +
    "Use this when the user wants to trade a coin, e.g., 'buy BTC' or 'create plan for ETH'",
  parameters: z.object({
    symbol: z.string().describe("Trading pair symbol (e.g., 'BTCUSDT')"),
    riskLevel: z
      .enum(["low", "medium", "high"])
      .default("medium")
      .describe("Risk tolerance"),
    allocationPercent: z
      .number()
      .min(0.01)
      .max(0.5)
      .default(0.1)
      .describe("Percent of portfolio to allocate"),
  }),
  async execute(
    { symbol, riskLevel, allocationPercent },
    runContext: RunContext<GordonContext> | undefined
  ) {
    const ctx = runContext?.context;
    if (!ctx?.binance || !ctx?.llm) {
      return { error: "Binance or LLM client not connected." };
    }

    // Normalize symbol
    const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
      ? symbol.toUpperCase()
      : `${symbol.toUpperCase()}USDT`;

    // Get detailed analysis first
    const analysis = await analyze(ctx.binance, normalizedSymbol, {
      timeframes: ["1h", "4h", "1d"],
    });

    // Calculate allocation
    const maxAllocationPercent = allocationPercent ?? ctx.config.preferences.maxAllocationPerTrade;
    const maxAllocation = ctx.portfolioValue * maxAllocationPercent;

    // Generate plan using AI
    const plan = await generatePlan(ctx.llm, {
      analysis,
      preferences: {
        riskLevel: riskLevel ?? "medium",
        maxAllocation,
        cashReservePercent: ctx.config.preferences.cashReservePercent,
      },
      portfolioValue: ctx.portfolioValue,
    });

    return {
      success: true,
      plan,
      summary: `Created ${plan.strategy} plan for ${plan.symbol}: Entry at ${plan.entry.price ?? "market"}, Stop at ${plan.stopLoss.price}, ${plan.takeProfit.length} TP levels. Allocation: ${plan.allocation.amount} USDT (${(plan.allocation.percentOfPortfolio * 100).toFixed(1)}%)`,
    };
  },
});

// ============================================================================
// Plan Execution Tool (Requires Approval)
// ============================================================================

export const executePlanTool = tool({
  name: "execute_plan",
  description:
    "Execute an approved trading plan by placing orders on Binance. " +
    "IMPORTANT: This places real orders with real money. Only use after user confirms the plan.",
  parameters: z.object({
    planId: z.string().describe("The ID of the plan to execute"),
  }),
  needsApproval: true, // This requires human approval before execution
  async execute({ planId }, runContext: RunContext<GordonContext> | undefined) {
    const ctx = runContext?.context;
    if (!ctx?.binance) {
      return { error: "Binance client not connected. Please configure API keys." };
    }

    // Get the plan
    const plan = getPlan(planId);
    if (!plan) {
      return { error: `Plan not found: ${planId}` };
    }

    // Check mode
    if (ctx.config.mode !== "ARMED") {
      return {
        error: "Cannot execute: System is in SAFE mode. User must arm the system first.",
      };
    }

    // Execute the plan
    const result = await executePlan(ctx.binance, plan, ctx.config, {
      totalValue: ctx.portfolioValue,
      availableCash: ctx.availableCash,
      openPositions: getActiveTrades().length,
    });

    if (result.success && result.trade) {
      return {
        success: true,
        trade: result.trade,
        orderCount: result.orders.length,
      };
    }

    return {
      success: false,
      error: result.error,
    };
  },
});

// ============================================================================
// Position Monitor Tool
// ============================================================================

export const checkPositionsTool = tool({
  name: "check_positions",
  description:
    "Check the status of all open positions and detect any alerts or anomalies. " +
    "Use this when the user asks 'how are my trades?' or 'check positions'",
  parameters: z.object({}),
  async execute(_: Record<string, never>, runContext: RunContext<GordonContext> | undefined) {
    const ctx = runContext?.context;
    if (!ctx?.binance) {
      return { error: "Binance client not connected. Please configure API keys." };
    }

    const result: MonitorResult = await runMonitorCycle(ctx.binance);

    // Transform the result into a more user-friendly format
    const totalUnrealizedPnl = result.updates.reduce((sum, u) => sum + u.unrealizedPnl, 0);
    const positions = result.updates.map((p) => ({
      symbol: p.trade.symbol,
      status: p.status,
      unrealizedPnl: p.unrealizedPnl,
      unrealizedPnlPercent: p.unrealizedPnlPercent,
    }));

    return {
      openTrades: result.updates.length,
      totalUnrealizedPnl,
      totalUnrealizedPnlPercent: ctx.portfolioValue > 0 ? (totalUnrealizedPnl / ctx.portfolioValue) * 100 : 0,
      positions,
      alerts: result.alerts.map((a) => a.message),
    };
  },
});

// ============================================================================
// Close Trade Tool (Requires Approval)
// ============================================================================

export const closeTradeTool = tool({
  name: "close_trade",
  description:
    "Close an open trade by selling all remaining position. " +
    "Use when user wants to exit a trade early, e.g., 'close my BTC trade'",
  parameters: z.object({
    tradeId: z.string().describe("The ID of the trade to close"),
    reason: z
      .enum(["MANUAL", "STOP", "TP1", "TP2", "TP3"])
      .default("MANUAL")
      .describe("Reason for closing"),
  }),
  needsApproval: true,
  async execute({ tradeId, reason }, runContext: RunContext<GordonContext> | undefined) {
    const ctx = runContext?.context;
    if (!ctx?.binance) {
      return { error: "Binance client not connected. Please configure API keys." };
    }

    const trade = getTrade(tradeId);
    if (!trade) {
      return { error: `Trade not found: ${tradeId}` };
    }

    const result = await closeTrade(ctx.binance, trade, reason ?? "MANUAL");

    return {
      success: result.success,
      pnl: result.pnl,
      error: result.error,
    };
  },
});

// ============================================================================
// Explain Tool
// ============================================================================

export const explainTool = tool({
  name: "explain",
  description:
    "Explain a trading concept, term, or strategy in simple terms. " +
    "Use when the user asks 'what is X?' or 'explain Y' or needs help understanding something",
  parameters: z.object({
    topic: z.string().describe("The topic to explain"),
    additionalContext: z
      .string()
      .default("")
      .describe("Additional context for the explanation"),
  }),
  async execute({ topic, additionalContext }, runContext: RunContext<GordonContext> | undefined) {
    const ctx = runContext?.context;
    if (!ctx?.llm) {
      return { error: "LLM client not connected." };
    }

    // Check if it's a preset topic
    const presetExplanation = getPresetExplanation(topic);
    if (presetExplanation) {
      return { explanation: presetExplanation, topic };
    }

    // Custom explanation using AI
    const explanation = await explain(ctx.llm, topic, { topic: additionalContext || undefined });
    return { explanation, topic };
  },
});

// ============================================================================
// Arm/Disarm System Tool
// ============================================================================

export const armSystemTool = tool({
  name: "arm_system",
  description:
    "Arm or disarm the trading system. When armed, Gordon can execute trades. " +
    "Use when user says 'arm' or 'enable trading' or 'disarm' or 'disable trading'",
  parameters: z.object({
    action: z.enum(["arm", "disarm"]).describe("Whether to arm or disarm"),
    hours: z
      .number()
      .min(1)
      .max(24)
      .default(24)
      .describe("Hours to stay armed (max: 24)"),
  }),
  needsApproval: true,
  async execute({ action, hours }) {
    const config = await loadConfig();

    if (action === "arm") {
      const armHours = Math.min(hours ?? 24, 24);
      const armedUntil = new Date(Date.now() + armHours * 60 * 60 * 1000).toISOString();

      await saveConfig({ ...config, mode: "ARMED", armedUntil });

      return {
        success: true,
        mode: "ARMED",
        armedUntil,
        message: `System armed for ${armHours} hours. Trading enabled.`,
      };
    } else {
      await saveConfig({ ...config, mode: "SAFE", armedUntil: null });

      return {
        success: true,
        mode: "SAFE",
        message: "System disarmed. Trading disabled.",
      };
    }
  },
});

// ============================================================================
// Get Portfolio Tool
// ============================================================================

export const getPortfolioTool = tool({
  name: "get_portfolio",
  description:
    "Get the current portfolio value and balances from Binance (both Spot and Funding wallets). " +
    "Use when user asks 'what's my balance?' or 'how much do I have?'",
  parameters: z.object({}),
  async execute(_: Record<string, never>, runContext: RunContext<GordonContext> | undefined) {
    const ctx = runContext?.context;
    if (!ctx?.binance) {
      return { error: "Binance client not connected. Please configure API keys." };
    }

    // Get all balances from both spot and funding wallets
    const allBalances = await ctx.binance.getAllBalances();

    // Calculate total value in USDT
    let totalValue = 0;
    const holdings: Array<{ asset: string; free: number; locked: number; usdtValue: number; wallet: string; note?: string }> = [];

    // USD-pegged stablecoins (treat as 1:1 with USDT)
    const stablecoins = ["USDT", "USD", "USDC", "BUSD", "TUSD", "USDP", "FDUSD"];

    for (const balance of allBalances) {
      const total = balance.free + balance.locked;

      if (total > 0) {
        let usdtValue = 0;

        if (stablecoins.includes(balance.asset)) {
          // Stablecoins are 1:1 with USD
          usdtValue = total;
        } else {
          // Try to get price from Binance (works for crypto and some fiat like EUR)
          try {
            const price = await ctx.binance.getPrice(`${balance.asset}USDT`);
            usdtValue = total * price;
          } catch {
            // No USDT pair - show raw amount without USD value
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

    // Sort by value
    holdings.sort((a, b) => b.usdtValue - a.usdtValue);

    return {
      totalValue,
      holdings: holdings.slice(0, 15), // Top 15 holdings
      openTrades: getActiveTrades().length,
    };
  },
});

// ============================================================================
// List Plans Tool
// ============================================================================

export const listPlansTool = tool({
  name: "list_plans",
  description:
    "List all trading plans, optionally filtered by status. " +
    "Use when user asks 'show my plans' or 'what plans do I have?'",
  parameters: z.object({
    status: z
      .enum(["DRAFT", "APPROVED", "EXECUTING", "CLOSED", "CANCELLED", "ALL"])
      .default("ALL")
      .describe("Filter by status (ALL for no filter)"),
    limit: z.number().min(1).max(50).default(10).describe("Max plans to return"),
  }),
  async execute({ status, limit }) {
    let plans = getAllPlans();

    if (status && status !== "ALL") {
      plans = plans.filter((p) => p.status === status);
    }

    // Sort by creation date (newest first)
    plans.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return {
      count: plans.length,
      plans: plans.slice(0, limit ?? 10).map((p) => ({
        id: p.id,
        symbol: p.symbol,
        strategy: p.strategy,
        status: p.status,
        allocation: p.allocation.amount,
        entry: p.entry.price ?? "market",
        stopLoss: p.stopLoss.price,
        createdAt: p.createdAt,
      })),
    };
  },
});

// ============================================================================
// Approve Plan Tool
// ============================================================================

export const approvePlanTool = tool({
  name: "approve_plan",
  description:
    "Approve a draft plan, marking it ready for execution. " +
    "Use when user says 'approve this plan' or 'looks good, approve it'",
  parameters: z.object({
    planId: z.string().describe("The ID of the plan to approve"),
  }),
  async execute({ planId }) {
    const plan = getPlan(planId);
    if (!plan) {
      return { error: `Plan not found: ${planId}` };
    }

    if (plan.status !== "DRAFT") {
      return { error: `Plan is not in DRAFT status, current status: ${plan.status}` };
    }

    updatePlan(planId, { status: "APPROVED" });

    return {
      success: true,
      planId,
      message: "Plan approved. Ready for execution when system is armed.",
    };
  },
});

// ============================================================================
// Connection Test Tool
// ============================================================================

export const testConnectionTool = tool({
  name: "test_connection",
  description:
    "Test the connection to Binance and verify API key permissions. " +
    "Use when user asks 'test connection', 'check API', 'are my keys working?'",
  parameters: z.object({}),
  async execute(_: Record<string, never>, runContext: RunContext<GordonContext> | undefined) {
    const ctx = runContext?.context;
    const results: Record<string, unknown> = {
      llmConnected: !!ctx?.llm,
      binanceConnected: false,
      binancePermissions: null,
      accountType: null,
      error: null,
    };

    if (!ctx?.binance) {
      results.error = "Binance client not initialized. Check BINANCE_API_KEY and BINANCE_API_SECRET in .env";
      return results;
    }

    try {
      // Test connection
      const connected = await ctx.binance.testConnection();
      results.binanceConnected = connected;

      if (connected) {
        // Get account info to check permissions
        const accountInfo = await ctx.binance.getAccountInfo();
        results.accountType = accountInfo.accountType;
        results.canTrade = accountInfo.canTrade;
        results.canWithdraw = accountInfo.canWithdraw;
        results.canDeposit = accountInfo.canDeposit;

        // Count balances
        const nonZeroBalances = accountInfo.balances.filter(
          (b) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0
        );
        results.assetsWithBalance = nonZeroBalances.length;
        results.assetList = nonZeroBalances.map((b) => ({
          asset: b.asset,
          free: parseFloat(b.free),
          locked: parseFloat(b.locked),
        }));
      }
    } catch (error) {
      results.error = error instanceof Error ? error.message : "Unknown error";
    }

    return results;
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
    runContext: RunContext<GordonContext> | undefined
  ) {
    const ctx = runContext?.context;
    if (!ctx?.binance) {
      return { error: "Binance client not connected. Please configure API keys." };
    }

    try {
      const fullDetails = await ctx.binance.getFullAccountDetails();
      const { account, apiRestrictions, recentTrades, deposits, withdrawals, earnPositions } = fullDetails;

      // Build response object
      const response: Record<string, unknown> = {
        // Account Info
        accountType: account.accountType,
        uid: account.uid,

        // Commission Rates
        commissionRates: {
          maker: `${(parseFloat(account.commissionRates.maker) * 100).toFixed(3)}%`,
          taker: `${(parseFloat(account.commissionRates.taker) * 100).toFixed(3)}%`,
        },

        // Permissions
        permissions: {
          canTrade: account.canTrade,
          canWithdraw: account.canWithdraw,
          canDeposit: account.canDeposit,
          accountPermissions: account.permissions,
        },
      };

      // API Restrictions
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

      // Trade History
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

      // Deposit History
      if (includeDepositHistory && deposits.length > 0) {
        const statusMap: Record<number, string> = {
          0: "pending",
          1: "success",
          6: "credited",
        };
        response.deposits = deposits.slice(0, 10).map((d) => ({
          coin: d.coin,
          amount: parseFloat(d.amount),
          network: d.network,
          status: statusMap[d.status] || `status_${d.status}`,
          txId: d.txId ? `${d.txId.slice(0, 10)}...` : null,
          time: new Date(d.insertTime).toISOString(),
        }));
      }

      // Withdrawal History
      if (includeWithdrawalHistory && withdrawals.length > 0) {
        const wStatusMap: Record<number, string> = {
          0: "email_sent",
          1: "cancelled",
          2: "awaiting_approval",
          3: "rejected",
          4: "processing",
          5: "failure",
          6: "completed",
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

      // Earn Positions
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

      // Summary counts
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
// Trade History Tool
// ============================================================================

export const getTradeHistoryTool = tool({
  name: "get_trade_history",
  description:
    "Get trade history for a specific symbol or all recent trades. " +
    "Use when user asks 'show my trades', 'trade history for BTC', 'what did I trade?'",
  parameters: z.object({
    symbol: z
      .string()
      .default("")
      .describe("Trading pair symbol (e.g., 'BTCUSDT'). Leave empty for all recent trades."),
    limit: z.number().min(1).max(100).default(20).describe("Max trades to return"),
  }),
  async execute({ symbol, limit }, runContext: RunContext<GordonContext> | undefined) {
    const ctx = runContext?.context;
    if (!ctx?.binance) {
      return { error: "Binance client not connected. Please configure API keys." };
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

      // Calculate some stats
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
          side: t.isBuyer ? "BUY" : "SELL",
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

export const getTransferHistoryTool = tool({
  name: "get_transfer_history",
  description:
    "Get deposit and withdrawal history. " +
    "Use when user asks 'show deposits', 'withdrawal history', 'transfer history'",
  parameters: z.object({
    type: z
      .enum(["deposits", "withdrawals", "both"])
      .default("both")
      .describe("Type of transfers to show"),
    limit: z.number().min(1).max(50).default(10).describe("Max records to return per type"),
  }),
  async execute({ type, limit }, runContext: RunContext<GordonContext> | undefined) {
    const ctx = runContext?.context;
    if (!ctx?.binance) {
      return { error: "Binance client not connected. Please configure API keys." };
    }

    try {
      const response: Record<string, unknown> = {};

      if (type === "deposits" || type === "both") {
        const deposits = await ctx.binance.getDepositHistory(limit);
        const statusMap: Record<number, string> = {
          0: "pending",
          1: "success",
          6: "credited",
        };
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
          0: "email_sent",
          1: "cancelled",
          2: "awaiting_approval",
          3: "rejected",
          4: "processing",
          5: "failure",
          6: "completed",
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
// Earn Positions Tool
// ============================================================================

export const getEarnPositionsTool = tool({
  name: "get_earn_positions",
  description:
    "Get Simple Earn (flexible savings) positions and yields. " +
    "Use when user asks 'show my earn', 'staking positions', 'what am I earning?'",
  parameters: z.object({}),
  async execute(_: Record<string, never>, runContext: RunContext<GordonContext> | undefined) {
    const ctx = runContext?.context;
    if (!ctx?.binance) {
      return { error: "Binance client not connected. Please configure API keys." };
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

// ============================================================================
// Export all tools
// ============================================================================

export const allTools = [
  scanMarketTool,
  analyzeCoinTool,
  createPlanTool,
  executePlanTool,
  checkPositionsTool,
  closeTradeTool,
  explainTool,
  armSystemTool,
  getPortfolioTool,
  listPlansTool,
  approvePlanTool,
  testConnectionTool,
  getAccountDetailsTool,
  getTradeHistoryTool,
  getTransferHistoryTool,
  getEarnPositionsTool,
];
