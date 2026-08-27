import { describe, expect, test } from "bun:test";
import {
  analyzeBreakoutFailureRegime,
  formatBreakoutFailureRegime,
  type BreakoutEvent,
} from "./breakout-failure-regime.ts";

function ev(symbol: string, at: number, outcome: BreakoutEvent["outcome"]): BreakoutEvent {
  return { symbol, breakoutAt: at, outcome };
}

function buildEvents(failures: number, follows: number, pending = 0): BreakoutEvent[] {
  const out: BreakoutEvent[] = [];
  let at = 1;
  for (let i = 0; i < failures; i++) out.push(ev(`F${i}`, at++, "failed"));
  for (let i = 0; i < follows; i++) out.push(ev(`H${i}`, at++, "followed_through"));
  for (let i = 0; i < pending; i++) out.push(ev(`P${i}`, at++, "pending"));
  return out;
}

describe("analyzeBreakoutFailureRegime", () => {
  test("underfilled window → insufficient_data", () => {
    const events = buildEvents(2, 3);
    const r = analyzeBreakoutFailureRegime(events);
    expect(r.verdict).toBe("insufficient_data");
  });

  test("healthy bull: 10% failure rate", () => {
    const events = buildEvents(2, 18);
    const r = analyzeBreakoutFailureRegime(events);
    expect(r.verdict).toBe("healthy_bull");
    expect(r.failureRate).toBeCloseTo(0.1, 4);
  });

  test("weakening: 40% failure rate", () => {
    const events = buildEvents(8, 12);
    const r = analyzeBreakoutFailureRegime(events);
    expect(r.verdict).toBe("weakening");
  });

  test("bear-like: 60% failure rate", () => {
    const events = buildEvents(12, 8);
    const r = analyzeBreakoutFailureRegime(events);
    expect(r.verdict).toBe("bear_like");
  });

  test("bear confirmed: 80% failure rate", () => {
    const events = buildEvents(16, 4);
    const r = analyzeBreakoutFailureRegime(events);
    expect(r.verdict).toBe("bear_confirmed");
  });

  test("pending events excluded from rate calculation", () => {
    const events = buildEvents(2, 18, 5);
    const r = analyzeBreakoutFailureRegime(events);
    expect(r.evaluatedEvents).toBe(20);
    expect(r.pendingEvents).toBe(5);
    expect(r.failureRate).toBeCloseTo(0.1, 4);
  });

  test("only most recent windowSize events considered", () => {
    // 10 fails followed by 20 follow-throughs; default window 30 sees all
    const events = buildEvents(10, 20);
    const wideWindow = analyzeBreakoutFailureRegime(events);
    expect(wideWindow.failureRate).toBeCloseTo(10 / 30, 4);
    // With windowSize=20, only the most-recent 20 (all follow-throughs) count
    const narrow = analyzeBreakoutFailureRegime(events, { windowSize: 20 });
    expect(narrow.failureRate).toBe(0);
    expect(narrow.verdict).toBe("healthy_bull");
  });

  test("custom thresholds shift band boundaries", () => {
    const events = buildEvents(7, 13);
    const def = analyzeBreakoutFailureRegime(events);
    expect(def.verdict).toBe("weakening"); // 35% > 30%
    const strict = analyzeBreakoutFailureRegime(events, {
      healthyBullCeiling: 0.4,
      weakeningCeiling: 0.55,
      bearLikeCeiling: 0.75,
    });
    expect(strict.verdict).toBe("healthy_bull"); // 35% < 40%
  });

  test("invalid threshold ordering → insufficient_data", () => {
    const events = buildEvents(5, 15);
    const r = analyzeBreakoutFailureRegime(events, {
      healthyBullCeiling: 0.6,
      weakeningCeiling: 0.4,
    });
    expect(r.verdict).toBe("insufficient_data");
  });

  test("bearishScore equals clamped failure rate", () => {
    const events = buildEvents(12, 8);
    const r = analyzeBreakoutFailureRegime(events);
    expect(r.bearishScore).toBeCloseTo(r.failureRate, 4);
  });

  test("custom minEvaluatedEvents tightens floor", () => {
    const events = buildEvents(5, 5);
    const lax = analyzeBreakoutFailureRegime(events, { minEvaluatedEvents: 5 });
    const strict = analyzeBreakoutFailureRegime(events, { minEvaluatedEvents: 50 });
    expect(lax.verdict).not.toBe("insufficient_data");
    expect(strict.verdict).toBe("insufficient_data");
  });
});

describe("formatBreakoutFailureRegime", () => {
  test("renders verdict + summary", () => {
    const events = buildEvents(12, 8);
    const r = analyzeBreakoutFailureRegime(events);
    const text = formatBreakoutFailureRegime(r);
    expect(text).toContain("Breakout-Failure Regime");
    expect(text).toContain("Failure rate");
    expect(text).toContain("Follow-through rate");
  });
});
