import { afterEach, describe, expect, it } from "bun:test";

import {
  getActiveACELessonRevision,
  resetActiveACELessonRevision,
  setActiveACELessonRevision,
  stampAceLessonRevision,
} from "./activeRevision.ts";

afterEach(() => {
  resetActiveACELessonRevision();
});

describe("ACE active-revision attribution stamp", () => {
  it("defaults to 0 (no lessons / ACE off)", () => {
    expect(getActiveACELessonRevision()).toBe(0);
  });

  it("set then get round-trips, flooring to an integer", () => {
    setActiveACELessonRevision(3);
    expect(getActiveACELessonRevision()).toBe(3);
    setActiveACELessonRevision(7.9);
    expect(getActiveACELessonRevision()).toBe(7);
  });

  it("ignores negative / non-finite values", () => {
    setActiveACELessonRevision(4);
    setActiveACELessonRevision(-1);
    setActiveACELessonRevision(Number.NaN);
    setActiveACELessonRevision(Number.POSITIVE_INFINITY);
    expect(getActiveACELessonRevision()).toBe(4);
  });

  it("does NOT stamp when no revision is active (ACE off → no noise)", () => {
    const payload = { venue: "binance" };
    expect(stampAceLessonRevision(payload)).toBe(payload);
    expect(stampAceLessonRevision(payload)).not.toHaveProperty("aceLessonRevision");
  });

  it("stamps the active revision while preserving existing keys", () => {
    setActiveACELessonRevision(5);
    const stamped = stampAceLessonRevision({ venue: "binance", symbol: "BTCUSDT" });
    expect(stamped).toEqual({ venue: "binance", symbol: "BTCUSDT", aceLessonRevision: 5 });
  });

  it("never clobbers a caller-supplied aceLessonRevision", () => {
    setActiveACELessonRevision(5);
    const payload = { aceLessonRevision: 2, venue: "binance" };
    expect(stampAceLessonRevision(payload)).toBe(payload);
    expect(stampAceLessonRevision(payload).aceLessonRevision).toBe(2);
  });

  it("keeps concurrent session revisions isolated", () => {
    setActiveACELessonRevision(3, ["session-a", "thread-a"]);
    setActiveACELessonRevision(8, ["session-b", "thread-b"]);

    expect(getActiveACELessonRevision("session-a")).toBe(3);
    expect(getActiveACELessonRevision("thread-b")).toBe(8);
    expect(stampAceLessonRevision({}, "thread-a")).toEqual({ aceLessonRevision: 3 });
    expect(stampAceLessonRevision({}, "session-b")).toEqual({ aceLessonRevision: 8 });
    expect(stampAceLessonRevision({}, "unknown-session")).toEqual({});
  });

  it("clears only the aliases for the session being closed", () => {
    setActiveACELessonRevision(3, ["session-a", "thread-a"]);
    setActiveACELessonRevision(8, "session-b");
    resetActiveACELessonRevision(["session-a", "thread-a"]);
    expect(getActiveACELessonRevision("session-a")).toBe(0);
    expect(getActiveACELessonRevision("session-b")).toBe(8);
  });
});
