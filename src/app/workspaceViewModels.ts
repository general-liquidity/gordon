import type { AnalysisExportData, BacktestExportData, ScanExportData } from "./commands/export.ts";
import type { RuntimeInspectorViewModel } from "./presenters/RuntimePresenter.ts";
import type {
  LastResults,
  WorkflowWorkspaceSnapshot,
  WorkspaceMemoryState,
  WorkspaceId,
} from "./state/AppStore.ts";
import type { DeskTone } from "./components/desk/DeskPanel.tsx";
import type { Plan } from "../types/plan.ts";
import { calculateAllocationPercent, calculateRiskReward } from "../core/validator.ts";
import { getRuntimeApprovalShortId } from "./runtimeApprovalId.ts";

export interface WorkspaceBoardRowViewModel {
  label: string;
  value: string;
  detail?: string;
  tone?: DeskTone;
}

export interface WorkspaceBoardCardViewModel {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  tone?: DeskTone;
  variant?: "ticket" | "panel";
  actions?: string[];
  rows?: WorkspaceBoardRowViewModel[];
  notes?: string[];
}

export interface WorkspaceBoardViewModel {
  workspace: Exclude<WorkspaceId, "desk">;
  title: string;
  subtitle: string;
  cards: WorkspaceBoardCardViewModel[];
}

export function clampWorkspaceCardIndex(model: WorkspaceBoardViewModel, selectedCardIndex: number): number {
  if (model.cards.length === 0) {
    return 0;
  }
  return Math.max(0, Math.min(selectedCardIndex, model.cards.length - 1));
}

export function getPrimaryWorkspaceAction(
  model: WorkspaceBoardViewModel,
  selectedCardIndex: number,
): string | null {
  if (model.cards.length === 0) {
    return null;
  }

  const selectedCard = model.cards[clampWorkspaceCardIndex(model, selectedCardIndex)];
  if (selectedCard?.actions?.[0]) {
    return selectedCard.actions[0];
  }

  for (const card of model.cards) {
    if (card.actions?.[0]) {
      return card.actions[0];
    }
  }

  return null;
}

export interface WorkspaceStrategyInventorySnapshot {
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

export interface WorkspaceBoardViewInput {
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
  strategyInventory: WorkspaceStrategyInventorySnapshot;
  planReview: {
    portfolioValue: number;
    availableCash: number;
    maxAllocationPerTrade: number;
    cashReservePercent: number;
  };
}

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

function buildRailsLabel(input: WorkspaceBoardViewInput): string {
  const rails = [
    input.hasExchange ? "exchange" : null,
    input.hasBroker ? "broker" : null,
    input.hasWalletRails ? "wallet rails" : null,
    input.hasMcpServers ? "mcp" : null,
  ].filter(Boolean);

  return rails.length > 0 ? rails.join(" · ") : "no live rails configured";
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
  rows: WorkspaceBoardRowViewModel[];
} | null {
  const selectedStrategyId = input.workspaceMemory.lab.selectedStrategyId;
  const selectedSource = input.workspaceMemory.lab.selectedSource;

  if (selectedStrategyId && selectedSource === "generated") {
    const strategy = input.strategyInventory.generatedStrategies.find((entry) => entry.id === selectedStrategyId);
    if (strategy) {
      return {
        label: strategy.name,
        source: "Generated strategy",
        subtitle: `${strategy.id}${strategy.timeframes?.length ? ` · ${strategy.timeframes.join(", ")}` : ""}`,
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
        source: "Systematic profile",
        subtitle: `${profile.strategyId} · ${titleCase(profile.marketFamily)}`,
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
      source: "Built-in strategy",
      subtitle: `${builtIn.id} · ${builtIn.timeframes.join(", ")}`,
      rows: [
        { label: "Risk", value: titleCase(builtIn.riskLevel), tone: "warning" },
        { label: "Timeframes", value: builtIn.timeframes.join(", "), tone: "info" },
      ],
    };
  }

  return null;
}

function extractBacktestSummary(
  backtest: BacktestExportData | undefined,
  workflow: WorkflowWorkspaceSnapshot | undefined,
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

function buildMarketWorkspace(input: WorkspaceBoardViewInput): WorkspaceBoardViewModel {
  const scan = input.lastResults.scan;
  const analysis = input.lastResults.analysis;
  const regime = input.lastResults.regime;
  const workflow = input.lastResults.workflowSummary;
  const focusSymbol = input.workspaceMemory.market.focusSymbol;

  const topOpportunity = scan?.opportunities?.[0];
  const scanCard: WorkspaceBoardCardViewModel = topOpportunity
    ? {
        eyebrow: "Scan Board",
        title: `${scan?.opportunities?.length ?? 0} live setups from the last sweep`,
        subtitle: `${scan?.coinsScanned ?? 0} symbols scanned${scan?.executionTime ? ` · ${scan.executionTime}ms` : ""}`,
        tone: "info",
        variant: "panel",
        actions: ["/scan", "/trending", "/breakouts", "/regime", "/score"],
        rows: scan?.opportunities?.slice(0, 4).map((opportunity) => ({
          label: opportunity.symbol,
          value: `${formatSignedPercent(opportunity.change24h)} · ${titleCase(opportunity.bias)} · ${titleCase(opportunity.risk)}`,
          detail: `Price ${formatCurrency(opportunity.price)} · setup ${(opportunity.setupConfidence * 100).toFixed(0)}%`,
          tone: opportunity.setupConfidence >= 0.7 ? "success" : "analysis",
        })),
      }
    : {
        eyebrow: "Scan Board",
        title: "Turn the tape into a shortlist",
        subtitle: "Market discovery becomes durable once scan results land here.",
        tone: "info",
        actions: ["/scan", "/trending", "/breakouts", "/regime", "/score"],
        notes: [
          "Run /scan to build the board from live setups.",
          "Use /trending or /breakouts when you want faster discovery loops.",
        ],
      };

  const analysisCard: WorkspaceBoardCardViewModel = analysis?.symbol
    ? {
        eyebrow: "Deep Dive",
        title: `${focusSymbol ?? analysis.symbol} in focus`,
        subtitle: analysis.formattedSummary ?? "Latest symbol analysis in the active session.",
        tone: analysis.setupDetected ? "analysis" : "neutral",
        variant: "panel",
        actions: [`/analyze ${analysis.symbol}`, `/ta ${analysis.symbol}`, `/chart ${analysis.symbol}`, `/whales ${analysis.symbol}`],
        rows: [
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
        ].filter(Boolean) as WorkspaceBoardRowViewModel[],
      }
    : {
        eyebrow: "Symbol Drill-Down",
        title: focusSymbol ? `${focusSymbol} queued for a deeper read` : "Push one symbol through a deeper read",
        subtitle: "Current desk posture stays in the transcript; this board keeps the next market actions visible.",
        tone: "analysis",
        actions: [
          focusSymbol ? `/analyze ${focusSymbol}` : "/analyze BTC",
          focusSymbol ? `/ta ${focusSymbol}` : "/ta BTC 4h",
          focusSymbol ? `/chart ${focusSymbol}` : "/chart BTC 4h",
          "/regime",
        ],
      };

  const regimeLabel = regime && typeof regime === "object"
    ? pickString(regime, ["regime", "currentRegime", "marketRegime", "state", "label"])
    : undefined;

  const contextRows: WorkspaceBoardRowViewModel[] = [
    {
      label: "Rails",
      value: buildRailsLabel(input),
      detail: "Market discovery is strongest when exchange data and MCP research rails are both online.",
      tone: "neutral",
    },
  ];

  if (regimeLabel) {
    contextRows.unshift({
      label: "Regime",
      value: titleCase(regimeLabel),
      detail: "Translate conditions into the right time horizon and playbook before sizing risk.",
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
      label: "Focus",
      value: focusSymbol,
      detail: "Pinned from the last symbol-specific market action.",
      tone: "info",
    });
  }

  return {
    workspace: "market",
    title: "Turn the tape into a shortlist.",
    subtitle: "Scan movers, regime, and symbol context.",
    cards: [
      scanCard,
      analysisCard,
      {
        eyebrow: "Market Context",
        title: "Discovery posture",
        subtitle: "Persistent market context belongs here instead of being buried in transcript noise.",
        tone: "brand",
        variant: "panel",
        actions: ["/regime", "/regime-history", "/ensemble", "/workflow dd BTC"],
        rows: contextRows,
      },
    ],
  };
}

function buildPlanWorkspace(input: WorkspaceBoardViewInput): WorkspaceBoardViewModel {
  const focusedPlan = getFocusedPlan(input);
  const planCounts = {
    draft: input.plans.filter((plan) => plan.status === "DRAFT").length,
    approved: input.plans.filter((plan) => plan.status === "APPROVED").length,
    executing: input.plans.filter((plan) => plan.status === "EXECUTING").length,
  };

  const latestPlanCard: WorkspaceBoardCardViewModel = focusedPlan
    ? {
        eyebrow: "Trade Ticket",
        title: `${focusedPlan.symbol} · ${titleCase(focusedPlan.strategy)}`,
        subtitle: `${titleCase(focusedPlan.status)} · ${focusedPlan.direction.toUpperCase()} bias`,
        tone: focusedPlan.status === "APPROVED" ? "success" : focusedPlan.status === "EXECUTING" ? "operate" : "warning",
        variant: "panel",
        actions: [`/plans`, `/preview-order ${focusedPlan.symbol}`, `/orders`, `/positions`],
        rows: [
          {
            label: "Entry",
            value: focusedPlan.entry.price ? formatCurrency(focusedPlan.entry.price) : "Market",
            detail: `Type ${titleCase(focusedPlan.entry.type)}`,
            tone: "info",
          },
          {
            label: "Stop",
            value: formatCurrency(focusedPlan.stopLoss.price),
            detail: focusedPlan.takeProfit[0]
              ? `TP1 ${formatCurrency(focusedPlan.takeProfit[0].price)}`
              : "No take-profit ladder",
            tone: "warning",
          },
          {
            label: "Allocation",
            value: `${formatCurrency(focusedPlan.allocation.amount)} · ${formatPercent(focusedPlan.allocation.percentOfPortfolio)}`,
            detail: focusedPlan.grid
              ? `${focusedPlan.grid.levels.length} grid levels`
              : focusedPlan.dca
                ? `${focusedPlan.dca.length} DCA levels`
                : "Single entry ticket",
            tone: "operate",
          },
          {
            label: "Plan ID",
            value: focusedPlan.id,
            detail: focusedPlan.expiresAt ? `Expires ${focusedPlan.expiresAt}` : "No expiry set",
            tone: "analysis",
          },
        ],
        notes: [focusedPlan.reasoning],
      }
    : {
        eyebrow: "Trade Ticket",
        title: "Review tickets before action",
        subtitle: "This is Gordon's trading-native review surface.",
        tone: "warning",
        actions: ["/plan BTC", "/grid BTC", "/preview-order", "/orders", "/positions"],
        notes: [
          "Create a ticket with /plan or /grid and it will appear here for review.",
        ],
      };

  const recentPlanRows: WorkspaceBoardRowViewModel[] = input.plans.slice(0, 5).map((plan) => ({
    label: plan.symbol,
    value: `${titleCase(plan.status)} · ${titleCase(plan.strategy)}`,
    detail: `${formatCurrency(plan.allocation.amount)} · ${plan.entry.price ? formatCurrency(plan.entry.price) : "Market"} · ${plan.id}`,
    tone: plan.id === focusedPlan?.id
      ? "analysis"
      : plan.status === "APPROVED"
        ? "success"
        : plan.status === "EXECUTING"
          ? "operate"
          : "warning",
  }));

  const approvalRows = input.runtimeInspector?.pendingApprovals?.slice(0, 4).map((request) => ({
    label: getRuntimeApprovalShortId(request.id),
    value: `${request.toolName} · ${request.reason ?? "Approval required"}`,
    detail: `Scope ${request.permissionScope} · ${request.riskClass} risk · approve ${getRuntimeApprovalShortId(request.id)} · deny ${getRuntimeApprovalShortId(request.id)} reason`,
    tone: "warning" as DeskTone,
  })) ?? [];

  const riskReviewRows: WorkspaceBoardRowViewModel[] = focusedPlan
    ? (() => {
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
      })()
    : [
        {
          label: "Risk",
          value: "No active ticket",
          detail: "Create a plan to populate risk, reserve, and execution readiness.",
          tone: "warning",
        },
      ];

  return {
    workspace: "plan",
    title: "Review tickets before action.",
    subtitle: "Trade thesis, sizing, invalidation, and approvals.",
    cards: [
      latestPlanCard,
      {
        eyebrow: "Plan Book",
        title: `${input.plans.length} stored tickets`,
        subtitle: `Pending approvals ${input.runtimeInspector?.pendingApprovalCount ?? 0} · queue ${input.queuedCount}`,
        tone: "brand",
        variant: "panel",
        actions: ["/plans", "/runtime-approvals", "approve <id>", "deny <id> reason"],
        rows: recentPlanRows.length > 0 ? recentPlanRows : [
          {
            label: "Tickets",
            value: "No stored plans yet",
            detail: "Create a plan and Gordon will keep it here for review and execution.",
            tone: "warning",
          },
        ],
        notes: [
          { label: "Draft", value: String(planCounts.draft), tone: "warning" },
          { label: "Approved", value: String(planCounts.approved), tone: "success" },
          { label: "Executing", value: String(planCounts.executing), tone: "operate" },
        ].map((row) => `${row.label}: ${row.value}`),
      },
      {
        eyebrow: "Risk Review",
        title: focusedPlan ? "Sizing, reserve, and reward/risk" : "Readiness appears here",
        subtitle: focusedPlan
          ? "This is the plan-native equivalent of a final review before execution."
          : "Risk review becomes durable once a ticket is on the desk.",
        tone: focusedPlan?.status === "APPROVED" ? "success" : "analysis",
        variant: "panel",
        actions: ["/preview-order", "/plans", "/positions", "/runtime-approvals"],
        rows: riskReviewRows,
      },
      {
        eyebrow: "Approval Lane",
        title: input.runtimeInspector?.pendingApprovalCount
          ? `${input.runtimeInspector.pendingApprovalCount} blocking approval(s)`
          : "No blocking approvals",
        subtitle: focusedPlan
          ? `Keep approval adjacent to ${focusedPlan.symbol}, not buried in diagnostics.`
          : "Approval remains explicit even before a ticket exists.",
        tone: input.runtimeInspector?.pendingApprovalCount ? "warning" : "success",
        variant: "panel",
        actions: ["/runtime-approvals", "approve <id>", "deny <id> reason"],
        rows: approvalRows.length > 0 ? approvalRows : [
          {
            label: "Mode",
            value: input.mode,
            detail: input.mode === "ARMED" ? "Live desk enabled." : "Read-only desk until explicitly armed.",
            tone: input.mode === "ARMED" ? "danger" : "success",
          },
          {
            label: "Routing",
            value: input.hasExchange || input.hasBroker ? "Execution rails online" : "No execution rail",
            detail: input.hasExchange || input.hasBroker
              ? "Preview before live action to keep risk explicit."
              : "Connect an exchange or broker before you route the ticket.",
            tone: input.hasExchange || input.hasBroker ? "operate" : "danger",
          },
        ],
      },
    ],
  };
}

function buildLabWorkspace(input: WorkspaceBoardViewInput): WorkspaceBoardViewModel {
  const backtestSummary = extractBacktestSummary(
    input.lastResults.backtest,
    input.lastResults.workflowSummary,
  );
  const generatedTop = input.strategyInventory.generatedStrategies.slice(0, 3);
  const focusedStrategy = getFocusedLabStrategy(input);
  const experimentRows: WorkspaceBoardRowViewModel[] = input.strategyInventory.researchExperiments.slice(0, 4).map((experiment) => ({
    label: experiment.strategyName,
    value: titleCase(experiment.status),
    detail: `${experiment.strategyId} · ${experiment.experimentId}`,
    tone: experiment.status === "validated" ? "success" : "analysis",
  }));
  const systematicRows: WorkspaceBoardRowViewModel[] = input.strategyInventory.systematicProfiles.slice(0, 4).map((profile) => ({
    label: profile.strategyName,
    value: `${titleCase(profile.status)} · ${formatNumber(profile.validationScore, 1)}/100`,
    detail: `${titleCase(profile.marketFamily)} · ${formatPercent(profile.capitalWeight)}`,
    tone: profile.liveEligible ? "success" : "warning",
  }));
  const registryRows: WorkspaceBoardRowViewModel[] = [
    ...input.strategyInventory.builtInStrategies.slice(0, 3).map((strategy) => ({
      label: strategy.id,
      value: strategy.name,
      detail: `${titleCase(strategy.riskLevel)} · ${strategy.timeframes.join(", ")}`,
      tone: "analysis" as DeskTone,
    })),
    ...input.strategyInventory.playbooks.slice(0, 2).map((playbook) => ({
      label: playbook.id,
      value: playbook.name,
      detail: `Playbook · ${titleCase(playbook.riskLevel)} · ${playbook.timeframes.join(", ")}`,
      tone: "info" as DeskTone,
    })),
  ];

  return {
    workspace: "lab",
    title: "Build, compare, and validate strategies.",
    subtitle: "Strategies, playbooks, backtests, and systematic research.",
    cards: [
      {
        eyebrow: focusedStrategy?.source ?? "Strategy Registry",
        title: focusedStrategy?.label ?? `${input.strategyInventory.builtInStrategyCount} built-in · ${input.strategyInventory.generatedStrategies.length} generated`,
        subtitle: focusedStrategy?.subtitle ?? `${input.strategyInventory.playbookCount} playbooks · tier 1 ${input.strategyInventory.builtInTier1Count} · tier 2 ${input.strategyInventory.builtInTier2Count}`,
        tone: "analysis",
        variant: "panel",
        actions: ["/strategies", "/strategy playbooks", "/gen <description>", "/strategy compare <a> <b>"],
        rows: focusedStrategy?.rows ?? (
          generatedTop.length > 0
          ? generatedTop.map((strategy) => ({
              label: strategy.id,
              value: strategy.name,
              detail: strategy.backtestReturn !== undefined
                ? `Return ${formatSignedPercent(strategy.backtestReturn)}${strategy.backtestSharpe !== undefined ? ` · Sharpe ${formatNumber(strategy.backtestSharpe)}` : ""}`
                : "Generated strategy awaiting validation.",
              tone: strategy.backtestReturn !== undefined && strategy.backtestReturn >= 0 ? "success" : "analysis",
            }))
          : [
              {
                label: "Generated",
                value: "No stored generated strategies yet",
                detail: "Use /gen or strategy_generate to create one and route it into validation.",
                tone: "warning",
              },
            ]
        ),
      },
      {
        eyebrow: "Validation Lane",
        title: backtestSummary?.title ?? "Backtests and experiments",
        subtitle: backtestSummary?.subtitle ?? "Use the lab for repeated research workflows instead of pushing everything through general chat.",
        tone: "info",
        variant: "panel",
        actions: ["/workflow backtest-cycle <strategy> <symbol>", "/strategy backtest <id> <symbol>", "/dataset list"],
        rows: backtestSummary?.rows ?? [
          {
            label: "Backtests",
            value: "No recent backtest snapshot",
            detail: "Run /workflow backtest-cycle or /strategy backtest to populate the lab.",
            tone: "warning",
          },
        ],
      },
      {
        eyebrow: "Systematic Runtime",
        title: `${input.strategyInventory.systematicProfileCount} strategy profile(s) tracked`,
        subtitle: `${input.strategyInventory.researchExperimentCount} research experiment(s) · concentration ${titleCase(input.strategyInventory.concentrationRisk ?? "unknown")}`,
        tone: "success",
        variant: "panel",
        actions: ["/strategy running", "/strategy evolving", "/systematic status", "/experiment list"],
        rows: systematicRows.length > 0 ? systematicRows : [
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
        notes: experimentRows.slice(0, 3).map((row) => `${row.label}: ${row.value}`),
      },
      {
        eyebrow: "Registry Shelf",
        title: `${input.strategyInventory.builtInStrategyCount} strategies · ${input.strategyInventory.playbookCount} playbooks`,
        subtitle: "Core strategy inventory should stay visible even when the latest run is experimental.",
        tone: "brand",
        variant: "panel",
        actions: ["/strategies", "/strategy info <id>", "/strategy playbooks", "/strategy compare <a> <b>"],
        rows: registryRows.length > 0 ? registryRows : [
          {
            label: "Registry",
            value: "No strategy inventory loaded",
            detail: "Hydrate the registry and playbook stores to turn the lab into a working shelf.",
            tone: "warning",
          },
        ],
      },
      {
        eyebrow: "Research Queue",
        title: `${input.strategyInventory.researchExperimentCount} tracked experiment(s)`,
        subtitle: "Genome variants, validation loops, and runtime promotion belong in one lab lane.",
        tone: "info",
        variant: "panel",
        actions: ["/strategy evolving", "/experiment list", "/dataset list"],
        rows: experimentRows.length > 0 ? experimentRows : [
          {
            label: "Experiments",
            value: "No recent systematic experiments",
            detail: "Run validation and evolutionary loops to populate the queue.",
            tone: "warning",
          },
        ],
      },
    ],
  };
}

function buildMonitorWorkspace(input: WorkspaceBoardViewInput): WorkspaceBoardViewModel {
  const portfolio = input.lastResults.portfolioSummary;
  const positions = input.lastResults.positionsSummary;
  const orders = input.lastResults.ordersSummary;
  const focusSection = input.workspaceMemory.monitor.focusSection;
  const holdingRows = portfolio?.holdings.slice(0, 4).map((holding) => ({
    label: holding.asset,
    value: formatCurrency(holding.usdtValue),
    detail: `${formatNumber(holding.amount, 6)} units${holding.note ? ` · ${holding.note}` : ""}`,
    tone: "info" as DeskTone,
  })) ?? [];
  const positionRows = positions?.positions.slice(0, 4).map((position) => ({
    label: position.symbol,
    value: `${formatSignedCurrency(position.unrealizedPnl)} · ${formatSignedPercent(position.unrealizedPnlPercent)}`,
    detail: `${titleCase(position.status)} · ${position.minutesOpen} min open`,
    tone: position.unrealizedPnl >= 0 ? "success" : "danger" as DeskTone,
  })) ?? [];
  const orderRows = orders?.orders.slice(0, 4).map((order) => ({
    label: order.symbol,
    value: `${order.side} ${order.type}`,
    detail: `Qty ${order.quantity} @ ${order.price} · ${order.status}`,
    tone: "operate" as DeskTone,
  })) ?? [];
  const alertRows: WorkspaceBoardRowViewModel[] = positions?.alerts.slice(0, 4).map((alert) => ({
    label: "Alert",
    value: alert,
    detail: "Review position health, invalidation, or execution drift.",
    tone: "danger" as DeskTone,
  })) ?? [];

  return {
    workspace: "monitor",
    title: "Supervise capital, runtime, and live state.",
    subtitle: "Book, orders, health, runtime, and bridge activity.",
    cards: [
      {
        eyebrow: "Book",
        title: portfolio
          ? `${formatCurrency(portfolio.totalValue)} total · ${formatCurrency(portfolio.availableCash)} cash`
          : "Supervise capital and exposure",
        subtitle: portfolio
          ? `${portfolio.holdings.length} holding(s) in the latest snapshot${focusSection === "book" ? " · focus book" : ""}`
          : "Portfolio, positions, orders, and health are operator surfaces, not side notes.",
        tone: "operate",
        variant: "panel",
        actions: ["/portfolio", "/positions", "/orders", "/health", "/history"],
        rows: portfolio
          ? holdingRows.length > 0
            ? holdingRows
            : [
                {
                  label: "Holdings",
                  value: String(portfolio.holdings.length),
                  detail: "Latest exchange snapshot on the active desk.",
                  tone: "analysis",
                },
              ]
          : [
              {
                label: "Portfolio",
                value: "No recent snapshot",
                detail: "Run /portfolio to pull the latest holdings and cash state.",
                tone: "warning",
              },
            ],
      },
      {
        eyebrow: "Positions & Orders",
        title: `${positions?.count ?? 0} open position(s) · ${orders?.count ?? 0} open order(s)`,
        subtitle: positions
          ? `${formatSignedCurrency(positions.totalUnrealized)} unrealized${focusSection === "positions" ? " · focus positions" : ""}`
          : "Route /positions and /orders to keep live supervision current.",
        tone: "warning",
        variant: "panel",
        actions: ["/positions", "/orders", "/audit recent", "/runtime-history"],
        rows: [
          ...(positionRows.length > 0 ? positionRows : [
            {
              label: "Positions",
              value: "No recent snapshot",
              detail: "Run /positions to capture the live book.",
              tone: "warning" as DeskTone,
            },
          ]),
          ...(orderRows.length > 0 ? orderRows : [
            {
              label: "Orders",
              value: "No recent snapshot",
              detail: "Run /orders to refresh working orders.",
              tone: "warning" as DeskTone,
            },
          ]),
          positions?.alerts.length
            ? {
                label: "Alerts",
                value: `${positions.alerts.length} active`,
                detail: positions.alerts[0],
                tone: "danger",
              }
            : null,
        ].filter(Boolean) as WorkspaceBoardRowViewModel[],
      },
      {
        eyebrow: "Runtime",
        title: `Bridge ${input.runtimeInspector?.activeBridgeSessions ?? 0} · background ${input.runtimeInspector?.backgroundTaskCount ?? 0}`,
        subtitle: `${buildRailsLabel(input)}${focusSection === "runtime" ? " · focus runtime" : ""}`,
        tone: "brand",
        variant: "panel",
        actions: ["/runtime-state", "/runtime-bridge", "/runtime-history", "/exchange status"],
        rows: [
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
            detail: input.runtimeInspector?.remoteDetail ?? "Daemon and ingress state belong in monitor, not setup.",
            tone: input.runtimeInspector?.activeBridgeSessions ? "operate" : "neutral",
          },
          {
            label: "Runtime",
            value: `${input.runtimeInspector?.transcriptEntryCount ?? 0} transcript entries`,
            detail: `${input.runtimeInspector?.pluginCount ?? 0} plugin(s) · ${input.runtimeInspector?.mcpServerCount ?? 0} MCP server(s)`,
            tone: "analysis",
          },
        ],
      },
      {
        eyebrow: "Alerts & Health",
        title: alertRows.length > 0
          ? `${alertRows.length} active alert(s)`
          : "No live alerts in the latest monitor snapshot",
        subtitle: input.lastResults.workflowSummary
          ? `${titleCase(input.lastResults.workflowSummary.workflow)} · ${input.lastResults.workflowSummary.summary}`
          : "Runtime, health, and monitor-cycle issues should land here before they become surprises.",
        tone: alertRows.length > 0 ? "danger" : "success",
        variant: "panel",
        actions: ["/health", "/audit recent", "/runtime-history", "/workflow monitor"],
        rows: alertRows.length > 0 ? alertRows : [
          {
            label: "Health",
            value: "Monitor clean",
            detail: "No recent position alerts were captured in the persisted monitor state.",
            tone: "success",
          },
          {
            label: "Workflow",
            value: input.lastResults.workflowSummary?.workflow
              ? titleCase(input.lastResults.workflowSummary.workflow)
              : "No recent monitor workflow",
            detail: input.lastResults.workflowSummary?.summary ?? "Run a monitor workflow to keep watch-state warm.",
            tone: input.lastResults.workflowSummary?.success ? "analysis" : "warning",
          },
        ],
      },
    ],
  };
}

export function buildWorkspaceBoardViewModel(input: WorkspaceBoardViewInput): WorkspaceBoardViewModel {
  switch (input.workspace) {
    case "market":
      return buildMarketWorkspace(input);
    case "plan":
      return buildPlanWorkspace(input);
    case "lab":
      return buildLabWorkspace(input);
    case "monitor":
      return buildMonitorWorkspace(input);
    default:
      return {
        workspace: input.workspace,
        title: "Workspace",
        subtitle: "No view model available.",
        cards: [],
      };
  }
}
