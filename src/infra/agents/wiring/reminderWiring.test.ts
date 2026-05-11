import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  _resetReminderWiringForTests,
  getSchedulerInstance,
  isRemindersEnabled,
  registerDefaultReminders,
  tickAndCollectReminders,
} from "./reminderWiring.ts";

const FLAG = "GORDON_REMINDERS";

describe("reminderWiring", () => {
  const prev = process.env[FLAG];
  beforeEach(() => {
    delete process.env[FLAG];
    _resetReminderWiringForTests();
  });
  afterEach(() => {
    if (prev === undefined) delete process.env[FLAG];
    else process.env[FLAG] = prev;
  });

  it("isRemindersEnabled reflects flag state", () => {
    expect(isRemindersEnabled()).toBe(false);
    process.env[FLAG] = "1";
    expect(isRemindersEnabled()).toBe(true);
  });

  it("returns [] when flag is off even after ticks", () => {
    registerDefaultReminders({ getDailyLossLimitUsd: () => 1000 });
    for (let i = 0; i < 20; i++) {
      expect(tickAndCollectReminders()).toEqual([]);
    }
  });

  it("emits reminders on cadence when flag is on", () => {
    process.env[FLAG] = "1";
    registerDefaultReminders({ getDailyLossLimitUsd: () => 1500 });
    // daily-loss-limit fires every 10 turns
    for (let i = 0; i < 9; i++) tickAndCollectReminders();
    const due = tickAndCollectReminders();
    expect(due.length).toBe(1);
    expect(due[0]).toContain("$1500");
  });

  it("registerDefaultReminders is idempotent", () => {
    process.env[FLAG] = "1";
    registerDefaultReminders({ getDailyLossLimitUsd: () => 1000 });
    registerDefaultReminders({ getDailyLossLimitUsd: () => 9999 });
    // The 9999 getter is ignored; only the first registration sticks.
    for (let i = 0; i < 9; i++) tickAndCollectReminders();
    const due = tickAndCollectReminders();
    expect(due[0]).toContain("$1000");
  });

  it("supports providing only a subset of providers", () => {
    process.env[FLAG] = "1";
    registerDefaultReminders({ getPositionCount: () => 3 });
    // Run 20 turns to hit the open-positions cadence
    for (let i = 0; i < 19; i++) tickAndCollectReminders();
    const due = tickAndCollectReminders();
    expect(due.length).toBe(1);
    expect(due[0]).toContain("3 open positions");
  });

  it("scheduler instance survives across calls", () => {
    const a = getSchedulerInstance();
    const b = getSchedulerInstance();
    expect(a).toBe(b);
  });
});
