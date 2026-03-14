import { describe, expect, it } from "bun:test";

import { checkToolAccess } from "./access-control.ts";
import type { GordonConfig } from "../../../types/index.ts";

function createConfig(mode: "ARMED" | "SAFE" = "SAFE"): GordonConfig {
  return {
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
      defaultTimeframes: ["1h", "4h"],
      topNCoins: 50,
      maxConcurrentTrades: 5,
    },
    memoryConfig: {
      lastMessages: 20,
      maxSessionDurationHours: 24,
      memoryWarningThreshold: 0.8,
    },
    mode,
    armedUntil: mode === "ARMED" ? new Date(Date.now() + 60_000).toISOString() : null,
    onboardingComplete: false,
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
  };
}

describe("checkToolAccess", () => {
  it("allows arm_system while the system is still SAFE", async () => {
    const result = await checkToolAccess("arm_system", createConfig("SAFE"), "test-user");

    expect(result.allowed).toBe(true);
    expect(result.mode).toBe("SAFE");
  });
});
