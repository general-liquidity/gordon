/**
 * Backtest Verdict Tools
 *
 * Agent-facing tools for the verdict-driven backtest screening layer:
 *   - Pre-run parameter gate (reject unsafe configs before engine runs)
 *   - Two-layer screening (sample size → risk-adjusted)
 *   - Experiment journal (JSONL log of hypothesis → verdict → metrics)
 *
 * These compose with the existing `run_backtest` tool. Typical flow:
 *   1. check_backtest_preconditions(config)     → abort if violations
 *   2. run_backtest(config)                      → existing tool
 *   3. screen_backtest_result(metrics)           → verdict
 *   4. record_backtest_experiment(...)           → journal entry
 *
 * The agent uses this chain when running auto-optimizer cycles or when
 * exploring new strategy hypotheses — captures the "why" alongside the
 * "what happened".
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  computeVerdict,
  formatVerdictSummary,
  DEFAULT_VERDICT_THRESHOLDS,
  STRICT_VERDICT_THRESHOLDS,
  type BacktestVerdict,
} from "../../../../../backtest/analysis/verdict.ts";
import {
  checkBacktestPreconditions,
  DEFAULT_GATE_LIMITS,
  mergeGateLimits,
} from "../../../../../backtest/prerun/preRunGate.ts";
import {
  recordExperiment,
  listExperiments,
  getJournalStats,
  summarizeMetrics,
} from "../../../../../backtest/persistence/experimentJournal.ts";
import type { BacktestMetrics } from "../../../../../backtest/types.ts";

// ============================================================================
// Shared zod shapes
// ============================================================================

const metricsShape = z
  .object({
    totalReturn: z.number(),
    annualizedReturn: z.number(),
    cagr: z.number(),
    maxDrawdown: z.number(),
    sharpeRatio: z.number(),
    sortinoRatio: z.number(),
    volatility: z.number(),
    calmarRatio: z.number(),
    totalTrades: z.number(),
    winningTrades: z.number(),
    losingTrades: z.number(),
    winRate: z.number(),
    profitFactor: z.number(),
    averageTrade: z.number(),
    averageWin: z.number(),
    averageLoss: z.number(),
    expectancy: z.number(),
    maxConsecutiveWins: z.number(),
    maxConsecutiveLosses: z.number(),
    initialValue: z.number(),
    finalValue: z.number(),
    totalPnl: z.number(),
    netProfit: z.number(),
    totalFees: z.number(),
    avgTradeDuration: z.number(),
    maxDrawdownDuration: z.number(),
  })
  .passthrough();

const thresholdsSchema = z
  .object({
    minTrades: z.number().int().min(1).optional(),
    minExposurePct: z.number().min(0).max(100).optional(),
    minSharpe: z.number().optional(),
    minCalmar: z.number().optional(),
    maxDrawdownPct: z.number().min(0).max(100).optional(),
  })
  .optional();

// ============================================================================
// 1. check_backtest_preconditions — pre-run gate
// ============================================================================

export const checkBacktestPreconditionsTool = createTool({
  id: "check_backtest_preconditions",
  description:
    "Run the pre-run parameter gate against a proposed backtest config BEFORE " +
    "calling run_backtest. Rejects configs that violate leverage caps, capital " +
    "minimums, position size caps, window bounds, or fee sanity checks. Returns " +
    "violations list — pass the config to run_backtest only when `passed: true`. " +
    "Prevents wasting compute on configurations the live trading constitution " +
    "would reject anyway.",
  inputSchema: z.object({
    leverage: z.number().min(1).max(125).optional().default(1),
    initialCapital: z.number().min(0).optional(),
    positionSizePercent: z.number().min(0).max(100).optional(),
    days: z.number().int().min(1).optional(),
    feePercent: z.number().min(0).optional(),
    limitsOverride: z
      .object({
        maxLeverage: z.number().optional(),
        maxDrawdownCap: z.number().optional(),
        minInitialCapital: z.number().optional(),
        maxPositionSizePct: z.number().optional(),
        minWindowDays: z.number().optional(),
        maxWindowDays: z.number().optional(),
        maxFeePct: z.number().optional(),
      })
      .optional(),
  }),
  outputSchema: z.object({
    passed: z.boolean(),
    violations: z.array(z.string()),
    limits: z.object({
      maxLeverage: z.number(),
      maxDrawdownCap: z.number(),
      minInitialCapital: z.number(),
      maxPositionSizePct: z.number(),
      minWindowDays: z.number(),
      maxWindowDays: z.number(),
      maxFeePct: z.number(),
    }),
  }),
  execute: async ({
    leverage,
    initialCapital,
    positionSizePercent,
    days,
    feePercent,
    limitsOverride,
  }) => {
    const limits = limitsOverride ? mergeGateLimits(limitsOverride) : DEFAULT_GATE_LIMITS;
    const result = checkBacktestPreconditions(
      { leverage, initialCapital, positionSizePercent, days, feePercent },
      limits,
    );
    return result;
  },
});

// ============================================================================
// 2. screen_backtest_result — two-layer verdict
// ============================================================================

export const screenBacktestResultTool = createTool({
  id: "screen_backtest_result",
  description:
    "Compute a single machine-parseable [VERDICT] from a backtest metrics " +
    "object. Runs the two-layer screening: Layer 1 checks statistical " +
    "validity (minimum trade count, minimum exposure), Layer 2 checks " +
    "risk-adjusted metrics (Sharpe >= threshold, Calmar >= threshold, " +
    "drawdown within cap). Returns ELIGIBLE, DISCARD_SAMPLE_SIZE, " +
    "DISCARD_RISK, DISCARD_PROFIT, or CRASH, plus violations for the " +
    "discard cases. Pass `strict: true` for live-eligible thresholds.",
  inputSchema: z.object({
    metrics: metricsShape,
    windowDays: z.number().int().min(1).optional(),
    strict: z.boolean().optional().default(false),
    thresholdsOverride: thresholdsSchema,
  }),
  outputSchema: z.object({
    verdict: z.enum(["ELIGIBLE", "DISCARD_SAMPLE_SIZE", "DISCARD_RISK", "DISCARD_PROFIT", "CRASH"]),
    verdictLine: z.string(),
    summary: z.string(),
    violations: z.array(z.string()),
    checks: z.object({
      sampleSize: z.boolean(),
      exposure: z.boolean(),
      drawdownCap: z.boolean(),
      sharpe: z.boolean(),
      calmar: z.boolean(),
    }),
    thresholds: z.object({
      minTrades: z.number(),
      minExposurePct: z.number(),
      minSharpe: z.number(),
      minCalmar: z.number(),
      maxDrawdownPct: z.number(),
    }),
  }),
  execute: async ({ metrics, windowDays, strict, thresholdsOverride }) => {
    const base = strict ? STRICT_VERDICT_THRESHOLDS : DEFAULT_VERDICT_THRESHOLDS;
    const thresholds = thresholdsOverride ? { ...base, ...thresholdsOverride } : base;
    const result = computeVerdict(metrics as unknown as BacktestMetrics, thresholds, windowDays);
    return {
      verdict: result.verdict,
      verdictLine: result.verdictLine,
      summary: formatVerdictSummary(result),
      violations: result.violations,
      checks: result.checks,
      thresholds: result.thresholds,
    };
  },
});

// ============================================================================
// 3. record_backtest_experiment — append to JSONL journal
// ============================================================================

export const recordBacktestExperimentTool = createTool({
  id: "record_backtest_experiment",
  description:
    "Append a backtest experiment to the journal at ~/.gordon/backtest-" +
    "experiments.jsonl. Captures hypothesis (your reasoning for running this " +
    "experiment), verdict, metrics summary, and violations. Use after each " +
    "backtest in an auto-optimizer cycle or manual strategy exploration — " +
    "the journal becomes the audit trail for 'why did Gordon discard that " +
    "strategy?' and 'which hypothesis was the LLM exploring last week?'.",
  inputSchema: z.object({
    strategyId: z.string(),
    symbol: z.string(),
    timeframe: z.string(),
    days: z.number().int().min(1),
    hypothesis: z
      .string()
      .min(1)
      .describe("Free-text reasoning for why you're running this experiment — what's the thesis?"),
    verdict: z.enum(["ELIGIBLE", "DISCARD_SAMPLE_SIZE", "DISCARD_RISK", "DISCARD_PROFIT", "CRASH"]),
    verdictLine: z.string(),
    violations: z.array(z.string()).default([]),
    metrics: metricsShape,
    backtestResultId: z.string().optional(),
  }),
  outputSchema: z.object({
    recorded: z.boolean(),
    experimentId: z.string(),
    timestamp: z.string(),
  }),
  execute: async ({
    strategyId,
    symbol,
    timeframe,
    days,
    hypothesis,
    verdict,
    verdictLine,
    violations,
    metrics,
    backtestResultId,
  }) => {
    const experiment = recordExperiment({
      strategyId,
      symbol,
      timeframe,
      days,
      hypothesis,
      verdict: verdict as BacktestVerdict,
      verdictLine,
      violations: violations ?? [],
      metricsSummary: summarizeMetrics(metrics as unknown as BacktestMetrics),
      backtestResultId,
    });
    return {
      recorded: true,
      experimentId: experiment.id,
      timestamp: experiment.timestamp,
    };
  },
});

// ============================================================================
// 4. list_backtest_experiments — query journal
// ============================================================================

export const listBacktestExperimentsTool = createTool({
  id: "list_backtest_experiments",
  description:
    "List recent backtest experiments from the journal (newest first). Filter " +
    "by verdict, strategy, or symbol. Use for 'show me the last 10 eligible " +
    "strategies I found' or 'why did I discard that BTC strategy yesterday?'.",
  inputSchema: z.object({
    limit: z.number().int().min(1).max(200).optional().default(20),
    verdict: z
      .enum(["ELIGIBLE", "DISCARD_SAMPLE_SIZE", "DISCARD_RISK", "DISCARD_PROFIT", "CRASH"])
      .optional(),
    strategyId: z.string().optional(),
    symbol: z.string().optional(),
  }),
  outputSchema: z.object({
    total: z.number(),
    experiments: z.array(
      z.object({
        id: z.string(),
        timestamp: z.string(),
        strategyId: z.string(),
        symbol: z.string(),
        timeframe: z.string(),
        days: z.number(),
        hypothesis: z.string(),
        verdict: z.string(),
        verdictLine: z.string(),
        violations: z.array(z.string()),
        metricsSummary: z.object({
          totalTrades: z.number(),
          sharpe: z.number(),
          calmar: z.number(),
          maxDrawdown: z.number(),
          totalReturn: z.number(),
          winRate: z.number(),
        }),
      }),
    ),
  }),
  execute: async ({ limit, verdict, strategyId, symbol }) => {
    const list = listExperiments({
      limit,
      verdict: verdict as BacktestVerdict | undefined,
      strategyId,
      symbol,
    });
    return {
      total: list.length,
      experiments: list.map((e) => ({
        id: e.id,
        timestamp: e.timestamp,
        strategyId: e.strategyId,
        symbol: e.symbol,
        timeframe: e.timeframe,
        days: e.days,
        hypothesis: e.hypothesis,
        verdict: e.verdict,
        verdictLine: e.verdictLine,
        violations: e.violations,
        metricsSummary: e.metricsSummary,
      })),
    };
  },
});

// ============================================================================
// 5. get_backtest_journal_stats — aggregate view
// ============================================================================

export const getBacktestJournalStatsTool = createTool({
  id: "get_backtest_journal_stats",
  description:
    "Return aggregate stats across the full backtest experiment journal: total " +
    "experiments, counts per verdict category, eligible rate percentage, and " +
    "average Sharpe for eligible strategies. Use for 'how is my auto-optimizer " +
    "doing?' — a low eligible rate means the LLM is exploring bad hypotheses.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    total: z.number(),
    byVerdict: z.object({
      ELIGIBLE: z.number(),
      DISCARD_SAMPLE_SIZE: z.number(),
      DISCARD_RISK: z.number(),
      DISCARD_PROFIT: z.number(),
      CRASH: z.number(),
    }),
    eligibleRatePct: z.number(),
    avgSharpeEligible: z.number(),
  }),
  execute: async () => {
    return getJournalStats();
  },
});

// ============================================================================
// Export
// ============================================================================

export const backtestVerdictTools = {
  check_backtest_preconditions: checkBacktestPreconditionsTool,
  screen_backtest_result: screenBacktestResultTool,
  record_backtest_experiment: recordBacktestExperimentTool,
  list_backtest_experiments: listBacktestExperimentsTool,
  get_backtest_journal_stats: getBacktestJournalStatsTool,
};
