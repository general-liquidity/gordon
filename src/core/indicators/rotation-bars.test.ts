import { describe, expect, it } from "bun:test";
import { constructRotationBars } from "./rotation-bars.ts";

describe("constructRotationBars — range", () => {
  it("emits a bar each time the high-low span reaches size", () => {
    // 100→150 spans 50 (bar1), then 150→{130,200} spans 70 → 200 (bar2).
    const r = constructRotationBars({
      values: [100, 120, 150, 130, 200],
      method: "range",
      size: 50,
    });
    expect(r.barCount).toBe(2);
    expect(r.bars[0]).toEqual({ open: 100, high: 150, low: 100, close: 150, direction: 1 });
    expect(r.bars[1]).toEqual({ open: 150, high: 200, low: 130, close: 200, direction: 1 });
  });

  it("filters sub-size noise to zero bars", () => {
    const r = constructRotationBars({
      values: [100, 110, 100, 110, 100],
      method: "range",
      size: 50,
    });
    expect(r.barCount).toBe(0);
  });
});

describe("constructRotationBars — renko", () => {
  it("prints one brick per size-crossing in the move direction", () => {
    const r = constructRotationBars({ values: [100, 160, 170, 210], method: "renko", size: 50 });
    expect(r.barCount).toBe(2);
    expect(r.bars[0]).toEqual({ open: 100, high: 150, low: 100, close: 150, direction: 1 });
    expect(r.bars[1]).toEqual({ open: 150, high: 200, low: 150, close: 200, direction: 1 });
  });

  it("prints down bricks on a decline", () => {
    const r = constructRotationBars({ values: [100, 40], method: "renko", size: 50 });
    expect(r.barCount).toBe(1);
    expect(r.bars[0]).toEqual({ open: 100, high: 100, low: 50, close: 50, direction: -1 });
  });

  it("emits multiple bricks for a large single move", () => {
    const r = constructRotationBars({ values: [100, 260], method: "renko", size: 50 });
    expect(r.barCount).toBe(3); // 100→150→200→250
    expect(r.bars.every((b) => b.direction === 1)).toBe(true);
  });
});

describe("constructRotationBars — guards", () => {
  it("rejects non-positive size", () => {
    expect(constructRotationBars({ values: [1, 2, 3], size: 0 }).barCount).toBe(0);
  });

  it("returns empty on insufficient data", () => {
    expect(constructRotationBars({ values: [100], size: 10 }).barCount).toBe(0);
  });

  it("caps output at maxBars and flags truncation", () => {
    const values = Array.from({ length: 1000 }, (_, i) => i); // 0,1,...,999
    const r = constructRotationBars({ values, method: "renko", size: 1, maxBars: 10 });
    expect(r.barCount).toBe(10);
    expect(r.truncated).toBe(true);
  });
});
