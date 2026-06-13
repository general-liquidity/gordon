import { describe, expect, test } from "bun:test";
import { digestLargeResult } from "./resultDigest.ts";

describe("digestLargeResult", () => {
  test("returns null for non-tabular or too-small input", () => {
    expect(digestLargeResult("hello")).toBeNull();
    expect(digestLargeResult({ a: 1, b: 2 })).toBeNull(); // no array field
    expect(digestLargeResult([1, 2, 3])).toBeNull(); // shorter than a worthwhile sample
    expect(digestLargeResult(null)).toBeNull();
    expect(digestLargeResult(undefined)).toBeNull();
  });

  test("digests a large array of objects with row count, column aggregates, sample, and tally", () => {
    const scan = Array.from({ length: 50 }, (_, i) => ({ symbol: `S${i}`, rsi: 30 + (i % 40), score: i / 50 }));
    const d = digestLargeResult(scan)!;
    expect(d).toContain("50 rows");
    expect(d).toContain("rsi: min"); // numeric column aggregated
    expect(d).toContain("score: min");
    expect(d).not.toContain("symbol: min"); // string column not aggregated
    expect(d).toContain("sample (first 4 of 50)");
    expect(d).toContain("…and 46 more rows");
  });

  test("attaches scalar wrapper fields as free context", () => {
    const result = {
      symbol: "BTCUSDT",
      timeframe: "1h",
      candles: Array.from({ length: 100 }, (_, i) => ({ close: 100 + i, volume: i })),
    };
    const d = digestLargeResult(result)!;
    expect(d).toContain("symbol=BTCUSDT");
    expect(d).toContain("timeframe=1h");
    expect(d).toContain("100 rows");
    expect(d).toContain("close: min");
  });

  test("digests a long numeric series with stats", () => {
    const series = Array.from({ length: 30 }, (_, i) => i * 1.5);
    const d = digestLargeResult(series)!;
    expect(d).toContain("30 values");
    expect(d).toContain("min 0");
    expect(d).toContain("max 43.5");
    expect(d).toContain("…and 26 more");
  });

  test("returns null for a mixed array (let the caller head-slice)", () => {
    expect(digestLargeResult([1, { a: 1 }, "x", 2, 3, 4, 5, 6])).toBeNull();
  });

  test("honors maxChars by dropping sample rows but keeping the aggregates", () => {
    const wide = Array.from({ length: 20 }, (_, i) => ({ id: i, a: i, b: i * 2, note: "x".repeat(200) }));
    const d = digestLargeResult(wide, { maxChars: 300 })!;
    expect(d.length).toBeLessThanOrEqual(301); // maxChars (+1 for the ellipsis)
    expect(d).toContain("20 rows"); // the count/aggregates survive
  });

  test("never throws on un-serializable rows", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ a: BigInt(i), b: i }));
    expect(() => digestLargeResult(rows)).not.toThrow();
    const d = digestLargeResult(rows);
    expect(d === null || typeof d === "string").toBe(true);
  });
});
