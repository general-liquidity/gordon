import { describe, expect, test } from "bun:test";
import { calculateCMO } from "./cmo.ts";

describe("CMO", () => {
  test("all-up [1,2,3,4] period 3 → CMO = +100", () => {
    const r = calculateCMO([1, 2, 3, 4], 3);
    expect(r.values[0]).toBeNull();
    expect(r.current).toBeCloseTo(100, 4);
    expect(r.signal).toBe("overbought");
  });

  test("all-down [4,3,2,1] period 3 → CMO = -100", () => {
    const r = calculateCMO([4, 3, 2, 1], 3);
    expect(r.current).toBeCloseTo(-100, 4);
    expect(r.signal).toBe("oversold");
  });

  test("mixed [1,3,2,4] period 3 → CMO = 60", () => {
    // deltas: +2,-1,+2 ; window i=3: gains{2,0,2}=4 losses{0,1,0}=1 → 100*(4-1)/5=60
    const r = calculateCMO([1, 3, 2, 4], 3);
    expect(r.current).toBeCloseTo(60, 4);
    expect(r.signal).toBe("overbought"); // > 50
  });

  test("flat series → CMO = 0", () => {
    const r = calculateCMO([5, 5, 5, 5], 3);
    expect(r.current).toBeCloseTo(0, 6);
    expect(r.signal).toBe("neutral");
  });

  test("insufficient data → null", () => {
    const r = calculateCMO([1, 2, 3], 3);
    expect(r.current).toBeNull();
  });
});
