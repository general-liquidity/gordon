import { describe, it, expect } from "bun:test";

import {
  isStreakCircuitBreakerEnabled,
  evaluateCircuit,
  shouldBlockTrade,
  streakToPayload,
  STREAK_CIRCUIT_BREAKER_FLAG_ENV,
} from "./streakCircuitBreaker.ts";

describe("isStreakCircuitBreakerEnabled", () => {
  it("respects the flag", () => {
    expect(isStreakCircuitBreakerEnabled({})).toBe(false);
    expect(isStreakCircuitBreakerEnabled({ [STREAK_CIRCUIT_BREAKER_FLAG_ENV]: "1" })).toBe(true);
  });
});

describe("evaluateCircuit — open state", () => {
  it("no losses → open with no size reduction", () => {
    const r = evaluateCircuit({
      recentResults: ["win", "win", "scratch"],
      nowMs: Date.now(),
    });
    expect(r.state).toBe("open");
    expect(r.sizeReductionActive).toBe(false);
  });

  it("2 losses (threshold-1) → open with size reduction", () => {
    const r = evaluateCircuit({
      recentResults: ["loss", "loss", "win"],
      nowMs: Date.now(),
    });
    expect(r.state).toBe("open");
    expect(r.sizeReductionActive).toBe(true);
  });
});

describe("evaluateCircuit — tripped state (Rule of Three)", () => {
  it("3 consecutive losses → tripped", () => {
    const r = evaluateCircuit({
      recentResults: ["loss", "loss", "loss", "win"],
      nowMs: Date.now(),
    });
    expect(r.state).toBe("tripped");
    expect(r.sizeReductionActive).toBe(true);
    expect(r.cooldownRemainingMs).toBe(60 * 60_000);
  });

  it("4 consecutive losses still trip", () => {
    const r = evaluateCircuit({
      recentResults: ["loss", "loss", "loss", "loss"],
      nowMs: Date.now(),
    });
    expect(r.state).toBe("tripped");
    expect(r.consecutiveLosses).toBe(4);
  });

  it("scratches don't break the streak", () => {
    const r = evaluateCircuit({
      recentResults: ["loss", "scratch", "loss", "loss"],
      nowMs: Date.now(),
    });
    expect(r.consecutiveLosses).toBe(3);
    expect(r.state).toBe("tripped");
  });

  it("wins break the streak", () => {
    const r = evaluateCircuit({
      recentResults: ["loss", "win", "loss", "loss", "loss"],
      nowMs: Date.now(),
    });
    expect(r.consecutiveLosses).toBe(1);
    expect(r.state).toBe("open");
  });
});

describe("evaluateCircuit — cooldown window", () => {
  it("recent trip enters cooldown", () => {
    const now = 1_000_000_000;
    const r = evaluateCircuit({
      recentResults: ["scratch"],
      lastTrippedAtMs: now - 30 * 60_000,
      nowMs: now,
    });
    expect(r.state).toBe("cooldown");
    expect(r.cooldownRemainingMs).toBeGreaterThan(0);
    expect(r.cooldownRemainingMs).toBeLessThan(60 * 60_000);
  });

  it("cooldown expires after 60 minutes by default", () => {
    const now = 1_000_000_000;
    const r = evaluateCircuit({
      recentResults: ["scratch"],
      lastTrippedAtMs: now - 70 * 60_000,
      nowMs: now,
    });
    expect(r.state).toBe("open");
    expect(r.cooldownRemainingMs).toBe(0);
  });
});

describe("evaluateCircuit — custom thresholds", () => {
  it("respects custom threshold of 5", () => {
    const r = evaluateCircuit({
      recentResults: ["loss", "loss", "loss"],
      nowMs: Date.now(),
      threshold: 5,
    });
    expect(r.state).toBe("open");
  });

  it("respects custom cooldown duration", () => {
    const now = 1_000_000_000;
    const r = evaluateCircuit({
      recentResults: ["loss", "loss", "loss"],
      nowMs: now,
      cooldownMinutes: 15,
    });
    expect(r.cooldownRemainingMs).toBe(15 * 60_000);
  });
});

describe("shouldBlockTrade", () => {
  it("blocks tripped and cooldown states", () => {
    expect(
      shouldBlockTrade(
        evaluateCircuit({
          recentResults: ["loss", "loss", "loss"],
          nowMs: Date.now(),
        }),
      ),
    ).toBe(true);
  });

  it("allows open state even when size-reduced", () => {
    expect(
      shouldBlockTrade(
        evaluateCircuit({
          recentResults: ["loss", "loss", "win"],
          nowMs: Date.now(),
        }),
      ),
    ).toBe(false);
  });
});

describe("streakToPayload", () => {
  it("emits stable shape", () => {
    const r = evaluateCircuit({
      recentResults: ["loss", "loss", "loss"],
      nowMs: Date.now(),
    });
    const p = streakToPayload(r) as { kind: string; state: string };
    expect(p.kind).toBe("streak_circuit_breaker.evaluated");
    expect(p.state).toBe("tripped");
  });
});
