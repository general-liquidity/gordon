import { calculateAllocationPercent, calculateRiskReward } from "../core/validator.ts";
import type { Plan } from "../types/plan.ts";
import type { RuntimeInspectorViewModel } from "./presenters/RuntimePresenter.ts";
import { getRuntimeApprovalShortId } from "./runtimeApprovalId.ts";
import type {
  LastResults,
  WorkspaceId,
  WorkspaceMemoryState,
} from "./state/AppStore.ts";
import type { DeskTone } from "./components/desk/DeskPanel.tsx";

export interface CockpitStrategyInventorySnapshot {
  builtInStrategyCount: number;
  builtInTier1Count: number;
  builtInTier2Count: number;
  builtInStrategies: Array<{
    id: string;
    name: string;
    riskLevel: string;
    timeframes: string[];
  }>;
  generatedStrategies: Array<{
    id: string;
    name: string;
    riskLevel?: string;
    timeframes?: string[];
    backtestReturn?: number;
    backtestSharpe?: number;
  }>;
  playbookCount: number;
  playbooks: Array<{
    id: string;
    name: string;
    riskLevel: string;
    timeframes: string[];
  }>;
  systematicProfileCount: number;
  systematicLiveEligibleCount: number;
  systematicProfiles: Array<{
    strategyId: string;
    strategyName: string;
    status: string;
    validationScore: number;
    marketFamily: string;
    liveEligible: boolean;
    capitalWeight: number;
  }>;
  researchExperimentCount: number;
  researchExperiments: Array<{
    experimentId: string;
    strategyId: string;
    strategyName: string;
    status: string;
  }>;
  diversificationScore?: number;
  concentrationRisk?: string;
}

export interface CockpitBuildInput {
  workspace: Exclude<WorkspaceId, "desk">;
  mode: "SAFE" | "ARMED";
  hasExchange: boolean;
  hasBroker: boolean;
  hasWalletRails: boolean;
  hasMcpServers: boolean;
  runtimeInspector: RuntimeInspectorViewModel | null;
  queuedCount: number;
  lastResults: LastResults;
  plans: Plan[];
  workspaceMemory: WorkspaceMemoryState;
  strategyInventory: CockpitStrategyInventorySnapshot;
  planReview: {
    portfolioValue: number;
    availableCash: number;
    maxAllocationPerTrade: number;
    cashReservePercent: number;
  };
}

export interface CockpitSection {
  id: string;
  label: string;
  actions: string[];
}

export interface CockpitLineItem {
  label: string;
  value: string;
  detail?: string;
  tone?: DeskTone;
}

export interface CockpitTableRow {
  key: string;
  cells: string[];
  tone?: DeskTone;
}

export interface MarketCockpitModel {
  workspace: "market";
  title: string;
  subtitle: string;
  sections: CockpitSection[];
  shortlist: {
    headers: string[];
    activeKey?: string;
    rows: CockpitTableRow[];
    emptyTitle: string;
    emptyDetail: string;
  };
  dossier: {
    title: string;
    subtitle: string;
    lines: CockpitLineItem[];
    notes: string[];
  };
  context: {
    title: string;
    subtitle: string;
    lines: CockpitLineItem[];
  };
}

export interface PlanCockpitModel {
  workspace: "plan";
  title: string;
  subtitle: string;
  sections: CockpitSection[];
  ticket: {
    title: string;
    subtitle: string;
    status: string;
    thesis?: string;
    metrics: CockpitLineItem[];
    ladder: string[];
    emptyTitle?: string;
    emptyDetail?: string;
  };
  approvals: {
    title: string;
    subtitle: string;
    mode: string;
    route: string;
    rows: Array<{ id: string; tool: string; summary: string; detail: string; tone?: DeskTone }>;
  };
  risk: {
    title: string;
    subtitle: string;
    lines: CockpitLineItem[];
  };
  book: {
    title: string;
    subtitle: string;
    headers: string[];
    rows: CockpitTableRow[];
  };
}

export interface LabCockpitModel {
  workspace: "lab";
  title: string;
  subtitle: string;
  sections: CockpitSection[];
  bench: {
    headers: string[];
    activeKey?: string;
    rows: CockpitTableRow[];
    emptyTitle: string;
    emptyDetail: string;
  };
  validation: {
    title: string;
    subtitle: string;
    lines: CockpitLineItem[];
  };
  systematic: {
    title: string;
    subtitle: string;
    lines: CockpitLineItem[];
  };
  protocolMarkdown: string;
  queue: {
    headers: string[];
    rows: CockpitTableRow[];
  };
}

export interface MonitorCockpitModel {
  workspace: "monitor";
  title: string;
  subtitle: string;
  sections: CockpitSection[];
  book: {
    headers: string[];
    rows: CockpitTableRow[];
  };
  blotter: {
    headers: string[];
    rows: CockpitTableRow[];
  };
  runtime: {
    title: string;
    subtitle: string;
    lines: CockpitLineItem[];
  };
  alerts: {
    title: string;
    subtitle: string;
    lines: CockpitLineItem[];
  };
}

export type CockpitModel =
  | MarketCockpitModel
  | PlanCockpitModel
  | LabCockpitModel
  | MonitorCockpitModel;

function formatNumber(value: number, digits = 2): string {
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
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }
  return undefined;
}

function buildRailsLabel(input: CockpitBuildInput): string {
  const parts = [
    input.hasExchange ? "exchange" : null,
    input.hasBroker ? "broker" : null,
    input.hasWalletRails ? "rails" : null,
    input.hasMcpServers ? "mcp" : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "no live rails";
}

function getFocusedPlan(input: CockpitBuildInput): Plan | undefined {
  const selectedPlanId = input.workspaceMemory.plan.selectedPlanId;
  if (selectedPlanId) {
    const match = input.plans.find((plan) => plan.id === selectedPlanId);
    if (match) return match;
  }
  const focusSymbol = input.workspaceMemory.plan.focusSymbol;
  if (focusSymbol) {
    const match = input.plans.find((plan) => plan.symbol === focusSymbol);
    if (match) return match;
  }
  return input.plans[0];
}

function buildMarketModel(input: CockpitBuildInput): MarketCockpitModel {
  const scan = input.lastResults.scan;
  const analysis = input.lastResults.analysis;
  const regime = input.lastResults.regime;
  const focusSymbol = input.workspaceMemory.market.focusSymbol;
  const shortlistRows: CockpitTableRow[] = scan?.opportunities?.slice(0, 10).map((entry) => ({
    key: entry.symbol,
    tone: entry.setupConfidence >= 0.7 ? "success" : "analysis",
    cells: [
      entry.symbol,
      formatCurrency(entry.price),
      formatSignedPercent(entry.change24h),
      titleCase(entry.bias),
      `${formatNumber(entry.setupConfidence * 100, 0)}%`,
      titleCase(entry.risk),
    ],
  })) ?? [];

  const dossierLines: CockpitLineItem[] = analysis?.symbol ? [
    analysis.price !== undefined ? { label: "Price", value: formatCurrency(analysis.price), tone: "info" } : null,
    analysis.trend ? { label: "Trend", value: titleCase(analysis.trend), tone: "analysis" } : null,
    {
      label: "Setup",
      value: analysis.setupDetected ? `Detected ${(analysis.setupConfidence ?? 0) * 100}%` : "No active setup",
      tone: analysis.setupDetected ? "success" : "warning",
    },
    analysis.indicators?.rsi !== undefined && analysis.indicators?.rsi !== null
      ? {
          label: "RSI",
          value: formatNumber(analysis.indicators.rsi, 1),
          detail: analysis.indicators.macdState ? `MACD ${analysis.indicators.macdState}` : undefined,
          tone: "info",
        }
      : null,
    analysis.supports?.[0]
      ? { label: "Support", value: formatCurrency(analysis.supports[0].price), detail: `Strength ${formatNumber(analysis.supports[0].strength)}`, tone: "success" }
      : null,
    analysis.resistances?.[0]
      ? { label: "Resistance", value: formatCurrency(analysis.resistances[0].price), detail: `Strength ${formatNumber(analysis.resistances[0].strength)}`, tone: "warning" }
      : null,
  ].filter(Boolean) as CockpitLineItem[] : [
    {
      label: "Focus",
      value: focusSymbol ?? "No symbol in focus",
      detail: focusSymbol ? "Run a full analysis to build the dossier." : "Scan or analyze a symbol to populate the dossier.",
      tone: "warning",
    },
  ];

  const regimeLabel = regime && typeof regime === "object"
    ? pickString(regime, ["regime", "currentRegime", "marketRegime", "state", "label"])
    : undefined;

  const contextLines: CockpitLineItem[] = [
    regimeLabel ? { label: "Regime", value: titleCase(regimeLabel), detail: "Match time horizon to tape conditions.", tone: "analysis" } : null,
    { label: "Rails", value: buildRailsLabel(input), detail: "Discovery improves when venue and research rails are both live.", tone: "neutral" },
    input.lastResults.workflowSummary
      ? {
          label: "Workflow",
          value: input.lastResults.workflowSummary.workflow,
          detail: input.lastResults.workflowSummary.summary,
          tone: input.lastResults.workflowSummary.success ? "success" : "warning",
        }
      : null,
  ].filter(Boolean) as CockpitLineItem[];

  return {
    workspace: "market",
    title: "Tape, shortlist, and symbol dossier",
    subtitle: "Rank the tape, then concentrate on one symbol without losing context.",
    sections: [
      { id: "shortlist", label: "Shortlist", actions: ["/scan", "/trending", "/breakouts", "/regime"] },
      { id: "dossier", label: "Dossier", actions: [analysis?.symbol ? `/analyze ${analysis.symbol}` : (focusSymbol ? `/analyze ${focusSymbol}` : "/analyze BTC"), analysis?.symbol ? `/ta ${analysis.symbol}` : "/ta BTC 4h", analysis?.symbol ? `/chart ${analysis.symbol}` : "/chart BTC 4h"] },
      { id: "context", label: "Context", actions: ["/regime", "/regime-history", "/workflow dd BTC"] },
    ],
    shortlist: {
      headers: ["SYMBOL", "PRICE", "24H", "BIAS", "SETUP", "RISK"],
      activeKey: analysis?.symbol ?? focusSymbol,
      rows: shortlistRows,
      emptyTitle: "No active shortlist",
      emptyDetail: "Run /scan, /trending, or /breakouts to populate the tape table.",
    },
    dossier: {
      title: analysis?.symbol ? `${analysis.symbol} dossier` : "No active dossier",
      subtitle: analysis?.formattedSummary ?? "One symbol should always be in focus while the rest of the tape stays ranked.",
      lines: dossierLines,
      notes: analysis?.formattedSummary ? [analysis.formattedSummary] : ["Promote one symbol from the tape to deepen the read."],
    },
    context: {
      title: "Discovery posture",
      subtitle: "Regime, rails, and workflow state stay pinned here.",
      lines: contextLines,
    },
  };
}

function buildPlanRiskLines(input: CockpitBuildInput, focusedPlan: Plan | undefined): CockpitLineItem[] {
  if (!focusedPlan) {
    return [
      { label: "Risk", value: "No active ticket", detail: "Create a plan to populate reserve, stop distance, and execution readiness.", tone: "warning" },
    ];
  }

  const entryPrice = focusedPlan.entry.price;
  const stopDistance = entryPrice ? Math.abs(entryPrice - focusedPlan.stopLoss.price) / entryPrice : undefined;
  const riskReward = calculateRiskReward(focusedPlan);
  const allocationPercent = input.planReview.portfolioValue > 0
    ? calculateAllocationPercent(focusedPlan, input.planReview.portfolioValue)
    : focusedPlan.allocation.percentOfPortfolio;
  const remainingCash = input.planReview.availableCash - focusedPlan.allocation.amount;
  const reserveTarget = input.planReview.portfolioValue * input.planReview.cashReservePercent;
  const warnings: string[] = [];
  if (focusedPlan.allocation.amount > input.planReview.portfolioValue * input.planReview.maxAllocationPerTrade) warnings.push("Allocation exceeds configured per-trade preference.");
  if (remainingCash < reserveTarget) warnings.push("Cash reserve would fall below the configured floor.");
  if (entryPrice && stopDistance !== undefined && stopDistance < 0.01) warnings.push("Stop is extremely tight.");
  if (entryPrice && stopDistance !== undefined && stopDistance > 0.1) warnings.push("Stop is wide.");
  if (entryPrice && riskReward > 0 && riskReward < 1.2) warnings.push("Reward-to-risk is below the preferred threshold.");

  const lines: CockpitLineItem[] = [
    { label: "R:R", value: entryPrice ? `${formatNumber(riskReward, 2)}:1` : "Market entry", detail: "Computed from entry, stop, and first target.", tone: !entryPrice ? "analysis" : riskReward >= 1.5 ? "success" : riskReward >= 1.2 ? "warning" : "danger" },
    { label: "Size", value: formatPercent(allocationPercent), detail: `Configured max ${formatPercent(input.planReview.maxAllocationPerTrade)}`, tone: allocationPercent <= input.planReview.maxAllocationPerTrade ? "success" : "warning" },
    { label: "Reserve", value: formatCurrency(Math.max(remainingCash, 0)), detail: `Target reserve ${formatCurrency(reserveTarget)}`, tone: remainingCash >= reserveTarget ? "success" : "danger" },
  ];
  if (entryPrice && stopDistance !== undefined) {
    lines.splice(1, 0, { label: "Stop dist.", value: formatPercent(stopDistance), detail: "Distance from entry to stop-loss.", tone: stopDistance <= 0.05 ? "success" : stopDistance <= 0.1 ? "warning" : "danger" });
  }
  if (warnings.length) {
    lines.push({ label: "Review", value: `${warnings.length} caution${warnings.length === 1 ? "" : "s"}`, detail: warnings[0], tone: "warning" });
  }
  return lines;
}

function buildPlanModel(input: CockpitBuildInput): PlanCockpitModel {
  const focusedPlan = getFocusedPlan(input);
  const planRows: CockpitTableRow[] = input.plans.slice(0, 10).map((plan) => ({
    key: plan.id,
    tone: plan.id === focusedPlan?.id ? "analysis" : plan.status === "APPROVED" ? "success" : plan.status === "EXECUTING" ? "operate" : "warning",
    cells: [
      plan.symbol,
      titleCase(plan.status),
      titleCase(plan.strategy),
      formatCurrency(plan.allocation.amount),
      plan.entry.price ? formatCurrency(plan.entry.price) : "Market",
    ],
  }));

  const approvalRows = input.runtimeInspector?.pendingApprovals.slice(0, 8).map((request) => ({
    id: getRuntimeApprovalShortId(request.id),
    tool: request.toolName,
    summary: request.reason ?? "Approval required",
    detail: `Scope ${request.permissionScope} · ${request.riskClass} risk`,
    tone: "warning" as DeskTone,
  })) ?? [];

  const ladder = focusedPlan
    ? [
        `Stop ${formatCurrency(focusedPlan.stopLoss.price)}`,
        ...focusedPlan.takeProfit.slice(0, 3).map((tp, index) => `TP${index + 1} ${formatCurrency(tp.price)} · ${formatPercent(tp.percentToSell)}`),
      ]
    : [];

  const draftCount = input.plans.filter((plan) => plan.status === "DRAFT").length;
  const approvedCount = input.plans.filter((plan) => plan.status === "APPROVED").length;
  const executingCount = input.plans.filter((plan) => plan.status === "EXECUTING").length;

  return {
    workspace: "plan",
    title: "Ticket review, approvals, and execution interlocks",
    subtitle: "Treat the plan as a review sheet, not a chat message.",
    sections: [
      { id: "ticket", label: "Ticket", actions: [focusedPlan ? "/plans" : "/plan BTC", focusedPlan ? `/preview-order ${focusedPlan.symbol}` : "/preview-order", "/orders", "/positions"] },
      { id: "approvals", label: "Approvals", actions: ["/runtime-approvals", "approve <id>", "deny <id> reason"] },
      { id: "risk", label: "Risk", actions: ["/preview-order", "/positions", "/portfolio", "/runtime-approvals"] },
      { id: "book", label: "Book", actions: ["/plans", "/runtime-approvals", "approve <id>", "deny <id> reason"] },
    ],
    ticket: focusedPlan
      ? {
          title: `${focusedPlan.symbol} · ${titleCase(focusedPlan.strategy)}`,
          subtitle: `${titleCase(focusedPlan.status)} · ${focusedPlan.direction.toUpperCase()} bias`,
          status: titleCase(focusedPlan.status),
          thesis: focusedPlan.reasoning,
          metrics: [
            { label: "Entry", value: focusedPlan.entry.price ? formatCurrency(focusedPlan.entry.price) : "Market", tone: "info" },
            { label: "Allocation", value: `${formatCurrency(focusedPlan.allocation.amount)} · ${formatPercent(focusedPlan.allocation.percentOfPortfolio)}`, tone: "operate" },
            { label: "Strategy", value: titleCase(focusedPlan.strategy), tone: "analysis" },
            { label: "Plan ID", value: focusedPlan.id, tone: "neutral" },
          ],
          ladder,
        }
      : {
          title: "No active ticket",
          subtitle: "Create one plan or grid and Gordon will hold it here for review.",
          status: "Waiting",
          metrics: [],
          ladder: [],
          emptyTitle: "Build a ticket before you route any action",
          emptyDetail: "Start with /plan BTC or /grid BTC. The sheet then carries thesis, sizing, invalidation, and execution posture.",
        },
    approvals: {
      title: approvalRows.length ? `${approvalRows.length} blocking approval${approvalRows.length === 1 ? "" : "s"}` : "Approval lane clear",
      subtitle: focusedPlan ? `Keep sign-off adjacent to ${focusedPlan.symbol}.` : "Approval remains explicit even before a ticket exists.",
      mode: input.mode,
      route: input.hasExchange || input.hasBroker ? "Execution rails online" : "No execution rail",
      rows: approvalRows,
    },
    risk: {
      title: focusedPlan ? "Risk and reserve review" : "Readiness appears here",
      subtitle: focusedPlan ? "This is the final review lane before execution." : "Reserve, stop distance, and reward-to-risk become durable once a ticket exists.",
      lines: buildPlanRiskLines(input, focusedPlan),
    },
    book: {
      title: `${input.plans.length} stored ticket${input.plans.length === 1 ? "" : "s"}`,
      subtitle: `Draft ${draftCount} · Approved ${approvedCount} · Executing ${executingCount}`,
      headers: ["SYMBOL", "STATUS", "STRATEGY", "ALLOCATION", "ENTRY"],
      rows: planRows,
    },
  };
}

function buildLabMarkdown(input: CockpitBuildInput): string {
  const topBuiltIn = input.strategyInventory.builtInStrategies.slice(0, 3).map((strategy) => `- ${strategy.name} · ${titleCase(strategy.riskLevel)} · ${strategy.timeframes.join(", ")}`);
  const topGenerated = input.strategyInventory.generatedStrategies.slice(0, 3).map((strategy) => `- ${strategy.name} · ${strategy.backtestReturn !== undefined ? `${formatSignedPercent(strategy.backtestReturn)} return` : "awaiting validation"}`);
  return [
    "# Lab protocol",
    "",
    "## Built-in bench",
    ...(topBuiltIn.length > 0 ? topBuiltIn : ["- No built-in strategies in focus"]),
    "",
    "## Generated bench",
    ...(topGenerated.length > 0 ? topGenerated : ["- No generated strategies yet"]),
    "",
    "## Operating rule",
    "- Promote only after validation, regime fit, and capital-weight review.",
  ].join("\n");
}

function buildLabModel(input: CockpitBuildInput): LabCockpitModel {
  const selectedStrategyId = input.workspaceMemory.lab.selectedStrategyId;
  const benchRows: CockpitTableRow[] = [
    ...input.strategyInventory.generatedStrategies.slice(0, 8).map((strategy) => ({
      key: strategy.id,
      tone: strategy.backtestReturn !== undefined && strategy.backtestReturn >= 0 ? "success" as DeskTone : "analysis" as DeskTone,
      cells: [
        strategy.name,
        "Generated",
        strategy.riskLevel ? titleCase(strategy.riskLevel) : "N/A",
        strategy.backtestReturn !== undefined ? `Return ${formatSignedPercent(strategy.backtestReturn)}` : "Awaiting validation",
      ],
    })),
    ...input.strategyInventory.builtInStrategies.slice(0, 4).map((strategy) => ({
      key: strategy.id,
      tone: "analysis" as DeskTone,
      cells: [
        strategy.name,
        "Built-in",
        titleCase(strategy.riskLevel),
        strategy.timeframes.join(", "),
      ],
    })),
  ];

  const validationLines: CockpitLineItem[] = input.lastResults.backtest?.result
    && typeof input.lastResults.backtest.result === "object"
    && input.lastResults.backtest.result !== null
    && "metrics" in input.lastResults.backtest.result
    && typeof (input.lastResults.backtest.result as { metrics?: unknown }).metrics === "object"
    && (input.lastResults.backtest.result as { metrics?: unknown }).metrics !== null
    ? (() => {
        const metrics = (input.lastResults.backtest!.result as { metrics: Record<string, unknown> }).metrics;
        return [
          typeof metrics.totalReturn === "number" ? { label: "Return", value: formatSignedPercent(metrics.totalReturn), tone: metrics.totalReturn >= 0 ? "success" : "danger" } : null,
          typeof metrics.sharpeRatio === "number" ? { label: "Sharpe", value: formatNumber(metrics.sharpeRatio), tone: metrics.sharpeRatio >= 1 ? "success" : "warning" } : null,
          typeof metrics.maxDrawdown === "number" ? { label: "Drawdown", value: `${formatNumber(metrics.maxDrawdown)}%`, tone: metrics.maxDrawdown <= 20 ? "success" : "warning" } : null,
          typeof metrics.totalTrades === "number" ? { label: "Trades", value: String(metrics.totalTrades), tone: "info" } : null,
        ].filter(Boolean) as CockpitLineItem[];
      })()
    : [{ label: "Validation", value: "No recent backtest snapshot", detail: "Run /workflow backtest-cycle or /strategy backtest to populate the lane.", tone: "warning" }];

  const systematicLines: CockpitLineItem[] = [
    {
      label: "Profiles",
      value: `${input.strategyInventory.systematicProfileCount}`,
      detail: `${input.strategyInventory.systematicLiveEligibleCount} live eligible`,
      tone: input.strategyInventory.systematicLiveEligibleCount > 0 ? "success" : "warning",
    },
    {
      label: "Diversification",
      value: input.strategyInventory.diversificationScore !== undefined ? `${formatNumber(input.strategyInventory.diversificationScore, 1)}/100` : "N/A",
      detail: titleCase(input.strategyInventory.concentrationRisk ?? "unknown"),
      tone: "analysis",
    },
  ];

  const queueRows: CockpitTableRow[] = input.strategyInventory.researchExperiments.slice(0, 8).map((experiment) => ({
    key: experiment.experimentId,
    tone: experiment.status === "validated" ? "success" : "analysis",
    cells: [
      experiment.strategyName,
      titleCase(experiment.status),
      experiment.strategyId,
      experiment.experimentId,
    ],
  }));

  return {
    workspace: "lab",
    title: "Strategy bench, validation lane, and systematic slate",
    subtitle: "Turn strategies into ranked, repeatable research assets instead of one-off chat outputs.",
    sections: [
      { id: "bench", label: "Bench", actions: ["/strategies", "/strategy playbooks", "/gen <description>", "/strategy compare <a> <b>"] },
      { id: "validation", label: "Validation", actions: ["/workflow backtest-cycle <strategy> <symbol>", "/strategy backtest <id> <symbol>"] },
      { id: "systematic", label: "Systematic", actions: ["/strategy running", "/strategy evolving", "/systematic status"] },
      { id: "protocol", label: "Protocol", actions: ["/strategy playbooks", "/export lab md"] },
      { id: "queue", label: "Queue", actions: ["/strategy evolving", "/experiment list", "/dataset list"] },
    ],
    bench: {
      headers: ["NAME", "SOURCE", "RISK", "SIGNAL"],
      activeKey: selectedStrategyId,
      rows: benchRows,
      emptyTitle: "No ranked strategy bench yet",
      emptyDetail: "Generate or load strategies to turn the lab into a persistent bench.",
    },
    validation: {
      title: "Validation lane",
      subtitle: input.lastResults.backtest?.summary ?? "Backtests, comparisons, and validation cycles belong in one research lane.",
      lines: validationLines,
    },
    systematic: {
      title: "Systematic slate",
      subtitle: `${input.strategyInventory.researchExperimentCount} tracked experiment(s)`,
      lines: systematicLines,
    },
    protocolMarkdown: buildLabMarkdown(input),
    queue: {
      headers: ["STRATEGY", "STATUS", "SOURCE", "REF"],
      rows: queueRows,
    },
  };
}

function buildMonitorModel(input: CockpitBuildInput): MonitorCockpitModel {
  const portfolio = input.lastResults.portfolioSummary;
  const positions = input.lastResults.positionsSummary;
  const orders = input.lastResults.ordersSummary;

  const bookRows: CockpitTableRow[] = portfolio?.holdings.slice(0, 8).map((holding) => ({
    key: holding.asset,
    tone: "info",
    cells: [holding.asset, formatNumber(holding.amount, 6), formatCurrency(holding.usdtValue), holding.wallet ?? (holding.note ?? "desk")],
  })) ?? [];

  const blotterRows: CockpitTableRow[] = [
    ...(positions?.positions.slice(0, 6).map((position) => ({
      key: `pos:${position.symbol}`,
      tone: position.unrealizedPnl >= 0 ? "success" as DeskTone : "danger" as DeskTone,
      cells: ["POS", position.symbol, titleCase(position.status), `${formatSignedPercent(position.unrealizedPnlPercent)} · ${formatSignedCurrency(position.unrealizedPnl)}`, `${position.minutesOpen} min open`],
    })) ?? []),
    ...(orders?.orders.slice(0, 6).map((order, index) => ({
      key: `ord:${order.symbol}:${index}`,
      tone: "operate" as DeskTone,
      cells: ["ORD", order.symbol, `${order.side} ${order.type}`, `Qty ${order.quantity} @ ${order.price}`, String(order.status)],
    })) ?? []),
  ];

  const runtimeLines: CockpitLineItem[] = [
    { label: "Approvals", value: String(input.runtimeInspector?.pendingApprovalCount ?? 0), detail: "Blocking approvals surface here and inline in the desk transcript.", tone: (input.runtimeInspector?.pendingApprovalCount ?? 0) > 0 ? "warning" : "success" },
    { label: "Plugins", value: `${input.runtimeInspector?.pluginCount ?? 0} loaded · ${input.runtimeInspector?.pluginAttentionCount ?? 0} attention`, detail: `${input.runtimeInspector?.routedPluginCount ?? 0} routed · ${input.runtimeInspector?.commandCount ?? 0} commands`, tone: (input.runtimeInspector?.pluginAttentionCount ?? 0) > 0 ? "warning" : "brand" },
    { label: "Bridge", value: input.runtimeInspector?.remoteConnectionStatus ? titleCase(input.runtimeInspector.remoteConnectionStatus) : "Offline", detail: input.runtimeInspector?.remoteDetail ?? "Daemon and ingress state stay visible in monitor.", tone: (input.runtimeInspector?.activeBridgeSessions ?? 0) > 0 ? "operate" : "neutral" },
    { label: "Runtime", value: `${input.runtimeInspector?.transcriptEntryCount ?? 0} transcript entries`, detail: `${input.runtimeInspector?.mcpServerCount ?? 0} MCP server(s)`, tone: "analysis" },
  ];

  const alertLines: CockpitLineItem[] = positions?.alerts.length
    ? positions.alerts.slice(0, 6).map((alert) => ({
        label: "Position alert",
        value: alert,
        detail: "Review invalidation, execution drift, or health deterioration.",
        tone: "danger",
      }))
    : [{
        label: "Health",
        value: "Monitor clean",
        detail: input.lastResults.workflowSummary?.summary ?? "No recent position alerts were captured in monitor state.",
        tone: input.lastResults.workflowSummary?.success ? "analysis" : "success",
      }];

  return {
    workspace: "monitor",
    title: "Capital, runtime, and live supervision",
    subtitle: "Keep the book, blotter, and runtime in one operator surface.",
    sections: [
      { id: "book", label: "Book", actions: ["/portfolio", "/positions", "/orders", "/health"] },
      { id: "runtime", label: "Runtime", actions: ["/runtime-state", "/runtime-bridge", "/runtime-history"] },
      { id: "blotter", label: "Blotter", actions: ["/positions", "/orders", "/audit recent"] },
      { id: "alerts", label: "Alerts", actions: ["/health", "/audit recent", "/workflow monitor"] },
    ],
    book: {
      headers: ["SYMBOL", "QTY", "VALUE", "VENUE"],
      rows: bookRows,
    },
    blotter: {
      headers: ["LANE", "SYMBOL", "STATUS", "EXPOSURE", "NOTE"],
      rows: blotterRows,
    },
    runtime: {
      title: `Bridge ${input.runtimeInspector?.activeBridgeSessions ?? 0} · background ${input.runtimeInspector?.backgroundTaskCount ?? 0}`,
      subtitle: buildRailsLabel(input),
      lines: runtimeLines,
    },
    alerts: {
      title: alertLines[0]?.value === "Monitor clean" ? "No live alerts in the latest snapshot" : `${alertLines.length} active alert${alertLines.length === 1 ? "" : "s"}`,
      subtitle: input.lastResults.workflowSummary?.summary ?? "Health, runtime, and monitor-cycle issues should land here before they become surprises.",
      lines: alertLines,
    },
  };
}

export function buildCockpitModel(input: CockpitBuildInput): CockpitModel | null {
  switch (input.workspace) {
    case "market":
      return buildMarketModel(input);
    case "plan":
      return buildPlanModel(input);
    case "lab":
      return buildLabModel(input);
    case "monitor":
      return buildMonitorModel(input);
    default:
      return null;
  }
}

export function clampCockpitSectionIndex(model: CockpitModel, selectedIndex: number): number {
  if (model.sections.length === 0) return 0;
  return Math.max(0, Math.min(selectedIndex, model.sections.length - 1));
}

export function getPrimaryCockpitAction(model: CockpitModel, selectedIndex: number): string | null {
  const section = model.sections[clampCockpitSectionIndex(model, selectedIndex)];
  return section?.actions[0] ?? null;
}

