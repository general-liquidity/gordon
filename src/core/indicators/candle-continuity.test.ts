import { describe, expect, test } from "bun:test";
import { calculateCandleContinuity } from "./candle-continuity.ts";
import type { Candle } from "./types.ts";

function c(open: number, high: number, low: number, close: number, volume = 100): Candle {
  return { open, high, low, close, volume };
}

describe("calculateCandleContinuity", () => {
  test("continuation up: bullish prior + close above prior high", () => {
    // prior bullish (10 -> 12), current opens inside body, closes above prior high (12)
    const prior = c(10, 12.5, 9.5, 12);
    const current = c(11, 14, 10.8, 13.5);
    const r = calculateCandleContinuity([prior, current]);
    expect(r.type).toBe("continuation");
    expect(r.bias).toBe("bullish");
    expect(r.signal).toBe("long");
    expect(r.closeRelation).toBe("strength_up");
    expect(r.referenceOpen).toBe(13.5);
  });

  test("continuation down: bearish prior + close below prior low", () => {
    // prior bearish (12 -> 10), current closes below prior low (9.5)
    const prior = c(12, 12.5, 9.5, 10);
    const current = c(11, 11.5, 8, 9);
    const r = calculateCandleContinuity([prior, current]);
    expect(r.type).toBe("continuation");
    expect(r.bias).toBe("bearish");
    expect(r.signal).toBe("short");
    expect(r.closeRelation).toBe("strength_down");
    expect(r.referenceOpen).toBe(9);
  });

  test("reversal up: bearish prior + close above prior high", () => {
    // prior bearish (12 -> 10), current closes above prior high (12.5)
    const prior = c(12, 12.5, 9.5, 10);
    const current = c(10.5, 13.5, 10.2, 13);
    const r = calculateCandleContinuity([prior, current]);
    expect(r.type).toBe("reversal");
    expect(r.bias).toBe("bullish");
    expect(r.signal).toBe("long");
    expect(r.closeRelation).toBe("strength_up");
    expect(r.referenceOpen).toBe(13);
  });

  test("reversal down: bullish prior + close below prior low", () => {
    // prior bullish (10 -> 12), current closes below prior low (9.5)
    const prior = c(10, 12.5, 9.5, 12);
    const current = c(11.5, 11.8, 8.5, 9);
    const r = calculateCandleContinuity([prior, current]);
    expect(r.type).toBe("reversal");
    expect(r.bias).toBe("bearish");
    expect(r.signal).toBe("short");
    expect(r.closeRelation).toBe("strength_down");
    expect(r.referenceOpen).toBe(9);
  });

  test("weakness / neutral: close stays inside prior range", () => {
    // prior bullish (10 -> 12), current closes inside prior range (between 9.5 and 12.5)
    const prior = c(10, 12.5, 9.5, 12);
    const current = c(11, 12.2, 10.5, 11.5);
    const r = calculateCandleContinuity([prior, current]);
    expect(r.type).toBe("neutral");
    expect(r.bias).toBe("neutral");
    expect(r.signal).toBe("flat");
    expect(r.closeRelation).toBe("inside");
    expect(r.referenceOpen).toBeNull();
  });

  test("insufficient data: single candle -> neutral", () => {
    const r = calculateCandleContinuity([c(10, 11, 9, 10.5)]);
    expect(r.type).toBe("neutral");
    expect(r.bias).toBe("neutral");
    expect(r.signal).toBe("flat");
    expect(r.referenceOpen).toBeNull();
    expect(r.continuationRate).toBeNull();
    expect(r.samplePairs).toBe(0);
    expect(r.interpretation).toBe("Insufficient data for candle continuity");
  });

  test("empty array -> neutral", () => {
    const r = calculateCandleContinuity([]);
    expect(r.samplePairs).toBe(0);
    expect(r.continuationRate).toBeNull();
  });

  test("openLocation classification", () => {
    const prior = c(10, 12.5, 9.5, 12); // body 10..12, range 9.5..12.5
    expect(calculateCandleContinuity([prior, c(13, 14, 12.6, 13.5)]).openLocation).toBe(
      "above_prior_high",
    );
    expect(calculateCandleContinuity([prior, c(9, 9.4, 8, 8.5)]).openLocation).toBe(
      "below_prior_low",
    );
    expect(calculateCandleContinuity([prior, c(11, 11.5, 10.5, 11)]).openLocation).toBe(
      "inside_prior_body",
    );
    // open in range but outside body: between 12 (body high) and 12.5 (high)
    expect(calculateCandleContinuity([prior, c(12.3, 12.4, 12.1, 12.35)]).openLocation).toBe(
      "inside_prior_range",
    );
  });

  test("continuationRate history: all bullish run -> rate 1.0", () => {
    // 5 candles, each bullish; 4 pairs, prior dir == next dir every time
    const candles: Candle[] = [
      c(10, 11, 9.5, 10.8),
      c(10.8, 12, 10.6, 11.8),
      c(11.8, 13, 11.6, 12.8),
      c(12.8, 14, 12.6, 13.8),
      c(13.8, 15, 13.6, 14.8),
    ];
    const r = calculateCandleContinuity(candles, { historyBars: 50 });
    expect(r.samplePairs).toBe(4);
    expect(r.continuationRate).toBe(1);
  });

  test("continuationRate history: alternating direction -> rate 0", () => {
    // bull, bear, bull, bear -> no prior/next direction matches
    const candles: Candle[] = [
      c(10, 11, 9.5, 10.8), // bull
      c(10.8, 11, 9, 9.5), // bear
      c(9.5, 11, 9.4, 10.8), // bull
      c(10.8, 11, 9, 9.5), // bear
    ];
    const r = calculateCandleContinuity(candles, { historyBars: 50 });
    expect(r.samplePairs).toBe(3);
    expect(r.continuationRate).toBe(0);
  });

  test("historyBars window caps sample count", () => {
    const candles: Candle[] = Array.from({ length: 100 }, (_, i) =>
      c(10 + i, 11 + i, 9 + i, 10.5 + i),
    );
    const r = calculateCandleContinuity(candles, { historyBars: 10 });
    expect(r.samplePairs).toBe(9);
  });
});
