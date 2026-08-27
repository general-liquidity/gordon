import { describe, expect, test } from "bun:test";
import { detectPsp, formatPsp, type PspBar } from "./psp-detector.ts";

function bar(symbol: string, open: number, close: number): PspBar {
  return { symbol, open, close };
}

describe("detectPsp", () => {
  test("fewer than 2 assets → insufficient_data", () => {
    const r = detectPsp([bar("NQ", 100, 101)]);
    expect(r.verdict).toBe("insufficient_data");
  });

  test("all three bullish → all_bullish, no PSP", () => {
    const r = detectPsp([bar("NQ", 100, 101), bar("ES", 100, 100.5), bar("YM", 100, 100.8)]);
    expect(r.verdict).toBe("all_bullish");
    expect(r.pspAsset).toBeNull();
  });

  test("all three bearish → all_bearish, no PSP", () => {
    const r = detectPsp([bar("NQ", 100, 99), bar("ES", 100, 99.5), bar("YM", 100, 99.2)]);
    expect(r.verdict).toBe("all_bearish");
  });

  test("two bullish, one bearish → psp_detected, recommended long", () => {
    const r = detectPsp([
      bar("NQ", 100, 99), // bearish dissenter
      bar("ES", 100, 101),
      bar("YM", 100, 100.5),
    ]);
    expect(r.verdict).toBe("psp_detected");
    expect(r.pspAsset).toBe("NQ");
    expect(r.recommendedDirection).toBe("long");
  });

  test("two bearish, one bullish → psp_detected, recommended short", () => {
    const r = detectPsp([
      bar("NQ", 100, 101), // bullish dissenter
      bar("ES", 100, 99),
      bar("YM", 100, 98.5),
    ]);
    expect(r.verdict).toBe("psp_detected");
    expect(r.pspAsset).toBe("NQ");
    expect(r.recommendedDirection).toBe("short");
  });

  test("equal split → split verdict", () => {
    const r = detectPsp([bar("NQ", 100, 101), bar("ES", 100, 99)]);
    expect(r.verdict).toBe("split");
    expect(r.pspAsset).toBeNull();
  });

  test("multiple dissenters → split", () => {
    const r = detectPsp([
      bar("A", 100, 101), // bull
      bar("B", 100, 101.5), // bull
      bar("C", 100, 99), // bear dissenter
      bar("D", 100, 98), // bear dissenter
    ]);
    // 2 bull vs 2 bear → split
    expect(r.verdict).toBe("split");
  });

  test("clear majority with 2 dissenters → split (no false-positive PSP)", () => {
    const r = detectPsp([
      bar("A", 100, 101), // bull
      bar("B", 100, 101.5), // bull
      bar("C", 100, 102), // bull
      bar("D", 100, 99), // bear dissenter
      bar("E", 100, 98.5), // bear dissenter
    ]);
    // Majority is bullish (3) but 2 dissenters → split per primitive's
    // conservative rule (only single-dissenter cases count as PSP)
    expect(r.majorityDirection).toBe("bullish");
    expect(r.verdict).toBe("split");
  });

  test("doji bar ignored, doesn't count as majority or dissenter", () => {
    const r = detectPsp(
      [
        bar("NQ", 100, 100), // exact doji
        bar("ES", 100, 101),
        bar("YM", 100, 101.5),
      ],
      { dojiToleranceFraction: 0 },
    );
    // Majority bullish, NQ is doji not a dissenter
    expect(r.majorityDirection).toBe("bullish");
    expect(r.dojiCount).toBe(1);
    expect(r.verdict).toBe("all_bullish"); // no dissenters
  });

  test("doji tolerance band suppresses tiny moves", () => {
    const r = detectPsp(
      [
        bar("NQ", 100, 100.01), // tiny bull
        bar("ES", 100, 101),
        bar("YM", 100, 101.5),
      ],
      { dojiToleranceFraction: 0.001 },
    );
    // NQ change = 0.01% which is below 0.1% doji tolerance → doji
    expect(r.assetStatuses[0]!.direction).toBe("doji");
  });

  test("4-asset PSP with single dissenter", () => {
    const r = detectPsp([
      bar("BTC", 50000, 50100),
      bar("ETH", 3000, 3010),
      bar("SOL", 100, 100.5),
      bar("AVAX", 30, 29.5), // bear dissenter
    ]);
    expect(r.verdict).toBe("psp_detected");
    expect(r.pspAsset).toBe("AVAX");
  });

  test("3-2 split — 3 bull, 2 bear → 2 dissenters → split", () => {
    const r = detectPsp([
      bar("A", 100, 101),
      bar("B", 100, 101),
      bar("C", 100, 101),
      bar("D", 100, 99),
      bar("E", 100, 99),
    ]);
    expect(r.majorityDirection).toBe("bullish");
    expect(r.verdict).toBe("split"); // 2 dissenters disqualifies PSP
  });

  test("4-1 with single dissenter → psp_detected", () => {
    const r = detectPsp([
      bar("A", 100, 101),
      bar("B", 100, 101),
      bar("C", 100, 101),
      bar("D", 100, 101),
      bar("E", 100, 99),
    ]);
    expect(r.verdict).toBe("psp_detected");
    expect(r.pspAsset).toBe("E");
    expect(r.recommendedDirection).toBe("long");
  });
});

describe("formatPsp", () => {
  test("renders header + per-asset table + dissenter note", () => {
    const r = detectPsp([bar("NQ", 100, 99), bar("ES", 100, 101), bar("YM", 100, 100.5)]);
    const text = formatPsp(r);
    expect(text).toContain("PSP Detector");
    expect(text).toContain("PSP_DETECTED");
    expect(text).toContain("dissenter");
  });
});
