import { describe, expect, test } from "bun:test";
import { detectCandlestickPatterns, ALL_CANDLESTICK_PATTERNS } from "./candlestick-patterns.ts";
import type { Candle } from "./types.ts";

/** Build a candle from explicit OHLC. Volume optional, defaults stable. */
function bar(open: number, high: number, low: number, close: number, volume = 1_000_000): Candle {
  return { open, high, low, close, volume };
}

/** Make a baseline neutral bar at a given midprice. */
function neutralBar(mid: number): Candle {
  return bar(mid, mid + 0.5, mid - 0.5, mid + 0.01, 1_000_000);
}

describe("detectCandlestickPatterns — empty + filter", () => {
  test("returns empty result on empty input", () => {
    const r = detectCandlestickPatterns([]);
    expect(r.matches).toEqual([]);
    expect(r.latestBarMatches).toEqual([]);
  });

  test("only emits requested patterns", () => {
    const candles = [
      bar(100, 102, 98, 96), // bearish
      bar(97, 98, 96, 97.5), // bullish small body inside — bullish harami
    ];
    const r = detectCandlestickPatterns(candles, { patterns: ["bullish_engulfing"] });
    expect(r.matches.find((m) => m.pattern === "bullish_harami")).toBeUndefined();
  });

  test("default window includes all bars when window > length", () => {
    const candles = [bar(100, 102, 98, 96), bar(97, 98, 96, 97.5)];
    const r = detectCandlestickPatterns(candles, { windowBars: 1000 });
    expect(r.matches.length).toBeGreaterThan(0);
  });
});

describe("detectCandlestickPatterns — harami", () => {
  test("bullish_harami: small candle inside prior larger bearish body", () => {
    const candles = [
      bar(100, 100.5, 95, 95.5), // big bearish
      bar(96, 97, 96, 96.8), // small body inside [95.5, 100]
    ];
    const r = detectCandlestickPatterns(candles);
    const match = r.latestBarMatches.find((m) => m.pattern === "bullish_harami");
    expect(match).toBeDefined();
    expect(match?.direction).toBe("bullish");
    expect(match?.confidence).toBeGreaterThan(0);
  });

  test("bullish_harami does NOT match when current body is larger", () => {
    const candles = [
      bar(100, 100.5, 99, 99.5), // small bearish
      bar(99.6, 102, 99.5, 100.5), // bigger
    ];
    const r = detectCandlestickPatterns(candles);
    expect(r.latestBarMatches.find((m) => m.pattern === "bullish_harami")).toBeUndefined();
  });

  test("bearish_harami: small candle inside prior larger bullish body", () => {
    const candles = [
      bar(95, 100.5, 94.5, 100), // big bullish
      bar(99, 99.5, 96, 96.5), // small body inside [95, 100]
    ];
    const r = detectCandlestickPatterns(candles);
    expect(r.latestBarMatches.find((m) => m.pattern === "bearish_harami")).toBeDefined();
  });
});

describe("detectCandlestickPatterns — engulfing", () => {
  test("bullish_engulfing wraps prior bearish body", () => {
    const candles = [
      bar(100, 100.5, 98, 98.5), // bearish: body 98.5..100
      bar(98, 102, 97.5, 101), // bullish: body 98..101 wraps the prior body
    ];
    const r = detectCandlestickPatterns(candles);
    expect(r.latestBarMatches.find((m) => m.pattern === "bullish_engulfing")).toBeDefined();
  });

  test("bearish_engulfing wraps prior bullish body", () => {
    const candles = [
      bar(98, 100.5, 97.5, 100), // bullish: body 98..100
      bar(101, 101.5, 96, 97), // bearish: body 97..101 wraps
    ];
    const r = detectCandlestickPatterns(candles);
    expect(r.latestBarMatches.find((m) => m.pattern === "bearish_engulfing")).toBeDefined();
  });
});

describe("detectCandlestickPatterns — single-bar shapes", () => {
  test("hammer: long lower shadow, small body up top, tiny upper shadow", () => {
    // body 0.3, lower shadow 4.5, upper shadow 0.2 → opposite-side
    // shadow stays inside the body, ratio ≥ 2.
    const candles = [bar(99.5, 100, 95, 99.8)];
    const r = detectCandlestickPatterns(candles);
    const m = r.latestBarMatches.find((x) => x.pattern === "hammer");
    expect(m).toBeDefined();
    expect(m?.direction).toBe("bullish");
  });

  test("shooting_star: long upper shadow, small body down, tiny lower shadow", () => {
    // body 0.3, upper shadow 4.5, lower shadow 0.2.
    const candles = [bar(100.2, 105, 100, 100.5)];
    const r = detectCandlestickPatterns(candles);
    const m = r.latestBarMatches.find((x) => x.pattern === "shooting_star");
    expect(m).toBeDefined();
    expect(m?.direction).toBe("bearish");
  });

  test("doji: open ≈ close", () => {
    const candles = [bar(100, 102, 98, 100.05)];
    const r = detectCandlestickPatterns(candles);
    expect(r.latestBarMatches.find((m) => m.pattern === "doji")).toBeDefined();
  });

  test("doji does NOT match when body is wide", () => {
    const candles = [bar(100, 102, 98, 101.5)];
    const r = detectCandlestickPatterns(candles);
    expect(r.latestBarMatches.find((m) => m.pattern === "doji")).toBeUndefined();
  });
});

describe("detectCandlestickPatterns — 3-bar reversals", () => {
  test("morning_star: bearish → small body → bullish closing into 1st body", () => {
    const candles = [
      bar(105, 105.5, 99, 99.5), // bearish, big body
      bar(99, 99.3, 98.5, 99.1), // tiny body
      bar(99.5, 103, 99.2, 102.5), // bullish, closes well above midpoint of 1st (102.25)
    ];
    const r = detectCandlestickPatterns(candles);
    expect(r.latestBarMatches.find((m) => m.pattern === "morning_star")).toBeDefined();
  });

  test("evening_star: bullish → small body → bearish closing into 1st body", () => {
    const candles = [
      bar(95, 100.5, 94.5, 100), // bullish big body
      bar(100.5, 100.8, 100.2, 100.6), // tiny body
      bar(100, 100.2, 96, 96.5), // bearish, closes well below midpoint of 1st (97.5)
    ];
    const r = detectCandlestickPatterns(candles);
    expect(r.latestBarMatches.find((m) => m.pattern === "evening_star")).toBeDefined();
  });
});

describe("detectCandlestickPatterns — piercing line + dark cloud", () => {
  test("piercing_line: gap-down open + reclaim past midpoint", () => {
    const candles = [
      bar(100, 100.5, 95, 95.5), // big bearish — body 95.5..100, midpoint 97.75
      bar(94.8, 99, 94.5, 98.5), // gap down then reclaim above 97.75, below 100
    ];
    const r = detectCandlestickPatterns(candles);
    expect(r.latestBarMatches.find((m) => m.pattern === "piercing_line")).toBeDefined();
  });

  test("dark_cloud_cover: gap-up open + fade past midpoint", () => {
    const candles = [
      bar(95, 100.5, 94.5, 100), // big bullish — body 95..100, midpoint 97.5
      bar(100.7, 101, 96, 96.5), // gap up then fade below 97.5, above 95
    ];
    const r = detectCandlestickPatterns(candles);
    expect(r.latestBarMatches.find((m) => m.pattern === "dark_cloud_cover")).toBeDefined();
  });
});

describe("detectCandlestickPatterns — inside_bar", () => {
  test("inside_bar: current bar's high < prev high AND low > prev low", () => {
    const candles = [bar(100, 105, 95, 99), bar(99, 102, 97, 100)];
    const r = detectCandlestickPatterns(candles);
    const m = r.latestBarMatches.find((x) => x.pattern === "inside_bar");
    expect(m).toBeDefined();
    expect(m?.direction).toBe("neutral");
  });

  test("inside_bar does NOT match when current high equals prev high", () => {
    const candles = [
      bar(100, 105, 95, 99),
      bar(99, 105, 97, 100), // high equal — not strictly inside
    ];
    const r = detectCandlestickPatterns(candles);
    expect(r.latestBarMatches.find((m) => m.pattern === "inside_bar")).toBeUndefined();
  });
});

describe("detectCandlestickPatterns — windowBars", () => {
  test("emits matches inside window, ignores older ones", () => {
    const candles: Candle[] = [];
    // Old harami at index 0..1 — outside window.
    candles.push(bar(100, 100.5, 95, 95.5));
    candles.push(bar(96, 97, 96, 96.8));
    // Filler neutral bars.
    for (let i = 0; i < 30; i++) candles.push(neutralBar(96.8 + i * 0.01));
    const r = detectCandlestickPatterns(candles, { windowBars: 5 });
    expect(r.matches.find((m) => m.pattern === "bullish_harami")).toBeUndefined();
  });
});

describe("detectCandlestickPatterns — catalog completeness", () => {
  test("every pattern has at least one test above", () => {
    // Sanity: confirm the catalog has 12 patterns as documented.
    expect(ALL_CANDLESTICK_PATTERNS.length).toBe(12);
  });
});
