import { describe, expect, test } from "bun:test";
import { calculateCCI } from "./cci.ts";
import type { Candle } from "./types.ts";

// high=low=close so typical price == close, making CCI hand-computable.
function flat(price: number): Candle {
  return { open: price, high: price, low: price, close: price, volume: 1 };
}

describe("CCI", () => {
  test("TP=[1,2,3] period 3 → CCI = +100", () => {
    // SMA(TP)=2, meanDev=(1+0+1)/3=2/3, CCI=(3-2)/(0.015*2/3)=1/0.01=100
    const r = calculateCCI([flat(1), flat(2), flat(3)], 3);
    expect(r.values[0]).toBeNull();
    expect(r.values[1]).toBeNull();
    expect(r.current).toBeCloseTo(100, 4);
    expect(r.signal).toBe("neutral"); // exactly +100 is not > 100
  });

  test("TP=[3,2,1] descending period 3 → CCI = -100 (oversold needs < -100)", () => {
    // SMA=2, meanDev=2/3, CCI=(1-2)/0.01 = -100
    const r = calculateCCI([flat(3), flat(2), flat(1)], 3);
    expect(r.current).toBeCloseTo(-100, 4);
  });

  test("strong spike pushes CCI above +100 → overbought", () => {
    // period 4, TP=[1,1,1,10]: SMA=3.25, meanDev=3.375, CCI=6.75/0.050625≈133.3
    const r = calculateCCI([flat(1), flat(1), flat(1), flat(10)], 4);
    expect(r.current!).toBeGreaterThan(100);
    expect(r.signal).toBe("overbought");
  });

  test("flat series → CCI = 0", () => {
    const r = calculateCCI([flat(5), flat(5), flat(5)], 3);
    expect(r.current).toBeCloseTo(0, 6);
  });

  test("insufficient data → null", () => {
    const r = calculateCCI([flat(1), flat(2)], 3);
    expect(r.current).toBeNull();
    expect(r.interpretation).toContain("Insufficient");
  });
});
