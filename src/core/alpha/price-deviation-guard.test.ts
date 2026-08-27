import { describe, expect, test } from "bun:test";
import { checkPriceDeviation } from "./price-deviation-guard.ts";

describe("checkPriceDeviation", () => {
  // MATH-ANCHOR: identical price → 0% deviation, ok.
  test("100 vs 100 → 0% ok", () => {
    const r = checkPriceDeviation({ orderPrice: 100, referencePrice: 100 });
    expect(r).not.toBeNull();
    expect(r!.deviationPct).toBe(0);
    expect(r!.breached).toBe(false);
    expect(r!.verdict).toBe("ok");
  });

  // MATH-ANCHOR: (105 - 100)/100 * 100 = +5%, breached at 2% threshold.
  test("105 vs 100 → +5% breached at 2% threshold", () => {
    const r = checkPriceDeviation({ orderPrice: 105, referencePrice: 100, thresholdPct: 2 });
    expect(r!.deviationPct).toBe(5);
    expect(r!.breached).toBe(true);
    // No side → warn (can't classify direction).
    expect(r!.verdict).toBe("warn");
  });

  // MATH-ANCHOR: buy limit far ABOVE mark = dangerous direction → block.
  test("buy at 110 vs 100 mark → block", () => {
    const r = checkPriceDeviation({ orderPrice: 110, referencePrice: 100, side: "buy" });
    expect(r!.deviationPct).toBe(10);
    expect(r!.breached).toBe(true);
    expect(r!.verdict).toBe("block");
  });

  // Sell far BELOW mark = dangerous direction → block.
  test("sell at 90 vs 100 mark → block", () => {
    const r = checkPriceDeviation({ orderPrice: 90, referencePrice: 100, side: "sell" });
    expect(r!.deviationPct).toBe(-10);
    expect(r!.verdict).toBe("block");
  });

  // Benign direction: buy BELOW mark → warn (improves fill, not dangerous).
  test("buy at 90 vs 100 mark → warn (benign direction)", () => {
    const r = checkPriceDeviation({ orderPrice: 90, referencePrice: 100, side: "buy" });
    expect(r!.deviationPct).toBe(-10);
    expect(r!.breached).toBe(true);
    expect(r!.verdict).toBe("warn");
  });

  // Benign direction: sell ABOVE mark → warn.
  test("sell at 110 vs 100 mark → warn (benign direction)", () => {
    const r = checkPriceDeviation({ orderPrice: 110, referencePrice: 100, side: "sell" });
    expect(r!.verdict).toBe("warn");
  });

  // Within tolerance with a side stays ok.
  test("buy at 101 vs 100, 2% threshold → ok", () => {
    const r = checkPriceDeviation({
      orderPrice: 101,
      referencePrice: 100,
      thresholdPct: 2,
      side: "buy",
    });
    expect(r!.deviationPct).toBe(1);
    expect(r!.breached).toBe(false);
    expect(r!.verdict).toBe("ok");
  });

  // Boundary: exactly at threshold is NOT breached (strict >).
  test("102 vs 100 at 2% threshold → exactly 2%, not breached", () => {
    const r = checkPriceDeviation({ orderPrice: 102, referencePrice: 100, thresholdPct: 2 });
    expect(r!.deviationPct).toBe(2);
    expect(r!.breached).toBe(false);
    expect(r!.verdict).toBe("ok");
  });

  // NULL on bad inputs.
  test("null on referencePrice <= 0", () => {
    expect(checkPriceDeviation({ orderPrice: 100, referencePrice: 0 })).toBeNull();
    expect(checkPriceDeviation({ orderPrice: 100, referencePrice: -50 })).toBeNull();
  });

  test("null on non-positive / non-finite orderPrice", () => {
    expect(checkPriceDeviation({ orderPrice: 0, referencePrice: 100 })).toBeNull();
    expect(checkPriceDeviation({ orderPrice: -1, referencePrice: 100 })).toBeNull();
    expect(checkPriceDeviation({ orderPrice: NaN, referencePrice: 100 })).toBeNull();
    expect(checkPriceDeviation({ orderPrice: Infinity, referencePrice: 100 })).toBeNull();
  });

  test("invalid thresholdPct falls back to default 2%", () => {
    const r = checkPriceDeviation({ orderPrice: 103, referencePrice: 100, thresholdPct: NaN });
    expect(r!.deviationPct).toBe(3);
    expect(r!.breached).toBe(true);
  });

  test("interpretation string present on every verdict", () => {
    const ok = checkPriceDeviation({ orderPrice: 100, referencePrice: 100 });
    const block = checkPriceDeviation({ orderPrice: 110, referencePrice: 100, side: "buy" });
    expect(typeof ok!.interpretation).toBe("string");
    expect(block!.interpretation).toContain("BLOCK");
  });
});
