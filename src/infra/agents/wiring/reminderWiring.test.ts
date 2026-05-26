import { describe, it, expect, beforeEach } from "bun:test";
import {
  _resetReminderWiringForTests,
  getSchedulerInstance,
  registerDefaultReminders,
  tickAndCollectReminders,
} from "./reminderWiring.ts";

describe("reminderWiring", () => {
  beforeEach(() => {
    _resetReminderWiringForTests();
  });

  it("emits reminders on cadence", () => {
    registerDefaultReminders({ getDailyLossLimitUsd: () => 1500 });
    // daily-loss-limit fires every 10 turns
    for (let i = 0; i < 9; i++) tickAndCollectReminders();
    const due = tickAndCollectReminders();
    expect(due.length).toBe(1);
    expect(due[0]).toContain("$1500");
  });

  it("registerDefaultReminders is idempotent", () => {
    registerDefaultReminders({ getDailyLossLimitUsd: () => 1000 });
    registerDefaultReminders({ getDailyLossLimitUsd: () => 9999 });
    // The 9999 getter is ignored; only the first registration sticks.
    for (let i = 0; i < 9; i++) tickAndCollectReminders();
    const due = tickAndCollectReminders();
    expect(due[0]).toContain("$1000");
  });

  it("supports providing only a subset of providers", () => {
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
