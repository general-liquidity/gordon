/**
 * Playbook Backtest Tools (Mastra Format)
 *
 * Agent tools for backtesting playbooks against historical data.
 * Bridges the Playbook Engine with the Backtest Simulator.
 *
 * Tools:
 * - backtest_playbook: Run a playbook backtest on a symbol/timeframe
 * - get_backtest_results: Retrieve stored playbook backtest results
 * - compare_backtest_results: Compare multiple playbook backtests
 * - get_best_strategy: Find the best-performing playbook for a symbol
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { playbookRegistry } from "../../../../../core/playbooks/registry.ts";
import {
  BacktestSimulator,
  savePlaybookBacktestResult,
  listPlaybookBacktestResults,
  loadPlaybookBacktestResult,
  formatBacktestSummary,
  formatTradeList,
  formatEquityCurve,
  formatBacktestComparison,
  type Candle,
  type PlaybookBacktestResult,
} from "../../../../../core/backtesting/index.ts";
import { fetchHistoricalDataRange } from "../../../../../backtest/data/historical.ts";
import { getGordonContext, normalizeSymbol, type MastraExecutionContext } from "../../types.ts";
import { createModuleLogger } from "../../../../logger/index.ts";

const logger = createModuleLogger("backtest-tools");

// ============================================================================
// backtest_playbook
// ============================================================================

export const backtestPlaybookTool = createTool({
  id: "backtest_playbook",
  description:
    "Backtest a playbook strategy against historical price data. " +
    "Runs the playbook's entry/exit rules against candle data and returns " +
    "comprehensive performance metrics including Sharpe ratio, drawdown, win rate, " +
    "and individual trade details. Results are auto-saved to the database.",
  inputSchema: z.object({
    playbook_name: z
      .string()
      .describe("Playbook ID to backtest (e.g., 'momentum-breakout', 'mean-reversion', 'trend-following')"),
    symbol: z
      .string()
      .describe("Trading pair symbol (e.g., 'BTCUSDT', 'ETHUSDT')"),
    timeframe: z
      .string()
      .default("1h")
      .describe("Candle timeframe: '1h', '4h', '1d'"),
    start_date: z
      .string()
      .describe("Backtest start date (ISO format, e.g., '2025-01-01')"),
    end_date: z
      .string()
      .describe("Backtest end date (ISO format, e.g., '2025-06-01')"),
    initial_capital: z
      .number()
      .default(10000)
      .describe("Starting capital in USDT"),
    fee_percent: z
      .number()
      .default(0.1)
      .describe("Trading fee per side as percentage"),
    slippage_percent: z
      .number()
      .default(0.05)
      .describe("Slippage per side as percentage"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    summary: z.string().optional(),
    trade_list: z.string().optional(),
    equity_curve: z.string().optional(),
    result_id: z.string().optional(),
    total_trades: z.number().optional(),
    total_return_percent: z.number().optional(),
    sharpe_ratio: z.number().optional(),
    max_drawdown_percent: z.number().optional(),
    win_rate: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async (input, execContext?: MastraExecutionContext) => {
    try {
      const {
        playbook_name,
        symbol: rawSymbol,
        timeframe,
        start_date,
        end_date,
        initial_capital,
        fee_percent,
        slippage_percent,
      } = input;

      // Resolve playbook
      const playbook = playbookRegistry.get(playbook_name);
      if (!playbook) {
        const available = playbookRegistry.getAll().map((p) => p.id);
        return {
          success: false,
          error: `Playbook "${playbook_name}" not found. Available: ${available.join(", ")}`,
        };
      }

      // Normalize symbol
      const symbol = normalizeSymbol(rawSymbol);

      // Get exchange for fetching data
      const ctx = getGordonContext(execContext ?? undefined);
      const exchange = ctx?.exchange;
      if (!exchange) {
        return { success: false, error: "Exchange client not connected. Please configure API keys." };
      }

      // Fetch historical data
      const startTime = new Date(start_date).getTime();
      const endTime = new Date(end_date).getTime();
      if (isNaN(startTime) || isNaN(endTime) || endTime <= startTime) {
        return { success: false, error: "Invalid date range. Ensure start_date < end_date and both are valid ISO dates." };
      }

      logger.info("Fetching historical data", { symbol, timeframe, start_date, end_date });
      const ohlcData = await fetchHistoricalDataRange(exchange, symbol, timeframe, startTime, endTime);

      if (ohlcData.length < 60) {
        return {
          success: false,
          error: `Insufficient data: only ${ohlcData.length} candles retrieved for ${symbol} (${timeframe}). Need at least 60.`,
        };
      }

      // Convert OHLC to Candle
      const candles: Candle[] = ohlcData.map((c) => ({
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        timestamp: c.timestamp,
      }));

      // Run backtest
      const config = {
        playbook_name: playbook.id,
        symbol,
        timeframe: timeframe ?? "1h",
        start_date,
        end_date,
        initial_capital: initial_capital ?? 10000,
        fee_percent: fee_percent ?? 0.1,
        slippage_percent: slippage_percent ?? 0.05,
      };

      logger.info("Running playbook backtest", {
        playbook: playbook.id,
        symbol,
        candles: String(candles.length),
      });

      const simulator = new BacktestSimulator();
      const result = simulator.run(config, candles, playbook);

      // Save to database
      const resultId = savePlaybookBacktestResult(result);

      // Format output
      const summary = formatBacktestSummary(result);
      const tradeList = formatTradeList(result.trades, 15);
      const equityCurveStr = formatEquityCurve(result.equity_curve);

      return {
        success: true,
        summary,
        trade_list: tradeList,
        equity_curve: equityCurveStr,
        result_id: resultId ?? undefined,
        total_trades: result.total_trades,
        total_return_percent: result.total_return_percent,
        sharpe_ratio: result.sharpe_ratio,
        max_drawdown_percent: result.max_drawdown_percent,
        win_rate: result.win_rate,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("backtest_playbook failed", { error: message });
      return { success: false, error: message };
    }
  },
});

// ============================================================================
// get_backtest_results
// ============================================================================

export const getBacktestResultsTool = createTool({
  id: "get_backtest_results",
  description:
    "Retrieve stored playbook backtest results. " +
    "Filter by playbook name, symbol, or timeframe. " +
    "Returns summary metrics for each result.",
  inputSchema: z.object({
    playbook_name: z.string().optional().describe("Filter by playbook ID"),
    symbol: z.string().optional().describe("Filter by trading pair"),
    timeframe: z.string().optional().describe("Filter by candle timeframe"),
    limit: z.number().min(1).max(50).default(10).describe("Max results to return"),
    order_by: z
      .enum(["created_at", "total_return", "sharpe_ratio", "win_rate"])
      .default("created_at")
      .describe("Sort field"),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        id: z.string(),
        playbook_name: z.string(),
        symbol: z.string(),
        timeframe: z.string(),
        total_return: z.number(),
        sharpe_ratio: z.number(),
        max_drawdown: z.number(),
        win_rate: z.number(),
        total_trades: z.number(),
        created_at: z.string(),
      })
    ),
    count: z.number(),
    error: z.string().optional(),
  }),
  execute: async ({ playbook_name, symbol, timeframe, limit, order_by }) => {
    try {
      const summaries = listPlaybookBacktestResults({
        playbook_name,
        symbol: symbol ? normalizeSymbol(symbol) : undefined,
        timeframe,
        limit: limit ?? 10,
        order_by: order_by ?? "created_at",
        order_dir: "desc",
      });

      return {
        results: summaries.map((s) => ({
          id: s.id,
          playbook_name: s.playbook_name,
          symbol: s.symbol,
          timeframe: s.timeframe,
          total_return: s.total_return,
          sharpe_ratio: s.sharpe_ratio,
          max_drawdown: s.max_drawdown,
          win_rate: s.win_rate,
          total_trades: s.total_trades,
          created_at: s.created_at,
        })),
        count: summaries.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("get_backtest_results failed", { error: message });
      return { results: [], count: 0, error: message };
    }
  },
});

// ============================================================================
// compare_backtest_results
// ============================================================================

export const compareBacktestResultsTool = createTool({
  id: "compare_backtest_results",
  description:
    "Compare multiple playbook backtest results side by side. " +
    "Provide result IDs or let it compare the latest results for given playbooks.",
  inputSchema: z.object({
    result_ids: z
      .array(z.string())
      .optional()
      .describe("Specific result IDs to compare"),
    playbook_names: z
      .array(z.string())
      .optional()
      .describe("Playbook IDs to compare (uses latest result for each)"),
    symbol: z
      .string()
      .optional()
      .describe("Symbol to filter by when using playbook_names"),
    timeframe: z
      .string()
      .optional()
      .describe("Timeframe to filter by when using playbook_names"),
  }),
  outputSchema: z.object({
    comparison: z.string(),
    count: z.number(),
    error: z.string().optional(),
  }),
  execute: async ({ result_ids, playbook_names, symbol, timeframe }) => {
    try {
      const results: PlaybookBacktestResult[] = [];

      // Load by IDs
      if (result_ids && result_ids.length > 0) {
        for (const id of result_ids) {
          const result = loadPlaybookBacktestResult(id);
          if (result) results.push(result);
        }
      }

      // Load by playbook names (latest per playbook)
      if (playbook_names && playbook_names.length > 0 && results.length === 0) {
        for (const name of playbook_names) {
          const summaries = listPlaybookBacktestResults({
            playbook_name: name,
            symbol: symbol ? normalizeSymbol(symbol) : undefined,
            timeframe,
            limit: 1,
            order_by: "created_at",
            order_dir: "desc",
          });
          if (summaries.length > 0) {
            const full = loadPlaybookBacktestResult(summaries[0]!.id);
            if (full) results.push(full);
          }
        }
      }

      if (results.length === 0) {
        return {
          comparison: "No backtest results found to compare.",
          count: 0,
          error: "No matching results. Run backtests first using backtest_playbook.",
        };
      }

      const comparison = formatBacktestComparison(results);
      return { comparison, count: results.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("compare_backtest_results failed", { error: message });
      return { comparison: "", count: 0, error: message };
    }
  },
});

// ============================================================================
// get_best_strategy
// ============================================================================

export const getBestStrategyTool = createTool({
  id: "get_best_strategy",
  description:
    "Find the best-performing playbook for a given symbol based on stored backtest results. " +
    "Ranks by Sharpe ratio by default. Returns top N strategies.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair symbol (e.g., 'BTCUSDT')"),
    timeframe: z.string().optional().describe("Filter by candle timeframe"),
    rank_by: z
      .enum(["sharpe_ratio", "total_return", "win_rate"])
      .default("sharpe_ratio")
      .describe("Metric to rank by"),
    top_n: z.number().min(1).max(10).default(3).describe("Number of top strategies to return"),
  }),
  outputSchema: z.object({
    rankings: z.array(
      z.object({
        rank: z.number(),
        playbook_name: z.string(),
        total_return: z.number(),
        sharpe_ratio: z.number(),
        max_drawdown: z.number(),
        win_rate: z.number(),
        total_trades: z.number(),
      })
    ),
    symbol: z.string(),
    count: z.number(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol: rawSymbol, timeframe, rank_by, top_n }) => {
    try {
      const symbol = normalizeSymbol(rawSymbol);
      const orderBy = (rank_by ?? "sharpe_ratio") as "sharpe_ratio" | "total_return" | "win_rate";

      const summaries = listPlaybookBacktestResults({
        symbol,
        timeframe,
        limit: 50,
        order_by: orderBy,
        order_dir: "desc",
      });

      if (summaries.length === 0) {
        return {
          rankings: [],
          symbol,
          count: 0,
          error: `No backtest results found for ${symbol}. Run backtest_playbook first.`,
        };
      }

      // Deduplicate: keep the best result per playbook
      const bestByPlaybook = new Map<string, (typeof summaries)[number]>();
      for (const s of summaries) {
        const existing = bestByPlaybook.get(s.playbook_name);
        if (!existing) {
          bestByPlaybook.set(s.playbook_name, s);
        } else {
          // Compare by the ranking metric
          const curr =
            orderBy === "total_return"
              ? s.total_return
              : orderBy === "win_rate"
                ? s.win_rate
                : s.sharpe_ratio;
          const prev =
            orderBy === "total_return"
              ? existing.total_return
              : orderBy === "win_rate"
                ? existing.win_rate
                : existing.sharpe_ratio;
          if (curr > prev) {
            bestByPlaybook.set(s.playbook_name, s);
          }
        }
      }

      // Sort and take top N
      const sorted = [...bestByPlaybook.values()].sort((a, b) => {
        const aVal =
          orderBy === "total_return"
            ? a.total_return
            : orderBy === "win_rate"
              ? a.win_rate
              : a.sharpe_ratio;
        const bVal =
          orderBy === "total_return"
            ? b.total_return
            : orderBy === "win_rate"
              ? b.win_rate
              : b.sharpe_ratio;
        return bVal - aVal;
      });

      const topResults = sorted.slice(0, top_n ?? 3);

      return {
        rankings: topResults.map((s, i) => ({
          rank: i + 1,
          playbook_name: s.playbook_name,
          total_return: s.total_return,
          sharpe_ratio: s.sharpe_ratio,
          max_drawdown: s.max_drawdown,
          win_rate: s.win_rate,
          total_trades: s.total_trades,
        })),
        symbol,
        count: topResults.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("get_best_strategy failed", { error: message });
      return { rankings: [], symbol: rawSymbol, count: 0, error: message };
    }
  },
});

// ============================================================================
// Export as Object (Mastra format)
// ============================================================================

/**
 * Playbook backtest tools exported as an object for Mastra Agent.
 */
export const playbookBacktestTools = {
  backtest_playbook: backtestPlaybookTool,
  get_backtest_results: getBacktestResultsTool,
  compare_backtest_results: compareBacktestResultsTool,
  get_best_strategy: getBestStrategyTool,
};
