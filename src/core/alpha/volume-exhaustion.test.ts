import { describe, expect, test } from "bun:test";
import { detectVolumeExhaustion, formatVolumeExhaustion } from "./volume-exhaustion.ts";

describe("detectVolumeExhaustion", () => {
  test("mean_reversion strategy returns not_applicable", () => {
    const r = detectVolumeExhaustion({
      strategy: "mean_reversion",
      baselineMeanVolUSD: 1_000_000,
      currentMeanVolUSD: 100_000,
      postEntryCandles: 10,
    });
    expect(r.action).toBe("not_applicable");
    expect(r.signal).toBe(false);
  });

  test("too few post-entry candles → insufficient_data", () => {
    const r = detectVolumeExhaustion({
      strategy: "breakout",
      baselineMeanVolUSD: 1_000_000,
      currentMeanVolUSD: 100_000,
      postEntryCandles: 2,
    });
    expect(r.action).toBe("insufficient_data");
  });

  test("zero baseline → insufficient_data", () => {
    const r = detectVolumeExhaustion({
      strategy: "breakout",
      baselineMeanVolUSD: 0,
      currentMeanVolUSD: 100,
      postEntryCandles: 10,
    });
    expect(r.action).toBe("insufficient_data");
  });

  test("flat volume → hold", () => {
    const r = detectVolumeExhaustion({
      strategy: "breakout",
      baselineMeanVolUSD: 1_000_000,
      currentMeanVolUSD: 1_000_000,
      postEntryCandles: 10,
    });
    expect(r.severity).toBe("none");
    expect(r.action).toBe("hold");
    expect(r.signal).toBe(false);
  });

  test("volume rising → hold", () => {
    const r = detectVolumeExhaustion({
      strategy: "breakout",
      baselineMeanVolUSD: 1_000_000,
      currentMeanVolUSD: 1_500_000,
      postEntryCandles: 10,
    });
    expect(r.severity).toBe("none");
    expect(r.action).toBe("hold");
    expect(r.dropFraction).toBeLessThan(0);
  });

  test("10% drop → tighten_stop (sub-mild)", () => {
    const r = detectVolumeExhaustion({
      strategy: "breakout",
      baselineMeanVolUSD: 1_000_000,
      currentMeanVolUSD: 900_000,
      postEntryCandles: 10,
    });
    expect(r.severity).toBe("none");
    expect(r.action).toBe("tighten_stop");
    expect(r.signal).toBe(false);
  });

  test("30% drop → mild severity → scale_out", () => {
    const r = detectVolumeExhaustion({
      strategy: "breakout",
      baselineMeanVolUSD: 1_000_000,
      currentMeanVolUSD: 700_000,
      postEntryCandles: 10,
    });
    expect(r.severity).toBe("mild");
    expect(r.action).toBe("scale_out");
    expect(r.signal).toBe(true);
  });

  test("60% drop → severe severity → exit_full", () => {
    const r = detectVolumeExhaustion({
      strategy: "breakout",
      baselineMeanVolUSD: 1_000_000,
      currentMeanVolUSD: 400_000,
      postEntryCandles: 10,
    });
    expect(r.severity).toBe("severe");
    expect(r.action).toBe("exit_full");
    expect(r.signal).toBe(true);
  });

  test("respects custom thresholds", () => {
    const r = detectVolumeExhaustion({
      strategy: "breakout",
      baselineMeanVolUSD: 1_000_000,
      currentMeanVolUSD: 850_000,
      postEntryCandles: 10,
      mildDropThreshold: 0.1,
      severeDropThreshold: 0.2,
    });
    expect(r.severity).toBe("mild");
    expect(r.action).toBe("scale_out");
  });
});

describe("formatVolumeExhaustion", () => {
  test("renders header + severity", () => {
    const r = detectVolumeExhaustion({
      strategy: "breakout",
      baselineMeanVolUSD: 1_000_000,
      currentMeanVolUSD: 400_000,
      postEntryCandles: 10,
    });
    const text = formatVolumeExhaustion(r);
    expect(text).toContain("Volume Exhaustion");
    expect(text).toContain("SEVERE");
    expect(text).toContain("exit_full");
  });
});
