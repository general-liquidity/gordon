import { describe, expect, test } from "bun:test";

import { accountPctAtRisk, stopDistancePct } from "./positionRisk.ts";

describe("positionRisk", () => {
  test("computes long stop distance and account risk", () => {
    const position = {
      side: "long" as const,
      entryPrice: 67_432,
      stopPrice: 66_500,
      lastPrice: 68_100,
      quantity: 0.25,
    };

    expect(stopDistancePct(position)).toBeCloseTo((68_100 - 66_500) / 68_100, 6);
    expect(accountPctAtRisk(position, 30_000)).toBeCloseTo((932 * 0.25) / 30_000, 6);
  });

  test("computes short stop distance and account risk", () => {
    const position = {
      side: "short" as const,
      entryPrice: 3_821,
      stopPrice: 3_900,
      lastPrice: 3_790,
      quantity: 5,
    };

    expect(stopDistancePct(position)).toBeCloseTo((3_900 - 3_790) / 3_790, 6);
    expect(accountPctAtRisk(position, 50_000)).toBeCloseTo((79 * 5) / 50_000, 6);
  });

  test("returns null when stop or equity is missing", () => {
    const position = {
      side: "long" as const,
      entryPrice: 100,
      lastPrice: 110,
      quantity: 2,
    };

    expect(stopDistancePct(position)).toBeNull();
    expect(accountPctAtRisk(position, 10_000)).toBeNull();
    expect(accountPctAtRisk({ ...position, stopPrice: 90 }, null)).toBeNull();
    expect(accountPctAtRisk({ ...position, stopPrice: 90 }, 0)).toBeNull();
  });

  test("reports breached stops as negative distance and floors profitable stops at zero risk", () => {
    const longBreached = {
      side: "long" as const,
      entryPrice: 100,
      stopPrice: 95,
      lastPrice: 90,
      quantity: 1,
    };
    const lockedProfit = { ...longBreached, stopPrice: 105, lastPrice: 110 };

    expect(stopDistancePct(longBreached)).toBeLessThan(0);
    expect(accountPctAtRisk(lockedProfit, 10_000)).toBe(0);
  });
});
