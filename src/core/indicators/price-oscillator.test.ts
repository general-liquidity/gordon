import { describe, expect, test } from "bun:test";
import { calculateAPO, calculatePPO } from "./price-oscillator.ts";

describe("APO / PPO", () => {
  test("APO [1,2,3] fast2/slow3 → 0.5 ; PPO → 25%", () => {
    // EMA2 seed@1=1.5, @2=(3-1.5)*0.6667+1.5=2.5 ; EMA3 seed@2=2
    // APO = 2.5 - 2 = 0.5 ; PPO = 0.5/2*100 = 25
    const apo = calculateAPO([1, 2, 3], 2, 3);
    const ppo = calculatePPO([1, 2, 3], 2, 3);
    expect(apo.values[0]).toBeNull();
    expect(apo.values[1]).toBeNull();
    expect(apo.current).toBeCloseTo(0.5, 4);
    expect(apo.trend).toBe("bullish");
    expect(ppo.current).toBeCloseTo(25, 4);
    expect(ppo.trend).toBe("bullish");
  });

  test("constant series → APO=0, PPO=0", () => {
    const apo = calculateAPO([9, 9, 9, 9, 9], 2, 3);
    const ppo = calculatePPO([9, 9, 9, 9, 9], 2, 3);
    expect(apo.current).toBeCloseTo(0, 6);
    expect(ppo.current).toBeCloseTo(0, 6);
  });

  test("downtrend → negative APO/PPO", () => {
    const apo = calculateAPO([5, 4, 3, 2, 1], 2, 3);
    expect(apo.current!).toBeLessThan(0);
    expect(apo.trend).toBe("bearish");
  });

  test("insufficient data → null", () => {
    expect(calculateAPO([1, 2], 2, 3).current).toBeNull();
    expect(calculatePPO([1, 2], 2, 3).current).toBeNull();
  });
});
