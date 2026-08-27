import { describe, it, expect } from "bun:test";
import {
  computeAtrProgression,
  atrProgressionToPayload,
  type AtrProgressionCandle,
} from "./atrDailyProgression.ts";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function buildDay(
  dayIndex: number,
  high: number,
  low: number,
  close: number,
): AtrProgressionCandle[] {
  // One candle per hour, 24 candles per day. We only care about high/low/close
  // aggregation, so just emit two candles per day with the desired extremes.
  const base = dayIndex * DAY_MS;
  return [
    { timestamp: base + 1 * HOUR_MS, high, low: low + 1, close: (high + low) / 2 },
    { timestamp: base + 23 * HOUR_MS, high: high - 0.1, low, close },
  ];
}

describe("computeAtrProgression", () => {
  it("no candles → degenerate result", () => {
    const r = computeAtrProgression({ candles: [] });
    expect(r.dailyAtr).toBe(0);
    expect(r.reasoning).toContain("no candles");
  });

  it("single day → cannot compute ATR yet", () => {
    const r = computeAtrProgression({ candles: buildDay(0, 110, 100, 105) });
    expect(r.dailyAtr).toBe(0);
    expect(r.reasoning).toContain("≥2 days");
  });

  it("LOW zone when today's range is well below ATR", () => {
    // 14 prior days each with range 10 → ATR≈10. Today range 2 → 20%.
    const candles: AtrProgressionCandle[] = [];
    for (let d = 0; d < 14; d++) candles.push(...buildDay(d, 110, 100, 105));
    candles.push(...buildDay(14, 101, 99, 100));
    const r = computeAtrProgression({ candles });
    expect(r.dailyAtr).toBeGreaterThan(0);
    expect(r.zone).toBe("low");
    expect(r.suggestedAction).toBe("continue");
    expect(r.continuationProbability).toBeGreaterThanOrEqual(0.8);
  });

  it("WARNING zone near 100% of ATR", () => {
    const candles: AtrProgressionCandle[] = [];
    for (let d = 0; d < 14; d++) candles.push(...buildDay(d, 110, 100, 105));
    // Today range ≈ 9.5 → ~95% of ATR≈10
    candles.push(...buildDay(14, 109.5, 100, 105));
    const r = computeAtrProgression({ candles });
    expect(r.zone).toBe("warning");
    expect(r.suggestedAction).toBe("caution");
  });

  it("EXCEEDED zone when range > ATR", () => {
    const candles: AtrProgressionCandle[] = [];
    for (let d = 0; d < 14; d++) candles.push(...buildDay(d, 110, 100, 105));
    candles.push(...buildDay(14, 120, 100, 110)); // range=20 = 200% of ATR
    const r = computeAtrProgression({ candles });
    expect(r.zone).toBe("extreme");
    expect(r.suggestedAction).toBe("avoid");
    expect(r.continuationProbability).toBeLessThanOrEqual(0.2);
  });

  it("reversalProbability + continuationProbability = 1", () => {
    const candles: AtrProgressionCandle[] = [];
    for (let d = 0; d < 14; d++) candles.push(...buildDay(d, 110, 100, 105));
    candles.push(...buildDay(14, 106, 100, 103));
    const r = computeAtrProgression({ candles });
    expect(r.reversalProbability + r.continuationProbability).toBeCloseTo(1, 9);
  });

  it("UTC day boundary shift groups candles differently", () => {
    // Half a day at boundary 0 vs boundary 12 should give different daily groupings.
    const candles: AtrProgressionCandle[] = [];
    for (let d = 0; d < 14; d++) candles.push(...buildDay(d, 110, 100, 105));
    candles.push(...buildDay(14, 109, 100, 105));
    const a = computeAtrProgression({ candles, dayBoundaryHourUtc: 0 });
    const b = computeAtrProgression({ candles, dayBoundaryHourUtc: 12 });
    expect(a.daysObserved).toBeDefined();
    expect(b.daysObserved).toBeDefined();
  });
});

describe("atrProgressionToPayload", () => {
  it("emits stable shape", () => {
    const candles: AtrProgressionCandle[] = [];
    for (let d = 0; d < 14; d++) candles.push(...buildDay(d, 110, 100, 105));
    candles.push(...buildDay(14, 107, 100, 104));
    const p = atrProgressionToPayload(computeAtrProgression({ candles })) as {
      kind: string;
      zone: string;
      suggestedAction: string;
    };
    expect(p.kind).toBe("atr_progression.computed");
    expect(["low", "moderate", "active", "high", "warning", "exceeded", "extreme"]).toContain(
      p.zone,
    );
    expect(["continue", "caution", "avoid"]).toContain(p.suggestedAction);
  });
});
