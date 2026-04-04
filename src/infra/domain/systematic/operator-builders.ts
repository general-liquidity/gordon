import type { BacktestMetrics, BacktestResult } from "../../backtest/types.ts";
import type { PortfolioState, StrategySlot } from "../../core/runtime/types.ts";
import type {
  BiasDiagnosticSummary,
  DatasetRecord,
  DatasetSnapshotRecord,
  ResearchExperimentRecord,
  StrategyLifecycleEvent,
  StrategyPortfolioSummary,
  SystematicStrategyProfile,
  SystematicValidationSummary,
} from "./types.ts";
import {
  type OperatorAction,
  type OperatorDiff,
  type OperatorGate,
  type OperatorMetric,
  type OperatorReport,
  normalizeOperatorReport,
} from "./operator-report.ts";

function formatPercent(value: number, digits = 2): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function formatNumber(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "N/A";
}

function formatCurrency(value: number, digits = 2): string {
  return `$${value.toFixed(digits)}`;
}

function gateStatusFromValidation(status: "passed" | "warning" | "failed"): OperatorReport["status"] {
  switch (status) {
    case "passed":
      return "success";
    case "warning":
      return "warning";
    default:
      return "error";
  }
}

function toneForMetric(value: number, goodIfPositive = true): OperatorMetric["tone"] {
  if (!Number.isFinite(value)) return "info";
  if (value === 0) return "info";
  return goodIfPositive ? (value > 0 ? "success" : "warning") : (value < 0 ? "success" : "warning");
}

function mapValidationGate(
  gate: SystematicValidationSummary["gates"][number],
  biasDiagnostics?: BiasDiagnosticSummary,
): OperatorGate {
  const biasGate = gate.name === "bias_diagnostics" ? biasDiagnostics : undefined;
  return {
    name: gate.name,
    status: gate.passed ? "pass" : biasGate?.status === "warning" ? "warn" : "fail",
    score: gate.score,
    detail: gate.detail,
    blocker: !gate.passed && gate.name !== "walk_forward" && gate.name !== "monte_carlo",
  };
}

function buildValidationActions(
  validation: SystematicValidationSummary,
  profile?: SystematicStrategyProfile,
): OperatorAction[] {
  if (validation.liveEligible) {
    return [
      {
        label: "Promote to paper",
        command: `/runtime deploy ${validation.strategyId}`,
        priority: "now",
        rationale: "Validation is strong enough to move into paper or assisted runtime.",
      },
      {
        label: "Inspect systematic status",
        command: `/systematic status ${validation.strategyId}`,
        priority: "next",
      },
    ];
  }

  const failedGate = validation.gates.find((gate) => !gate.passed);
  const rationale = failedGate ? `Address ${failedGate.name} before promotion.` : "Run another validation pass.";

  return [
    {
      label: "Inspect validation blockers",
      command: `/validate ${validation.strategyId}`,
      priority: "now",
      rationale,
    },
    {
      label: "Run optimization",
      command: `/optimize ${validation.strategyId} ${profile?.marketFamily === "stocks" ? "AAPL" : "BTCUSDT"}`,
      priority: "next",
      rationale: "Tighten parameters before another validation cycle.",
    },
  ];
}

export function buildBacktestOperatorReport(params: {
  strategyName: string;
  symbol: string;
  timeframe: string;
  days: number;
  executionTime: number;
  result: BacktestResult;
  validation: SystematicValidationSummary;
  profile: SystematicStrategyProfile;
  biasDiagnostics?: BiasDiagnosticSummary;
}): OperatorReport {
  const { strategyName, symbol, timeframe, days, executionTime, result, validation, profile, biasDiagnostics } = params;
  const metrics: OperatorMetric[] = [
    { label: "Return", value: formatPercent(result.metrics.totalReturn), tone: toneForMetric(result.metrics.totalReturn) },
    { label: "Sharpe", value: formatNumber(result.metrics.sharpeRatio), tone: result.metrics.sharpeRatio >= 1 ? "success" : "warning" },
    { label: "Max Drawdown", value: formatPercent(-Math.abs(result.metrics.maxDrawdown)), tone: result.metrics.maxDrawdown <= 15 ? "success" : "warning" },
    { label: "Trades", value: String(result.metrics.totalTrades), tone: result.metrics.totalTrades >= 30 ? "success" : "warning" },
    { label: "Validation Score", value: formatNumber(validation.score, 1), tone: validation.liveEligible ? "success" : "warning" },
    { label: "Execution", value: `${executionTime}ms`, tone: "info" },
  ];

  const warnings = [
    ...result.warnings,
    ...result.systematic?.quality.warnings ?? [],
    ...biasDiagnostics?.notes ?? [],
  ];

  return normalizeOperatorReport({
    title: "Systematic Backtest Report",
    status: gateStatusFromValidation(validation.status),
    summary: `${strategyName} on ${symbol} ${timeframe} over ${days} days returned ${formatPercent(result.metrics.totalReturn)} with validation ${validation.status}. ${validation.liveEligible ? "Promotion is available." : "Promotion is blocked or conditional."}`,
    metrics,
    tables: [
      {
        title: "Trade Profile",
        columns: [
          { key: "metric", header: "Metric" },
          { key: "value", header: "Value", align: "right" },
        ],
        rows: [
          { metric: "Win Rate", value: formatPercent(result.metrics.winRate) },
          { metric: "Profit Factor", value: formatNumber(result.metrics.profitFactor) },
          { metric: "Expectancy", value: formatCurrency(result.metrics.expectancy) },
          { metric: "Avg Win", value: formatCurrency(result.metrics.averageWin) },
          { metric: "Avg Loss", value: formatCurrency(result.metrics.averageLoss) },
          { metric: "Decay Score", value: formatNumber(profile.decayScore, 1) },
        ],
      },
    ],
    gates: validation.gates.map((gate) => mapValidationGate(gate, biasDiagnostics)),
    warnings,
    actions: buildValidationActions(validation, profile),
  });
}

export function buildOptimizationOperatorReport(params: {
  strategyName: string;
  symbol: string;
  timeframe: string;
  optimizeFor: string;
  warnings?: string[];
  rankedResults: Array<{
    parameters: Record<string, unknown>;
    metrics: BacktestMetrics;
    score: number;
  }>;
  overfitSummary?: {
    overfitScore: number;
    severity: string;
    isLikelyOverfit: boolean;
  };
}): OperatorReport {
  const best = params.rankedResults[0];
  const topRows = params.rankedResults.slice(0, 10).map((result, index) => ({
    rank: String(index + 1),
    params: JSON.stringify(result.parameters),
    score: formatNumber(result.score, 3),
    sharpe: formatNumber(result.metrics.sharpeRatio),
    return: formatPercent(result.metrics.totalReturn),
    dd: formatPercent(-Math.abs(result.metrics.maxDrawdown)),
    trades: String(result.metrics.totalTrades),
  }));

  const warnings = [...(params.warnings ?? [])];
  if (params.overfitSummary?.isLikelyOverfit) {
    warnings.push(`Optimization appears overfit (${params.overfitSummary.severity}, score ${params.overfitSummary.overfitScore.toFixed(2)}).`);
  }

  return normalizeOperatorReport({
    title: "Optimization Ranking",
    status: params.overfitSummary?.isLikelyOverfit ? "warning" : "success",
    summary: best
      ? `${params.strategyName} on ${params.symbol} ${params.timeframe} ranked ${params.rankedResults.length} candidates by ${params.optimizeFor}. Best score ${formatNumber(best.score, 3)}.`
      : `No valid optimization candidates were produced for ${params.strategyName}.`,
    metrics: best ? [
      { label: "Best Score", value: formatNumber(best.score, 3), tone: "success" },
      { label: "Best Return", value: formatPercent(best.metrics.totalReturn), tone: toneForMetric(best.metrics.totalReturn) },
      { label: "Best Sharpe", value: formatNumber(best.metrics.sharpeRatio), tone: best.metrics.sharpeRatio >= 1 ? "success" : "warning" },
      { label: "Candidates", value: String(params.rankedResults.length), tone: "info" },
    ] : [],
    tables: topRows.length > 0 ? [{
      title: "Ranked Candidates",
      columns: [
        { key: "rank", header: "#" , align: "right"},
        { key: "params", header: "Parameters" },
        { key: "score", header: "Score", align: "right" },
        { key: "sharpe", header: "Sharpe", align: "right" },
        { key: "return", header: "Return", align: "right" },
        { key: "dd", header: "MaxDD", align: "right" },
        { key: "trades", header: "Trades", align: "right" },
      ],
      rows: topRows,
    }] : [],
    warnings,
    actions: [
      {
        label: "Validate top candidate",
        command: `/backtest ${params.strategyName} ${params.symbol} ${params.timeframe}`,
        priority: "now",
        rationale: "Confirm the leading configuration under the full validation gate set.",
      },
      {
        label: "Inspect experiment lineage",
        command: `/experiment rank ${params.strategyName}`,
        priority: "next",
      },
    ],
  });
}

export function buildComparisonOperatorReport(params: {
  symbol: string;
  timeframe: string;
  rankBy: string;
  rankings: Array<{
    rank: number;
    strategy: string;
    strategyId: string;
    metrics: BacktestMetrics;
    score: number;
  }>;
  buyAndHold?: {
    totalReturn: number;
    maxDrawdown: number;
  };
}): OperatorReport {
  const rows = params.rankings.slice(0, 10).map((ranking) => ({
    rank: String(ranking.rank),
    strategy: ranking.strategy,
    score: formatNumber(ranking.score, 3),
    return: formatPercent(ranking.metrics.totalReturn),
    sharpe: formatNumber(ranking.metrics.sharpeRatio),
    dd: formatPercent(-Math.abs(ranking.metrics.maxDrawdown)),
    trades: String(ranking.metrics.totalTrades),
  }));

  const winner = params.rankings[0];
  const diffs: OperatorDiff[] = [];
  if (winner && params.buyAndHold) {
    diffs.push({
      label: "Return vs Buy/Hold",
      baseline: formatPercent(params.buyAndHold.totalReturn),
      current: formatPercent(winner.metrics.totalReturn),
      delta: formatPercent(winner.metrics.totalReturn - params.buyAndHold.totalReturn),
      status: winner.metrics.totalReturn > params.buyAndHold.totalReturn ? "better" : "worse",
    });
    diffs.push({
      label: "Drawdown vs Buy/Hold",
      baseline: formatPercent(-Math.abs(params.buyAndHold.maxDrawdown)),
      current: formatPercent(-Math.abs(winner.metrics.maxDrawdown)),
      delta: formatPercent(params.buyAndHold.maxDrawdown - winner.metrics.maxDrawdown),
      status: winner.metrics.maxDrawdown < params.buyAndHold.maxDrawdown ? "better" : "worse",
    });
  }

  return normalizeOperatorReport({
    title: "Strategy Comparison",
    status: winner ? "success" : "warning",
    summary: winner
      ? `${winner.strategy} leads ${params.rankings.length} compared strategies on ${params.symbol} ${params.timeframe}, ranked by ${params.rankBy}.`
      : `No comparable strategies produced valid results on ${params.symbol}.`,
    metrics: winner ? [
      { label: "Winner", value: winner.strategy, tone: "success" },
      { label: "Winner Score", value: formatNumber(winner.score, 3), tone: "success" },
      { label: "Return", value: formatPercent(winner.metrics.totalReturn), tone: toneForMetric(winner.metrics.totalReturn) },
      { label: "Sharpe", value: formatNumber(winner.metrics.sharpeRatio), tone: winner.metrics.sharpeRatio >= 1 ? "success" : "warning" },
    ] : [],
    tables: rows.length > 0 ? [{
      title: "Rankings",
      columns: [
        { key: "rank", header: "#", align: "right" },
        { key: "strategy", header: "Strategy" },
        { key: "score", header: "Score", align: "right" },
        { key: "return", header: "Return", align: "right" },
        { key: "sharpe", header: "Sharpe", align: "right" },
        { key: "dd", header: "MaxDD", align: "right" },
        { key: "trades", header: "Trades", align: "right" },
      ],
      rows,
    }] : [],
    diffs,
    actions: winner ? [
      {
        label: "Inspect winner status",
        command: `/systematic status ${winner.strategyId}`,
        priority: "now",
      },
      {
        label: "Backtest winner again",
        command: `/backtest ${winner.strategyId} ${params.symbol} ${params.timeframe}`,
        priority: "next",
      },
    ] : [],
  });
}

export function buildRuntimeHealthOperatorReport(params: {
  portfolio: PortfolioState;
  actions: Array<{ type: string; slot_id?: string; reason: string; severity: "warning" | "critical" }>;
}): OperatorReport {
  const activeSlots = params.portfolio.slots.filter((slot) => slot.status !== "stopped");
  const rows = activeSlots.map((slot) => {
    const winRate = slot.total_trades > 0 ? (slot.winning_trades / slot.total_trades) * 100 : 0;
    return {
      slot: slot.playbook_name,
      status: slot.status,
      allocation: `${slot.allocated_percent.toFixed(1)}%`,
      pnl: formatCurrency(slot.total_pnl),
      trades: String(slot.total_trades),
      win: `${winRate.toFixed(1)}%`,
      dd: `${slot.current_drawdown_percent.toFixed(1)}%`,
    };
  });

  return normalizeOperatorReport({
    title: "Runtime Health",
    status: params.actions.some((action) => action.severity === "critical")
      ? "error"
      : params.actions.length > 0
        ? "warning"
        : "success",
    summary: `${activeSlots.length} active slot(s), ${formatCurrency(params.portfolio.total_pnl)} total PnL, portfolio drawdown ${params.portfolio.portfolio_drawdown_percent.toFixed(1)}%.`,
    metrics: [
      { label: "Active Slots", value: String(activeSlots.length), tone: "info" },
      { label: "Allocated", value: formatCurrency(params.portfolio.allocated_capital), tone: "info" },
      { label: "Deployed", value: formatCurrency(params.portfolio.deployed_capital), tone: "info" },
      { label: "Portfolio Drawdown", value: `${params.portfolio.portfolio_drawdown_percent.toFixed(1)}%`, tone: params.portfolio.portfolio_drawdown_percent <= 10 ? "success" : "warning" },
    ],
    tables: rows.length > 0 ? [{
      title: "Strategy Slots",
      columns: [
        { key: "slot", header: "Slot" },
        { key: "status", header: "Status" },
        { key: "allocation", header: "Alloc", align: "right" },
        { key: "pnl", header: "PnL", align: "right" },
        { key: "trades", header: "Trades", align: "right" },
        { key: "win", header: "Win", align: "right" },
        { key: "dd", header: "Drawdown", align: "right" },
      ],
      rows,
    }] : [],
    warnings: params.actions.map((action) => `${action.severity.toUpperCase()}: ${action.reason}${action.slot_id ? ` (${action.slot_id})` : ""}`),
    actions: [
      {
        label: "Inspect systematic portfolio",
        command: "/systematic portfolio",
        priority: "next",
      },
    ],
  });
}

export function buildLiveBacktestDiffReport(params: {
  strategyId: string;
  strategyName: string;
  slot?: StrategySlot | null;
  backtest?: BacktestResult | null;
  profile?: SystematicStrategyProfile | null;
}): OperatorReport {
  const liveWinRate = params.slot && params.slot.total_trades > 0
    ? (params.slot.winning_trades / params.slot.total_trades) * 100
    : null;
  const backtestWinRate = params.backtest ? params.backtest.metrics.winRate * 100 : null;
  const diffs: OperatorDiff[] = [];

  if (params.slot && params.backtest) {
    diffs.push({
      label: "Win Rate",
      baseline: `${backtestWinRate?.toFixed(1) ?? "N/A"}%`,
      current: `${liveWinRate?.toFixed(1) ?? "N/A"}%`,
      delta: liveWinRate !== null && backtestWinRate !== null ? formatPercent(liveWinRate - backtestWinRate) : undefined,
      status: liveWinRate !== null && backtestWinRate !== null
        ? liveWinRate >= backtestWinRate ? "better" : "worse"
        : "n/a",
    });
    diffs.push({
      label: "Drawdown",
      baseline: `${params.backtest.metrics.maxDrawdown.toFixed(1)}%`,
      current: `${params.slot.current_drawdown_percent.toFixed(1)}%`,
      delta: formatPercent(params.backtest.metrics.maxDrawdown - params.slot.current_drawdown_percent),
      status: params.slot.current_drawdown_percent <= params.backtest.metrics.maxDrawdown ? "better" : "worse",
    });
    diffs.push({
      label: "Trade Count",
      baseline: String(params.backtest.metrics.totalTrades),
      current: String(params.slot.total_trades),
      delta: String(params.slot.total_trades - params.backtest.metrics.totalTrades),
      status: "mixed",
    });
  }

  return normalizeOperatorReport({
    title: "Live vs Backtest",
    status: params.slot && params.backtest ? "info" : "warning",
    summary: params.slot && params.backtest
      ? `${params.strategyName} is running live with ${params.slot.total_trades} live trades against ${params.backtest.metrics.totalTrades} backtest trades in the latest systematic snapshot.`
      : `Gordon needs both a live slot and a stored backtest for ${params.strategyName} to produce a diff.`,
    metrics: [
      { label: "Strategy", value: params.strategyName, tone: "info" },
      { label: "Systematic Status", value: params.profile?.status ?? "untracked", tone: params.profile?.liveEligible ? "success" : "warning" },
      { label: "Decay Score", value: params.profile ? formatNumber(params.profile.decayScore, 1) : "N/A", tone: params.profile && params.profile.decayScore < 25 ? "success" : "warning" },
    ],
    diffs,
    actions: [
      {
        label: "Inspect runtime",
        command: "/runtime health",
        priority: "next",
      },
      {
        label: "Inspect strategy status",
        command: `/systematic status ${params.strategyId}`,
        priority: "next",
      },
    ],
  });
}

export function buildDecayOperatorReport(params: {
  profile?: SystematicStrategyProfile | null;
  lifecycle: StrategyLifecycleEvent[];
  validation?: SystematicValidationSummary | null;
}): OperatorReport {
  const profile = params.profile;
  return normalizeOperatorReport({
    title: "Decay Report",
    status: !profile ? "warning" : profile.decayScore >= 35 ? "warning" : "success",
    summary: profile
      ? `${profile.strategyName} has decay score ${profile.decayScore.toFixed(1)} and systematic status ${profile.status}.`
      : "No systematic profile exists for this strategy yet.",
    metrics: profile ? [
      { label: "Decay Score", value: formatNumber(profile.decayScore, 1), tone: profile.decayScore >= 35 ? "warning" : "success" },
      { label: "Validation Score", value: formatNumber(profile.validationScore, 1), tone: profile.liveEligible ? "success" : "warning" },
      { label: "Status", value: profile.status, tone: profile.status === "degraded" ? "warning" : "info" },
    ] : [],
    tables: params.lifecycle.length > 0 ? [{
      title: "Recent Lifecycle",
      columns: [
        { key: "event", header: "Event" },
        { key: "createdAt", header: "Created" },
      ],
      rows: params.lifecycle.slice(0, 8).map((event) => ({
        event: event.eventType,
        createdAt: event.createdAt,
      })),
    }] : [],
    warnings: profile?.decayScore && profile.decayScore >= 35
      ? ["Decay exceeds the degradation threshold. Revalidate or reduce capital allocation."]
      : [],
    actions: [
      {
        label: "Run another backtest",
        command: `/backtest ${profile?.strategyId ?? "strategy"} ${profile?.marketFamily === "stocks" ? "AAPL" : "BTCUSDT"}`,
        priority: "now",
      },
    ],
  });
}

export function buildDatasetInventoryReport(params: {
  datasets: DatasetRecord[];
  snapshots: DatasetSnapshotRecord[];
}): OperatorReport {
  return normalizeOperatorReport({
    title: "Dataset Inventory",
    status: params.datasets.length > 0 ? "success" : "warning",
    summary: `${params.datasets.length} dataset(s) and ${params.snapshots.length} snapshot(s) are available for systematic research.`,
    metrics: [
      { label: "Datasets", value: String(params.datasets.length), tone: "info" },
      { label: "Snapshots", value: String(params.snapshots.length), tone: "info" },
      { label: "Best Quality", value: params.datasets.length > 0 ? formatNumber(Math.max(...params.datasets.map((dataset) => dataset.quality.qualityScore)), 1) : "N/A", tone: "success" },
    ],
    tables: params.datasets.length > 0 ? [{
      title: "Datasets",
      columns: [
        { key: "symbol", header: "Symbol" },
        { key: "timeframe", header: "Timeframe" },
        { key: "marketFamily", header: "Market" },
        { key: "quality", header: "Quality", align: "right" },
        { key: "candles", header: "Candles", align: "right" },
        { key: "source", header: "Source" },
      ],
      rows: params.datasets.slice(0, 10).map((dataset) => ({
        symbol: dataset.symbol,
        timeframe: dataset.timeframe,
        marketFamily: dataset.marketFamily,
        quality: formatNumber(dataset.quality.qualityScore, 1),
        candles: String(dataset.candleCount),
        source: dataset.sourceId,
      })),
    }] : [],
    actions: [
      {
        label: "Inspect experiments",
        command: "/systematic experiments",
        priority: "next",
      },
    ],
  });
}

export function buildExperimentsReport(params: {
  experiments: ResearchExperimentRecord[];
}): OperatorReport {
  return normalizeOperatorReport({
    title: "Research Experiments",
    status: params.experiments.length > 0 ? "success" : "warning",
    summary: `${params.experiments.length} experiment(s) currently tracked in the systematic journal.`,
    metrics: [
      { label: "Experiments", value: String(params.experiments.length), tone: "info" },
      { label: "Validated", value: String(params.experiments.filter((experiment) => experiment.status === "validated").length), tone: "success" },
      { label: "Live", value: String(params.experiments.filter((experiment) => experiment.status === "live").length), tone: "info" },
    ],
    tables: params.experiments.length > 0 ? [{
      title: "Experiment Journal",
      columns: [
        { key: "strategy", header: "Strategy" },
        { key: "status", header: "Status" },
        { key: "hypothesis", header: "Hypothesis" },
        { key: "updatedAt", header: "Updated" },
      ],
      rows: params.experiments.slice(0, 10).map((experiment) => ({
        strategy: experiment.strategyName,
        status: experiment.status,
        hypothesis: experiment.hypothesis,
        updatedAt: experiment.updatedAt,
      })),
    }] : [],
    actions: [
      {
        label: "Open A/B workflow",
        command: "/experiment list",
        priority: "next",
      },
    ],
  });
}

export function buildLifecycleReport(params: {
  strategyId: string;
  lifecycle: StrategyLifecycleEvent[];
}): OperatorReport {
  return normalizeOperatorReport({
    title: "Lifecycle Log",
    status: params.lifecycle.length > 0 ? "info" : "warning",
    summary: `${params.lifecycle.length} lifecycle event(s) recorded for ${params.strategyId}.`,
    tables: params.lifecycle.length > 0 ? [{
      title: "Recent Events",
      columns: [
        { key: "eventType", header: "Event" },
        { key: "createdAt", header: "Created" },
      ],
      rows: params.lifecycle.slice(0, 15).map((event) => ({
        eventType: event.eventType,
        createdAt: event.createdAt,
      })),
    }] : [],
    actions: [
      {
        label: "Inspect systematic status",
        command: `/systematic status ${params.strategyId}`,
        priority: "next",
      },
    ],
  });
}

export function buildPortfolioOperatorReport(summary: StrategyPortfolioSummary): OperatorReport {
  return normalizeOperatorReport({
    title: "Systematic Portfolio",
    status: summary.concentrationRisk === "high" ? "warning" : "success",
    summary: `${summary.entries.length} strategy profile(s), diversification score ${summary.diversificationScore.toFixed(1)}, concentration risk ${summary.concentrationRisk}.`,
    metrics: [
      { label: "Strategies", value: String(summary.entries.length), tone: "info" },
      { label: "Capital Weight", value: formatNumber(summary.totalCapitalWeight * 100, 1) + "%", tone: "info" },
      { label: "Diversification", value: formatNumber(summary.diversificationScore, 1), tone: summary.diversificationScore >= 60 ? "success" : "warning" },
    ],
    tables: summary.entries.length > 0 ? [{
      title: "Portfolio Entries",
      columns: [
        { key: "strategyName", header: "Strategy" },
        { key: "marketFamily", header: "Market" },
        { key: "status", header: "Status" },
        { key: "validationScore", header: "Validation", align: "right" },
        { key: "capitalWeight", header: "Weight", align: "right" },
        { key: "estimatedCorrelation", header: "Corr", align: "right" },
      ],
      rows: summary.entries.slice(0, 10).map((entry) => ({
        strategyName: entry.strategyName,
        marketFamily: entry.marketFamily,
        status: entry.status,
        validationScore: formatNumber(entry.validationScore, 1),
        capitalWeight: `${(entry.capitalWeight * 100).toFixed(1)}%`,
        estimatedCorrelation: formatNumber(entry.estimatedCorrelation, 2),
      })),
    }] : [],
    warnings: summary.notes,
    actions: [
      {
        label: "Inspect runtime health",
        command: "/runtime health",
        priority: "next",
      },
    ],
  });
}

export function buildStrategyStatusReport(params: {
  strategyId: string;
  profile?: SystematicStrategyProfile | null;
  validation?: SystematicValidationSummary | null;
  experiments: ResearchExperimentRecord[];
  lifecycle: StrategyLifecycleEvent[];
}): OperatorReport {
  const profile = params.profile;
  return normalizeOperatorReport({
    title: "Systematic Strategy Status",
    status: !profile ? "warning" : profile.liveEligible ? "success" : profile.validationStatus === "warning" ? "warning" : "error",
    summary: profile
      ? `${profile.strategyName} is ${profile.status} with validation ${profile.validationStatus} (${profile.validationScore.toFixed(1)}).`
      : `No systematic profile exists for ${params.strategyId}.`,
    metrics: profile ? [
      { label: "Market", value: profile.marketFamily, tone: "info" },
      { label: "Validation", value: formatNumber(profile.validationScore, 1), tone: profile.liveEligible ? "success" : "warning" },
      { label: "Decay", value: formatNumber(profile.decayScore, 1), tone: profile.decayScore < 25 ? "success" : "warning" },
      { label: "Return Driver", value: profile.returnDriver, tone: "info" },
    ] : [],
    gates: params.validation?.gates.map((gate) => ({
      name: gate.name,
      status: gate.passed ? "pass" : "fail",
      score: gate.score,
      detail: gate.detail,
      blocker: !gate.passed,
    })) ?? [],
    tables: [
      ...(params.experiments.length > 0 ? [{
        title: "Recent Experiments",
        columns: [
          { key: "id", header: "Experiment" },
          { key: "status", header: "Status" },
          { key: "updated", header: "Updated" },
        ],
        rows: params.experiments.slice(0, 5).map((experiment) => ({
          id: experiment.experimentId,
          status: experiment.status,
          updated: experiment.updatedAt,
        })),
      }] : []),
      ...(params.lifecycle.length > 0 ? [{
        title: "Recent Lifecycle",
        columns: [
          { key: "event", header: "Event" },
          { key: "created", header: "Created" },
        ],
        rows: params.lifecycle.slice(0, 5).map((event) => ({
          event: event.eventType,
          created: event.createdAt,
        })),
      }] : []),
    ],
    actions: [
      {
        label: "Inspect decay",
        command: `/decay ${params.strategyId}`,
        priority: "next",
      },
    ],
  });
}
