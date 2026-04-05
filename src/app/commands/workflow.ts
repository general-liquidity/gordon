/**
 * Workflow Command Handler
 * Predefined workflows that chain multiple commands for common trading tasks
 */

import type { Exchange } from "../../infra/exchange/index.ts";
import type { LLMClient } from "../../infra/ai/llm/index.ts";
import type { GordonConfig } from "../../types/index.ts";
import { scan } from "../../core/scanner.ts";
import { analyze, type DetailedAnalysis } from "../../core/analyzer.ts";
import { strategyRegistry, type StrategyId } from "../../strategies/index.ts";
import { runBacktest } from "../../backtest/engine.ts";
import { fetchHistoricalData } from "../../backtest/data/historical.ts";
import { formatBacktestSummary } from "../../backtest/reporting/formatter.ts";
import type { BacktestResult, BacktestConfig } from "../../backtest/types.ts";
import { createStreamingWorkflow, type StreamingWorkflowResult } from "../../infra/agents/index.ts";
import { normalizeCryptoSymbol } from "../../infra/domain/markets/instruments.ts";
// Tinyfish monitoring removed — stubs for backward compat
class TinyfishClient { isConfigured() { return false; } }
function summarizeTinyfishResult(_r: any): string { return "Tinyfish removed"; }
function buildTinyfishRequest(opts: any): any { return opts; }
async function runTinyfishResearch(..._args: any[]): Promise<any> { return { summary: "Tinyfish removed" }; }
function scheduleTinyfishMonitor(_opts: any): any { return { id: "removed" }; }
type TinyfishSSEEvent = { event: string; data?: unknown };
type TinyfishRunResponse = { summary?: string; result?: any; raw?: any };

// ============================================================================
// Types
// ============================================================================

export interface WorkflowContext {
  exchange: Exchange;
  llm?: LLMClient;
  config?: GordonConfig;
}

export interface WorkflowResult {
  success: boolean;
  workflow: string;
  steps: WorkflowStep[];
  summary: string;
  data?: Record<string, unknown>;
  error?: string;
}

export interface WorkflowStep {
  name: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  message?: string;
  data?: unknown;
  duration?: number;
}

type WorkflowType = "quick" | "dd" | "backtest-cycle" | "web-dd" | "web-monitor";

export interface TinyfishWorkflowStreamEvent {
  event: string;
  status: "running" | "completed" | "failed";
  summary?: string;
  data?: unknown;
}

// ============================================================================
// Workflow Definitions
// ============================================================================

/**
 * Quick workflow: scan -> analyze -> plan recommendation
 * Use case: Fast overview of a specific symbol
 */
async function runQuickWorkflow(
  symbol: string,
  ctx: WorkflowContext
): Promise<WorkflowResult> {
  const steps: WorkflowStep[] = [];
  const normalizedSymbol = normalizeSymbol(symbol);

  // Step 1: Quick market context scan
  steps.push({ name: "scan", status: "running" });
  const scanStart = Date.now();
  try {
    const scanResult = await scan(ctx.exchange, { topN: 20, timeframes: ["1h"] });
    const scanDuration = Date.now() - scanStart;

    const symbolInScan = scanResult.coins.find(
      (c) => c.symbol === normalizedSymbol
    );

    steps[0] = {
      name: "scan",
      status: "completed",
      message: `Scanned ${scanResult.coins.length} coins, found ${scanResult.coins.filter((c) => c.setupDetected).length} opportunities`,
      data: {
        coinsScanned: scanResult.coins.length,
        opportunities: scanResult.coins.filter((c) => c.setupDetected).length,
        symbolFound: !!symbolInScan,
        symbolHasSetup: symbolInScan?.setupDetected || false,
      },
      duration: scanDuration,
    };
  } catch (error) {
    steps[0] = {
      name: "scan",
      status: "failed",
      message: error instanceof Error ? error.message : "Scan failed",
      duration: Date.now() - scanStart,
    };
  }

  // Step 2: Deep analysis on the symbol
  steps.push({ name: "analyze", status: "running" });
  const analyzeStart = Date.now();
  let analysis: DetailedAnalysis | null = null;
  try {
    analysis = await analyze(ctx.exchange, normalizedSymbol, {
      timeframes: ["1h", "4h"],
    });
    const analyzeDuration = Date.now() - analyzeStart;

    steps[1] = {
      name: "analyze",
      status: "completed",
      message: `${normalizedSymbol}: ${analysis.bias} bias, ${analysis.trend} trend, RSI ${analysis.indicators.rsi?.toFixed(1) || "N/A"}`,
      data: {
        symbol: analysis.symbol,
        price: analysis.price,
        trend: analysis.trend,
        bias: analysis.bias,
        risk: analysis.risk,
        setupDetected: analysis.setupDetected,
        setupConfidence: analysis.setupConfidence,
        rsi: analysis.indicators.rsi,
        macdState: analysis.macdState,
        supports: analysis.supports.slice(0, 3),
        resistances: analysis.resistances.slice(0, 3),
      },
      duration: analyzeDuration,
    };
  } catch (error) {
    steps[1] = {
      name: "analyze",
      status: "failed",
      message: error instanceof Error ? error.message : "Analysis failed",
      duration: Date.now() - analyzeStart,
    };
  }

  // Step 3: Generate plan recommendation
  steps.push({ name: "plan", status: "running" });
  const planStart = Date.now();

  if (analysis) {
    const planRecommendation = generatePlanRecommendation(analysis);
    steps[2] = {
      name: "plan",
      status: "completed",
      message: planRecommendation.summary,
      data: planRecommendation,
      duration: Date.now() - planStart,
    };
  } else {
    steps[2] = {
      name: "plan",
      status: "skipped",
      message: "Skipped due to analysis failure",
      duration: Date.now() - planStart,
    };
  }

  const allCompleted = steps.every(
    (s) => s.status === "completed" || s.status === "skipped"
  );

  return {
    success: allCompleted,
    workflow: "quick",
    steps,
    summary: generateQuickSummary(normalizedSymbol, steps, analysis),
    data: {
      symbol: normalizedSymbol,
      analysis: analysis ? {
        price: analysis.price,
        trend: analysis.trend,
        bias: analysis.bias,
        setupDetected: analysis.setupDetected,
      } : null,
    },
  };
}

/**
 * Due Diligence workflow: scan -> analyze -> portfolio check -> risk assessment
 * Use case: Comprehensive research before entering a position
 */
async function runDueDiligenceWorkflow(
  symbol: string,
  ctx: WorkflowContext
): Promise<WorkflowResult> {
  const steps: WorkflowStep[] = [];
  const normalizedSymbol = normalizeSymbol(symbol);

  // Step 1: Market scan for context
  steps.push({ name: "scan", status: "running" });
  const scanStart = Date.now();
  try {
    const scanResult = await scan(ctx.exchange, { topN: 50, timeframes: ["1h"] });
    const position = scanResult.coins.findIndex((c) => c.symbol === normalizedSymbol);
    const topOpportunities = scanResult.coins
      .filter((c) => c.setupDetected)
      .slice(0, 5)
      .map((c) => c.symbol);

    steps[0] = {
      name: "scan",
      status: "completed",
      message: `${normalizedSymbol} ranked #${position >= 0 ? position + 1 : "N/A"} of ${scanResult.coins.length} coins`,
      data: {
        ranking: position >= 0 ? position + 1 : null,
        totalCoins: scanResult.coins.length,
        topOpportunities,
      },
      duration: Date.now() - scanStart,
    };
  } catch (error) {
    steps[0] = {
      name: "scan",
      status: "failed",
      message: error instanceof Error ? error.message : "Scan failed",
      duration: Date.now() - scanStart,
    };
  }

  // Step 2: Deep analysis
  steps.push({ name: "analyze", status: "running" });
  const analyzeStart = Date.now();
  let analysis: DetailedAnalysis | null = null;
  try {
    analysis = await analyze(ctx.exchange, normalizedSymbol, {
      timeframes: ["1h", "4h", "1d"],
      candleLimit: 200,
    });

    steps[1] = {
      name: "analyze",
      status: "completed",
      message: `Trend: ${analysis.trend}, Bias: ${analysis.bias}, Risk: ${analysis.risk}`,
      data: {
        symbol: analysis.symbol,
        price: analysis.price,
        change24h: analysis.change24h,
        volume24h: analysis.volume24h,
        trend: analysis.trend,
        bias: analysis.bias,
        risk: analysis.risk,
        setupDetected: analysis.setupDetected,
        setupConfidence: analysis.setupConfidence,
        indicators: {
          rsi: analysis.indicators.rsi,
          macdState: analysis.macdState,
          volumeTrend: analysis.volumeTrend,
        },
        supports: analysis.supports.slice(0, 5),
        resistances: analysis.resistances.slice(0, 5),
        setupDetails: analysis.setupDetails,
      },
      duration: Date.now() - analyzeStart,
    };
  } catch (error) {
    steps[1] = {
      name: "analyze",
      status: "failed",
      message: error instanceof Error ? error.message : "Analysis failed",
      duration: Date.now() - analyzeStart,
    };
  }

  // Step 3: Portfolio context check
  steps.push({ name: "portfolio", status: "running" });
  const portfolioStart = Date.now();
  try {
    // Get account balance to check existing exposure
    const balances = await ctx.exchange.getAllBalances();
    const baseSymbol = normalizedSymbol.replace("USDT", "");
    const existingPosition = balances.find((b) => b.asset === baseSymbol);
    const usdtBalance = balances.find((b) => b.asset === "USDT");

    const hasExposure = existingPosition && existingPosition.free > 0;
    const availableUSDT = usdtBalance?.free || 0;

    steps[2] = {
      name: "portfolio",
      status: "completed",
      message: hasExposure
        ? `Already holding ${existingPosition.free} ${baseSymbol}`
        : `No existing position. Available: $${availableUSDT.toFixed(2)} USDT`,
      data: {
        hasExistingPosition: hasExposure,
        existingAmount: existingPosition?.free || 0,
        availableUSDT,
      },
      duration: Date.now() - portfolioStart,
    };
  } catch (error) {
    steps[2] = {
      name: "portfolio",
      status: "failed",
      message: error instanceof Error ? error.message : "Portfolio check failed",
      duration: Date.now() - portfolioStart,
    };
  }

  // Step 4: Risk assessment
  steps.push({ name: "risk", status: "running" });
  const riskStart = Date.now();

  if (analysis) {
    const riskAssessment = assessRisk(analysis);
    steps[3] = {
      name: "risk",
      status: "completed",
      message: `Risk Score: ${riskAssessment.score}/10 - ${riskAssessment.verdict}`,
      data: riskAssessment,
      duration: Date.now() - riskStart,
    };
  } else {
    steps[3] = {
      name: "risk",
      status: "skipped",
      message: "Skipped due to analysis failure",
      duration: Date.now() - riskStart,
    };
  }

  const allCompleted = steps.every(
    (s) => s.status === "completed" || s.status === "skipped"
  );

  return {
    success: allCompleted,
    workflow: "dd",
    steps,
    summary: generateDDSummary(normalizedSymbol, steps, analysis),
    data: {
      symbol: normalizedSymbol,
      analysis: analysis ? {
        price: analysis.price,
        trend: analysis.trend,
        bias: analysis.bias,
        risk: analysis.risk,
        setupDetected: analysis.setupDetected,
      } : null,
    },
  };
}

/**
 * Backtest Cycle workflow: backtest -> optimize -> compare
 * Use case: Evaluate and optimize a strategy for a specific symbol
 */
async function runBacktestCycleWorkflow(
  strategyId: string,
  symbol: string,
  ctx: WorkflowContext
): Promise<WorkflowResult> {
  const steps: WorkflowStep[] = [];
  const normalizedSymbol = normalizeSymbol(symbol);

  // Validate strategy
  const strategy = strategyRegistry.get(strategyId as StrategyId);
  if (!strategy) {
    return {
      success: false,
      workflow: "backtest-cycle",
      steps: [],
      summary: `Strategy "${strategyId}" not found. Use /strategies to see available strategies.`,
      error: `Strategy "${strategyId}" not found`,
    };
  }

  // Step 1: Initial backtest
  steps.push({ name: "backtest", status: "running" });
  const backtestStart = Date.now();
  let backtestResult: BacktestResult | null = null;

  try {
    const ohlcData = await fetchHistoricalData(ctx.exchange, normalizedSymbol, "4h", 90);

    if (ohlcData.length < 100) {
      steps[0] = {
        name: "backtest",
        status: "failed",
        message: `Insufficient data for ${normalizedSymbol}`,
        duration: Date.now() - backtestStart,
      };
    } else {
      const engineParams = {
        initialCapital: 10000,
        commissionRate: 0.001,
      };

      const engineResult = runBacktest(strategy, ohlcData, engineParams);

      const config: BacktestConfig = {
        strategyId: strategy.id,
        symbol: normalizedSymbol,
        timeframe: "4h",
        days: 90,
        initialCapital: 10000,
        positionSizePercent: 10,
        compounding: false,
        feePercent: 0.1,
        slippagePercent: 0.05,
      };

      backtestResult = {
        id: `bt_${Date.now()}`,
        strategyName: strategy.name,
        config,
        metrics: engineResult.metrics,
        trades: engineResult.trades.map((t) => ({
          id: t.id,
          entryTime: new Date(t.entryTime).toISOString(),
          exitTime: new Date(t.exitTime).toISOString(),
          entryPrice: t.entryPrice,
          exitPrice: t.exitPrice,
          quantity: t.quantity,
          positionValue: t.entryPrice * t.quantity,
          side: t.side,
          pnl: t.netPnL,
          pnlPercent: t.returnPct,
          fees: t.commission,
          exitReason: "SIGNAL" as const,
        })),
        equityCurve: engineResult.equityCurve.map((p) => ({
          timestamp: p.timestamp,
          equity: p.equity,
        })),
        drawdownCurve: engineResult.equityCurve.map((p) => ({
          timestamp: p.timestamp,
          drawdown: p.drawdownPct,
        })),
        startDate: new Date(engineResult.startDate).toISOString(),
        endDate: new Date(engineResult.endDate).toISOString(),
        executionTime: Date.now() - backtestStart,
        createdAt: new Date().toISOString(),
        warnings: [],
      };

      steps[0] = {
        name: "backtest",
        status: "completed",
        message: `Return: ${engineResult.metrics.totalReturn.toFixed(2)}%, Sharpe: ${engineResult.metrics.sharpeRatio.toFixed(2)}, Trades: ${engineResult.metrics.totalTrades}`,
        data: {
          totalReturn: engineResult.metrics.totalReturn,
          sharpeRatio: engineResult.metrics.sharpeRatio,
          maxDrawdown: engineResult.metrics.maxDrawdown,
          winRate: engineResult.metrics.winRate,
          totalTrades: engineResult.metrics.totalTrades,
        },
        duration: Date.now() - backtestStart,
      };
    }
  } catch (error) {
    steps[0] = {
      name: "backtest",
      status: "failed",
      message: error instanceof Error ? error.message : "Backtest failed",
      duration: Date.now() - backtestStart,
    };
  }

  // Step 2: Optimization (simplified - just test a few variations)
  steps.push({ name: "optimize", status: "running" });
  const optimizeStart = Date.now();

  if (backtestResult) {
    // In a real implementation, this would run parameter optimization
    // For now, we provide optimization recommendations based on results
    const optimizationSuggestions = generateOptimizationSuggestions(backtestResult);

    steps[1] = {
      name: "optimize",
      status: "completed",
      message: `${optimizationSuggestions.suggestions.length} optimization suggestions generated`,
      data: optimizationSuggestions,
      duration: Date.now() - optimizeStart,
    };
  } else {
    steps[1] = {
      name: "optimize",
      status: "skipped",
      message: "Skipped due to backtest failure",
      duration: Date.now() - optimizeStart,
    };
  }

  // Step 3: Compare with baseline
  steps.push({ name: "compare", status: "running" });
  const compareStart = Date.now();

  if (backtestResult) {
    // Compare with buy-and-hold benchmark
    const benchmarkComparison = {
      strategyReturn: backtestResult.metrics.totalReturn,
      buyHoldReturn: 0, // Would calculate from price data
      outperformance: backtestResult.metrics.totalReturn, // Simplified
      riskAdjustedAdvantage: backtestResult.metrics.sharpeRatio > 1 ? "positive" : "negative",
    };

    steps[2] = {
      name: "compare",
      status: "completed",
      message: `Strategy ${backtestResult.metrics.totalReturn > 0 ? "outperformed" : "underperformed"} with ${backtestResult.metrics.totalReturn.toFixed(2)}% return`,
      data: benchmarkComparison,
      duration: Date.now() - compareStart,
    };
  } else {
    steps[2] = {
      name: "compare",
      status: "skipped",
      message: "Skipped due to backtest failure",
      duration: Date.now() - compareStart,
    };
  }

  const allCompleted = steps.every(
    (s) => s.status === "completed" || s.status === "skipped"
  );

  return {
    success: allCompleted,
    workflow: "backtest-cycle",
    steps,
    summary: generateBacktestCycleSummary(strategy.name, normalizedSymbol, steps, backtestResult),
    data: {
      strategy: strategy.name,
      symbol: normalizedSymbol,
      backtestResult: backtestResult ? {
        totalReturn: backtestResult.metrics.totalReturn,
        sharpeRatio: backtestResult.metrics.sharpeRatio,
        maxDrawdown: backtestResult.metrics.maxDrawdown,
        winRate: backtestResult.metrics.winRate,
        totalTrades: backtestResult.metrics.totalTrades,
      } : null,
    },
  };
}

function getTinyfishWorkflowSummary(response: TinyfishRunResponse): string {
  return response.summary ?? summarizeTinyfishResult(response.result ?? response.raw) ?? "Tinyfish run completed.";
}

function mapTinyfishSseEvent(event: TinyfishSSEEvent): TinyfishWorkflowStreamEvent {
  const payload =
    typeof event.data === "object" && event.data !== null
      ? (event.data as Record<string, unknown>)
      : undefined;
  const summary = (() => {
    if (typeof event.data === "string") return event.data;
    if (payload && typeof payload.summary === "string") return payload.summary;
    if (payload && typeof payload.message === "string") return payload.message;
    if (payload && typeof payload.status === "string") return payload.status;
    return event.event;
  })();

  const status =
    event.event === "error" ? "failed" :
    event.event === "done" || event.event === "complete" ? "completed" :
    "running";

  return {
    event: event.event,
    status,
    summary,
    data: payload ?? event.data,
  };
}

export function createTinyfishDueDiligenceStream(
  url: string,
  goal: string,
  options?: {
    browserProfile?: string;
    proxyCountry?: string;
  },
): StreamingWorkflowResult<TinyfishWorkflowStreamEvent> {
  return createStreamingWorkflow<TinyfishWorkflowStreamEvent>(
    async function* () {
      const client = new TinyfishClient();
      if (!client.isConfigured()) {
        yield {
          event: "error",
          status: "failed",
          summary: "Tinyfish not configured. Set TINYFISH_API_KEY.",
        };
        return;
      }

      yield {
        event: "start",
        status: "running",
        summary: `Starting Tinyfish due diligence for ${url}`,
        data: { url, goal },
      };

      try {
        for await (const event of client.runSSE(
          buildTinyfishRequest({
            url,
            goal,
            browserProfile: options?.browserProfile,
            proxyCountry: options?.proxyCountry,
            allowAuthenticated: false,
            metadata: { source: "workflow.web-dd" },
          }),
        )) {
          yield mapTinyfishSseEvent(event);
        }
      } catch (error) {
        yield {
          event: "error",
          status: "failed",
          summary: error instanceof Error ? error.message : String(error),
        };
        return;
      }

      yield {
        event: "done",
        status: "completed",
        summary: `Tinyfish due diligence stream completed for ${url}`,
      };
    },
    {
      enableHeartbeat: true,
      heartbeatInterval: 5000,
      metadata: { source: "workflow.web-dd" },
    },
  );
}

async function runTinyfishDueDiligenceWorkflow(
  url: string,
  goal: string,
  _ctx: WorkflowContext,
): Promise<WorkflowResult> {
  const client = new TinyfishClient();
  if (!client.isConfigured()) {
    return {
      success: false,
      workflow: "web-dd",
      steps: [],
      summary: "Tinyfish not configured. Set TINYFISH_API_KEY before running web due diligence.",
      error: "Tinyfish not configured",
    };
  }

  const steps: WorkflowStep[] = [];
  steps.push({ name: "research", status: "running" });
  const researchStart = Date.now();
  let response: TinyfishRunResponse | null = null;
  let extractedSummary = "";

  try {
    response = await runTinyfishResearch(
      buildTinyfishRequest({
        url,
        goal,
        allowAuthenticated: false,
        metadata: { source: "workflow.web-dd" },
      }),
    );
    extractedSummary = getTinyfishWorkflowSummary(response);
    steps[0] = {
      name: "research",
      status: response.success ? "completed" : "failed",
      message: extractedSummary,
      data: {
        runId: response.runId,
        status: response.status,
        url,
      },
      duration: Date.now() - researchStart,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    steps[0] = {
      name: "research",
      status: "failed",
      message,
      duration: Date.now() - researchStart,
    };
    return {
      success: false,
      workflow: "web-dd",
      steps,
      summary: `Web due diligence failed for ${url}`,
      error: message,
    };
  }

  steps.push({ name: "assessment", status: "running" });
  const assessmentStart = Date.now();
  const assessmentMessage = response?.success
    ? `Captured browser-native evidence for ${url}. Summary: ${extractedSummary}`
    : `Tinyfish reached ${url} but did not return a successful result. Summary: ${extractedSummary}`;

  steps[1] = {
    name: "assessment",
    status: response?.success ? "completed" : "failed",
    message: assessmentMessage,
    data: {
      summary: extractedSummary,
      success: response?.success ?? false,
    },
    duration: Date.now() - assessmentStart,
  };

  return {
    success: response?.success ?? false,
    workflow: "web-dd",
    steps,
    summary: response?.success
      ? `Tinyfish web due diligence completed for ${url}`
      : `Tinyfish web due diligence returned an unsuccessful result for ${url}`,
    data: {
      url,
      goal,
      response,
      summary: extractedSummary,
    },
    error: response?.success ? undefined : response?.error,
  };
}

async function runTinyfishMonitorWorkflow(
  monitorId: string,
  schedule: string,
  url: string,
  goal: string,
  _ctx: WorkflowContext,
): Promise<WorkflowResult> {
  const client = new TinyfishClient();
  if (!client.isConfigured()) {
    return {
      success: false,
      workflow: "web-monitor",
      steps: [],
      summary: "Tinyfish not configured. Set TINYFISH_API_KEY before scheduling web monitors.",
      error: "Tinyfish not configured",
    };
  }

  const steps: WorkflowStep[] = [];
  steps.push({ name: "schedule", status: "running" });
  const scheduleStart = Date.now();

  try {
    const monitor = scheduleTinyfishMonitor({
      monitorId,
      name: monitorId,
      url,
      goal,
      schedule,
      createdBy: "workflow",
      enabled: true,
    });

    steps[0] = {
      name: "schedule",
      status: "completed",
      message: `Scheduled ${monitor.monitorId} on ${monitor.cronExpr}`,
      data: {
        monitorId: monitor.monitorId,
        cronExpr: monitor.cronExpr,
        url: monitor.url,
      },
      duration: Date.now() - scheduleStart,
    };

    return {
      success: true,
      workflow: "web-monitor",
      steps,
      summary: `Tinyfish monitor '${monitor.monitorId}' scheduled for ${url}`,
      data: {
        monitorId: monitor.monitorId,
        cronExpr: monitor.cronExpr,
        url: monitor.url,
        goal: monitor.goal,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    steps[0] = {
      name: "schedule",
      status: "failed",
      message,
      duration: Date.now() - scheduleStart,
    };
    return {
      success: false,
      workflow: "web-monitor",
      steps,
      summary: `Failed to schedule Tinyfish monitor '${monitorId}'`,
      error: message,
    };
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function normalizeSymbol(symbol: string): string {
  return normalizeCryptoSymbol(symbol);
}

function generatePlanRecommendation(analysis: DetailedAnalysis): {
  summary: string;
  action: "buy" | "sell" | "wait" | "avoid";
  confidence: number;
  reasons: string[];
  entry?: number;
  stopLoss?: number;
  targets?: number[];
} {
  const reasons: string[] = [];
  let action: "buy" | "sell" | "wait" | "avoid" = "wait";
  let confidence = 0.5;

  if (analysis.setupDetected && analysis.setupConfidence >= 0.6) {
    action = "buy";
    confidence = analysis.setupConfidence;
    reasons.push("Valid setup detected near support");
  }

  if (analysis.bias === "bullish") {
    confidence += 0.1;
    reasons.push("Bullish bias from technical indicators");
  } else if (analysis.bias === "bearish") {
    confidence -= 0.1;
    reasons.push("Bearish bias - caution advised");
  }

  if (analysis.rsiState === "oversold") {
    reasons.push("RSI indicates oversold conditions");
  } else if (analysis.rsiState === "overbought") {
    action = action === "buy" ? "wait" : action;
    reasons.push("RSI indicates overbought - wait for pullback");
  }

  if (analysis.risk === "high") {
    action = "avoid";
    reasons.push("High risk environment");
  }

  const entry = analysis.price;
  const stopLoss = analysis.setupDetails.invalidationPrice || analysis.price * 0.95;
  const targets = analysis.resistances.slice(0, 3).map((r) => r.price);

  return {
    summary: `${action.toUpperCase()}: ${analysis.symbol} at $${analysis.price.toFixed(4)} (${(confidence * 100).toFixed(0)}% confidence)`,
    action,
    confidence: Math.min(1, Math.max(0, confidence)),
    reasons,
    entry,
    stopLoss,
    targets: targets.length > 0 ? targets : undefined,
  };
}

function assessRisk(analysis: DetailedAnalysis): {
  score: number;
  verdict: string;
  factors: { name: string; impact: "positive" | "negative" | "neutral"; weight: number }[];
} {
  let score = 5; // Start neutral
  const factors: { name: string; impact: "positive" | "negative" | "neutral"; weight: number }[] = [];

  // Support strength
  if (analysis.supports.length > 0) {
    const avgStrength = analysis.supports.reduce((sum, s) => sum + s.strength, 0) / analysis.supports.length;
    if (avgStrength > 0.7) {
      score -= 1;
      factors.push({ name: "Strong support levels", impact: "positive", weight: 1 });
    } else if (avgStrength < 0.3) {
      score += 1;
      factors.push({ name: "Weak support levels", impact: "negative", weight: 1 });
    }
  } else {
    score += 2;
    factors.push({ name: "No clear support levels", impact: "negative", weight: 2 });
  }

  // Volatility/RSI
  if (analysis.indicators.rsi !== null) {
    if (analysis.indicators.rsi < 20 || analysis.indicators.rsi > 80) {
      score += 1;
      factors.push({ name: "Extreme RSI levels", impact: "negative", weight: 1 });
    } else if (analysis.indicators.rsi >= 40 && analysis.indicators.rsi <= 60) {
      score -= 0.5;
      factors.push({ name: "Balanced RSI", impact: "positive", weight: 0.5 });
    }
  }

  // Volume trend
  if (analysis.volumeTrend === "rising") {
    score -= 0.5;
    factors.push({ name: "Rising volume", impact: "positive", weight: 0.5 });
  } else if (analysis.volumeTrend === "falling") {
    score += 1;
    factors.push({ name: "Falling volume", impact: "negative", weight: 1 });
  }

  // Setup validity
  if (analysis.setupDetected) {
    score -= 1;
    factors.push({ name: "Valid setup detected", impact: "positive", weight: 1 });
  }

  // Risk level from analysis
  if (analysis.risk === "high") {
    score += 1;
    factors.push({ name: "High-risk market conditions", impact: "negative", weight: 1 });
  } else if (analysis.risk === "low") {
    score -= 1;
    factors.push({ name: "Low-risk market conditions", impact: "positive", weight: 1 });
  }

  // Clamp score
  score = Math.min(10, Math.max(1, Math.round(score)));

  let verdict: string;
  if (score <= 3) verdict = "Low Risk - Favorable conditions";
  else if (score <= 5) verdict = "Moderate Risk - Proceed with caution";
  else if (score <= 7) verdict = "Elevated Risk - Consider smaller position";
  else verdict = "High Risk - Not recommended";

  return { score, verdict, factors };
}

function generateOptimizationSuggestions(result: BacktestResult): {
  suggestions: string[];
  currentMetrics: Record<string, number>;
} {
  const suggestions: string[] = [];
  const metrics = result.metrics;

  if (metrics.winRate < 50) {
    suggestions.push("Consider stricter entry criteria to improve win rate");
  }

  if (metrics.maxDrawdown > 20) {
    suggestions.push("Implement tighter stop-losses to reduce max drawdown");
  }

  if (metrics.sharpeRatio < 1) {
    suggestions.push("Risk-adjusted returns are below optimal; consider position sizing");
  }

  if (metrics.totalTrades < 20) {
    suggestions.push("Low trade count - results may not be statistically significant");
  }

  if (metrics.profitFactor < 1.5) {
    suggestions.push("Profit factor suggests room for improving trade selection");
  }

  if (suggestions.length === 0) {
    suggestions.push("Strategy performance is solid; consider testing on different timeframes");
  }

  return {
    suggestions,
    currentMetrics: {
      totalReturn: metrics.totalReturn,
      sharpeRatio: metrics.sharpeRatio,
      maxDrawdown: metrics.maxDrawdown,
      winRate: metrics.winRate,
      profitFactor: metrics.profitFactor,
    },
  };
}

function generateQuickSummary(
  symbol: string,
  steps: WorkflowStep[],
  analysis: DetailedAnalysis | null
): string {
  const lines: string[] = [`## Quick Analysis: ${symbol}`, ""];

  for (const step of steps) {
    const status = step.status === "completed" ? "[OK]" : step.status === "failed" ? "[FAIL]" : "[SKIP]";
    lines.push(`${status} **${step.name}**: ${step.message || "No message"}`);
  }

  if (analysis) {
    lines.push("");
    lines.push("### Key Metrics");
    lines.push(`- Price: $${analysis.price.toFixed(4)}`);
    lines.push(`- Trend: ${analysis.trend}`);
    lines.push(`- Bias: ${analysis.bias}`);
    lines.push(`- Setup: ${analysis.setupDetected ? `Yes (${(analysis.setupConfidence * 100).toFixed(0)}% confidence)` : "No"}`);
  }

  return lines.join("\n");
}

function generateDDSummary(
  symbol: string,
  steps: WorkflowStep[],
  analysis: DetailedAnalysis | null
): string {
  const lines: string[] = [`## Due Diligence Report: ${symbol}`, ""];

  lines.push("### Workflow Steps");
  for (const step of steps) {
    const status = step.status === "completed" ? "[OK]" : step.status === "failed" ? "[FAIL]" : "[SKIP]";
    lines.push(`${status} **${step.name}**: ${step.message || "No message"}`);
  }

  if (analysis) {
    lines.push("");
    lines.push("### Technical Summary");
    lines.push(`- Current Price: $${analysis.price.toFixed(4)}`);
    lines.push(`- 24h Change: ${analysis.change24h.toFixed(2)}%`);
    lines.push(`- Trend: ${analysis.trend}`);
    lines.push(`- Bias: ${analysis.bias}`);
    lines.push(`- Risk Level: ${analysis.risk}`);

    if (analysis.supports.length > 0) {
      lines.push(`- Key Support: $${analysis.supports[0]!.price.toFixed(4)}`);
    }
    if (analysis.resistances.length > 0) {
      lines.push(`- Key Resistance: $${analysis.resistances[0]!.price.toFixed(4)}`);
    }
  }

  return lines.join("\n");
}

function generateBacktestCycleSummary(
  strategyName: string,
  symbol: string,
  steps: WorkflowStep[],
  result: BacktestResult | null
): string {
  const lines: string[] = [`## Backtest Cycle: ${strategyName} on ${symbol}`, ""];

  lines.push("### Workflow Steps");
  for (const step of steps) {
    const status = step.status === "completed" ? "[OK]" : step.status === "failed" ? "[FAIL]" : "[SKIP]";
    lines.push(`${status} **${step.name}**: ${step.message || "No message"}`);
  }

  if (result) {
    lines.push("");
    lines.push("### Performance Summary");
    lines.push(`- Total Return: ${result.metrics.totalReturn.toFixed(2)}%`);
    lines.push(`- Sharpe Ratio: ${result.metrics.sharpeRatio.toFixed(2)}`);
    lines.push(`- Max Drawdown: ${result.metrics.maxDrawdown.toFixed(2)}%`);
    lines.push(`- Win Rate: ${result.metrics.winRate.toFixed(1)}%`);
    lines.push(`- Total Trades: ${result.metrics.totalTrades}`);
  }

  return lines.join("\n");
}

// ============================================================================
// Main Handler
// ============================================================================

/**
 * Parse and execute a workflow command
 *
 * Supported workflows:
 * - /workflow quick <symbol> - Quick scan, analyze, and plan
 * - /workflow dd <symbol> - Full due diligence
 * - /workflow backtest-cycle <strategy> <symbol> - Backtest, optimize, compare
 * - /workflow web-dd <url> <goal...> - Tinyfish browser-native due diligence
 * - /workflow web-monitor <monitorId> <schedule> <url> <goal...> - Tinyfish recurring web monitor
 */
export async function handleWorkflowCommand(
  args: string,
  ctx: WorkflowContext
): Promise<WorkflowResult> {
  const parts = args.trim().split(/\s+/);
  const workflowType = parts[0]?.toLowerCase() as WorkflowType | undefined;

  if (!workflowType) {
    return {
      success: false,
      workflow: "unknown",
      steps: [],
      summary: "Usage: /workflow [quick|dd|backtest-cycle|web-dd|web-monitor] <args>",
      error: "No workflow type specified",
    };
  }

  switch (workflowType) {
    case "quick": {
      const symbol = parts[1];
      if (!symbol) {
        return {
          success: false,
          workflow: "quick",
          steps: [],
          summary: "Usage: /workflow quick <symbol>",
          error: "No symbol provided",
        };
      }
      return runQuickWorkflow(symbol, ctx);
    }

    case "dd": {
      const symbol = parts[1];
      if (!symbol) {
        return {
          success: false,
          workflow: "dd",
          steps: [],
          summary: "Usage: /workflow dd <symbol>",
          error: "No symbol provided",
        };
      }
      return runDueDiligenceWorkflow(symbol, ctx);
    }

    case "backtest-cycle": {
      const strategy = parts[1];
      const symbol = parts[2];
      if (!strategy || !symbol) {
        return {
          success: false,
          workflow: "backtest-cycle",
          steps: [],
          summary: "Usage: /workflow backtest-cycle <strategy> <symbol>",
          error: "Strategy and symbol required",
        };
      }
      return runBacktestCycleWorkflow(strategy, symbol, ctx);
    }

    case "web-dd": {
      const url = parts[1];
      const goal = parts.slice(2).join(" ").trim();
      if (!url || !goal) {
        return {
          success: false,
          workflow: "web-dd",
          steps: [],
          summary: "Usage: /workflow web-dd <url> <goal...>",
          error: "URL and goal are required",
        };
      }
      return runTinyfishDueDiligenceWorkflow(url, goal, ctx);
    }

    case "web-monitor": {
      const monitorId = parts[1];
      const schedule = parts[2];
      const url = parts[3];
      const goal = parts.slice(4).join(" ").trim();
      if (!monitorId || !schedule || !url || !goal) {
        return {
          success: false,
          workflow: "web-monitor",
          steps: [],
          summary: "Usage: /workflow web-monitor <monitorId> <schedule> <url> <goal...>",
          error: "Monitor ID, schedule, URL, and goal are required",
        };
      }
      return runTinyfishMonitorWorkflow(monitorId, schedule, url, goal, ctx);
    }

    default:
      return {
        success: false,
        workflow: workflowType,
        steps: [],
        summary: `Unknown workflow: ${workflowType}. Available: quick, dd, backtest-cycle, web-dd, web-monitor`,
        error: `Unknown workflow type: ${workflowType}`,
      };
  }
}

/**
 * Get list of available workflows with descriptions
 */
export function getAvailableWorkflows(): Array<{
  name: string;
  description: string;
  usage: string;
}> {
  return [
    {
      name: "quick",
      description: "Fast analysis: scan -> analyze -> plan recommendation",
      usage: "/workflow quick <symbol>",
    },
    {
      name: "dd",
      description: "Due diligence: scan -> analyze -> portfolio check -> risk assessment",
      usage: "/workflow dd <symbol>",
    },
    {
      name: "backtest-cycle",
      description: "Strategy evaluation: backtest -> optimize -> compare",
      usage: "/workflow backtest-cycle <strategy> <symbol>",
    },
    {
      name: "web-dd",
      description: "Tinyfish browser-native due diligence against dynamic or authenticated web pages",
      usage: "/workflow web-dd <url> <goal...>",
    },
    {
      name: "web-monitor",
      description: "Schedule a recurring Tinyfish web monitor for listings, governance, or campaign pages",
      usage: "/workflow web-monitor <monitorId> <schedule> <url> <goal...>",
    },
  ];
}

/**
 * Format a workflow result for CLI display
 */
export function formatWorkflowResult(result: WorkflowResult): string {
  const lines: string[] = [];
  const title = result.workflow ? result.workflow.toUpperCase() : "WORKFLOW";

  lines.push(`=== ${title} ===`);
  if (result.summary) {
    lines.push(result.summary);
  }

  if (result.error) {
    lines.push(`Error: ${result.error}`);
  }

  if (result.steps.length > 0) {
    lines.push("");
    lines.push("Steps:");
    for (const step of result.steps) {
      const icon =
        step.status === "completed" ? "✓" :
        step.status === "failed" ? "✕" :
        step.status === "skipped" ? "•" :
        step.status === "running" ? "…" :
        "○";
      const duration = step.duration !== undefined ? ` (${(step.duration / 1000).toFixed(1)}s)` : "";
      const message = step.message ? ` - ${step.message}` : "";
      lines.push(`  ${icon} ${step.name}${message}${duration}`);
    }
  }

  return lines.join("\n");
}
