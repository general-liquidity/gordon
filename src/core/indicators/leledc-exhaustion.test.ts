import { describe, expect, it } from "bun:test";
import { computeLeledcExhaustion, type LeledcCandle } from "./leledc-exhaustion.ts";

/** A bearish candle around `base`. */
const bearBar = (base: number): LeledcCandle => ({
  open: base + 0.5,
  high: base + 0.7,
  low: base - 0.7,
  close: base - 0.5,
});
/** A bullish candle around `base`, with `lowOverride` to force a new extreme low. */
const bullBar = (base: number, lowOverride?: number): LeledcCandle => ({
  open: base - 0.5,
  high: base + 0.5,
  low: lowOverride ?? base - 0.7,
  close: base + 0.5,
});

describe("computeLeledcExhaustion", () => {
  it("flags a major bottom (support) after a sustained decline + bullish reversal at a new low", () => {
    const candles: LeledcCandle[] = [];
    for (let i = 0; i < 34; i++) candles.push(bearBar(100 - i)); // declining, all bearish
    // Bullish reversal at a fresh low → bullish exhaustion (major bottom).
    candles.push(bullBar(66, 64)); // index 34, low 64 = new extreme
    const r = computeLeledcExhaustion({ candles });

    const bottom = r.signals.find((s) => s.tier === "major" && s.side === "bottom");
    expect(bottom).toBeDefined();
    expect(bottom!.level).toBe(64); // the reversal bar's low = support
    expect(r.majorSupport).toBe(64);
    expect(r.latestIsExhaustion).toBe(true);
    expect(r.latestSignal?.side).toBe("bottom");
  });

  it("flags a major top (resistance) after a sustained rally + bearish reversal at a new high", () => {
    const candles: LeledcCandle[] = [];
    for (let i = 0; i < 34; i++) candles.push(bullBar(100 + i)); // rising, all bullish
    // Bearish reversal at a fresh high → bearish exhaustion (major top).
    candles.push({ open: 133, high: 136, low: 132, close: 132.5 }); // bearish, high 136 = new extreme
    const r = computeLeledcExhaustion({ candles });
    const top = r.signals.find((s) => s.tier === "major" && s.side === "top");
    expect(top).toBeDefined();
    expect(top!.level).toBe(136);
    expect(r.majorResistance).toBe(136);
  });

  it("finds no exhaustion on a flat series (counters never advance)", () => {
    const candles = Array.from({ length: 40 }, () => ({
      open: 100,
      high: 100.5,
      low: 99.5,
      close: 100,
    }));
    const r = computeLeledcExhaustion({ candles });
    expect(r.signals.length).toBe(0);
    expect(r.latestIsExhaustion).toBe(false);
  });

  it("is neutral on insufficient data", () => {
    const r = computeLeledcExhaustion({ candles: [bearBar(100), bearBar(99)] });
    expect(r.signals).toEqual([]);
    expect(r.majorSupport).toBeNull();
  });
});
