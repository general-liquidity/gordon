import { describe, expect, it } from "bun:test";
import type { GordonContext } from "../../infra/agents/types.ts";
import { SessionController, SessionRuntimeFactory } from "../../runtime/index.ts";
import { createRuntimeInspectorViewModel } from "./RuntimePresenter.ts";

class MockSessionController extends SessionController {
  override async getCurrentSession() {
    return {
      resourceId: "user-1",
      threadId: "thread-1",
      threadStartedAt: "2026-01-01T00:00:00.000Z",
      lastActiveAt: "2026-01-01T00:10:00.000Z",
      sessionCount: 1,
    };
  }
}

function createMockContext(): GordonContext {
  return {
    binance: null,
    exchange: null,
    broker: null,
    llm: {} as GordonContext["llm"],
    config: {
      version: "1.0.0",
      exchanges: [],
      brokers: [],
      agentRails: {
        walletProviders: [],
        chainProviders: [],
        paymentProviders: [],
        autoSyncMcpPlugins: true,
        requireApprovalForExternalActions: true,
      },
      mcpServers: [],
      preferences: {
        cashReservePercent: 0.2,
        maxAllocationPerTrade: 0.1,
        defaultTimeframes: ["1h"],
        topNCoins: 25,
        maxConcurrentTrades: 3,
      },
      memoryConfig: {
        lastMessages: 20,
        maxSessionDurationHours: 24,
        memoryWarningThreshold: 0.8,
      },
      permissionMode: "ask",
      
      onboardingComplete: true,
      startupBannerMode: "full",
      useKeyring: false,
      telemetry: { enabled: false, researchData: false },
      riskManagement: {
        mode: "enforce",
        maxDailyLossPercent: 3,
        maxDrawdownPercent: 15,
        maxPositionSizePercent: 10,
        maxPositions: 5,
      },
      strategyRuntime: {
        allocationStrategy: "equal_weight",
      },
      regimeDetection: {
        autoRegime: true,
      },
      systematic: {
        executionMode: "assisted",
        minTradesForPromotion: 30,
        minValidationScore: 60,
        autoSnapshotDatasets: true,
        autoCreateResearchExperiments: true,
        simulationRealism: {
          profile: "realistic",
          executionLagBars: 1,
          spreadBps: 2,
          marketImpactBps: 1,
        },
        biasDiagnostics: {
          minBacktestDays: 90,
          minOutOfSampleWindows: 3,
          maxTradePnlConcentrationPercent: 55,
          maxCagrPercent: 300,
          requireWalkForward: true,
          requireMonteCarlo: true,
        },
      },
    },
    portfolioValue: 0,
    availableCash: 0,
    userId: "user-1",
    threadId: "thread-1",
  };
}

function createRuntime() {
  const factory = new SessionRuntimeFactory({
    resolveContext: async () => createMockContext(),
    sessionController: new MockSessionController(),
  });
  return { factory, runtime: factory.get("test", { sessionId: "test" }) };
}

describe("RuntimePresenter", () => {
  it("keeps the operator rail hidden for passive transcript-only state", () => {
    const { factory, runtime } = createRuntime();

    try {
      runtime.getTranscriptStore().append({ role: "user", content: "hello" });
      runtime.getTranscriptStore().append({ role: "assistant", content: "world" });

      const viewModel = createRuntimeInspectorViewModel(runtime);

      expect(viewModel.transcriptEntryCount).toBe(2);
      expect(viewModel.hasContent).toBe(false);
    } finally {
      factory.dispose();
    }
  });

  it("shows the operator rail when an approval is pending", () => {
    const { factory, runtime } = createRuntime();

    try {
      runtime.getState().approvals.pending.push({
        id: "approval-12345678",
        toolName: "place_market_order",
        permissionScope: "livetrade.execute",
        approvalClass: "per_action",
        riskClass: "high",
        sideEffectLevel: "execution",
        runtimeId: "test",
        sessionId: "test",
        threadId: "thread-1",
        fingerprint: "fp-1",
        status: "pending",
        requestedAt: "2026-01-01T00:00:00.000Z",
        reason: "Need explicit approval",
      });

      const viewModel = createRuntimeInspectorViewModel(runtime);

      expect(viewModel.pendingApprovalCount).toBe(1);
      expect(viewModel.hasContent).toBe(true);
    } finally {
      factory.dispose();
    }
  });

  it("keeps the operator rail hidden for passive remote degradation alone", () => {
    const { factory, runtime } = createRuntime();

    try {
      runtime.setRemoteState({
        connectionStatus: "degraded",
        reachable: false,
        detail: "IPC daemon unavailable",
      });

      const viewModel = createRuntimeInspectorViewModel(runtime);

      expect(viewModel.remoteConnectionStatus).toBe("degraded");
      expect(viewModel.hasContent).toBe(false);
    } finally {
      factory.dispose();
    }
  });

  it("surfaces plugin lifecycle attention when tooling needs review", () => {
    const { factory, runtime } = createRuntime();

    try {
      runtime.syncToolingState({
        plugins: [
          {
            id: "coingecko",
            name: "CoinGecko",
            enabled: true,
            status: "ready",
            lifecycle: "routed",
            toolCount: 2,
            commandCount: 0,
            surfacedCommandCount: 0,
            attentionLevel: "warning",
            attentionReasons: ["no commands surfaced"],
            integrationCommands: [],
          },
        ],
      });

      const viewModel = createRuntimeInspectorViewModel(runtime);

      expect(viewModel.pluginAttentionCount).toBe(1);
      expect(viewModel.hasContent).toBe(true);
    } finally {
      factory.dispose();
    }
  });
});
