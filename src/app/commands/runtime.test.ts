import { describe, expect, it } from "bun:test";
import type { GordonContext } from "../../infra/agents/types.ts";
import { SessionRuntimeFactory } from "../../runtime/index.ts";
import { SessionController } from "../../runtime/index.ts";
import {
  applyRuntimeApprovalDecision,
  compactRuntimeTranscript,
  formatRuntimeApprovals,
  formatRuntimeBridge,
  formatRuntimeHistory,
  formatRuntimeHandoffs,
  formatRuntimePlugins,
  formatRuntimeScratchpad,
  formatRuntimeSessionInfo,
  formatRuntimeState,
  formatRuntimeTranscript,
} from "./runtime.ts";

class MockSessionController extends SessionController {
  override async getCurrentSession() {
    return {
      resourceId: "user-1",
      threadId: "thread-1",
      threadStartedAt: "2026-01-01T00:00:00.000Z",
      lastActiveAt: "2026-01-01T00:10:00.000Z",
      sessionCount: 3,
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
  const runtime = factory.get("test", { sessionId: "test" });
  runtime.getTranscriptStore().append({ role: "user", content: "scan btc" });
  runtime.getTranscriptStore().append({ role: "assistant", content: "scanner ready" });
  runtime.getScratchpadStore().appendEntry({
    worker: "Analyst",
    kind: "note",
    content: "BTC momentum still positive",
  });
  runtime.getScratchpadStore().recordHandoff({
    fromWorker: "Gordon",
    toWorker: "Analyst",
    reason: "Need deeper market view",
  });
  runtime.beginBridgeIngress({
    source: "daemon",
    commandType: "runtime.background_status",
  });
  runtime.getState().permissionScopes = ["market.read"];
  runtime.getState().stream.status = "running";
  runtime.getState().stream.activeAgent = "Analyst";
  return { runtime, factory };
}

describe("runtime commands", () => {
  it("formats runtime session and state summaries", async () => {
    const { runtime, factory } = createRuntime();

    try {
      await expect(formatRuntimeSessionInfo(runtime)).resolves.toContain("Current Session Info");
      expect(formatRuntimeState(runtime)).toContain("Runtime State");
    } finally {
      factory.dispose();
    }
  });

  it("formats transcript, scratchpad, and handoffs", () => {
    const { runtime, factory } = createRuntime();
    try {
      expect(formatRuntimeTranscript(runtime, "5")).toContain("Runtime Transcript");
      expect(formatRuntimeScratchpad(runtime, "")).toContain("Runtime Scratchpad");
      expect(formatRuntimeHandoffs(runtime)).toContain("Runtime Handoffs");
      expect(formatRuntimeBridge(runtime)).toContain("Runtime Bridge");
      expect(formatRuntimePlugins(runtime)).toContain("No runtime plugins");
    } finally {
      factory.dispose();
    }
  });

  it("compacts the runtime transcript and persists it into the store", () => {
    const { runtime, factory } = createRuntime();
    try {
      for (let index = 0; index < 12; index += 1) {
        runtime.getTranscriptStore().append({
          role: index % 2 === 0 ? "user" : "assistant",
          content: `entry-${index}`,
        });
      }

      const response = compactRuntimeTranscript(runtime, "10");

      expect(response).toContain("Runtime Transcript Compacted");
      expect(runtime.getTranscriptStore().getCompactionCount()).toBeGreaterThan(0);
      expect(runtime.getTranscript()[0]?.metadata?.compacted).toBe(true);
    } finally {
      factory.dispose();
    }
  });

  it("formats and resolves runtime approvals using short request ids", () => {
    const { runtime, factory } = createRuntime();
    try {
      const store = runtime.getState();
      store.approvals.pending.push({
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

      expect(formatRuntimeApprovals(runtime)).toContain("Runtime Approvals");
      expect(formatRuntimeApprovals(runtime)).toContain("12345678");
      expect(applyRuntimeApprovalDecision(runtime, "12345678 persist", "approve")).toContain("Runtime Approval Approved");
      expect(formatRuntimeHistory(runtime, "BTC 5")).toContain("No runtime history matches");
    } finally {
      factory.dispose();
    }
  });
});
