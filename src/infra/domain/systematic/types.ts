import type { BacktestMetrics } from "../../../backtest/types.ts";

export type MarketFamily = "crypto" | "stocks";
export type DatasetKind = "raw_ohlc";
export type SystematicExecutionMode = "assisted" | "semi_systematic" | "strict_systematic";
export type ValidationStatus = "passed" | "warning" | "failed";
export type BiasDiagnosticStatus = "passed" | "warning" | "failed";
export type SystematicStrategyStatus =
  | "research"
  | "validated"
  | "paper"
  | "live"
  | "degraded"
  | "retired";

export interface SimulationRealismProfile {
  profile: "baseline" | "realistic" | "conservative";
  executionLagBars: number;
  spreadBps: number;
  marketImpactBps: number;
}

export interface DatasetQualityReport {
  qualityScore: number;
  coveragePercent: number;
  expectedCandles: number;
  actualCandles: number;
  gapCount: number;
  duplicateCount: number;
  stale: boolean;
  warnings: string[];
}

export interface DatasetRecord {
  datasetId: string;
  kind: DatasetKind;
  marketFamily: MarketFamily;
  symbol: string;
  timeframe: string;
  sourceId: string;
  sourceKind: "exchange" | "broker" | "cache";
  startTime: number;
  endTime: number;
  candleCount: number;
  quality: DatasetQualityReport;
  createdAt: string;
  updatedAt: string;
}

export interface DatasetSnapshotRecord {
  snapshotId: string;
  datasetId: string;
  startTime: number;
  endTime: number;
  candleCount: number;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface ValidationGateResult {
  name: string;
  passed: boolean;
  score: number;
  detail: string;
}

export interface BiasDiagnosticCheck {
  name: string;
  status: BiasDiagnosticStatus;
  score: number;
  detail: string;
  blocker: boolean;
}

export interface BiasDiagnosticSummary {
  status: BiasDiagnosticStatus;
  score: number;
  blockerCount: number;
  warningCount: number;
  checks: BiasDiagnosticCheck[];
  notes: string[];
}

export interface SystematicValidationSummary {
  validationId: string;
  strategyId: string;
  strategyName: string;
  status: ValidationStatus;
  score: number;
  liveEligible: boolean;
  gates: ValidationGateResult[];
  walkForwardSummary?: {
    avgReturn: number;
    avgSharpeRatio: number;
    totalTrades: number;
    verdict: string;
  };
  monteCarloSummary?: {
    robustnessScore: number;
    verdict: string;
    profitProbability: number;
    riskOfRuin: number;
  };
  overfittingSummary?: {
    overfitScore: number;
    severity: string;
    isLikelyOverfit: boolean;
  };
  biasDiagnostics?: BiasDiagnosticSummary;
  createdAt: string;
}

export interface ResearchExperimentRecord {
  experimentId: string;
  strategyId: string;
  strategyName: string;
  hypothesis: string;
  notes: string;
  datasetId?: string;
  datasetSnapshotId?: string;
  backtestResultId?: string;
  validationId?: string;
  status: "research" | "validated" | "paper" | "live" | "archived";
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SystematicStrategyProfile {
  strategyId: string;
  strategyName: string;
  marketFamily: MarketFamily;
  status: SystematicStrategyStatus;
  validationStatus: ValidationStatus;
  validationScore: number;
  returnDriver: string;
  regimeTag: string;
  capitalWeight: number;
  maxAllocation: number;
  latestDatasetId?: string;
  latestDatasetSnapshotId?: string;
  latestBacktestResultId?: string;
  latestValidationId?: string;
  liveEligible: boolean;
  lastMetrics?: Pick<BacktestMetrics, "totalReturn" | "sharpeRatio" | "maxDrawdown" | "winRate" | "totalTrades">;
  decayScore: number;
  createdAt: string;
  updatedAt: string;
}

export interface StrategyLifecycleEvent {
  eventId: string;
  strategyId: string;
  eventType:
    | "dataset_registered"
    | "validation_recorded"
    | "experiment_logged"
    | "promoted_to_paper"
    | "promoted_to_live"
    | "degraded"
    | "retired"
    | "override";
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface StrategyPortfolioEntry {
  strategyId: string;
  strategyName: string;
  marketFamily: MarketFamily;
  status: SystematicStrategyStatus;
  validationScore: number;
  capitalWeight: number;
  maxAllocation: number;
  returnDriver: string;
  regimeTag: string;
  estimatedCorrelation: number;
  diversificationContribution: number;
}

export interface StrategyPortfolioSummary {
  portfolioId: string;
  entries: StrategyPortfolioEntry[];
  totalCapitalWeight: number;
  diversificationScore: number;
  concentrationRisk: "low" | "medium" | "high";
  notes: string[];
}

export interface SystematicBacktestMetadata {
  datasetId: string;
  datasetSnapshotId?: string;
  validationId?: string;
  researchExperimentId?: string;
  sourceId: string;
  sourceKind: "exchange" | "broker" | "cache";
  marketFamily: MarketFamily;
  quality: DatasetQualityReport;
  realism?: SimulationRealismProfile;
}
