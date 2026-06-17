import { describe, expect, test } from "bun:test";
import {
  stopOutBuffer,
  survivalStopDistance,
  survivalStopPrice,
  marginCircuitBreaker,
  COMPETITION_STOP_OUT_LEVEL_PCT,
} from "./survivalStop.ts";
import { liquidationDistance } from "./liquidationGuard.ts";

describe("stopOutBuffer", () => {
  test("competition default = stop-out share of one position's margin (0.30/30 = 0.01)", () => {
    expect(stopOutBuffer()).toBeCloseTo(0.01, 9);
    expect(stopOutBuffer(30, 30)).toBeCloseTo(0.01, 9);
  });
  test("scales with the stop-out level and account leverage", () => {
    expect(stopOutBuffer(50, 25)).toBeCloseTo(0.02, 9);
  });
});

describe("survivalStopDistance", () => {
  test("high leverage ⇒ tight stop, low leverage ⇒ wide stop", () => {
    const hi = survivalStopDistance({ positionNotional: 20_000, equity: 1_000 }); // 20× gross
    const lo = survivalStopDistance({ positionNotional: 3_000, equity: 1_000 }); //  3× gross
    expect(hi).toBeCloseTo(0.024, 6); // 0.6·(1/20 − 0.01)
    expect(lo).toBeCloseTo(0.194, 3); // 0.6·(1/3  − 0.01)
    expect(hi).toBeLessThan(lo);
  });

  test("always strictly inside the venue stop-out distance (survivalFraction < 1)", () => {
    const notional = 10_000;
    const equity = 1_000;
    const d = survivalStopDistance({ positionNotional: notional, equity });
    const stopOut = liquidationDistance(notional / equity, stopOutBuffer());
    expect(d).toBeLessThan(stopOut); // we exit BEFORE the venue liquidates
  });

  test("survivalFraction is honoured", () => {
    const half = survivalStopDistance({ positionNotional: 20_000, equity: 1_000, survivalFraction: 0.5 });
    expect(half).toBeCloseTo(0.5 * (1 / 20 - 0.01), 6); // 0.02
  });

  test("no position or no equity ⇒ Infinity (impose no survival stop)", () => {
    expect(survivalStopDistance({ positionNotional: 0, equity: 1_000 })).toBe(Number.POSITIVE_INFINITY);
    expect(survivalStopDistance({ positionNotional: 5_000, equity: 0 })).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("survivalStopPrice", () => {
  test("long stop sits below entry, short stop above", () => {
    expect(survivalStopPrice(100, "buy", 0.02)).toBeCloseTo(98, 9);
    expect(survivalStopPrice(100, "long", 0.02)).toBeCloseTo(98, 9);
    expect(survivalStopPrice(100, "sell", 0.02)).toBeCloseTo(102, 9);
    expect(survivalStopPrice(100, "short", 0.02)).toBeCloseTo(102, 9);
  });
  test("degenerate inputs return 0", () => {
    expect(survivalStopPrice(0, "buy", 0.02)).toBe(0);
    expect(survivalStopPrice(100, "buy", Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("marginCircuitBreaker", () => {
  test("idle when there is no used margin (no open positions)", () => {
    const v = marginCircuitBreaker({ marginLevelPct: 0, usedMargin: 0 });
    expect(v.tripped).toBe(false);
    expect(v.reason).toContain("idle");
  });
  test("trips when margin level falls to/through the breaker (default 50%)", () => {
    expect(marginCircuitBreaker({ marginLevelPct: 45, usedMargin: 5_000 }).tripped).toBe(true);
    expect(marginCircuitBreaker({ marginLevelPct: 50, usedMargin: 5_000 }).tripped).toBe(true); // ≤
  });
  test("does not trip when healthy", () => {
    const v = marginCircuitBreaker({ marginLevelPct: 300, usedMargin: 5_000 });
    expect(v.tripped).toBe(false);
  });
  test("breaker sits above the 30% stop-out so we never reach forced liquidation", () => {
    const v = marginCircuitBreaker({ marginLevelPct: 35, usedMargin: 5_000 });
    expect(v.tripped).toBe(true); // 35% ≤ 50% breaker → flatten BEFORE the 30% stop-out
    expect(v.reason).toContain(`${COMPETITION_STOP_OUT_LEVEL_PCT}%`);
  });
  test("custom breaker level", () => {
    expect(marginCircuitBreaker({ marginLevelPct: 70, usedMargin: 5_000, breakerLevelPct: 80 }).tripped).toBe(true);
    expect(marginCircuitBreaker({ marginLevelPct: 90, usedMargin: 5_000, breakerLevelPct: 80 }).tripped).toBe(false);
  });
});
