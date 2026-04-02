import { calculateAllocationPercent, calculateRiskReward } from "../core/validator.ts";
import type { Plan } from "../types/plan.ts";
import type { DeskTone } from "./components/desk/DeskPanel.tsx";
import { getRuntimeApprovalShortId } from "./runtimeApprovalId.ts";
import type { WorkspaceBoardRowViewModel, WorkspaceBoardViewInput } from "./workspaceTypes.ts";

export interface WorkspaceSurfaceSection {
  id: string;
  actions: string[];
}

export interface MarketWorkspaceTableRow {
  symbol: string;
  price: string;
  change24h: string;
  bias: string;
  setup: string;
  risk: string;
  tone?: DeskTone;
}

export interface MarketWorkspaceFocusModel {
  title: string;
  subtitle: string;
  tone: DeskTone;
  actions: string[];
  rows: WorkspaceBoardRowViewModel[];
  notes: string[];
}

export interface MarketWorkspaceContextModel {
  title: string;
  subtitle: string;
  tone: DeskTone;
  actions: string[];
  rows: WorkspaceBoardRowViewModel[];
}

export interface MarketWorkspaceSurfaceModel {
  workspace: "market";
  title: string;
  subtitle: string;
  sections: WorkspaceSurfaceSection[];
  shortlist: {
    title: string;
    subtitle: string;
    tone: DeskTone;
    actions: string[];
    activeSymbol?: string;
    rows: MarketWorkspaceTableRow[];
    emptyTitle: string;
    emptyDetail: string;
  };
  focus: MarketWorkspaceFocusModel;
  context: MarketWorkspaceContextModel;
}

export interface PlanWorkspaceBookRow {
  symbol: string;
  status: string;
  strategy: string;
  allocation: string;
  entry: string;
  planId: string;
  tone?: DeskTone;
}

export interface PlanWorkspaceApprovalRow {
  id: string;
  tool: string;
  summary: string;
  detail: string;
  tone?: DeskTone;
}

export interface PlanWorkspaceTicketModel {
  title: string;
  subtitle: string;
  tone: DeskTone;
  actions: string[];
  statusLabel: string;
  thesis?: string;
  metrics: Array<{
    label: string;
    value: string;
    tone?: DeskTone;
  }>;
  ladder: string[];
  emptyTitle?: string;
  emptyDetail?: string;
}

export interface PlanWorkspaceRiskModel {
  title: string;
  subtitle: string;
  tone: DeskTone;
  actions: string[];
  rows: WorkspaceBoardRowViewModel[];
}

export interface PlanWorkspaceApprovalModel {
  title: string;
  subtitle: string;
  tone: DeskTone;
  actions: string[];
  mode: string;
  route: string;
  rows: PlanWorkspaceApprovalRow[];
}

export interface PlanWorkspaceBookModel {
  title: string;
  subtitle: string;
  tone: DeskTone;
  actions: string[];
  rows: PlanWorkspaceBookRow[];
  counts: {
    draft: number;
    approved: number;
    executing: number;
  };
}

export interface PlanWorkspaceSurfaceModel {
  workspace: "plan";
  title: string;
  subtitle: string;
  sections: WorkspaceSurfaceSection[];
  ticket: PlanWorkspaceTicketModel;
  approvals: PlanWorkspaceApprovalModel;
  risk: PlanWorkspaceRiskModel;
  book: PlanWorkspaceBookModel;
}

export interface LabWorkspaceBenchRow {
  id: string;
  name: string;
  source: string;
  risk: string;
  signal: string;
  tone?: DeskTone;
}

export interface LabWorkspaceRegistryRow {
  id: string;
  name: string;
  kind: string;
  risk: string;
  frame: string;
  tone?: DeskTone;
}

export interface LabWorkspaceQueueRow {
  name: string;
  status: string;
  source: string;
  reference: string;
  tone?: DeskTone;
}

export interface LabWorkspaceSurfaceModel {
  workspace: "lab";
  title: string;
  subtitle: string;
  sections: WorkspaceSurfaceSection[];
  bench: {
    title: string;
    subtitle: string;
    tone: DeskTone;
    actions: string[];
    rows: LabWorkspaceBenchRow[];
    activeId?: string;
    emptyTitle: string;
    emptyDetail: string;
  };
  validation: {
    title: string;
    subtitle: string;
    tone: DeskTone;
    actions: string[];
    rows: WorkspaceBoardRowViewModel[];
    notes?: string[];
  };
  systematic: {
    title: string;
    subtitle: string;
    tone: DeskTone;
    actions: string[];
    rows: WorkspaceBoardRowViewModel[];
    notes?: string[];
  };
  registry: {
    title: string;
    subtitle: string;
    tone: DeskTone;
    actions: string[];
    rows: LabWorkspaceRegistryRow[];
  };
  queue: {
    title: string;
    subtitle: string;
    tone: DeskTone;
    actions: string[];
    rows: LabWorkspaceQueueRow[];
  };
}

export interface MonitorWorkspaceBookRow {
  symbol: string;
  quantity: string;
  value: string;
  venue: string;
  tone?: DeskTone;
}

export interface MonitorWorkspaceBlotterRow {
  lane: string;
  symbol: string;
  status: string;
  exposure: string;
  note: string;
  tone?: DeskTone;
}

export interface MonitorWorkspaceAlertRow {
  heading: string;
  status: string;
  note: string;
  tone?: DeskTone;
}

export interface MonitorWorkspaceSurfaceModel {
  workspace: "monitor";
  title: string;
  subtitle: string;
  sections: WorkspaceSurfaceSection[];
  book: {
    title: string;
    subtitle: string;
    tone: DeskTone;
    actions: string[];
    rows: MonitorWorkspaceBookRow[];
  };
  runtime: {
    title: string;
    subtitle: string;
    tone: DeskTone;
    actions: string[];
    rows: WorkspaceBoardRowViewModel[];
  };
  blotter: {
    title: string;
    subtitle: string;
    tone: DeskTone;
    actions: string[];
    rows: MonitorWorkspaceBlotterRow[];
  };
  alerts: {
    title: string;
    subtitle: string;
    tone: DeskTone;
    actions: string[];
    rows: MonitorWorkspaceAlertRow[];
  };
}

export type WorkspaceSurfaceViewModel =
  | MarketWorkspaceSurfaceModel
  | PlanWorkspaceSurfaceModel
  | LabWorkspaceSurfaceModel
  | MonitorWorkspaceSurfaceModel;

function formatNumber(value: number, digits: number = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "N/A";
}

function formatCurrency(value: number): string {
  return `$${formatNumber(value)}`;
}

function formatSignedPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value)}%`;
}

function formatSignedCurrency(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}$${formatNumber(value)}`;
}

function formatPercent(value: number): string {
  return `${formatNumber(value * 100, 1)}%`;
}

function formatDistancePercent(value: number): string {
  return `${formatNumber(value * 100, 1)}%`;
}

function titleCase(value: string): string {
  return value
    .split(/[_\s-]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function pickString(value: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return undefined;
}

function buildRailsLabel(input: WorkspaceBoardViewInput): string {
  const rails = [
    input.hasExchange ? "exchange" : null,
    input.hasBroker ? "broker" : null,
    input.hasWalletRails ? "wallet rails" : null,
    input.hasMcpServers ? "mcp" : null,
  ].filter(Boolean);

  return rails.length > 0 ? rails.join(" · ") : "no live rails configured";
}

function getFocusedPlan(input: WorkspaceBoardViewInput): Plan | undefined {
  const selectedPlanId = input.workspaceMemory.plan.selectedPlanId;
  if (selectedPlanId) {
    const match = input.plans.find((plan) => plan.id === selectedPlanId);
    if (match) {
      return match;
    }
  }

  const focusSymbol = input.workspaceMemory.plan.focusSymbol;
  if (focusSymbol) {
    const match = input.plans.find((plan) => plan.symbol === focusSymbol);
    if (match) {
      return match;
    }
  }

  return input.plans[0];
}

function getFocusedLabStrategy(input: WorkspaceBoardViewInput): {
  label: string;
  source: string;
  subtitle: string;
  id: string;
  rows: WorkspaceBoardRowViewModel[];
} | null {
  const selectedStrategyId = input.workspaceMemory.lab.selectedStrategyId;
  const selectedSource = input.workspaceMemory.lab.selectedSource;

  if (selectedStrategyId && selectedSource === "generated") {
    const strategy = input.strategyInventory.generatedStrategies.find((entry) => entry.id === selectedStrategyId);
    if (strategy) {
      return {
        label: strategy.name,
        source: "Generated",
        subtitle: `${strategy.id}${strategy.timeframes?.length ? ` · ${strategy.timeframes.join(", ")}` : ""}`,
        id: strategy.id,
        rows: [
          strategy.riskLevel ? { label: "Risk", value: titleCase(strategy.riskLevel), tone: "warning" } : null,
          strategy.backtestReturn !== undefined
            ? { label: "Return", value: formatSignedPercent(strategy.backtestReturn), tone: strategy.backtestReturn >= 0 ? "success" : "danger" }
            : null,
          strategy.backtestSharpe !== undefined
            ? { label: "Sharpe", value: formatNumber(strategy.backtestSharpe), tone: strategy.backtestSharpe >= 1 ? "success" : "warning" }
            : null,
        ].filter(Boolean) as WorkspaceBoardRowViewModel[],
      };
    }
  }

  if (selectedStrategyId && selectedSource === "playbook") {
    const playbook = input.strategyInventory.playbooks.find((entry) => entry.id === selectedStrategyId);
    if (playbook) {
      return {
        label: playbook.name,
        source: "Playbook",
        subtitle: `${playbook.id} · ${playbook.timeframes.join(", ")}`,
        id: playbook.id,
        rows: [
          { label: "Risk", value: titleCase(playbook.riskLevel), tone: "warning" },
          { label: "Timeframes", value: playbook.timeframes.join(", "), tone: "info" },
        ],
      };
    }
  }

  if (selectedStrategyId && selectedSource === "systematic") {
    const profile = input.strategyInventory.systematicProfiles.find((entry) => entry.strategyId === selectedStrategyId);
    if (profile) {
      return {
        label: profile.strategyName,
        source: "Systematic",
        subtitle: `${profile.strategyId} · ${titleCase(profile.marketFamily)}`,
        id: profile.strategyId,
        rows: [
          { label: "Status", value: titleCase(profile.status), tone: profile.liveEligible ? "success" : "warning" },
          { label: "Validation", value: `${formatNumber(profile.validationScore, 1)}/100`, tone: "analysis" },
          { label: "Capital", value: formatPercent(profile.capitalWeight), tone: "operate" },
        ],
      };
    }
  }

  const builtIn = selectedStrategyId
    ? input.strategyInventory.builtInStrategies.find((entry) => entry.id === selectedStrategyId)
    : input.strategyInventory.builtInStrategies[0];
  if (builtIn) {
    return {
      label: builtIn.name,
      source: "Built-in",
      subtitle: `${builtIn.id} · ${builtIn.timeframes.join(", ")}`,
      id: builtIn.id,
      rows: [
        { label: "Risk", value: titleCase(builtIn.riskLevel), tone: "warning" },
        { label: "Timeframes", value: builtIn.timeframes.join(", "), tone: "info" },
      ],
    };
  }

  return null;
}

function extractBacktestSummary(
  backtest: WorkspaceBoardViewInput["lastResults"]["backtest"],
  workflow: WorkspaceBoardViewInput["lastResults"]["workflowSummary"],
): {
  title: string;
  subtitle: string;
  rows: WorkspaceBoardRowViewModel[];
} | null {
  const metrics = (
    backtest?.result
    && typeof backtest.result === "object"
    && backtest.result !== null
    && "metrics" in backtest.result
    && typeof (backtest.result as { metrics?: unknown }).metrics === "object"
    && (backtest.result as { metrics?: unknown }).metrics !== null
  )
    ? ((backtest.result as { metrics: Record<string, unknown> }).metrics)
    : null;

  if (metrics) {
    const totalReturn = typeof metrics.totalReturn === "number" ? metrics.totalReturn : null;
    const sharpeRatio = typeof metrics.sharpeRatio === "number" ? metrics.sharpeRatio : null;
    const maxDrawdown = typeof metrics.maxDrawdown === "number" ? metrics.maxDrawdown : null;
    const totalTrades = typeof metrics.totalTrades === "number" ? metrics.totalTrades : null;

    return {
      title: "Last backtest",
      subtitle: backtest?.summary ?? backtest?.formattedSummary ?? "Most recent validated test run.",
      rows: [
        totalReturn !== null
          ? { label: "Return", value: formatSignedPercent(totalReturn), tone: totalReturn >= 0 ? "success" : "danger" }
          : null,
        sharpeRatio !== null
          ? { label: "Sharpe", value: formatNumber(sharpeRatio), tone: sharpeRatio >= 1 ? "success" : "warning" }
          : null,
        maxDrawdown !== null
          ? { label: "Drawdown", value: `${formatNumber(maxDrawdown)}%`, tone: maxDrawdown <= 20 ? "success" : "warning" }
          : null,
        totalTrades !== null
          ? { label: "Trades", value: String(totalTrades), tone: "info" }
          : null,
      ].filter(Boolean) as WorkspaceBoardRowViewModel[],
    };
  }

  if (workflow?.workflow === "backtest-cycle") {
    return {
      title: "Last workflow",
      subtitle: workflow.summary,
      rows: workflow.steps.slice(0, 4).map((step) => ({
        label: step.name,
        value: titleCase(step.status),
        detail: step.message,
        tone: step.status === "completed" ? "success" : step.status === "failed" ? "danger" : "info",
      })),
    };
  }

  return null;
}

function buildMarketSurface(input: WorkspaceBoardViewInput): MarketWorkspaceSurfaceModel {
  const scan = input.lastResults.scan;
  const analysis = input.lastResults.analysis;
  const regime = input.lastResults.regime;
  const workflow = input.lastResults.workflowSummary;
  const focusSymbol = input.workspaceMemory.market.focusSymbol;
  const regimeLabel = regime && typeof regime === "object"
    ? pickString(regime, ["regime", "currentRegime", "marketRegime", "state", "label"])
    : undefined;

  const shortlistRows: MarketWorkspaceTableRow[] = scan?.opportunities?.slice(0, 8).map((opportunity) => ({
    symbol: opportunity.symbol,
    price: formatCurrency(opportunity.price),
    change24h: formatSignedPercent(opportunity.change24h),
    bias: titleCase(opportunity.bias),
    setup: `${formatNumber(opportunity.setupConfidence * 100, 0)}%`,
    risk: titleCase(opportunity.risk),
    tone: opportunity.setupConfidence >= 0.7 ? "success" : "analysis",
  })) ?? [];

  const focusRows: WorkspaceBoardRowViewModel[] = analysis?.symbol
    ? [
        analysis.price !== undefined ? { label: "Price", value: formatCurrency(analysis.price), tone: "info" } : null,
        analysis.trend ? { label: "Trend", value: titleCase(analysis.trend), tone: "analysis" } : null,
        analysis.setupDetected !== undefined ? {
          label: "Setup",
          value: analysis.setupDetected
            ? `Detected ${(analysis.setupConfidence ?? 0) * 100}%`
            : "No active setup",
          tone: analysis.setupDetected ? "success" : "warning",
        } : null,
        analysis.indicators?.rsi !== undefined && analysis.indicators?.rsi !== null ? {
          label: "RSI",
          value: formatNumber(analysis.indicators.rsi, 1),
          detail: analysis.indicators.macdState
            ? `MACD ${analysis.indicators.macdState}${analysis.indicators.volumeTrend ? ` · volume ${analysis.indicators.volumeTrend}` : ""}`
            : undefined,
          tone: "info",
        } : null,
        analysis.supports?.[0] ? {
          label: "Support",
          value: formatCurrency(analysis.supports[0].price),
          detail: `Strength ${formatNumber(analysis.supports[0].strength, 2)}`,
          tone: "success",
        } : null,
        analysis.resistances?.[0] ? {
          label: "Resistance",
          value: formatCurrency(analysis.resistances[0].price),
          detail: `Strength ${formatNumber(analysis.resistances[0].strength, 2)}`,
          tone: "warning",
        } : null,
      ].filter(Boolean) as WorkspaceBoardRowViewModel[]
    : [
        {
          label: "Focus",
          value: focusSymbol ?? "No symbol in focus",
          detail: focusSymbol
            ? "Run a full analysis to turn the pinned symbol into a live dossier."
            : "Scan the market or analyze a symbol to populate the dossier.",
          tone: "warning",
        },
      ];

  const focusNotes = analysis?.formattedSummary
    ? [analysis.formattedSummary]
    : focusSymbol
      ? [`${focusSymbol} is pinned from the last market action.`]
      : ["The dossier becomes useful once one symbol is promoted out of the tape."];

  const contextRows: WorkspaceBoardRowViewModel[] = [
    {
      label: "Rails",
      value: buildRailsLabel(input),
      detail: "Discovery is strongest when venue data and research rails are both available.",
      tone: "neutral",
    },
  ];

  if (regimeLabel) {
    contextRows.unshift({
      label: "Regime",
      value: titleCase(regimeLabel),
      detail: "Translate conditions into the right time horizon before sizing risk.",
      tone: "analysis",
    });
  }

  if (workflow && ["quick", "dd"].includes(workflow.workflow)) {
    contextRows.push({
      label: "Workflow",
      value: workflow.workflow === "dd" ? "Due diligence" : "Quick loop",
      detail: workflow.summary,
      tone: workflow.success ? "success" : "warning",
    });
  }

  if (focusSymbol && !analysis?.symbol) {
    contextRows.unshift({
      label: "Pinned",
      value: focusSymbol,
      detail: "Promoted from the last symbol-specific action.",
      tone: "info",
    });
  }

  return {
    workspace: "market",
    title: "Tape, shortlist, and symbol dossier.",
    subtitle: "Scan the market, promote one symbol, then deepen context without burying it in chat.",
    sections: [
      { id: "shortlist", actions: ["/scan", "/trending", "/breakouts", "/regime", "/score"] },
      { id: "focus", actions: [analysis?.symbol ? `/analyze ${analysis.symbol}` : (focusSymbol ? `/analyze ${focusSymbol}` : "/analyze BTC"), analysis?.symbol ? `/ta ${analysis.symbol}` : (focusSymbol ? `/ta ${focusSymbol}` : "/ta BTC 4h"), analysis?.symbol ? `/chart ${analysis.symbol}` : (focusSymbol ? `/chart ${focusSymbol}` : "/chart BTC 4h"), "/whales BTC"] },
      { id: "context", actions: ["/regime", "/regime-history", "/ensemble", "/workflow dd BTC"] },
    ],
    shortlist: {
      title: shortlistRows.length > 0
        ? `${shortlistRows.length} setup${shortlistRows.length === 1 ? "" : "s"} on the tape`
        : "No active shortlist",
      subtitle: scan
        ? `${scan.coinsScanned ?? 0} symbols scanned${scan.executionTime ? ` · ${scan.executionTime}ms` : ""}`
        : "Run a sweep to turn the tape into ranked market structure.",
      tone: shortlistRows.length > 0 ? "info" : "warning",
      actions: ["/scan", "/trending", "/breakouts", "/regime", "/score"],
      activeSymbol: analysis?.symbol ?? focusSymbol,
      rows: shortlistRows,
      emptyTitle: "Turn the tape into a ranked shortlist",
      emptyDetail: "Run /scan, /trending, or /breakouts to populate the market table.",
    },
    focus: {
      title: analysis?.symbol
        ? `${focusSymbol ?? analysis.symbol} dossier`
        : focusSymbol
          ? `${focusSymbol} queued for a deeper read`
          : "No symbol dossier yet",
      subtitle: analysis?.formattedSummary ?? "One symbol should always be in focus while the rest of the tape stays ranked.",
      tone: analysis?.setupDetected ? "analysis" : "neutral",
      actions: [analysis?.symbol ? `/analyze ${analysis.symbol}` : (focusSymbol ? `/analyze ${focusSymbol}` : "/analyze BTC"), analysis?.symbol ? `/ta ${analysis.symbol}` : (focusSymbol ? `/ta ${focusSymbol}` : "/ta BTC 4h"), analysis?.symbol ? `/chart ${analysis.symbol}` : (focusSymbol ? `/chart ${focusSymbol}` : "/chart BTC 4h"), analysis?.symbol ? `/whales ${analysis.symbol}` : (focusSymbol ? `/whales ${focusSymbol}` : "/whales BTC")],
      rows: focusRows,
      notes: focusNotes,
    },
    context: {
      title: "Discovery posture",
      subtitle: "Regime, rails, and workflow state stay pinned here instead of fragmenting across the transcript.",
      tone: "brand",
      actions: ["/regime", "/regime-history", "/ensemble", "/workflow dd BTC"],
      rows: contextRows,
    },
  };
}

function buildPlanRiskRows(input: WorkspaceBoardViewInput, focusedPlan: Plan | undefined): WorkspaceBoardRowViewModel[] {
  if (!focusedPlan) {
    return [
      {
        label: "Risk",
        value: "No active ticket",
        detail: "Create a plan to populate reserve, stop distance, and execution readiness.",
        tone: "warning",
      },
    ];
  }

  const entryPrice = focusedPlan.entry.price;
  const stopDistance = entryPrice
    ? Math.abs(entryPrice - focusedPlan.stopLoss.price) / entryPrice
    : undefined;
  const riskReward = calculateRiskReward(focusedPlan);
  const allocationPercent = input.planReview.portfolioValue > 0
    ? calculateAllocationPercent(focusedPlan, input.planReview.portfolioValue)
    : focusedPlan.allocation.percentOfPortfolio;
  const remainingCash = input.planReview.availableCash - focusedPlan.allocation.amount;
  const reserveTarget = input.planReview.portfolioValue * input.planReview.cashReservePercent;
  const preferredMaxAllocation = input.planReview.portfolioValue * input.planReview.maxAllocationPerTrade;
  const warnings: string[] = [];

  if (focusedPlan.allocation.amount > preferredMaxAllocation) {
    warnings.push("Allocation exceeds configured per-trade preference.");
  }
  if (remainingCash < reserveTarget) {
    warnings.push("Cash reserve would fall below the configured floor.");
  }
  if (entryPrice && stopDistance !== undefined && stopDistance < 0.01) {
    warnings.push("Stop is extremely tight for live execution.");
  } else if (entryPrice && stopDistance !== undefined && stopDistance > 0.1) {
    warnings.push("Stop is wide; position size should stay disciplined.");
  }
  if (entryPrice && riskReward > 0 && riskReward < 1.2) {
    warnings.push("Reward-to-risk is below the preferred threshold.");
  }

  const rows: WorkspaceBoardRowViewModel[] = [
    {
      label: "R:R",
      value: entryPrice ? `${formatNumber(riskReward, 2)}:1` : "Market entry",
      detail: entryPrice
        ? "Calculated from entry, stop, and first take-profit."
        : "Waiting for a fixed entry price to compute exact reward/risk.",
      tone: !entryPrice ? "analysis" : riskReward >= 1.5 ? "success" : riskReward >= 1.2 ? "warning" : "danger",
    },
    {
      label: "Size",
      value: formatPercent(allocationPercent),
      detail: `Configured max ${formatPercent(input.planReview.maxAllocationPerTrade)} of portfolio.`,
      tone: allocationPercent <= input.planReview.maxAllocationPerTrade ? "success" : "warning",
    },
    {
      label: "Reserve",
      value: formatCurrency(Math.max(remainingCash, 0)),
      detail: `Target reserve ${formatCurrency(reserveTarget)} after execution.`,
      tone: remainingCash >= reserveTarget ? "success" : "danger",
    },
  ];

  if (entryPrice && stopDistance !== undefined) {
    rows.splice(1, 0, {
      label: "Stop dist.",
      value: formatDistancePercent(stopDistance),
      detail: "Distance from entry to stop-loss.",
      tone: stopDistance <= 0.05 ? "success" : stopDistance <= 0.1 ? "warning" : "danger",
    });
  }

  if (warnings.length > 0) {
    rows.push({
      label: "Review",
      value: `${warnings.length} caution${warnings.length === 1 ? "" : "s"}`,
      detail: warnings[0],
      tone: "warning",
    });
  }

  return rows;
}

function buildPlanSurface(input: WorkspaceBoardViewInput): PlanWorkspaceSurfaceModel {
  const focusedPlan = getFocusedPlan(input);
  const planCounts = {
    draft: input.plans.filter((plan) => plan.status === "DRAFT").length,
    approved: input.plans.filter((plan) => plan.status === "APPROVED").length,
    executing: input.plans.filter((plan) => plan.status === "EXECUTING").length,
  };

  const ladder = focusedPlan
    ? [
        `Stop ${formatCurrency(focusedPlan.stopLoss.price)}`,
        ...focusedPlan.takeProfit.slice(0, 3).map((takeProfit, index) => (
          `TP${index + 1} ${formatCurrency(takeProfit.price)} · ${formatPercent(takeProfit.percentToSell)}`
        )),
      ]
    : [];

  const bookRows: PlanWorkspaceBookRow[] = input.plans.slice(0, 8).map((plan) => ({
    symbol: plan.symbol,
    status: titleCase(plan.status),
    strategy: titleCase(plan.strategy),
    allocation: formatCurrency(plan.allocation.amount),
    entry: plan.entry.price ? formatCurrency(plan.entry.price) : "Market",
    planId: plan.id,
    tone: plan.id === focusedPlan?.id
      ? "analysis"
      : plan.status === "APPROVED"
        ? "success"
        : plan.status === "EXECUTING"
          ? "operate"
          : "warning",
  }));

  const approvalRows: PlanWorkspaceApprovalRow[] = input.runtimeInspector?.pendingApprovals?.slice(0, 6).map((request) => {
    const shortId = getRuntimeApprovalShortId(request.id);
    return {
      id: shortId,
      tool: request.toolName,
      summary: request.reason ?? "Approval required",
      detail: `Scope ${request.permissionScope} · ${request.riskClass} risk`,
      tone: "warning" as DeskTone,
    };
  }) ?? [];

  return {
    workspace: "plan",
    title: "Ticket review, approvals, and execution interlocks.",
    subtitle: "Treat the plan as a review sheet, not a chat message.",
    sections: [
      { id: "ticket", actions: [focusedPlan ? "/plans" : "/plan BTC", focusedPlan ? `/preview-order ${focusedPlan.symbol}` : "/preview-order", "/orders", "/positions"] },
      { id: "approvals", actions: ["/runtime-approvals", "approve <id>", "deny <id> reason"] },
      { id: "risk", actions: ["/preview-order", "/positions", "/portfolio", "/runtime-approvals"] },
      { id: "book", actions: ["/plans", "/runtime-approvals", "approve <id>", "deny <id> reason"] },
    ],
    ticket: focusedPlan
      ? {
          title: `${focusedPlan.symbol} · ${titleCase(focusedPlan.strategy)}`,
          subtitle: `${titleCase(focusedPlan.status)} · ${focusedPlan.direction.toUpperCase()} bias`,
          tone: focusedPlan.status === "APPROVED" ? "success" : focusedPlan.status === "EXECUTING" ? "operate" : "warning",
          actions: ["/plans", `/preview-order ${focusedPlan.symbol}`, "/orders", "/positions"],
          statusLabel: titleCase(focusedPlan.status),
          thesis: focusedPlan.reasoning,
          metrics: [
            {
              label: "Entry",
              value: focusedPlan.entry.price ? formatCurrency(focusedPlan.entry.price) : "Market",
              tone: "info",
            },
            {
              label: "Allocation",
              value: `${formatCurrency(focusedPlan.allocation.amount)} · ${formatPercent(focusedPlan.allocation.percentOfPortfolio)}`,
              tone: "operate",
            },
            {
              label: "Strategy",
              value: titleCase(focusedPlan.strategy),
              tone: "analysis",
            },
            {
              label: "Plan ID",
              value: focusedPlan.id,
              tone: "neutral",
            },
          ],
          ladder,
        }
      : {
          title: "No active ticket",
          subtitle: "Create one plan or grid and Gordon will hold it here for review.",
          tone: "warning",
          actions: ["/plan BTC", "/grid BTC", "/preview-order", "/orders", "/positions"],
          statusLabel: "Waiting",
          metrics: [],
          ladder: [],
          emptyTitle: "Build a ticket before you route any action",
          emptyDetail: "Start with /plan BTC or /grid BTC. The sheet will then carry thesis, sizing, invalidation, and execution posture.",
        },
    approvals: {
      title: approvalRows.length > 0
        ? `${approvalRows.length} blocking approval${approvalRows.length === 1 ? "" : "s"}`
        : "Approval lane clear",
      subtitle: focusedPlan
        ? `Keep sign-off adjacent to ${focusedPlan.symbol}, not buried in diagnostics.`
        : "Approval remains explicit even before a ticket exists.",
      tone: approvalRows.length > 0 ? "warning" : "success",
      actions: ["/runtime-approvals", "approve <id>", "deny <id> reason"],
      mode: input.mode,
      route: input.hasExchange || input.hasBroker ? "Execution rails online" : "No execution rail",
      rows: approvalRows,
    },
    risk: {
      title: focusedPlan ? "Risk and reserve review" : "Readiness appears here",
      subtitle: focusedPlan
        ? "This is the final review lane before execution."
        : "Reserve, stop distance, and reward-to-risk become durable once a ticket exists.",
      tone: focusedPlan?.status === "APPROVED" ? "success" : "analysis",
      actions: ["/preview-order", "/positions", "/portfolio", "/runtime-approvals"],
      rows: buildPlanRiskRows(input, focusedPlan),
    },
    book: {
      title: `${input.plans.length} stored ticket${input.plans.length === 1 ? "" : "s"}`,
      subtitle: `Draft ${planCounts.draft} · Approved ${planCounts.approved} · Executing ${planCounts.executing}`,
      tone: "brand",
      actions: ["/plans", "/runtime-approvals", "approve <id>", "deny <id> reason"],
      rows: bookRows,
      counts: planCounts,
    },
  };
}

function buildLabSurface(input: WorkspaceBoardViewInput): LabWorkspaceSurfaceModel {
  const focusedStrategy = getFocusedLabStrategy(input);
  const backtestSummary = extractBacktestSummary(
    input.lastResults.backtest,
    input.lastResults.workflowSummary,
  );
  const generatedTop = input.strategyInventory.generatedStrategies.slice(0, 6);
  const experimentRows = input.strategyInventory.researchExperiments.slice(0, 6);
  const systematicRows = input.strategyInventory.systematicProfiles.slice(0, 6);
  const registryRows = [
    ...input.strategyInventory.builtInStrategies.slice(0, 5).map((strategy) => ({
      id: strategy.id,
      name: strategy.name,
      kind: "Built-in",
      risk: titleCase(strategy.riskLevel),
      frame: strategy.timeframes.join(", "),
      tone: "analysis" as DeskTone,
    })),
    ...input.strategyInventory.playbooks.slice(0, 4).map((playbook) => ({
      id: playbook.id,
      name: playbook.name,
      kind: "Playbook",
      risk: titleCase(playbook.riskLevel),
      frame: playbook.timeframes.join(", "),
      tone: "info" as DeskTone,
    })),
  ];

  return {
    workspace: "lab",
    title: "Strategy bench, validation lane, and systematic slate.",
    subtitle: "Turn strategies into ranked, repeatable research assets instead of one-off chat outputs.",
    sections: [
      { id: "bench", actions: ["/strategies", "/strategy playbooks", "/gen <description>", "/strategy compare <a> <b>"] },
      { id: "validation", actions: ["/workflow backtest-cycle <strategy> <symbol>", "/strategy backtest <id> <symbol>", "/dataset list"] },
      { id: "systematic", actions: ["/strategy running", "/strategy evolving", "/systematic status", "/experiment list"] },
      { id: "registry", actions: ["/strategies", "/strategy info <id>", "/strategy playbooks", "/strategy compare <a> <b>"] },
      { id: "queue", actions: ["/strategy evolving", "/experiment list", "/dataset list"] },
    ],
    bench: {
      title: focusedStrategy
        ? `${focusedStrategy.label} in focus`
        : `${input.strategyInventory.builtInStrategyCount} built-in · ${input.strategyInventory.generatedStrategies.length} generated`,
      subtitle: focusedStrategy?.subtitle ?? `${input.strategyInventory.playbookCount} playbooks · tier 1 ${input.strategyInventory.builtInTier1Count} · tier 2 ${input.strategyInventory.builtInTier2Count}`,
      tone: "analysis",
      actions: ["/strategies", "/strategy playbooks", "/gen <description>", "/strategy compare <a> <b>"],
      activeId: focusedStrategy?.id,
      rows: focusedStrategy
        ? [
            {
              id: focusedStrategy.id,
              name: focusedStrategy.label,
              source: focusedStrategy.source,
              risk: focusedStrategy.rows.find((row) => row.label === "Risk")?.value ?? "N/A",
              signal: focusedStrategy.rows.map((row) => row.value).join(" · "),
              tone: "analysis",
            },
            ...generatedTop
              .filter((strategy) => strategy.id !== focusedStrategy.id)
              .map((strategy) => ({
                id: strategy.id,
                name: strategy.name,
                source: "Generated",
                risk: strategy.riskLevel ? titleCase(strategy.riskLevel) : "N/A",
                signal: strategy.backtestReturn !== undefined
                  ? `Return ${formatSignedPercent(strategy.backtestReturn)}${strategy.backtestSharpe !== undefined ? ` · Sharpe ${formatNumber(strategy.backtestSharpe)}` : ""}`
                  : "Awaiting validation",
                tone: strategy.backtestReturn !== undefined && strategy.backtestReturn >= 0 ? "success" : "analysis" as DeskTone,
              })),
          ]
        : (
          generatedTop.map((strategy) => ({
            id: strategy.id,
            name: strategy.name,
            source: "Generated",
            risk: strategy.riskLevel ? titleCase(strategy.riskLevel) : "N/A",
            signal: strategy.backtestReturn !== undefined
              ? `Return ${formatSignedPercent(strategy.backtestReturn)}${strategy.backtestSharpe !== undefined ? ` · Sharpe ${formatNumber(strategy.backtestSharpe)}` : ""}`
              : "Awaiting validation",
            tone: strategy.backtestReturn !== undefined && strategy.backtestReturn >= 0 ? "success" : "analysis" as DeskTone,
          }))
        ),
      emptyTitle: "No ranked strategy bench yet",
      emptyDetail: "Generate or load strategies to turn the lab into a persistent bench.",
    },
    validation: {
      title: backtestSummary?.title ?? "Validation lane",
      subtitle: backtestSummary?.subtitle ?? "Backtests, comparisons, and validation cycles belong in one research lane.",
      tone: "info",
      actions: ["/workflow backtest-cycle <strategy> <symbol>", "/strategy backtest <id> <symbol>", "/dataset list"],
      rows: backtestSummary?.rows ?? [
        {
          label: "Validation",
          value: "No recent backtest snapshot",
          detail: "Run /workflow backtest-cycle or /strategy backtest to populate the lane.",
          tone: "warning",
        },
      ],
      notes: focusedStrategy?.rows.map((row) => `${row.label}: ${row.value}`),
    },
    systematic: {
      title: `${input.strategyInventory.systematicProfileCount} profile(s) · ${input.strategyInventory.systematicLiveEligibleCount} live eligible`,
      subtitle: `${input.strategyInventory.researchExperimentCount} experiment(s) · concentration ${titleCase(input.strategyInventory.concentrationRisk ?? "unknown")}`,
      tone: "success",
      actions: ["/strategy running", "/strategy evolving", "/systematic status", "/experiment list"],
      rows: systematicRows.length > 0
        ? systematicRows.map((profile) => ({
            label: profile.strategyName,
            value: `${titleCase(profile.status)} · ${formatNumber(profile.validationScore, 1)}/100`,
            detail: `${titleCase(profile.marketFamily)} · ${formatPercent(profile.capitalWeight)}${profile.liveEligible ? " · live eligible" : ""}`,
            tone: profile.liveEligible ? "success" : "warning",
          }))
        : [
            {
              label: "Live eligible",
              value: String(input.strategyInventory.systematicLiveEligibleCount),
              detail: "Profiles that have passed enough validation to be promoted safely.",
              tone: input.strategyInventory.systematicLiveEligibleCount > 0 ? "success" : "warning",
            },
            {
              label: "Diversification",
              value: input.strategyInventory.diversificationScore !== undefined
                ? `${formatNumber(input.strategyInventory.diversificationScore, 1)}/100`
                : "N/A",
              detail: "Systematic portfolio contribution across regimes and return drivers.",
              tone: "analysis",
            },
          ],
      notes: experimentRows.slice(0, 3).map((row) => `${row.strategyName}: ${titleCase(row.status)}`),
    },
    registry: {
      title: `${input.strategyInventory.builtInStrategyCount} strategies · ${input.strategyInventory.playbookCount} playbooks`,
      subtitle: "Core strategy inventory stays visible even when the active run is experimental.",
      tone: "brand",
      actions: ["/strategies", "/strategy info <id>", "/strategy playbooks", "/strategy compare <a> <b>"],
      rows: registryRows,
    },
    queue: {
      title: `${input.strategyInventory.researchExperimentCount} tracked experiment(s)`,
      subtitle: "Genome variants, validation loops, and runtime promotion belong in one research queue.",
      tone: "info",
      actions: ["/strategy evolving", "/experiment list", "/dataset list"],
      rows: experimentRows.map((experiment) => ({
        name: experiment.strategyName,
        status: titleCase(experiment.status),
        source: experiment.strategyId,
        reference: experiment.experimentId,
        tone: experiment.status === "validated" ? "success" : "analysis",
      })),
    },
  };
}

function buildMonitorSurface(input: WorkspaceBoardViewInput): MonitorWorkspaceSurfaceModel {
  const portfolio = input.lastResults.portfolioSummary;
  const positions = input.lastResults.positionsSummary;
  const orders = input.lastResults.ordersSummary;
  const focusSection = input.workspaceMemory.monitor.focusSection;

  const bookRows: MonitorWorkspaceBookRow[] = portfolio?.holdings.slice(0, 8).map((holding) => ({
    symbol: holding.asset,
    quantity: formatNumber(holding.amount, 6),
    value: formatCurrency(holding.usdtValue),
    venue: holding.wallet ?? (holding.note ?? "desk"),
    tone: "info",
  })) ?? [];

  const blotterRows: MonitorWorkspaceBlotterRow[] = [
    ...(positions?.positions.slice(0, 6).map((position) => ({
      lane: "Pos",
      symbol: position.symbol,
      status: titleCase(position.status),
      exposure: `${formatSignedPercent(position.unrealizedPnlPercent)} · ${formatSignedCurrency(position.unrealizedPnl)}`,
      note: `${position.minutesOpen} min open`,
      tone: position.unrealizedPnl >= 0 ? "success" : "danger" as DeskTone,
    })) ?? []),
    ...(orders?.orders.slice(0, 6).map((order) => ({
      lane: "Ord",
      symbol: order.symbol,
      status: `${order.side} ${order.type}`,
      exposure: `Qty ${order.quantity} @ ${order.price}`,
      note: String(order.status),
      tone: "operate" as DeskTone,
    })) ?? []),
  ];

  const runtimeRows: WorkspaceBoardRowViewModel[] = [
    {
      label: "Approvals",
      value: String(input.runtimeInspector?.pendingApprovalCount ?? 0),
      detail: "Blocking approvals surface here and inline in the desk transcript.",
      tone: input.runtimeInspector?.pendingApprovalCount ? "warning" : "success",
    },
    {
      label: "Plugins",
      value: `${input.runtimeInspector?.pluginCount ?? 0} loaded · ${input.runtimeInspector?.pluginAttentionCount ?? 0} attention`,
      detail: `${input.runtimeInspector?.routedPluginCount ?? 0} routed · ${input.runtimeInspector?.commandCount ?? 0} surfaced commands · ${input.runtimeInspector?.approvalRuleCount ?? 0} approval rules`,
      tone: (input.runtimeInspector?.pluginAttentionCount ?? 0) > 0 ? "warning" : "brand",
    },
    {
      label: "Bridge",
      value: input.runtimeInspector?.remoteConnectionStatus
        ? titleCase(input.runtimeInspector.remoteConnectionStatus)
        : "Offline",
      detail: input.runtimeInspector?.remoteDetail ?? "Daemon and ingress state stay visible in monitor.",
      tone: input.runtimeInspector?.activeBridgeSessions ? "operate" : "neutral",
    },
    {
      label: "Runtime",
      value: `${input.runtimeInspector?.transcriptEntryCount ?? 0} transcript entries`,
      detail: `${input.runtimeInspector?.pluginCount ?? 0} plugin(s) · ${input.runtimeInspector?.mcpServerCount ?? 0} MCP server(s)`,
      tone: "analysis",
    },
  ];

  const alertRows: MonitorWorkspaceAlertRow[] = positions?.alerts.slice(0, 6).map((alert) => ({
    heading: "Position alert",
    status: alert,
    note: "Review invalidation, execution drift, or health deterioration.",
    tone: "danger",
  })) ?? [];

  if (alertRows.length === 0) {
    alertRows.push({
      heading: "Health",
      status: "Monitor clean",
      note: input.lastResults.workflowSummary?.summary ?? "No recent position alerts were captured in monitor state.",
      tone: input.lastResults.workflowSummary?.success ? "analysis" : "success",
    });
  }

  return {
    workspace: "monitor",
    title: "Capital, runtime, and live supervision.",
    subtitle: "Keep the book, blotter, and runtime in one operator surface.",
    sections: [
      { id: "book", actions: ["/portfolio", "/positions", "/orders", "/health", "/history"] },
      { id: "runtime", actions: ["/runtime-state", "/runtime-bridge", "/runtime-history", "/exchange status"] },
      { id: "blotter", actions: ["/positions", "/orders", "/audit recent", "/runtime-history"] },
      { id: "alerts", actions: ["/health", "/audit recent", "/runtime-history", "/workflow monitor"] },
    ],
    book: {
      title: portfolio
        ? `${formatCurrency(portfolio.totalValue)} total · ${formatCurrency(portfolio.availableCash)} cash`
        : "No current book snapshot",
      subtitle: portfolio
        ? `${portfolio.holdings.length} holding(s)${focusSection === "book" ? " · focus book" : ""}`
        : "Portfolio, positions, orders, and health belong in one supervision surface.",
      tone: "operate",
      actions: ["/portfolio", "/positions", "/orders", "/health", "/history"],
      rows: bookRows,
    },
    runtime: {
      title: `Bridge ${input.runtimeInspector?.activeBridgeSessions ?? 0} · background ${input.runtimeInspector?.backgroundTaskCount ?? 0}`,
      subtitle: `${buildRailsLabel(input)}${focusSection === "runtime" ? " · focus runtime" : ""}`,
      tone: "brand",
      actions: ["/runtime-state", "/runtime-bridge", "/runtime-history", "/exchange status"],
      rows: runtimeRows,
    },
    blotter: {
      title: `${positions?.count ?? 0} position(s) · ${orders?.count ?? 0} order(s)`,
      subtitle: positions
        ? `${formatSignedCurrency(positions.totalUnrealized)} unrealized${focusSection === "positions" ? " · focus positions" : ""}`
        : "Route /positions and /orders to keep the blotter current.",
      tone: "warning",
      actions: ["/positions", "/orders", "/audit recent", "/runtime-history"],
      rows: blotterRows,
    },
    alerts: {
      title: alertRows[0]?.status.includes("clean")
        ? "No live alerts in the latest snapshot"
        : `${alertRows.length} active alert${alertRows.length === 1 ? "" : "s"}`,
      subtitle: input.lastResults.workflowSummary
        ? `${titleCase(input.lastResults.workflowSummary.workflow)} · ${input.lastResults.workflowSummary.summary}`
        : "Health, runtime, and monitor-cycle issues should land here before they become surprises.",
      tone: alertRows[0]?.tone === "danger" ? "danger" : "success",
      actions: ["/health", "/audit recent", "/runtime-history", "/workflow monitor"],
      rows: alertRows,
    },
  };
}

export function buildWorkspaceSurfaceViewModel(input: WorkspaceBoardViewInput): WorkspaceSurfaceViewModel | null {
  switch (input.workspace) {
    case "market":
      return buildMarketSurface(input);
    case "plan":
      return buildPlanSurface(input);
    case "lab":
      return buildLabSurface(input);
    case "monitor":
      return buildMonitorSurface(input);
    default:
      return null;
  }
}

export function clampWorkspaceSurfaceSectionIndex(
  model: WorkspaceSurfaceViewModel,
  selectedSectionIndex: number,
): number {
  if (model.sections.length === 0) {
    return 0;
  }
  return Math.max(0, Math.min(selectedSectionIndex, model.sections.length - 1));
}

export function getPrimaryWorkspaceSurfaceAction(
  model: WorkspaceSurfaceViewModel,
  selectedSectionIndex: number,
): string | null {
  const clampedIndex = clampWorkspaceSurfaceSectionIndex(model, selectedSectionIndex);
  const selectedSection = model.sections[clampedIndex];
  if (selectedSection?.actions?.[0]) {
    return selectedSection.actions[0];
  }

  for (const section of model.sections) {
    if (section.actions[0]) {
      return section.actions[0];
    }
  }

  return null;
}
