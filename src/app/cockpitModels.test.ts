import { describe, expect, it } from "bun:test";

import type { Plan } from "../types/plan.ts";
import {
  buildCockpitModel,
  clampCockpitSectionIndex,
  getPrimaryCockpitAction,
  type CockpitBuildInput,
} from "./cockpitModels.ts";

function createBaseInput(
  workspace: CockpitBuildInput["workspace"],
): CockpitBuildInput {
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

describe("cockpit models", () => {
  it("builds a market cockpit with shortlist rows and a dossier", () => {
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

    const model = buildCockpitModel(input);

    expect(model?.workspace).toBe("market");
    if (!model || model.workspace !== "market") throw new Error("Expected market cockpit");
    expect(model.shortlist.rows[0]?.cells[0]).toBe("BTCUSDT");
    expect(model.dossier.title).toContain("BTCUSDT");
    expect(getPrimaryCockpitAction(model, 0)).toBe("/scan");
  });

  it("builds a plan cockpit with ticket, approvals, risk, and book", () => {
    const input = createBaseInput("plan");
    input.mode = "ARMED";
    input.plans = [
      createPlan(),
      createPlan({
        id: "pln_approved",
        status: "APPROVED",
        symbol: "ETHUSDT",
        strategy: "ema_rsi_crossover",
      }),
    ];
    input.runtimeInspector = {
      ...input.runtimeInspector!,
      pendingApprovalCount: 1,
      pendingApprovals: [
        {
          id: "approval_1234abcd",
          toolName: "place_order",
          reason: "Live order requires sign-off",
          permissionScope: "broker:trade",
          riskClass: "high",
        } as never,
      ],
    };

    const model = buildCockpitModel(input);

    expect(model?.workspace).toBe("plan");
    if (!model || model.workspace !== "plan") throw new Error("Expected plan cockpit");
    expect(model.ticket.title).toContain("BTCUSDT");
    expect(model.approvals.rows[0]?.tool).toBe("place_order");
    expect(model.book.rows).toHaveLength(2);
    expect(clampCockpitSectionIndex(model, 8)).toBe(3);
    expect(getPrimaryCockpitAction(model, 1)).toBe("/runtime-approvals");
  });

  it("builds a lab cockpit from strategy inventory and backtest state", () => {
    const input = createBaseInput("lab");
    input.workspaceMemory.lab = {
      selectedStrategyId: "gen_rsi",
      selectedSource: "generated",
    };
    input.strategyInventory.generatedStrategies = [
      { id: "gen_rsi", name: "RSI Bounce", riskLevel: "medium", backtestReturn: 12.4, backtestSharpe: 1.3 },
    ];
    input.strategyInventory.builtInStrategies = [
      { id: "ema_cross", name: "EMA Cross", riskLevel: "medium", timeframes: ["1h", "4h"] },
    ];
    input.strategyInventory.playbooks = [
      { id: "pb_mean", name: "Mean Reversion", riskLevel: "medium", timeframes: ["15m", "1h"] },
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

    const model = buildCockpitModel(input);

    expect(model?.workspace).toBe("lab");
    if (!model || model.workspace !== "lab") throw new Error("Expected lab cockpit");
    expect(model.bench.rows[0]?.cells[0]).toContain("RSI");
    expect(model.validation.title).toContain("Validation");
    expect(model.protocolMarkdown).toContain("Lab protocol");
    expect(getPrimaryCockpitAction(model, 0)).toBe("/strategies");
  });

  it("builds a monitor cockpit from book, positions, orders, and runtime state", () => {
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

    const model = buildCockpitModel(input);

    expect(model?.workspace).toBe("monitor");
    if (!model || model.workspace !== "monitor") throw new Error("Expected monitor cockpit");
    expect(model.book.rows[0]?.cells[0]).toBe("BTC");
    expect(model.blotter.rows[0]?.cells[1]).toBe("BTCUSDT");
    expect(model.runtime.lines[0]?.label).toBe("Approvals");
    expect(getPrimaryCockpitAction(model, 2)).toBe("/positions");
  });
});
