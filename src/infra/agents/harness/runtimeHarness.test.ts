import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { GordonConfigSchema } from "../../../types/config.ts";
import { appendActionLogEntry } from "../../action-log/store.ts";
import { setDatabasePathForTesting } from "../../storage/database.ts";
import {
  buildEventDrivenReminders,
  classifyRecoveryGuidance,
  formatRecoveryGuidance,
  getExecutionReadiness,
  optimizeToolResultForContext,
  recordLoopSignal,
  recordToolCallFingerprint,
  detectFingerprintCycle,
  recordVenueFailure,
  registerPlanningArtifact,
  resetLoopSignals,
} from "./runtimeHarness.ts";
import type { GordonContext } from "../types.ts";

let tempDatabaseDir = "";

beforeEach(() => {
  tempDatabaseDir = mkdtempSync(join(tmpdir(), "gordon-runtime-harness-"));
  setDatabasePathForTesting(join(tempDatabaseDir, "gordon.db"));
});

afterEach(() => {
  setDatabasePathForTesting(null);
  if (tempDatabaseDir) {
    rmSync(tempDatabaseDir, { recursive: true, force: true });
    tempDatabaseDir = "";
  }
});

function createContext(overrides: Partial<GordonContext> = {}): GordonContext {
  return {
    binance: null,
    exchange: null,
    broker: null,
    agentRails: null,
    llm: {} as GordonContext["llm"],
    config: GordonConfigSchema.parse({
      permissionMode: "auto",
      modelConfig: { provider: "openai", model: "gpt-5.4" },
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
    expect(formatRecoveryGuidance(guidance)).toContain("Try:");
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

  it("flags coherent-action amplification: many same-surface trading calls with varied args", () => {
    const context = createContext({ threadId: "thread-amp-coherent" });
    // Same decision surface (BTCUSDT buy), varied args → 20 DISTINCT fingerprints
    // (the identical-fingerprint doom-loop misses this), one decision surface.
    for (let i = 0; i < 20; i++) {
      recordToolCallFingerprint(context, "preview_market_order", { symbol: "BTCUSDT", action: "buy", note: i });
    }
    const reminders = buildEventDrivenReminders(context, "execution");
    expect(reminders.some((line) => line.includes("amplification"))).toBeTrue();
  });

  it("does not flag amplification when surfaces are genuinely distinct", () => {
    const context = createContext({ threadId: "thread-amp-distinct" });
    for (let i = 0; i < 20; i++) {
      recordToolCallFingerprint(context, "preview_market_order", { symbol: `SYM${i}`, action: "buy" });
    }
    const reminders = buildEventDrivenReminders(context, "execution");
    expect(reminders.some((line) => line.includes("amplification"))).toBeFalse();
  });
});

describe("detectFingerprintCycle", () => {
  it("detects an A-B-A-B repeating cycle at 2 round trips", () => {
    const cyc = detectFingerprintCycle(["A", "B", "A", "B"]);
    expect(cyc).not.toBeNull();
    expect(cyc!.cycleLen).toBe(2);
    expect(cyc!.repeats).toBe(2);
  });

  it("detects a 3-step A-B-C cycle", () => {
    const cyc = detectFingerprintCycle(["A", "B", "C", "A", "B", "C"]);
    expect(cyc?.cycleLen).toBe(3);
    expect(cyc?.repeats).toBe(2);
  });

  it("returns the SHORTEST cycle length (A-B-A-B is a 2-cycle, not 4)", () => {
    expect(detectFingerprintCycle(["A", "B", "A", "B", "A", "B"])?.cycleLen).toBe(2);
  });

  it("ignores a single-fingerprint repeat — the identical-count check owns that", () => {
    expect(detectFingerprintCycle(["A", "A", "A", "A"])).toBeNull();
  });

  it("returns null for a single occurrence of a pattern", () => {
    expect(detectFingerprintCycle(["A", "B"])).toBeNull();
  });

  it("returns null when there is no cycle", () => {
    expect(detectFingerprintCycle(["A", "B", "C", "D", "E", "F"])).toBeNull();
  });
});

describe("recordToolCallFingerprint — multi-step cycle blocking", () => {
  it("blocks an alternating two-tool loop the identical-count check misses", () => {
    const context = createContext({ threadId: "cycle-thread" });
    resetLoopSignals(context);
    // x, then [check_balance, place_order] twice. Each of cb/po appears only
    // 2× (below the identical threshold of 3), but the [cb, po] cycle recurs 2×.
    recordToolCallFingerprint(context, "x", { a: 1 });
    recordToolCallFingerprint(context, "check_balance", {});
    recordToolCallFingerprint(context, "place_order", { sym: "BTC" });
    recordToolCallFingerprint(context, "check_balance", {});
    const last = recordToolCallFingerprint(context, "place_order", { sym: "BTC" });
    expect(last.count).toBeLessThan(3); // identical-count check would NOT block
    expect(last.cycle).not.toBeNull(); // ...but the cycle detector catches it
    expect(last.cycle!.cycleLen).toBe(2);
    expect(last.blocked).toBeTrue();
    resetLoopSignals(context);
  });

  it("does not flag a varied, progressing tool sequence", () => {
    const context = createContext({ threadId: "varied-thread" });
    resetLoopSignals(context);
    recordToolCallFingerprint(context, "get_market_data", { sym: "BTC" });
    recordToolCallFingerprint(context, "compute_indicator", { ind: "rsi" });
    recordToolCallFingerprint(context, "get_news", { sym: "BTC" });
    const last = recordToolCallFingerprint(context, "compute_risk", { sym: "BTC" });
    expect(last.cycle).toBeNull();
    expect(last.blocked).toBeFalse();
    resetLoopSignals(context);
  });
});
