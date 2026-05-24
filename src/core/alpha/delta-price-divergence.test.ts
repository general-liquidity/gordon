import { describe, expect, test } from "bun:test";
import {
  detectDeltaPriceDivergence,
  formatDeltaPriceDivergence,
  type DeltaPriceBar,
} from "./delta-price-divergence.ts";

function bar(close: number, delta: number): DeltaPriceBar {
  return { close, delta };
}

describe("detectDeltaPriceDivergence", () => {
  test("too few bars → insufficient_data", () => {
    const bars: DeltaPriceBar[] = [bar(100, 100), bar(101, 50)];
    const r = detectDeltaPriceDivergence(bars);
    expect(r.verdict).toBe("insufficient_data");
  });

  test("aligned up: price up + delta up → aligned verdict", () => {
    // Price 100 → 105 (+5%), each bar has positive delta
    const bars: DeltaPriceBar[] = [
      bar(100, 0),
      bar(101.5, 800),
      bar(102.5, 700),
      bar(104, 900),
      bar(105, 600),
    ];
    const r = detectDeltaPriceDivergence(bars);
    expect(r.priceDirection).toBe("up");
    expect(r.deltaDirection).toBe("up");
    expect(r.divergenceType).toBe("aligned_up");
    expect(r.verdict).toBe("aligned");
  });

  test("aligned down: price down + delta down → aligned verdict", () => {
    const bars: DeltaPriceBar[] = [
      bar(100, 0),
      bar(98.5, -700),
      bar(97, -800),
      bar(95.5, -650),
      bar(94, -900),
    ];
    const r = detectDeltaPriceDivergence(bars);
    expect(r.priceDirection).toBe("down");
    expect(r.deltaDirection).toBe("down");
    expect(r.divergenceType).toBe("aligned_down");
    expect(r.verdict).toBe("aligned");
  });

  test("bearish divergence: price up + delta negative → bearish_divergence_signal", () => {
    // Price grinding higher but aggressive selling absorbing
    const bars: DeltaPriceBar[] = [
      bar(100, 0),
      bar(101, -200),
      bar(101.5, -400),
      bar(102, -500),
      bar(103, -300),
    ];
    const r = detectDeltaPriceDivergence(bars);
    expect(r.priceDirection).toBe("up");
    expect(r.deltaDirection).toBe("down");
    expect(r.divergenceType).toBe("bearish_divergence");
    expect(r.verdict).toBe("bearish_divergence_signal");
    expect(r.summary).toContain("BEARISH DIVERGENCE");
  });

  test("bullish divergence: price down + delta positive → bullish_divergence_signal", () => {
    // Price dripping lower but buyers absorbing
    const bars: DeltaPriceBar[] = [
      bar(100, 0),
      bar(99, 300),
      bar(98.5, 400),
      bar(98, 600),
      bar(97, 500),
    ];
    const r = detectDeltaPriceDivergence(bars);
    expect(r.priceDirection).toBe("down");
    expect(r.deltaDirection).toBe("up");
    expect(r.divergenceType).toBe("bullish_divergence");
    expect(r.verdict).toBe("bullish_divergence_signal");
    expect(r.summary).toContain("BULLISH DIVERGENCE");
  });

  test("flat price → insufficient_signal", () => {
    const bars: DeltaPriceBar[] = [
      bar(100, 0),
      bar(100.05, 500),
      bar(100.1, 400),
      bar(100.05, 300),
      bar(100.08, 200),
    ];
    const r = detectDeltaPriceDivergence(bars);
    expect(r.priceDirection).toBe("flat");
    expect(r.verdict).toBe("insufficient_signal");
  });

  test("minAbsoluteDelta filters small delta moves", () => {
    const bars: DeltaPriceBar[] = [
      bar(100, 0),
      bar(101, 50),
      bar(102, 60),
      bar(103, 40),
      bar(104, 30),
    ];
    const r = detectDeltaPriceDivergence(bars, { minAbsoluteDelta: 1000 });
    expect(r.deltaDirection).toBe("flat");
    expect(r.verdict).toBe("insufficient_signal");
  });

  test("priceChangePct = (end - start) / start over lookback window", () => {
    const bars: DeltaPriceBar[] = [
      bar(100, 0),
      bar(101, 200),
      bar(102, 200),
      bar(103, 200),
      bar(104, 200),
    ];
    const r = detectDeltaPriceDivergence(bars);
    expect(r.startClose).toBe(100);
    expect(r.endClose).toBe(104);
    expect(r.priceChangePct).toBeCloseTo(0.04, 6);
  });

  test("cumulativeDelta sums only post-start bars in lookback", () => {
    const bars: DeltaPriceBar[] = [
      bar(100, 999), // start; this delta NOT counted
      bar(101, 200),
      bar(102, 300),
      bar(103, 400),
      bar(104, 100),
    ];
    const r = detectDeltaPriceDivergence(bars);
    // Cumulative = 200 + 300 + 400 + 100 = 1000
    expect(r.cumulativeDelta).toBe(1000);
  });

  test("custom lookback shrinks the window", () => {
    const bars: DeltaPriceBar[] = [];
    for (let i = 0; i < 20; i++) bars.push(bar(100 + i, 100));
    const wide = detectDeltaPriceDivergence(bars, { lookbackBars: 15 });
    const narrow = detectDeltaPriceDivergence(bars, { lookbackBars: 3 });
    expect(wide.lookbackUsed).toBe(15);
    expect(narrow.lookbackUsed).toBe(3);
    // Narrow window has smaller cumulative delta
    expect(narrow.cumulativeDelta).toBeLessThan(wide.cumulativeDelta);
  });

  test("divergenceMagnitude is 0 for aligned verdicts", () => {
    const bars: DeltaPriceBar[] = [
      bar(100, 0),
      bar(102, 500),
      bar(104, 500),
      bar(106, 500),
      bar(108, 500),
    ];
    const r = detectDeltaPriceDivergence(bars);
    expect(r.verdict).toBe("aligned");
    expect(r.divergenceMagnitude).toBe(0);
  });

  test("divergenceMagnitude is in [0, 1] for divergence verdicts", () => {
    const bars: DeltaPriceBar[] = [
      bar(100, 0),
      bar(101, -500),
      bar(102, -800),
      bar(103, -1000),
      bar(104, -700),
    ];
    const r = detectDeltaPriceDivergence(bars, { minAbsoluteDelta: 500 });
    expect(r.verdict).toBe("bearish_divergence_signal");
    expect(r.divergenceMagnitude).toBeGreaterThanOrEqual(0);
    expect(r.divergenceMagnitude).toBeLessThanOrEqual(1);
  });

  test("NaN delta values are ignored in cumulative", () => {
    const bars: DeltaPriceBar[] = [
      bar(100, 0),
      bar(101, 200),
      bar(102, NaN),
      bar(103, 300),
      bar(104, 200),
    ];
    const r = detectDeltaPriceDivergence(bars);
    // Cumulative = 200 + 300 + 200 = 700 (NaN skipped)
    expect(r.cumulativeDelta).toBe(700);
  });

  test("Mati's framing: price up + delta turning negative = bearish_divergence", () => {
    // Exact pattern from the video: price slowly grinds higher while
    // aggressive sellers absorb
    const bars: DeltaPriceBar[] = [
      bar(15500, 0),
      bar(15510, -100),
      bar(15520, -300),
      bar(15535, -500),
      bar(15545, -200),
    ];
    const r = detectDeltaPriceDivergence(bars, {
      minAbsoluteDelta: 500,
      minPriceMovePct: 0.001,
    });
    expect(r.verdict).toBe("bearish_divergence_signal");
  });

  test("start close non-positive → insufficient_data", () => {
    const bars: DeltaPriceBar[] = [
      bar(0, 0),
      bar(1, 100),
      bar(2, 200),
      bar(3, 300),
      bar(4, 400),
    ];
    const r = detectDeltaPriceDivergence(bars);
    expect(r.verdict).toBe("insufficient_data");
  });
});

describe("formatDeltaPriceDivergence", () => {
  test("renders verdict + diagnostic rows", () => {
    const bars: DeltaPriceBar[] = [
      bar(100, 0),
      bar(101, -300),
      bar(101.5, -500),
      bar(102, -600),
      bar(103, -200),
    ];
    const r = detectDeltaPriceDivergence(bars);
    const text = formatDeltaPriceDivergence(r);
    expect(text).toContain("Delta-Price Divergence");
    expect(text).toContain("Price change");
    expect(text).toContain("Cumulative delta");
  });
});
