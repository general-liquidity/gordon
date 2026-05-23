import { describe, expect, test } from "bun:test";
import { classifyMaProximity, formatMaProximity } from "./ma-proximity.ts";

describe("classifyMaProximity", () => {
  test("invalid price/ADR returns extended", () => {
    const r = classifyMaProximity({ price: 0, adr: 1, sma10: 100 });
    expect(r.surfingMa).toBe("extended");
    expect(r.readyForBreakout).toBe(false);
  });

  test("no MAs supplied → extended", () => {
    const r = classifyMaProximity({ price: 100, adr: 2 });
    expect(r.surfingMa).toBe("extended");
    expect(r.chosenMa).toBeNull();
  });

  test("price hugging 10 SMA within 1x ADR → surfing 10", () => {
    const r = classifyMaProximity({ price: 101, adr: 2, sma10: 100, sma21: 95, sma50: 90 });
    expect(r.surfingMa).toBe("10");
    expect(r.chosenMa).toBe(100);
    expect(r.stopUnderMaPct).toBeCloseTo(1.0, 1);
    expect(r.readyForBreakout).toBe(true);
  });

  test("price within 1x ADR of multiple MAs → picks fastest (10)", () => {
    const r = classifyMaProximity({ price: 101, adr: 5, sma10: 100, sma21: 99, sma50: 98 });
    expect(r.surfingMa).toBe("10");
  });

  test("price hugging 50 SMA only → surfing 50 (rare premium R:R)", () => {
    const r = classifyMaProximity({ price: 101, adr: 2, sma50: 100 });
    expect(r.surfingMa).toBe("50");
    expect(r.readyForBreakout).toBe(true);
  });

  test("price far from all MAs → extended, not ready", () => {
    const r = classifyMaProximity({ price: 200, adr: 2, sma10: 100, sma21: 95, sma50: 90 });
    expect(r.surfingMa).toBe("extended");
    expect(r.readyForBreakout).toBe(false);
    expect(r.rrTier).toBe("extended");
  });

  test("stop > 3% → not ready even if hugging", () => {
    // ADR is large so it counts as "near" but the stop math fails
    const r = classifyMaProximity({ price: 100, adr: 10, sma10: 95 });
    expect(r.surfingMa).toBe("10");
    expect(r.stopUnderMaPct).toBeGreaterThan(3);
    expect(r.readyForBreakout).toBe(false);
    expect(r.rrTier).toBe("wide");
  });

  test("premium tier when stop ≤ 1.5%", () => {
    const r = classifyMaProximity({ price: 100, adr: 2, sma10: 99 });
    expect(r.stopUnderMaPct).toBeCloseTo(1.0, 1);
    expect(r.rrTier).toBe("premium");
  });

  test("good tier when stop in (1.5, 2.5]%", () => {
    const r = classifyMaProximity({ price: 100, adr: 5, sma10: 98 });
    expect(r.stopUnderMaPct).toBeCloseTo(2.0, 1);
    expect(r.rrTier).toBe("good");
  });

  test("acceptable tier when stop in (2.5, 3.0]%", () => {
    const r = classifyMaProximity({ price: 100, adr: 5, sma10: 97 });
    expect(r.stopUnderMaPct).toBeCloseTo(3.0, 1);
    expect(r.rrTier).toBe("acceptable");
  });

  test("custom maxStopPct widens acceptance", () => {
    const r = classifyMaProximity({ price: 100, adr: 10, sma10: 95, maxStopPct: 6 });
    expect(r.stopUnderMaPct).toBeCloseTo(5.0, 1);
    expect(r.readyForBreakout).toBe(true);
  });

  test("stopBufferAbsolute subtracts from MA before stop calc", () => {
    const noBuffer = classifyMaProximity({ price: 100, adr: 2, sma10: 99 });
    const withBuffer = classifyMaProximity({ price: 100, adr: 2, sma10: 99, stopBufferAbsolute: 1 });
    expect(withBuffer.stopUnderMaPct).toBeGreaterThan(noBuffer.stopUnderMaPct);
  });

  test("custom proximity multiple narrows the band", () => {
    const inputs = { price: 110, adr: 5, sma10: 100, sma21: 95, sma50: 90 };
    const lax = classifyMaProximity({ ...inputs, proximityAdrMultiple: 3 });
    const strict = classifyMaProximity({ ...inputs, proximityAdrMultiple: 1 });
    expect(lax.surfingMa).not.toBe("extended");
    expect(strict.surfingMa).toBe("extended");
  });
});

describe("formatMaProximity", () => {
  test("renders header + tier", () => {
    const r = classifyMaProximity({ price: 101, adr: 2, sma10: 100 });
    const text = formatMaProximity(r);
    expect(text).toContain("MA Proximity");
    expect(text).toContain("surfing 10");
  });
});
