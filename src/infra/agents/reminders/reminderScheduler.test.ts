import { describe, it, expect, beforeEach } from "bun:test";
import {
  ReminderScheduler,
  dailyLossLimitReminder,
  mandateScopeReminder,
  openPositionsReminder,
} from "./reminderScheduler.ts";

describe("ReminderScheduler", () => {
  let s: ReminderScheduler;
  beforeEach(() => {
    s = new ReminderScheduler();
  });

  it("does not fire on turn 0 by default", () => {
    s.register({
      id: "x",
      everyNTurns: 1,
      handler: () => "hello",
    });
    expect(s.collect()).toEqual([]);
  });

  it("fires on turns matching everyNTurns", () => {
    s.register({ id: "every3", everyNTurns: 3, handler: () => "tick" });
    expect(s.advance()).toBe(1); // turn 1
    expect(s.collect()).toEqual([]);
    s.advance(); // 2
    expect(s.collect()).toEqual([]);
    s.advance(); // 3
    expect(s.collect()).toEqual(["tick"]);
    s.advance(); // 4
    expect(s.collect()).toEqual([]);
    s.advance(); // 5
    expect(s.collect()).toEqual([]);
    s.advance(); // 6
    expect(s.collect()).toEqual(["tick"]);
  });

  it("can opt into firing on turn 0 via skipFirstTurn:false", () => {
    s.register({ id: "x", everyNTurns: 1, handler: () => "hi", skipFirstTurn: false });
    // Don't advance — turn is still 0, but with skipFirstTurn=false this still
    // requires (turn % everyNTurns === 0) which is true for turn=0, everyN=1.
    expect(s.collect()).toEqual(["hi"]);
  });

  it("filters out null handler returns and throwing handlers", () => {
    s.register({ id: "null", everyNTurns: 1, handler: () => null });
    s.register({
      id: "throws",
      everyNTurns: 1,
      handler: () => {
        throw new Error("bug");
      },
    });
    s.register({ id: "ok", everyNTurns: 1, handler: () => "ok!" });
    s.advance();
    expect(s.collect()).toEqual(["ok!"]);
  });

  it("sorts by priority — lower runs first", () => {
    s.register({ id: "a", everyNTurns: 1, priority: 50, handler: () => "A" });
    s.register({ id: "b", everyNTurns: 1, priority: 10, handler: () => "B" });
    s.register({ id: "c", everyNTurns: 1, priority: 100, handler: () => "C" });
    s.advance();
    expect(s.collect()).toEqual(["B", "A", "C"]);
  });

  it("rejects everyNTurns < 1", () => {
    expect(() => s.register({ id: "bad", everyNTurns: 0, handler: () => "x" })).toThrow();
  });

  it("unregister removes a reminder", () => {
    const off = s.register({ id: "x", everyNTurns: 1, handler: () => "x" });
    s.advance();
    expect(s.collect()).toEqual(["x"]);
    off();
    expect(s.collect()).toEqual([]);
  });
});

describe("trading reminder factories", () => {
  it("dailyLossLimitReminder fires when limit > 0", () => {
    const s = new ReminderScheduler();
    s.register(dailyLossLimitReminder(() => 1000));
    for (let i = 0; i < 10; i++) s.advance();
    const out = s.collect();
    expect(out.length).toBe(1);
    expect(out[0]).toContain("$1000.00");
  });

  it("dailyLossLimitReminder skips when limit is 0", () => {
    const s = new ReminderScheduler();
    s.register(dailyLossLimitReminder(() => 0));
    for (let i = 0; i < 10; i++) s.advance();
    expect(s.collect()).toEqual([]);
  });

  it("mandateScopeReminder lists venues", () => {
    const s = new ReminderScheduler();
    s.register(
      mandateScopeReminder(() => ({
        id: "M-1",
        venues: ["binance", "kraken"],
        expiresAt: "2026-12-31",
      })),
    );
    for (let i = 0; i < 15; i++) s.advance();
    const out = s.collect();
    expect(out[0]).toContain("M-1");
    expect(out[0]).toContain("binance, kraken");
    expect(out[0]).toContain("2026-12-31");
  });

  it("openPositionsReminder skips on zero positions", () => {
    const s = new ReminderScheduler();
    s.register(openPositionsReminder(() => 0));
    for (let i = 0; i < 20; i++) s.advance();
    expect(s.collect()).toEqual([]);
  });
});
