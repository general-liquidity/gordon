import { describe, expect, test } from "bun:test";
import { calculateRsiTrendline } from "./rsi-trendline.ts";

/**
 * Build a closes series that drives RSI into a descending sequence of pivot
 * highs (lower highs = a descending resistance trendline on RSI), then a sharp
 * rally that pushes the latest RSI above that projected line = bullish break.
 *
 * We don't hand-compute RSI; we exploit RSI's monotonic relationship to recent
 * gains/losses. Alternating up/down segments of decreasing up-strength produce
 * RSI pivot highs that step down; a final strong up-run breaks above.
 */
function buildBullishBreakCloses(): number[] {
  const closes: number[] = [];
  let price = 100;
  // Warmup so RSI is well-defined.
  for (let i = 0; i < 20; i++) {
    price += i % 2 === 0 ? 0.5 : -0.4;
    closes.push(price);
  }
  // Three rally/pullback cycles with WEAKENING rallies -> stepping-down RSI peaks.
  const rallyStrengths = [6, 4, 2];
  for (const up of rallyStrengths) {
    for (let i = 0; i < 4; i++) {
      price += up;
      closes.push(price);
    }
    for (let i = 0; i < 4; i++) {
      price -= 3;
      closes.push(price);
    }
  }
  // Final strong rally to break above the descending RSI resistance.
  for (let i = 0; i < 6; i++) {
    price += 9;
    closes.push(price);
  }
  return closes;
}

/**
 * Mirror: weakening sell-offs produce RSI pivot lows that step UP (higher lows =
 * ascending support trendline), then a sharp dump pushes RSI below it = bearish.
 */
function buildBearishBreakCloses(): number[] {
  const closes: number[] = [];
  let price = 100;
  for (let i = 0; i < 20; i++) {
    price += i % 2 === 0 ? 0.4 : -0.5;
    closes.push(price);
  }
  const dumpStrengths = [6, 4, 2];
  for (const down of dumpStrengths) {
    for (let i = 0; i < 4; i++) {
      price -= down;
      closes.push(price);
    }
    for (let i = 0; i < 4; i++) {
      price += 3;
      closes.push(price);
    }
  }
  for (let i = 0; i < 6; i++) {
    price -= 9;
    closes.push(price);
  }
  return closes;
}

describe("calculateRsiTrendline", () => {
  test("insufficient data returns null lines and none breakout", () => {
    const res = calculateRsiTrendline([1, 2, 3, 4, 5]);
    expect(res.breakout).toBe("none");
    expect(res.resistanceLine).toBeNull();
    expect(res.supportLine).toBeNull();
    expect(res.currentRsi).toBeNull();
    expect(res.rsiPeriod).toBe(14);
    expect(res.interpretation).toBe("Insufficient data for RSI trendline");
  });

  test("empty input is insufficient", () => {
    const res = calculateRsiTrendline([]);
    expect(res.currentRsi).toBeNull();
    expect(res.breakout).toBe("none");
  });

  test("bullish RSI-trendline break above descending resistance", () => {
    const res = calculateRsiTrendline(buildBullishBreakCloses());
    expect(res.currentRsi).not.toBeNull();
    expect(res.resistanceLine).not.toBeNull();
    // Descending resistance => negative slope, earlier-higher / later-lower pivots.
    expect(res.resistanceLine!.slope).toBeLessThan(0);
    expect(res.breakout).toBe("above_resistance");
    expect(res.currentRsi!).toBeGreaterThan(res.resistanceLine!.valueAtLastBar);
    expect(res.interpretation.toLowerCase()).toContain("bullish");
  });

  test("bearish RSI-trendline break below ascending support", () => {
    const res = calculateRsiTrendline(buildBearishBreakCloses());
    expect(res.currentRsi).not.toBeNull();
    expect(res.supportLine).not.toBeNull();
    // Ascending support => positive slope.
    expect(res.supportLine!.slope).toBeGreaterThan(0);
    expect(res.breakout).toBe("below_support");
    expect(res.currentRsi!).toBeLessThan(res.supportLine!.valueAtLastBar);
    expect(res.interpretation.toLowerCase()).toContain("bearish");
  });

  test("anchor bars are ordered and within range", () => {
    const closes = buildBullishBreakCloses();
    const res = calculateRsiTrendline(closes);
    const line = res.resistanceLine!;
    expect(line.anchorBars[0]).toBeLessThan(line.anchorBars[1]);
    expect(line.anchorBars[0]).toBeGreaterThanOrEqual(0);
    expect(line.anchorBars[1]).toBeLessThan(closes.length);
  });

  test("respects custom rsiPeriod in result", () => {
    const res = calculateRsiTrendline(buildBullishBreakCloses(), { rsiPeriod: 7 });
    expect(res.rsiPeriod).toBe(7);
  });

  test("flat series produces no break", () => {
    const flat = new Array(60).fill(100);
    const res = calculateRsiTrendline(flat);
    expect(res.breakout).toBe("none");
  });
});
