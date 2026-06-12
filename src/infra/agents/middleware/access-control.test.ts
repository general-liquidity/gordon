import { describe, expect, it } from "bun:test";

import { checkToolAccess } from "./access-control.ts";
import type { GordonConfig } from "../../../types/index.ts";

function createConfig(permissionMode: "auto" | "ask" | "strict" = "ask"): GordonConfig {
  return {
    version: "1.0.0",
    exchanges: [],
    brokers: [],
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
    permissionMode,
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
    ui: {},
    costBudget: {
      action: "warn",
      warnThresholds: [0.5, 0.75, 0.9],
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
  it("allows non-trade tools in ask mode", async () => {
    const result = await checkToolAccess("set_permission_mode", createConfig("ask"), "test-user");
    expect(result.allowed).toBe(true);
  });

  it("blocks trade tools in strict mode", async () => {
    const result = await checkToolAccess("place_order", createConfig("strict"), "test-user");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("strict");
  });

  it("allows trade tools in auto mode", async () => {
    const result = await checkToolAccess("place_order", createConfig("auto"), "test-user");
    expect(result.allowed).toBe(true);
  });

  it("allows trade tools in ask mode (ApprovalDialog handles gating downstream)", async () => {
    const result = await checkToolAccess("place_order", createConfig("ask"), "test-user");
    expect(result.allowed).toBe(true);
  });
});
