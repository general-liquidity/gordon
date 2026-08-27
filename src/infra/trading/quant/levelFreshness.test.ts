import { describe, it, expect } from "bun:test";
import { evaluateLevelFreshness, levelFreshnessToPayload } from "./levelFreshness.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;

function mkCandle(timestamp: number, high: number, low: number) {
  return { timestamp, high, low };
}

describe("evaluateLevelFreshness — validation", () => {
  it("rejects non-positive level", () => {
    expect(() => evaluateLevelFreshness({ level: 0, candles: [mkCandle(0, 100, 99)] })).toThrow();
  });

  it("rejects empty candles", () => {
    expect(() => evaluateLevelFreshness({ level: 100, candles: [] })).toThrow();
  });

  it("rejects windowMinutes ≤ 0", () => {
    expect(() =>
      evaluateLevelFreshness({
        level: 100,
        candles: [mkCandle(0, 100, 99)],
        windowMinutes: 0,
      }),
    ).toThrow();
  });

  it("rejects touchTolerancePct ≤ 0", () => {
    expect(() =>
      evaluateLevelFreshness({
        level: 100,
        candles: [mkCandle(0, 100, 99)],
        touchTolerancePct: 0,
      }),
    ).toThrow();
  });

  it("rejects recycledThreshold < 1", () => {
    expect(() =>
      evaluateLevelFreshness({
        level: 100,
        candles: [mkCandle(0, 100, 99)],
        recycledThreshold: 0,
      }),
    ).toThrow();
  });

  it("rejects invalid OHLC (high < low)", () => {
    expect(() =>
      evaluateLevelFreshness({
        level: 100,
        candles: [mkCandle(0, 99, 100)],
      }),
    ).toThrow();
  });
});

describe("evaluateLevelFreshness — touch detection", () => {
  it("candle range overlaps band → touch", () => {
    // Level 100, default tol 0.1% → band [99.9, 100.1]
    // Candle 99.5–100.5 overlaps → touch
    const r = evaluateLevelFreshness({
      level: 100,
      candles: [mkCandle(0, 100.5, 99.5)],
    });
    expect(r.touchCount).toBe(1);
  });

  it("candle entirely below band → not a touch", () => {
    // Band [99.9, 100.1]; candle 98–99 → no overlap
    const r = evaluateLevelFreshness({
      level: 100,
      candles: [mkCandle(0, 99, 98)],
    });
    expect(r.touchCount).toBe(0);
  });

  it("candle entirely above band → not a touch", () => {
    // Band [99.9, 100.1]; candle 101–102 → no overlap
    const r = evaluateLevelFreshness({
      level: 100,
      candles: [mkCandle(0, 102, 101)],
    });
    expect(r.touchCount).toBe(0);
  });

  it("wick that grazes the band counts as a touch", () => {
    // Band [99.9, 100.1]; candle wick high = 99.95, low = 99 → high in band
    const r = evaluateLevelFreshness({
      level: 100,
      candles: [mkCandle(0, 99.95, 99)],
    });
    expect(r.touchCount).toBe(1);
  });

  it("respects custom tolerance", () => {
    // Tight tolerance: 0.001% → band [99.999, 100.001]
    // Candle 99.95–100.05 still touches (overlaps band)
    const tight = evaluateLevelFreshness({
      level: 100,
      candles: [mkCandle(0, 100.05, 99.95)],
      touchTolerancePct: 0.00001,
    });
    expect(tight.touchCount).toBe(1);

    // Candle 99–99.9 — high below tight band → no touch
    const noTouch = evaluateLevelFreshness({
      level: 100,
      candles: [mkCandle(0, 99.9, 99)],
      touchTolerancePct: 0.00001,
    });
    expect(noTouch.touchCount).toBe(0);
  });
});

describe("evaluateLevelFreshness — window filtering", () => {
  it("touches inside window are counted", () => {
    const now = 100 * HOUR;
    const r = evaluateLevelFreshness({
      level: 100,
      candles: [
        mkCandle(now - 1 * HOUR, 100.05, 99.95), // 1h ago, touch
        mkCandle(now - 3 * HOUR, 100.05, 99.95), // 3h ago, touch
      ],
      windowMinutes: 360, // 6h
      windowEndMs: now,
    });
    expect(r.touchCount).toBe(2);
  });

  it("touches outside window are not counted", () => {
    const now = 100 * HOUR;
    const r = evaluateLevelFreshness({
      level: 100,
      candles: [
        mkCandle(now - 10 * HOUR, 100.05, 99.95), // 10h ago, outside 6h window
        mkCandle(now - 1 * HOUR, 100.05, 99.95), // 1h ago, inside
      ],
      windowMinutes: 360,
      windowEndMs: now,
    });
    expect(r.touchCount).toBe(1);
  });

  it("default windowEndMs = latest candle timestamp", () => {
    const r = evaluateLevelFreshness({
      level: 100,
      candles: [
        mkCandle(0, 100.05, 99.95), // touch
        mkCandle(1 * HOUR, 100.05, 99.95), // touch (latest)
      ],
    });
    expect(r.touchCount).toBe(2);
    expect(r.windowEndMs).toBe(1 * HOUR);
  });
});

describe("evaluateLevelFreshness — classification", () => {
  it("0 touches → fresh", () => {
    const r = evaluateLevelFreshness({
      level: 100,
      candles: [mkCandle(0, 95, 90)],
    });
    expect(r.touchCount).toBe(0);
    expect(r.classification).toBe("fresh");
  });

  it("1 touch → fresh (default threshold 2)", () => {
    const r = evaluateLevelFreshness({
      level: 100,
      candles: [mkCandle(0, 100.05, 99.95)],
    });
    expect(r.touchCount).toBe(1);
    expect(r.classification).toBe("fresh");
  });

  it("2 touches → recycled (default threshold)", () => {
    const now = 100 * HOUR;
    const r = evaluateLevelFreshness({
      level: 100,
      candles: [mkCandle(now - 1 * HOUR, 100.05, 99.95), mkCandle(now - 2 * HOUR, 100.05, 99.95)],
      windowEndMs: now,
    });
    expect(r.touchCount).toBe(2);
    expect(r.classification).toBe("recycled");
  });

  it("3+ touches → recycled", () => {
    const now = 100 * HOUR;
    const r = evaluateLevelFreshness({
      level: 100,
      candles: [
        mkCandle(now - 1 * HOUR, 100.05, 99.95),
        mkCandle(now - 2 * HOUR, 100.05, 99.95),
        mkCandle(now - 3 * HOUR, 100.05, 99.95),
      ],
      windowEndMs: now,
    });
    expect(r.touchCount).toBe(3);
    expect(r.classification).toBe("recycled");
  });

  it("respects custom recycledThreshold", () => {
    // Threshold 1: even a single touch → recycled
    const r = evaluateLevelFreshness({
      level: 100,
      candles: [mkCandle(0, 100.05, 99.95)],
      recycledThreshold: 1,
    });
    expect(r.classification).toBe("recycled");
  });
});

describe("evaluateLevelFreshness — tolerance band", () => {
  it("reports correct tolerance band", () => {
    const r = evaluateLevelFreshness({
      level: 100,
      candles: [mkCandle(0, 100, 99)],
      touchTolerancePct: 0.01, // 1%
    });
    expect(r.toleranceBand.lower).toBeCloseTo(99, 6);
    expect(r.toleranceBand.upper).toBeCloseTo(101, 6);
  });
});

describe("levelFreshnessToPayload", () => {
  it("emits stable shape", () => {
    const now = 100 * HOUR;
    const r = evaluateLevelFreshness({
      level: 100,
      candles: [mkCandle(now - 1 * HOUR, 100.05, 99.95), mkCandle(now - 2 * HOUR, 100.05, 99.95)],
      windowEndMs: now,
    });
    const p = levelFreshnessToPayload(r) as {
      kind: string;
      classification: string;
      touchCount: number;
    };
    expect(p.kind).toBe("level_freshness.evaluated");
    expect(p.classification).toBe("recycled");
    expect(p.touchCount).toBe(2);
  });
});
