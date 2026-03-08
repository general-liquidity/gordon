import { v4 as uuidv4 } from "uuid";

import type { GordonConfig } from "../../types/index.ts";
import type { HistoricalFetchMetadata } from "../../backtest/data/historical.ts";
import { runMonteCarloSimulation } from "../../backtest/monte-carlo.ts";
import { detectOverfitting, type OptimizationEntry } from "../../backtest/optimization/overfitting.ts";
import type { BacktestMetrics, BacktestResult, OHLC, Trade } from "../../backtest/types.ts";
import { walkForwardTest } from "../../backtest/walk-forward.ts";
import type { Strategy } from "../../strategies/types.ts";
import { createModuleLogger } from "../logger/index.ts";
import {
  getDatasetRecord,
  getDatasetSnapshot,
  getValidationRun,
  getLatestValidationForStrategy,
  getStrategyProfile,
  listDatasetRecords,
  listDatasetSnapshots,
  listResearchExperiments,
  listStrategyLifecycleEvents,
  listStrategyProfiles,
  saveDatasetRecord,
  saveDatasetSnapshot,
  saveResearchExperiment,
  saveStrategyLifecycleEvent,
  saveValidationRun,
  upsertStrategyProfile,
} from "./store.ts";
import type {
  BiasDiagnosticCheck,
  BiasDiagnosticSummary,
  DatasetQualityReport,
  DatasetRecord,
  DatasetSnapshotRecord,
  MarketFamily,
  ResearchExperimentRecord,
  SimulationRealismProfile,
  StrategyPortfolioEntry,
  StrategyPortfolioSummary,
  SystematicStrategyProfile,
  SystematicValidationSummary,
  ValidationGateResult,
} from "./types.ts";

const logger = createModuleLogger("systematic-service");

const TIMEFRAME_MS: Record<string, number> = {
  "1m": 60 * 1000,
  "3m": 3 * 60 * 1000,
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "30m": 30 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "2h": 2 * 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "8h": 8 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000,
};

export interface ProcessSystematicBacktestInput {
  strategyId: string;
  strategyName: string;
  strategy?: Strategy;
  candles: OHLC[];
  backtestResult: BacktestResult;
  fetchMetadata: HistoricalFetchMetadata;
  config?: GordonConfig;
  parameterRanges?: Record<string, number[]>;
  hypothesis?: string;
  notes?: string;
}

export interface ProcessSystematicBacktestResult {
  dataset: DatasetRecord;
  snapshot?: DatasetSnapshotRecord;
  validation: SystematicValidationSummary;
  profile: SystematicStrategyProfile;
  experiment?: ResearchExperimentRecord;
}

function nowIso(): string {
  return new Date().toISOString();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function timeframeMs(timeframe: string): number {
  return TIMEFRAME_MS[timeframe] ?? TIMEFRAME_MS["1h"]!;
}

function mapTradesForMonteCarlo(trades: BacktestResult["trades"]): Trade[] {
  return trades.map((trade) => ({
    id: trade.id,
    side: trade.side,
    entryPrice: trade.entryPrice,
    entryTime: new Date(trade.entryTime).getTime(),
    exitPrice: trade.exitPrice,
    exitTime: new Date(trade.exitTime).getTime(),
    quantity: trade.quantity,
    grossPnL: trade.pnl + trade.fees,
    commission: trade.fees,
    netPnL: trade.pnl,
    returnPct: trade.pnlPercent,
    holdingPeriod: Math.max(1, Math.round((new Date(trade.exitTime).getTime() - new Date(trade.entryTime).getTime()) / timeframeMs("1h"))),
    exitReason: trade.exitReason,
  }));
}

export function scoreDatasetQuality(
  candles: OHLC[],
  timeframe: string,
  startTime: number,
  endTime: number,
): DatasetQualityReport {
  const intervalMs = timeframeMs(timeframe);
  const actualCandles = candles.length;
  const expectedCandles = Math.max(
    actualCandles,
    Math.max(1, Math.floor((Math.max(endTime, startTime + intervalMs) - startTime) / intervalMs)),
  );

  let gapCount = 0;
  let duplicateCount = 0;
  for (let i = 1; i < candles.length; i += 1) {
    const current = candles[i];
    const previous = candles[i - 1];
    if (!current || !previous) continue;
    const delta = current.timestamp - previous.timestamp;
    if (delta <= 0) {
      duplicateCount += 1;
      continue;
    }
    if (delta > intervalMs * 1.5) {
      gapCount += 1;
    }
  }

  const coveragePercent = clamp((actualCandles / expectedCandles) * 100, 0, 100);
  const stale = Date.now() - endTime > intervalMs * 20;
  const warnings: string[] = [];
  if (coveragePercent < 95) warnings.push("Dataset coverage is incomplete.");
  if (gapCount > 0) warnings.push(`Detected ${gapCount} candle gap(s).`);
  if (duplicateCount > 0) warnings.push(`Detected ${duplicateCount} duplicate candle(s).`);
  if (stale) warnings.push("Historical dataset is stale relative to the requested end time.");

  const qualityScore = clamp(
    coveragePercent - gapCount * 4 - duplicateCount * 8 - (stale ? 10 : 0),
    0,
    100,
  );

  return {
    qualityScore,
    coveragePercent,
    expectedCandles,
    actualCandles,
    gapCount,
    duplicateCount,
    stale,
    warnings,
  };
}

function inferReturnDriver(strategyId: string, strategyName: string): string {
  const label = `${strategyId} ${strategyName}`.toLowerCase();
  if (label.includes("mean")) return "mean_reversion";
  if (label.includes("grid") || label.includes("dca")) return "inventory_rebalancing";
  if (label.includes("breakout") || label.includes("momentum")) return "momentum";
  if (label.includes("trend")) return "trend_following";
  if (label.includes("arb")) return "arbitrage";
  if (label.includes("carry")) return "carry";
  return "directional";
}

function inferRegimeTag(timeframe: string, metrics: BacktestMetrics): string {
  if (metrics.maxDrawdown > 25) return "high_volatility";
  if (metrics.sharpeRatio >= 1.5) return "stable_trend";
  if (timeframe.endsWith("m") || timeframe === "1h") return "short_horizon";
  return "swing";
}

export function buildSimulationRealismProfile(config?: GordonConfig): SimulationRealismProfile {
  const realism = config?.systematic?.simulationRealism;
  return {
    profile: realism?.profile ?? "realistic",
    executionLagBars: realism?.executionLagBars ?? 1,
    spreadBps: realism?.spreadBps ?? 2,
    marketImpactBps: realism?.marketImpactBps ?? 1,
  };
}

function computeTradePnlConcentration(trades: BacktestResult["trades"]): number {
  const positivePnl = trades
    .map((trade) => Math.max(0, trade.pnl))
    .filter((pnl) => pnl > 0)
    .sort((left, right) => right - left);

  const totalPositivePnl = positivePnl.reduce((sum, pnl) => sum + pnl, 0);
  if (totalPositivePnl <= 0) return 0;

  const topPositivePnl = positivePnl.slice(0, 3).reduce((sum, pnl) => sum + pnl, 0);
  return (topPositivePnl / totalPositivePnl) * 100;
}

export function buildBiasDiagnostics(params: {
  config?: GordonConfig;
  quality: DatasetQualityReport;
  metrics: BacktestMetrics;
  trades: BacktestResult["trades"];
  startDate: string;
  endDate: string;
  walkForward?: Awaited<ReturnType<typeof walkForwardTest>>;
  monteCarlo?: Awaited<ReturnType<typeof runMonteCarloSimulation>>;
  overfitting?: ReturnType<typeof detectOverfitting>;
}): BiasDiagnosticSummary {
  const settings = params.config?.systematic?.biasDiagnostics;
  const minTrades = params.config?.systematic?.minTradesForPromotion ?? 30;
  const minBacktestDays = settings?.minBacktestDays ?? 90;
  const minOosWindows = settings?.minOutOfSampleWindows ?? 3;
  const maxTradePnlConcentrationPercent = settings?.maxTradePnlConcentrationPercent ?? 55;
  const maxCagrPercent = settings?.maxCagrPercent ?? 300;
  const requireWalkForward = settings?.requireWalkForward ?? true;
  const requireMonteCarlo = settings?.requireMonteCarlo ?? true;

  const days = Math.max(
    1,
    Math.round((new Date(params.endDate).getTime() - new Date(params.startDate).getTime()) / (24 * 60 * 60 * 1000)),
  );
  const tradeConcentration = computeTradePnlConcentration(params.trades);

  const checks: BiasDiagnosticCheck[] = [];

  checks.push({
    name: "sample_size",
    status: params.metrics.totalTrades >= minTrades ? "passed" : "failed",
    score: clamp((params.metrics.totalTrades / minTrades) * 100, 0, 100),
    detail: `${params.metrics.totalTrades} trades vs required minimum ${minTrades}.`,
    blocker: params.metrics.totalTrades < minTrades,
  });

  checks.push({
    name: "dataset_integrity",
    status: params.quality.qualityScore >= 70 ? "passed" : "failed",
    score: params.quality.qualityScore,
    detail: `Quality ${params.quality.qualityScore.toFixed(1)}/100 with ${params.quality.gapCount} gaps and ${params.quality.duplicateCount} duplicates.`,
    blocker: params.quality.qualityScore < 70,
  });

  checks.push({
    name: "backtest_horizon",
    status: days >= minBacktestDays ? "passed" : "warning",
    score: clamp((days / minBacktestDays) * 100, 0, 100),
    detail: `${days} day horizon vs preferred minimum ${minBacktestDays} days.`,
    blocker: false,
  });

  checks.push({
    name: "walk_forward_oos",
    status: !requireWalkForward
      ? "passed"
      : !params.walkForward
        ? "failed"
        : params.walkForward.windows.length >= minOosWindows
          ? "passed"
          : "failed",
    score: !params.walkForward ? 0 : clamp((params.walkForward.windows.length / minOosWindows) * 100, 0, 100),
    detail: params.walkForward
      ? `${params.walkForward.windows.length} out-of-sample window(s) with verdict ${params.walkForward.stability.verdict}.`
      : "Walk-forward validation missing.",
    blocker: requireWalkForward && (!params.walkForward || params.walkForward.windows.length < minOosWindows),
  });

  checks.push({
    name: "monte_carlo_coverage",
    status: !requireMonteCarlo
      ? "passed"
      : !params.monteCarlo
        ? "failed"
        : params.monteCarlo.riskMetrics.riskOfRuin <= 0.2
          ? "passed"
          : "warning",
    score: !params.monteCarlo ? 0 : clamp((1 - params.monteCarlo.riskMetrics.riskOfRuin) * 100, 0, 100),
    detail: params.monteCarlo
      ? `Risk of ruin ${(params.monteCarlo.riskMetrics.riskOfRuin * 100).toFixed(1)}%.`
      : "Monte Carlo validation missing.",
    blocker: requireMonteCarlo && !params.monteCarlo,
  });

  checks.push({
    name: "trade_pnl_concentration",
    status: tradeConcentration <= maxTradePnlConcentrationPercent
      ? "passed"
      : tradeConcentration <= maxTradePnlConcentrationPercent + 10
        ? "warning"
        : "failed",
    score: clamp(100 - Math.max(0, tradeConcentration - maxTradePnlConcentrationPercent) * 2, 0, 100),
    detail: `Top 3 trades contribute ${tradeConcentration.toFixed(1)}% of winning PnL.`,
    blocker: tradeConcentration > maxTradePnlConcentrationPercent + 10,
  });

  checks.push({
    name: "cagr_sanity",
    status: params.metrics.cagr <= maxCagrPercent ? "passed" : "failed",
    score: params.metrics.cagr <= maxCagrPercent ? 100 : clamp(100 - (params.metrics.cagr - maxCagrPercent) / 5, 0, 100),
    detail: `CAGR ${params.metrics.cagr.toFixed(1)}% vs max expected ${maxCagrPercent.toFixed(1)}%.`,
    blocker: params.metrics.cagr > maxCagrPercent,
  });

  checks.push({
    name: "overfitting_risk",
    status: !params.overfitting
      ? "warning"
      : params.overfitting.isLikelyOverfit
        ? "failed"
        : params.overfitting.severity === "moderate"
          ? "warning"
          : "passed",
    score: !params.overfitting ? 50 : clamp(100 - (params.overfitting.overfitScore - 1) * 35, 0, 100),
    detail: params.overfitting
      ? `Overfit score ${params.overfitting.overfitScore.toFixed(2)} (${params.overfitting.severity}).`
      : "No overfitting analysis available.",
    blocker: Boolean(params.overfitting?.isLikelyOverfit),
  });

  const blockerCount = checks.filter((check) => check.blocker && check.status === "failed").length;
  const warningCount = checks.filter((check) => check.status === "warning").length;
  const status: BiasDiagnosticSummary["status"] = blockerCount > 0
    ? "failed"
    : warningCount > 0
      ? "warning"
      : "passed";
  const notes = checks
    .filter((check) => check.status !== "passed")
    .map((check) => `${check.name}: ${check.detail}`);
  const score = checks.reduce((sum, check) => sum + check.score, 0) / checks.length;

  return {
    status,
    score,
    blockerCount,
    warningCount,
    checks,
    notes,
  };
}

function buildValidationGates(params: {
  config?: GordonConfig;
  quality: DatasetQualityReport;
  metrics: BacktestMetrics;
  walkForward?: Awaited<ReturnType<typeof walkForwardTest>>;
  monteCarlo?: Awaited<ReturnType<typeof runMonteCarloSimulation>>;
  overfittingScore?: ReturnType<typeof detectOverfitting>;
  biasDiagnostics?: BiasDiagnosticSummary;
}): ValidationGateResult[] {
  const minTrades = params.config?.systematic?.minTradesForPromotion ?? 30;
  const qualityScore = params.quality.qualityScore;
  const sharpeScore = clamp(((params.metrics.sharpeRatio + 0.5) / 2.5) * 100, 0, 100);
  const drawdownScore = clamp(100 - params.metrics.maxDrawdown * 2.5, 0, 100);
  const tradeScore = clamp((params.metrics.totalTrades / minTrades) * 100, 0, 100);
  const walkForwardScore = params.walkForward?.stability.robustnessScore ?? 50;
  const monteCarloScore = params.monteCarlo?.robustness.score ?? 50;
  const overfittingScore = params.overfittingScore
    ? clamp(100 - (params.overfittingScore.overfitScore - 1) * 35, 0, 100)
    : 60;
  const biasScore = params.biasDiagnostics?.score ?? 50;

  return [
    {
      name: "dataset_quality",
      passed: qualityScore >= 70,
      score: qualityScore,
      detail: `Quality ${qualityScore.toFixed(1)}/100 with ${params.quality.coveragePercent.toFixed(1)}% coverage.`,
    },
    {
      name: "minimum_trades",
      passed: params.metrics.totalTrades >= minTrades,
      score: tradeScore,
      detail: `${params.metrics.totalTrades} trades vs minimum ${minTrades}.`,
    },
    {
      name: "risk_adjusted_return",
      passed: params.metrics.sharpeRatio >= 0.5,
      score: sharpeScore,
      detail: `Sharpe ratio ${params.metrics.sharpeRatio.toFixed(2)}.`,
    },
    {
      name: "drawdown_control",
      passed: params.metrics.maxDrawdown <= 30,
      score: drawdownScore,
      detail: `Max drawdown ${params.metrics.maxDrawdown.toFixed(2)}%.`,
    },
    {
      name: "walk_forward",
      passed: !params.walkForward || !["poor", "unreliable"].includes(params.walkForward.stability.verdict),
      score: walkForwardScore,
      detail: params.walkForward
        ? `Walk-forward verdict ${params.walkForward.stability.verdict}.`
        : "Walk-forward skipped.",
    },
    {
      name: "monte_carlo",
      passed: !params.monteCarlo || !["poor", "unreliable"].includes(params.monteCarlo.robustness.verdict),
      score: monteCarloScore,
      detail: params.monteCarlo
        ? `Monte Carlo verdict ${params.monteCarlo.robustness.verdict}, risk of ruin ${(params.monteCarlo.riskMetrics.riskOfRuin * 100).toFixed(1)}%.`
        : "Monte Carlo skipped.",
    },
    {
      name: "overfitting",
      passed: !params.overfittingScore || !params.overfittingScore.isLikelyOverfit,
      score: overfittingScore,
      detail: params.overfittingScore
        ? `Overfit score ${params.overfittingScore.overfitScore.toFixed(2)} (${params.overfittingScore.severity}).`
        : "Overfitting check skipped.",
    },
    {
      name: "bias_diagnostics",
      passed: !params.biasDiagnostics || params.biasDiagnostics.status !== "failed",
      score: biasScore,
      detail: params.biasDiagnostics
        ? `Bias diagnostics ${params.biasDiagnostics.status} with ${params.biasDiagnostics.blockerCount} blocker(s) and ${params.biasDiagnostics.warningCount} warning(s).`
        : "Bias diagnostics skipped.",
    },
  ];
}

function computeValidationSummary(params: {
  strategyId: string;
  strategyName: string;
  marketFamily: MarketFamily;
  config?: GordonConfig;
  quality: DatasetQualityReport;
  metrics: BacktestMetrics;
  walkForward?: Awaited<ReturnType<typeof walkForwardTest>>;
  monteCarlo?: Awaited<ReturnType<typeof runMonteCarloSimulation>>;
  overfitting?: ReturnType<typeof detectOverfitting>;
  biasDiagnostics?: BiasDiagnosticSummary;
  datasetId?: string;
  datasetSnapshotId?: string;
  backtestResultId?: string;
}): SystematicValidationSummary & {
  datasetId?: string;
  datasetSnapshotId?: string;
  backtestResultId?: string;
  marketFamily: MarketFamily;
} {
  const gates = buildValidationGates({
    config: params.config,
    quality: params.quality,
    metrics: params.metrics,
    walkForward: params.walkForward,
    monteCarlo: params.monteCarlo,
    overfittingScore: params.overfitting,
    biasDiagnostics: params.biasDiagnostics,
  });

  const score = gates.reduce((sum, gate) => sum + gate.score, 0) / gates.length;
  const minValidationScore = params.config?.systematic?.minValidationScore ?? 60;
  const passedCount = gates.filter((gate) => gate.passed).length;
  const hasHardFailure = gates.some(
    (gate) => ["minimum_trades", "dataset_quality", "risk_adjusted_return", "bias_diagnostics"].includes(gate.name) && !gate.passed,
  );

  const status = hasHardFailure
    ? "failed"
    : score >= minValidationScore && passedCount === gates.length
      ? "passed"
      : "warning";

  const liveEligible = !hasHardFailure && score >= minValidationScore && passedCount >= gates.length - 1;

  return {
    validationId: uuidv4(),
    strategyId: params.strategyId,
    strategyName: params.strategyName,
    status,
    score,
    liveEligible,
    gates,
    walkForwardSummary: params.walkForward
      ? {
          avgReturn: params.walkForward.aggregatedMetrics.avgReturn,
          avgSharpeRatio: params.walkForward.aggregatedMetrics.avgSharpeRatio,
          totalTrades: params.walkForward.aggregatedMetrics.totalTrades,
          verdict: params.walkForward.stability.verdict,
        }
      : undefined,
    monteCarloSummary: params.monteCarlo
      ? {
          robustnessScore: params.monteCarlo.robustness.score,
          verdict: params.monteCarlo.robustness.verdict,
          profitProbability: params.monteCarlo.scenarios.profitProbability,
          riskOfRuin: params.monteCarlo.riskMetrics.riskOfRuin,
        }
      : undefined,
    overfittingSummary: params.overfitting
      ? {
          overfitScore: params.overfitting.overfitScore,
          severity: params.overfitting.severity,
          isLikelyOverfit: params.overfitting.isLikelyOverfit,
        }
      : undefined,
    biasDiagnostics: params.biasDiagnostics,
    createdAt: nowIso(),
    datasetId: params.datasetId,
    datasetSnapshotId: params.datasetSnapshotId,
    backtestResultId: params.backtestResultId,
    marketFamily: params.marketFamily,
  };
}

function computeDecayScore(
  previous: Pick<BacktestMetrics, "totalReturn" | "sharpeRatio" | "maxDrawdown" | "winRate" | "totalTrades"> | undefined,
  current: Pick<BacktestMetrics, "totalReturn" | "sharpeRatio" | "maxDrawdown" | "winRate" | "totalTrades">,
): number {
  if (!previous) return 0;

  const returnDecay = Math.max(0, previous.totalReturn - current.totalReturn) / Math.max(Math.abs(previous.totalReturn), 1) * 100;
  const sharpeDecay = Math.max(0, previous.sharpeRatio - current.sharpeRatio) / Math.max(Math.abs(previous.sharpeRatio), 0.5) * 100;
  const drawdownDecay = Math.max(0, current.maxDrawdown - previous.maxDrawdown) * 2;
  const winRateDecay = Math.max(0, previous.winRate - current.winRate);

  return clamp(returnDecay * 0.35 + sharpeDecay * 0.35 + drawdownDecay * 0.2 + winRateDecay * 0.1, 0, 100);
}

function estimateCapitalWeight(validationScore: number, liveEligible: boolean): number {
  if (!liveEligible) return 0;
  return clamp(0.05 + validationScore / 1000, 0.05, 0.25);
}

function estimateMaxAllocation(validationScore: number, liveEligible: boolean): number {
  if (!liveEligible) return 0.1;
  return clamp(0.1 + validationScore / 500, 0.1, 0.35);
}

export async function processSystematicBacktest(
  input: ProcessSystematicBacktestInput,
): Promise<ProcessSystematicBacktestResult> {
  const timestamp = nowIso();
  const realism = buildSimulationRealismProfile(input.config);
  const quality = scoreDatasetQuality(
    input.candles,
    input.fetchMetadata.timeframe,
    input.fetchMetadata.startTime,
    input.fetchMetadata.endTime,
  );

  const datasetId = `${input.fetchMetadata.sourceId}:${input.fetchMetadata.symbol}:${input.fetchMetadata.timeframe}:${input.fetchMetadata.startTime}:${input.fetchMetadata.endTime}`;
  const dataset: DatasetRecord = {
    datasetId,
    kind: "raw_ohlc",
    marketFamily: input.fetchMetadata.marketFamily,
    symbol: input.fetchMetadata.symbol,
    timeframe: input.fetchMetadata.timeframe,
    sourceId: input.fetchMetadata.sourceId,
    sourceKind: input.fetchMetadata.sourceKind,
    startTime: input.fetchMetadata.startTime,
    endTime: input.fetchMetadata.endTime,
    candleCount: input.fetchMetadata.candleCount,
    quality,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  saveDatasetRecord(dataset);
  saveStrategyLifecycleEvent({
    eventId: uuidv4(),
    strategyId: input.strategyId,
    eventType: "dataset_registered",
    payload: { datasetId: dataset.datasetId, symbol: dataset.symbol, timeframe: dataset.timeframe },
    createdAt: timestamp,
  });

  let snapshot: DatasetSnapshotRecord | undefined;
  if (input.config?.systematic?.autoSnapshotDatasets ?? true) {
    snapshot = {
      snapshotId: uuidv4(),
      datasetId: dataset.datasetId,
      startTime: dataset.startTime,
      endTime: dataset.endTime,
      candleCount: dataset.candleCount,
      createdAt: timestamp,
      metadata: {
        sourceId: dataset.sourceId,
        sourceKind: dataset.sourceKind,
        marketFamily: dataset.marketFamily,
      },
    };
    saveDatasetSnapshot(snapshot, input.candles);
  }

  let walkForward: Awaited<ReturnType<typeof walkForwardTest>> | undefined;
  if (input.strategy && input.candles.length >= 200) {
    try {
      walkForward = await walkForwardTest(input.strategy, input.candles, {
        trainRatio: 0.7,
        numWindows: 3,
        parameterRanges: input.parameterRanges ?? {},
        optimizeFor: "sharpeRatio",
      });
    } catch (error) {
      logger.warn("Walk-forward validation skipped", {
        strategyId: input.strategyId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  let monteCarlo: Awaited<ReturnType<typeof runMonteCarloSimulation>> | undefined;
  if (input.backtestResult.trades.length >= 10) {
    try {
      monteCarlo = await runMonteCarloSimulation(mapTradesForMonteCarlo(input.backtestResult.trades), {
        iterations: 250,
        initialCapital: input.backtestResult.metrics.initialValue,
      });
    } catch (error) {
      logger.warn("Monte Carlo validation skipped", {
        strategyId: input.strategyId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  let overfitting: ReturnType<typeof detectOverfitting> | undefined;
  if (walkForward && walkForward.windows.length > 0) {
    const optimizationEntries: OptimizationEntry[] = walkForward.windows.map((window) => ({
      parameters: window.optimizedParams,
      metrics: window.testMetrics,
      score: window.testMetrics.sharpeRatio,
    }));
    overfitting = detectOverfitting(optimizationEntries, { metric: "sharpeRatio" });
  }

  const biasDiagnostics = buildBiasDiagnostics({
    config: input.config,
    quality,
    metrics: input.backtestResult.metrics,
    trades: input.backtestResult.trades,
    startDate: input.backtestResult.startDate,
    endDate: input.backtestResult.endDate,
    walkForward,
    monteCarlo,
    overfitting,
  });

  const validation = computeValidationSummary({
    strategyId: input.strategyId,
    strategyName: input.strategyName,
    marketFamily: input.fetchMetadata.marketFamily,
    config: input.config,
    quality,
    metrics: input.backtestResult.metrics,
    walkForward,
    monteCarlo,
    overfitting,
    biasDiagnostics,
    datasetId: dataset.datasetId,
    datasetSnapshotId: snapshot?.snapshotId,
    backtestResultId: input.backtestResult.id,
  });
  saveValidationRun(validation);
  saveStrategyLifecycleEvent({
    eventId: uuidv4(),
    strategyId: input.strategyId,
    eventType: "validation_recorded",
    payload: { validationId: validation.validationId, status: validation.status, score: validation.score },
    createdAt: timestamp,
  });

  const existingProfile = getStrategyProfile(input.strategyId);
  const currentMetrics = {
    totalReturn: input.backtestResult.metrics.totalReturn,
    sharpeRatio: input.backtestResult.metrics.sharpeRatio,
    maxDrawdown: input.backtestResult.metrics.maxDrawdown,
    winRate: input.backtestResult.metrics.winRate,
    totalTrades: input.backtestResult.metrics.totalTrades,
  };
  const decayScore = computeDecayScore(existingProfile?.lastMetrics, currentMetrics);

  const nextStatus: SystematicStrategyProfile["status"] = decayScore >= 35
    ? "degraded"
    : validation.liveEligible
      ? "validated"
      : validation.status === "warning"
        ? "research"
        : "research";

  const profile: SystematicStrategyProfile = {
    strategyId: input.strategyId,
    strategyName: input.strategyName,
    marketFamily: input.fetchMetadata.marketFamily,
    status: nextStatus,
    validationStatus: validation.status,
    validationScore: validation.score,
    returnDriver: existingProfile?.returnDriver ?? inferReturnDriver(input.strategyId, input.strategyName),
    regimeTag: existingProfile?.regimeTag ?? inferRegimeTag(input.fetchMetadata.timeframe, input.backtestResult.metrics),
    capitalWeight: existingProfile?.capitalWeight ?? estimateCapitalWeight(validation.score, validation.liveEligible),
    maxAllocation: existingProfile?.maxAllocation ?? estimateMaxAllocation(validation.score, validation.liveEligible),
    latestDatasetId: dataset.datasetId,
    latestDatasetSnapshotId: snapshot?.snapshotId,
    latestBacktestResultId: input.backtestResult.id,
    latestValidationId: validation.validationId,
    liveEligible: validation.liveEligible,
    lastMetrics: currentMetrics,
    decayScore,
    createdAt: existingProfile?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  upsertStrategyProfile(profile);

  if (decayScore >= 35) {
    saveStrategyLifecycleEvent({
      eventId: uuidv4(),
      strategyId: input.strategyId,
      eventType: "degraded",
      payload: { decayScore, previousMetrics: existingProfile?.lastMetrics, currentMetrics },
      createdAt: timestamp,
    });
  }

  let experiment: ResearchExperimentRecord | undefined;
  if (input.config?.systematic?.autoCreateResearchExperiments ?? true) {
    experiment = {
      experimentId: uuidv4(),
      strategyId: input.strategyId,
      strategyName: input.strategyName,
      hypothesis: input.hypothesis ?? `Validate ${input.strategyName} on ${input.fetchMetadata.symbol} ${input.fetchMetadata.timeframe}.`,
      notes: input.notes ?? `Validation score ${validation.score.toFixed(1)} with ${input.backtestResult.metrics.totalTrades} trades.`,
      datasetId: dataset.datasetId,
      datasetSnapshotId: snapshot?.snapshotId,
      backtestResultId: input.backtestResult.id,
      validationId: validation.validationId,
      status: validation.liveEligible ? "validated" : "research",
      tags: [
        input.fetchMetadata.marketFamily,
        input.fetchMetadata.symbol,
        input.fetchMetadata.timeframe,
        profile.returnDriver,
        realism.profile,
      ],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    saveResearchExperiment(experiment);
    saveStrategyLifecycleEvent({
      eventId: uuidv4(),
      strategyId: input.strategyId,
      eventType: "experiment_logged",
      payload: { experimentId: experiment.experimentId, status: experiment.status },
      createdAt: timestamp,
    });
  }

  return { dataset, snapshot, validation, profile, experiment };
}

export function buildSystematicPortfolioSummary(): StrategyPortfolioSummary {
  const profiles = listStrategyProfiles();
  const entries: StrategyPortfolioEntry[] = profiles.map((profile) => {
    const similarProfiles = profiles.filter((candidate) =>
      candidate.strategyId !== profile.strategyId
      && (
        candidate.returnDriver === profile.returnDriver
        || candidate.regimeTag === profile.regimeTag
        || candidate.marketFamily === profile.marketFamily
      )
    );

    const estimatedCorrelation = clamp(
      (similarProfiles.length > 0 ? 0.35 : 0.15)
      + (profiles.filter((candidate) => candidate.returnDriver === profile.returnDriver).length - 1) * 0.1
      + (profiles.filter((candidate) => candidate.regimeTag === profile.regimeTag).length - 1) * 0.08,
      0,
      0.95,
    );

    return {
      strategyId: profile.strategyId,
      strategyName: profile.strategyName,
      marketFamily: profile.marketFamily,
      status: profile.status,
      validationScore: profile.validationScore,
      capitalWeight: profile.capitalWeight,
      maxAllocation: profile.maxAllocation,
      returnDriver: profile.returnDriver,
      regimeTag: profile.regimeTag,
      estimatedCorrelation,
      diversificationContribution: clamp(profile.capitalWeight * (1 - estimatedCorrelation), 0, 1),
    };
  });

  const totalCapitalWeight = entries.reduce((sum, entry) => sum + entry.capitalWeight, 0);
  const diversificationScore = entries.length === 0
    ? 0
    : clamp(
        (entries.reduce((sum, entry) => sum + entry.diversificationContribution, 0) / entries.length) * 100,
        0,
        100,
      );

  const maxWeight = entries.length > 0 ? Math.max(...entries.map((entry) => entry.capitalWeight)) : 0;
  const avgCorrelation = entries.length > 0
    ? entries.reduce((sum, entry) => sum + entry.estimatedCorrelation, 0) / entries.length
    : 0;

  const concentrationRisk = maxWeight > 0.35 || avgCorrelation > 0.7
    ? "high"
    : maxWeight > 0.2 || avgCorrelation > 0.5
      ? "medium"
      : "low";

  const notes: string[] = [];
  if (entries.length === 0) notes.push("No validated systematic strategies are registered yet.");
  if (concentrationRisk === "high") notes.push("Capital allocation is concentrated across similar drivers or regimes.");
  if (entries.filter((entry) => entry.marketFamily === "stocks").length === 0) notes.push("No stock systematic strategies are currently represented.");
  if (entries.filter((entry) => entry.marketFamily === "crypto").length === 0) notes.push("No crypto systematic strategies are currently represented.");

  return {
    portfolioId: "systematic-default",
    entries,
    totalCapitalWeight,
    diversificationScore,
    concentrationRisk,
    notes,
  };
}

export function promoteStrategyProfile(
  strategyId: string,
  status: "paper" | "live",
  options: { reason?: string; override?: boolean } = {},
): SystematicStrategyProfile | null {
  const existing = getStrategyProfile(strategyId);
  if (!existing) return null;

  const timestamp = nowIso();
  const next: SystematicStrategyProfile = {
    ...existing,
    status,
    updatedAt: timestamp,
  };
  upsertStrategyProfile(next);
  saveStrategyLifecycleEvent({
    eventId: uuidv4(),
    strategyId,
    eventType: status === "live" ? "promoted_to_live" : "promoted_to_paper",
    payload: {
      reason: options.reason ?? null,
      override: options.override ?? false,
      validationScore: existing.validationScore,
    },
    createdAt: timestamp,
  });
  return next;
}

export function recordSystematicOverride(
  strategyId: string,
  payload: Record<string, unknown>,
): void {
  saveStrategyLifecycleEvent({
    eventId: uuidv4(),
    strategyId,
    eventType: "override",
    payload,
    createdAt: nowIso(),
  });
}

export function getSystematicStrategyStatus(strategyId: string): {
  profile: SystematicStrategyProfile | null;
  latestValidation: SystematicValidationSummary | null;
  experiments: ReturnType<typeof listResearchExperiments>;
  lifecycle: ReturnType<typeof listStrategyLifecycleEvents>;
} {
  return {
    profile: getStrategyProfile(strategyId),
    latestValidation: getLatestValidationForStrategy(strategyId),
    experiments: listResearchExperiments(strategyId),
    lifecycle: listStrategyLifecycleEvents(strategyId),
  };
}

export {
  getDatasetRecord,
  getDatasetSnapshot,
  getValidationRun,
  listDatasetRecords,
  listDatasetSnapshots,
  listResearchExperiments,
  listStrategyProfiles,
};
