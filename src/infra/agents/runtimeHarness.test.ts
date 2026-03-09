import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";

import { GordonConfigSchema } from "../../types/config.ts";
import { appendActionLogEntry } from "../action-log/store.ts";
import {
  buildEventDrivenReminders,
  classifyRecoveryGuidance,
  formatRecoveryGuidance,
  getExecutionReadiness,
  optimizeToolResultForContext,
  recordLoopSignal,
  recordToolCallFingerprint,
  recordVenueFailure,
  registerPlanningArtifact,
  resetLoopSignals,
} from "./runtimeHarness.ts";
import type { GordonContext } from "./types.ts";

function createContext(overrides: Partial<GordonContext> = {}): GordonContext {
  return {
    binance: null,
    exchange: null,
    broker: null,
    agentRails: null,
    llm: {} as GordonContext["llm"],
    config: GordonConfigSchema.parse({
      mode: "ARMED",
      modelConfig: { provider: "openai", model: "gpt-5.2" },
    }),
    portfolioValue: 10000,
    availableCash: 1000,
    threadId: "thread-harness",
    requestedActionId: "trading.market_order",
    requestedTaskScope: "execution",
    ...overrides,
  };
}

describe("runtimeHarness", () => {
  it("blocks execution until planning evidence exists", () => {
    const context = createContext();
    expect(getExecutionReadiness(context).ready).toBeFalse();

    registerPlanningArtifact(context, {
      symbol: "BTCUSDT",
      artifactType: "preview",
      approved: true,
    });
    expect(getExecutionReadiness(context, "BTCUSDT").ready).toBeTrue();
  });

  it("detects repeated loop signals", () => {
    const context = createContext();
    resetLoopSignals(context);
    expect(recordLoopSignal(context, "tool:test").blocked).toBeFalse();
    expect(recordLoopSignal(context, "tool:test").blocked).toBeFalse();
    expect(recordLoopSignal(context, "tool:test").blocked).toBeTrue();
  });

  it("detects repeated identical tool fingerprints within the sliding call window", () => {
    const context = createContext();
    resetLoopSignals(context);
    expect(recordToolCallFingerprint(context, "scan_market", { symbol: "BTCUSDT" }).blocked).toBeFalse();
    expect(recordToolCallFingerprint(context, "scan_market", { symbol: "BTCUSDT" }).blocked).toBeFalse();
    const finalState = recordToolCallFingerprint(context, "scan_market", { symbol: "BTCUSDT" });
    expect(finalState.blocked).toBeTrue();
    expect(finalState.count).toBe(3);
  });

  it("classifies provider throttles", () => {
    const guidance = classifyRecoveryGuidance(
      new Error("Rate limit reached"),
      createContext(),
      { phase: "analysis" },
    );
    expect(guidance.category).toBe("provider_throttle");
    expect(formatRecoveryGuidance(guidance)).toContain("Next steps");
  });

  it("offloads large tool payloads to scratch files", async () => {
    const context = createContext();
    const largePayload = { text: "x".repeat(4000) };
    const optimized = await optimizeToolResultForContext(context, "large_tool", largePayload);

    expect(optimized.offloaded).toBeTrue();
    expect(optimized.scratchFile).toBeDefined();
    expect(existsSync(optimized.scratchFile!)).toBeTrue();
  });

  it("builds bounded trading reminders from venue failures and recent failure classes", () => {
    const context = createContext();
    recordVenueFailure(context);
    recordVenueFailure(context);
    appendActionLogEntry({
      threadId: context.threadId,
      entryType: "run_status",
      title: "Provider failed",
      content: "Rate limit reached",
    });

    const reminders = buildEventDrivenReminders(context, "execution");
    expect(reminders.some((line) => line.includes("rate-limit window"))).toBeTrue();
    expect(reminders.some((line) => line.includes("live market data"))).toBeTrue();
    expect(reminders.length).toBeLessThanOrEqual(8);
  });
});
