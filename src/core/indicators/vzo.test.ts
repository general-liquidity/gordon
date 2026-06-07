import { describe, expect, it } from "bun:test";
import { computeVZO } from "./vzo.ts";

const up = Array.from({ length: 20 }, (_, i) => 100 + i);
const down = Array.from({ length: 20 }, (_, i) => 100 - i);
const vol = Array.from({ length: 20 }, () => 100);

describe("computeVZO", () => {
  it("reads +100 (overbought) when all volume lands on up-closes", () => {
    const r = computeVZO({ closes: up, volumes: vol, period: 14 });
    expect(r.current).toBeCloseTo(100, 6);
    expect(r.zone).toBe("overbought");
    expect(r.values[0]).toBeNull();
  });

  it("reads −100 (oversold) when all volume lands on down-closes", () => {
    const r = computeVZO({ closes: down, volumes: vol, period: 14 });
    expect(r.current).toBeCloseTo(-100, 6);
    expect(r.zone).toBe("oversold");
  });

  it("stays near zero when up/down volume alternates", () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + (i % 2 === 0 ? 1 : -1));
    const r = computeVZO({ closes, volumes: Array.from({ length: 40 }, () => 100), period: 14 });
    expect(Math.abs(r.current!)).toBeLessThan(40);
  });

  it("is neutral on insufficient data or mismatched lengths", () => {
    expect(computeVZO({ closes: [1, 2, 3], volumes: [1, 1, 1], period: 14 }).zone).toBe("insufficient");
    expect(computeVZO({ closes: up, volumes: [1, 2] }).zone).toBe("insufficient");
  });
});
