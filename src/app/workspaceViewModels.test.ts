import { describe, expect, it } from "bun:test";
import {
  buildWorkspaceBoardViewModel,
  getPrimaryWorkspaceAction,
  type WorkspaceBoardViewInput,
} from "./workspaceViewModels.ts";
import type { Plan } from "../types/plan.ts";

function createBaseInput(
  workspace: WorkspaceBoardViewInput["workspace"],
): WorkspaceBoardViewInput {
  return {
    workspace,
    mode: "SAFE",
    hasExchange: true,
    hasBroker: false,
    hasWalletRails: false,
    hasMcpServers: true,
    runtimeInspector: {
      streamStatus: "idle",
      permissionScopes: [],
      backgroundTaskCount: 0,
      pendingApprovalCount: 0,
      recentApprovalCount: 0,
      approvalRuleCount: 0,
      pendingApprovals: [],
      pluginCount: 0,
      degradedPluginCount: 0,
      reloadRecommendedCount: 0,
      routedPluginCount: 0,
      pluginAttentionCount: 0,
      mcpServerCount: 1,
      registeredToolCount: 0,
      commandCount: 0,
      routingCount: 0,
      toolingHotReloadEnabled: true,
      recentPlugins: [],
      remoteConnectionStatus: "offline",
      remoteReachable: false,
      activeBridgeSessions: 0,
      recentBridge: [],
      transcriptEntryCount: 0,
      compactionCount: 0,
      recentTranscript: [],
      recentApprovals: [],
      recentScratchpad: [],
      recentHandoffs: [],
      hasContent: false,
      lastUpdatedAt: new Date().toISOString(),
    },
    queuedCount: 0,
    lastResults: {},
    plans: [],
    workspaceMemory: {
      market: {},
      plan: {},
      lab: {},
      monitor: {},
    },
    planReview: {
      portfolioValue: 10000,
      availableCash: 3500,
      maxAllocationPerTrade: 0.1,
      cashReservePercent: 0.2,
    },
    strategyInventory: {
      builtInStrategyCount: 24,
      builtInTier1Count: 5,
      builtInTier2Count: 19,
      builtInStrategies: [],
      generatedStrategies: [],
      playbookCount: 8,
      playbooks: [],
      systematicProfileCount: 2,
      systematicLiveEligibleCount: 1,
      systematicProfiles: [],
      researchExperimentCount: 3,
      researchExperiments: [],
      diversificationScore: 63.5,
      concentrationRisk: "medium",
    },
  };
}

function createPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: "pln_12345678",
    createdAt: "2026-04-02T10:00:00.000Z",
    expiresAt: "2026-04-03T10:00:00.000Z",
    symbol: "BTCUSDT",
    direction: "long",
    strategy: "support_bounce",
    allocation: {
      currency: "USDT",
      amount: 1000,
      percentOfPortfolio: 0.1,
    },
    entry: {
      type: "limit",
      price: 84000,
    },
    dca: null,
    grid: null,
    stopLoss: {
      price: 81000,
    },
    takeProfit: [
      { price: 87000, percentToSell: 0.5 },
      { price: 90000, percentToSell: 0.5 },
    ],
    reasoning: "Support held on higher timeframes and momentum is rebuilding.",
    status: "DRAFT",
    ...overrides,
  };
}

describe("workspace view models", () => {
  it("builds market workspace cards from scan and analysis results", () => {
    const input = createBaseInput("market");
    input.lastResults.scan = {
      coinsScanned: 42,
      opportunities: [
        {
          symbol: "BTCUSDT",
          price: 84500,
          change24h: 4.2,
          setupConfidence: 0.81,
          bias: "bullish",
          risk: "medium",
        },
      ],
      executionTime: 1800,
    };
    input.lastResults.analysis = {
      symbol: "BTCUSDT",
      price: 84500,
      trend: "uptrend",
      setupDetected: true,
      setupConfidence: 0.78,
      indicators: {
        rsi: 58.2,
        macdState: "bullish",
        volumeTrend: "rising",
      },
      supports: [{ price: 83200, strength: 0.72 }],
      resistances: [{ price: 86200, strength: 0.68 }],
    };

    const model = buildWorkspaceBoardViewModel(input);

    expect(model.workspace).toBe("market");
    expect(model.cards[0]?.title).toContain("live setups");
    expect(model.cards[1]?.title).toContain("BTCUSDT");
  });

  it("builds plan workspace cards from stored plans and approvals", () => {
    const input = createBaseInput("plan");
    input.runtimeInspector = {
      ...input.runtimeInspector!,
      pendingApprovalCount: 2,
    };
    input.plans = [
      createPlan(),
      createPlan({
        id: "pln_approved",
        status: "APPROVED",
        symbol: "ETHUSDT",
        strategy: "ema_rsi_crossover",
      }),
    ];

    const model = buildWorkspaceBoardViewModel(input);

    expect(model.cards[0]?.title).toContain("BTCUSDT");
    expect(model.cards[1]?.title).toContain("stored tickets");
    expect(model.cards[1]?.notes).toContain("Approved: 1");
  });

  it("returns the primary action for the selected workspace card", () => {
    const input = createBaseInput("market");
    input.lastResults.scan = {
      coinsScanned: 12,
      opportunities: [
        {
          symbol: "BTCUSDT",
          price: 84500,
          change24h: 2.1,
          setupConfidence: 0.76,
          bias: "bullish",
          risk: "medium",
        },
      ],
      executionTime: 1200,
    };

    const model = buildWorkspaceBoardViewModel(input);
    expect(getPrimaryWorkspaceAction(model, 0)).toBe("/scan");
  });

  it("builds lab workspace cards from strategy inventory and backtest data", () => {
    const input = createBaseInput("lab");
    input.strategyInventory.generatedStrategies = [
      { id: "gen_rsi", name: "RSI Bounce", backtestReturn: 12.4, backtestSharpe: 1.3 },
    ];
    input.lastResults.backtest = {
      summary: "Recent backtest complete.",
      result: {
        metrics: {
          totalReturn: 12.4,
          sharpeRatio: 1.3,
          maxDrawdown: 8.2,
          totalTrades: 21,
        },
      },
    };

    const model = buildWorkspaceBoardViewModel(input);

    expect(model.cards[0]?.title).toContain("generated");
    expect(model.cards[1]?.title).toContain("Last backtest");
    expect(model.cards[2]?.rows?.some((row) => row.label === "Live eligible" && row.value === "1")).toBe(true);
  });

  it("builds monitor workspace cards from portfolio and book snapshots", () => {
    const input = createBaseInput("monitor");
    input.lastResults.portfolioSummary = {
      message: "Portfolio snapshot",
      totalValue: 15250,
      availableCash: 4200,
      executionTime: 1200,
      holdings: [
        { asset: "BTC", amount: 0.12, usdtValue: 10150 },
      ],
    };
    input.lastResults.positionsSummary = {
      message: "Positions snapshot",
      count: 1,
      totalUnrealized: 240,
      positions: [
        {
          symbol: "BTCUSDT",
          status: "healthy",
          unrealizedPnl: 240,
          unrealizedPnlPercent: 2.8,
          minutesOpen: 95,
        },
      ],
      alerts: [],
    };
    input.lastResults.ordersSummary = {
      message: "Orders snapshot",
      count: 2,
      orders: [
        {
          symbol: "BTCUSDT",
          side: "BUY",
          type: "LIMIT",
          status: "NEW",
          quantity: 0.01,
          price: 83000,
          executedQty: 0,
        },
      ],
    };

    const model = buildWorkspaceBoardViewModel(input);

    expect(model.cards[0]?.title).toContain("$15250.00");
    expect(model.cards[1]?.title).toContain("open position");
    expect(model.cards[2]?.rows?.some((row) => row.label === "Approvals")).toBe(true);
  });
});
