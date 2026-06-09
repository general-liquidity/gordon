import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { GordonConfigSchema } from "../../../types/config.ts";
import { setDatabasePathForTesting } from "../../storage/database.ts";
import {
  buildEventDrivenReminders,
  registerPlanningArtifact,
  recordToolCallFingerprint,
  recordVenueFailure,
  resetReminderState,
  resetLoopSignals,
} from "../harness/runtimeHarness.ts";
import type { GordonContext } from "../types.ts";
import {
  TRADER_REMINDER_CATEGORIES,
  listTraderReminderCategories,
  shouldEmitTraderReminders,
  getTraderReminderMode,
} from "./traderReminders.ts";

let tempDir = "";
const ORIG_FLAG = process.env.GORDON_TRADER_REMINDERS;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gordon-trader-reminders-"));
  setDatabasePathForTesting(join(tempDir, "gordon.db"));
  delete process.env.GORDON_TRADER_REMINDERS;
});

afterEach(() => {
  setDatabasePathForTesting(null);
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = "";
  }
  if (ORIG_FLAG !== undefined) process.env.GORDON_TRADER_REMINDERS = ORIG_FLAG;
  else delete process.env.GORDON_TRADER_REMINDERS;
});

function createContext(overrides: Partial<GordonContext> = {}): GordonContext {
  return {
    binance: null,
    exchange: null,
    broker: null,
    llm: {} as GordonContext["llm"],
    config: GordonConfigSchema.parse({
      permissionMode: "auto",
      modelConfig: { provider: "openai", model: "gpt-5.4" },
    }),
    portfolioValue: 10000,
    availableCash: 1000,
    threadId: `thread-${Math.random().toString(36).slice(2)}`,
    requestedActionId: "trading.market_order",
    requestedTaskScope: "execution",
    ...overrides,
  };
}

describe("TraderReminderCategories registry", () => {
  it("registers exactly 6 categories", () => {
    const categories = listTraderReminderCategories();
    expect(categories.length).toBe(6);
    expect(new Set(categories)).toEqual(new Set([
      "plan_lifecycle",
      "execution_approval",
      "repeated_venue_failure",
      "stale_mandate",
      "repeated_loop",
      "incomplete_runtime_task",
    ]));
  });

  it("each category has a description and trigger condition", () => {
    for (const category of listTraderReminderCategories()) {
      const spec = TRADER_REMINDER_CATEGORIES[category];
      expect(spec.description.length).toBeGreaterThan(0);
      expect(spec.triggerCondition.length).toBeGreaterThan(0);
      expect(spec.defaultMaxAttempts).toBeGreaterThan(0);
    }
  });
});

describe("Trader reminder feature flag", () => {
  it("defaults to auto when env unset", () => {
    expect(getTraderReminderMode()).toBe("auto");
    expect(shouldEmitTraderReminders()).toBe(true);
  });

  it("force_on activates trader reminders", () => {
    process.env.GORDON_TRADER_REMINDERS = "true";
    expect(getTraderReminderMode()).toBe("force_on");
    expect(shouldEmitTraderReminders()).toBe(true);
  });

  it("force_off suppresses trader reminders", () => {
    process.env.GORDON_TRADER_REMINDERS = "false";
    expect(getTraderReminderMode()).toBe("force_off");
    expect(shouldEmitTraderReminders()).toBe(false);
  });

  it("accepts 1/0/on/off as aliases", () => {
    process.env.GORDON_TRADER_REMINDERS = "1";
    expect(shouldEmitTraderReminders()).toBe(true);
    process.env.GORDON_TRADER_REMINDERS = "0";
    expect(shouldEmitTraderReminders()).toBe(false);
    process.env.GORDON_TRADER_REMINDERS = "on";
    expect(shouldEmitTraderReminders()).toBe(true);
    process.env.GORDON_TRADER_REMINDERS = "off";
    expect(shouldEmitTraderReminders()).toBe(false);
  });
});

describe("Reminder triggers wired to runtimeHarness", () => {
  it("plan_lifecycle reminder fires in planning phase with no artifact", () => {
    const ctx = createContext({ requestedActionId: "trading.plan", requestedTaskScope: "planning" });
    resetReminderState(ctx);
    const reminders = buildEventDrivenReminders(ctx, "planning");
    expect(reminders.some((r) => /no trade plan/i.test(r))).toBe(true);
  });

  it("execution_approval reminder fires when plan exists but unapproved", () => {
    const ctx = createContext();
    resetReminderState(ctx);
    registerPlanningArtifact(ctx, { symbol: "BTCUSDT", artifactType: "plan", approved: false });
    const reminders = buildEventDrivenReminders(ctx, "execution");
    expect(reminders.some((r) => /not been explicitly approved/i.test(r))).toBe(true);
  });

  it("repeated_venue_failure reminder fires after multiple venue failures", () => {
    const ctx = createContext({ requestedActionId: "scan", requestedTaskScope: "analysis" });
    resetReminderState(ctx);
    recordVenueFailure(ctx);
    recordVenueFailure(ctx);
    const reminders = buildEventDrivenReminders(ctx, "analysis");
    expect(reminders.some((r) => /Venue data requests have failed/i.test(r))).toBe(true);
  });

  it("stale_mandate reminder fires in execution with no action id", () => {
    const ctx = createContext({ requestedActionId: undefined, requestedTaskScope: "execution" });
    resetReminderState(ctx);
    const reminders = buildEventDrivenReminders(ctx, "execution");
    expect(reminders.some((r) => /no active action mandate/i.test(r))).toBe(true);
  });

  it("repeated_loop reminder fires when fingerprint repeats fill the call log", () => {
    const ctx = createContext({ requestedActionId: "scan", requestedTaskScope: "analysis" });
    resetReminderState(ctx);
    resetLoopSignals(ctx);
    // Fill the 20-call sliding window with the same fingerprint
    for (let i = 0; i < 20; i++) {
      recordToolCallFingerprint(ctx, "scan_market", { symbol: "BTC" });
    }
    const reminders = buildEventDrivenReminders(ctx, "analysis");
    expect(reminders.some((r) => /identical tool invocations/i.test(r))).toBe(true);
  });

  it("incomplete_runtime_task reminder fires with approved plan + tasks", () => {
    const ctx = createContext({ requestedActionId: "trading.preview_market_order", requestedTaskScope: "planning" });
    resetReminderState(ctx);
    registerPlanningArtifact(ctx, {
      symbol: "BTCUSDT",
      artifactType: "preview",
      approved: true,
      extractedTasks: ["Confirm sizing.", "Honor stop-loss."],
    });
    const reminders = buildEventDrivenReminders(ctx, "planning");
    expect(reminders.some((r) => /outstanding next steps/i.test(r))).toBe(true);
  });

  it("force_off suppresses all 6 trader reminders simultaneously", () => {
    process.env.GORDON_TRADER_REMINDERS = "false";
    const ctx = createContext({ requestedActionId: undefined, requestedTaskScope: "execution" });
    resetReminderState(ctx);
    registerPlanningArtifact(ctx, { symbol: "BTC", artifactType: "plan", approved: false });
    recordVenueFailure(ctx);
    recordVenueFailure(ctx);
    const reminders = buildEventDrivenReminders(ctx, "execution");
    // None of the trader-specific reminders should be present.
    expect(reminders.some((r) => /not been explicitly approved/i.test(r))).toBe(false);
    expect(reminders.some((r) => /no active action mandate/i.test(r))).toBe(false);
    expect(reminders.some((r) => /Venue data requests have failed/i.test(r))).toBe(false);
  });
});
