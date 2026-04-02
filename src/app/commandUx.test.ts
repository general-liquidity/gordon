import { describe, expect, it } from "bun:test";

import {
  buildQuickStartRecommendedOptions,
} from "./QuickStartMenu.tsx";
import {
  getQuickActionItems,
  normalizeCommandUx,
  resolveWorkflowTopic,
} from "./commandUx.ts";

describe("command UX model", () => {
  it("maps analysis-style market commands into the Analyze workflow", () => {
    const command = normalizeCommandUx({
      name: "analyze",
      category: "market",
      level: 1,
    });

    expect(command.workflow).toBe("analyze");
    expect(command.audience).toBe("core");
  });

  it("resolves legacy help topics into workflow topics", () => {
    expect(resolveWorkflowTopic("market")).toBe("discover");
    expect(resolveWorkflowTopic("analysis")).toBe("analyze");
    expect(resolveWorkflowTopic("strategy")).toBe("run");
    expect(resolveWorkflowTopic("system")).toBe("operate");
  });

  it("prioritizes setup-oriented quick actions when Gordon is not ready", () => {
    const actions = getQuickActionItems({
      mode: "SAFE",
      workspace: "desk",
      setupComplete: false,
      hasExchange: false,
      hasBroker: false,
      hasWalletRails: false,
    });

    expect(actions.map((entry) => entry.command)).toEqual([
      "/setup",
      "/doctor",
      "/model",
      "/help",
      "/configure advanced",
    ]);
  });

  it("surfaces funding when rails are configured and the system is ready", () => {
    const actions = getQuickActionItems({
      mode: "SAFE",
      workspace: "desk",
      setupComplete: true,
      hasExchange: true,
      hasBroker: false,
      hasWalletRails: true,
    });

    expect(actions.map((entry) => entry.command)).toContain("/fund quote");
    expect(actions.map((entry) => entry.command)).toContain("/preview-order");
  });

  it("switches suggested quick actions with the active workspace", () => {
    const actions = getQuickActionItems({
      mode: "SAFE",
      workspace: "lab",
      setupComplete: true,
      hasExchange: true,
      hasBroker: false,
      hasWalletRails: false,
    });

    expect(actions.map((entry) => entry.command)).toEqual([
      "/strategies",
      "/gen trend strategy for ETH",
      "/strategy playbooks",
      "/workflow backtest-cycle sma_crossover BTCUSDT",
      "/strategy running",
    ]);
  });

  it("changes quick-start recommendations based on readiness", () => {
    const setupRecommendations = buildQuickStartRecommendedOptions({
      mode: "SAFE",
      setupComplete: false,
      hasExchange: false,
      hasBroker: false,
      hasWalletRails: false,
    });
    const readyRecommendations = buildQuickStartRecommendedOptions({
      mode: "ARMED",
      setupComplete: true,
      hasExchange: true,
      hasBroker: false,
      hasWalletRails: false,
    });

    expect(setupRecommendations[0]).toBe("chat");
    expect(readyRecommendations[0]).toBe("chat");
    expect(readyRecommendations).toContain("orders");
    expect(readyRecommendations).toContain("scan");
  });
});
