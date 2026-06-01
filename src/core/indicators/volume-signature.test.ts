import { describe, expect, test } from "bun:test";
import { calculateVolumeSignature } from "./volume-signature.ts";
import type { Candle } from "./types.ts";

/** Build a bar with explicit OHLCV. */
function bar(o: number, h: number, l: number, c: number, v: number): Candle {
  return { open: o, high: h, low: l, close: c, volume: v };
}

/** A flat up/down series with controllable closes and volumes, used to seed
 *  the avg-volume window before the bar under test. closePos ~ mid. */
function flatBar(close: number, volume: number): Candle {
  // Range 99..101 around close-ish; close placed mid by default.
  return bar(close, close + 1, close - 1, close, volume);
}

describe("volume-signature — warmup nulls", () => {
  test("avgVolume is null before avgPeriod bars, then defined", () => {
    const candles: Candle[] = Array.from({ length: 12 }, (_, i) => flatBar(100, 1000));
    const r = calculateVolumeSignature(candles, { avgPeriod: 10 });
    // indices 0..8 null, index 9 (10th bar) onward defined
    for (let i = 0; i < 9; i++) expect(r.avgVolume[i]).toBeNull();
    expect(r.avgVolume[9]).toBe(1000);
    expect(r.avgVolume[11]).toBe(1000);
  });

  test("no tags fire during warmup (avg unavailable)", () => {
    const candles: Candle[] = Array.from({ length: 5 }, () => flatBar(100, 1000));
    const r = calculateVolumeSignature(candles, { avgPeriod: 10, atrPeriod: 14 });
    for (let i = 0; i < 5; i++) {
      expect(r.dryUp1[i]).toBe(false);
      expect(r.accumulation[i]).toBe(false);
      expect(r.distribution[i]).toBe(false);
      expect(r.churn[i]).toBe(false);
    }
    expect(r.interpretation).toContain("Insufficient data");
  });

  test("empty input", () => {
    const r = calculateVolumeSignature([]);
    expect(r.pp10).toEqual([]);
    expect(r.latest.index).toBeNull();
    expect(r.distributionCount).toBe(0);
    expect(r.distributionVerdict).toBe("healthy");
  });
});

describe("volume-signature — pocket pivot", () => {
  test("up day with volume > max prior down-volume fires pp10 and pp5", () => {
    // avgPeriod=5 so the baseline is available by index 5+.
    // Bars 0..5: baseline. We control an explicit down day and the pivot.
    // Closes: 100,101,102,101(down,vol 800),103,104, then pivot 105 vol 900.
    const candles: Candle[] = [
      flatBar(100, 1000), // 0
      flatBar(101, 1000), // 1 up
      flatBar(102, 1000), // 2 up
      flatBar(101, 800), // 3 DOWN, down-vol 800
      flatBar(103, 1000), // 4 up
      flatBar(104, 1000), // 5 up
      // index 6: up day, vol 900 > max prior down-vol (800) within last 5 bars
      flatBar(105, 900), // 6 PIVOT
    ];
    const r = calculateVolumeSignature(candles, { avgPeriod: 5, ppLong: 10, ppShort: 5 });
    // Prior 5 bars before idx 6 = bars 1..5; only down day is bar 3 (vol 800).
    // 900 > 800 → fires.
    expect(r.pp10[6]).toBe(true);
    expect(r.pp5[6]).toBe(true);
  });

  test("up day with volume below max prior down-volume does NOT fire", () => {
    const candles: Candle[] = [
      flatBar(100, 1000), // 0
      flatBar(101, 1000), // 1 up
      flatBar(100, 5000), // 2 DOWN, big down-vol 5000
      flatBar(101, 1000), // 3 up
      flatBar(102, 1000), // 4 up
      flatBar(103, 2000), // 5 up, vol 2000 < 5000 down-vol
    ];
    const r = calculateVolumeSignature(candles, { avgPeriod: 5, ppLong: 10, ppShort: 5 });
    expect(r.pp10[5]).toBe(false);
    expect(r.pp5[5]).toBe(false);
  });
});

describe("volume-signature — volume dry-up", () => {
  // avg = 1000. dryUp1 threshold = avg*0.55 = 550. dryUp2 = avg*0.40 = 400.
  function dryUpSeries(lastVol: number): Candle[] {
    const out: Candle[] = [];
    for (let i = 0; i < 10; i++) out.push(flatBar(100, 1000));
    out.push(flatBar(100, lastVol));
    return out;
  }

  test("-50% bar (vol 500) fires dryUp1 not dryUp2", () => {
    const r = calculateVolumeSignature(dryUpSeries(500), { avgPeriod: 10 });
    const i = 10;
    // avg over last 10 (bars 1..10) = (9*1000 + 500)/10 = 950. 0.55*950=522.5
    // 500 < 522.5 → dryUp1 true. 0.40*950=380; 500 > 380 → dryUp2 false.
    expect(r.avgVolume[i]).toBe(950);
    expect(r.dryUp1[i]).toBe(true);
    expect(r.dryUp2[i]).toBe(false);
  });

  test("-65% bar (vol 350) fires both dryUp1 and dryUp2", () => {
    const r = calculateVolumeSignature(dryUpSeries(350), { avgPeriod: 10 });
    const i = 10;
    // avg = (9*1000 + 350)/10 = 935. 0.55*935=514.25 → 350<514.25 dryUp1 true.
    // 0.40*935=374 → 350<374 dryUp2 true.
    expect(r.avgVolume[i]).toBe(935);
    expect(r.dryUp1[i]).toBe(true);
    expect(r.dryUp2[i]).toBe(true);
  });
});

describe("volume-signature — accumulation", () => {
  test("up day closing at the high on big volume = accumulation", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 10; i++) candles.push(flatBar(100, 1000));
    // Up day: prior close 100, close 102 (up). Range 100..102, close at high
    // → closePosition = 1.0 >= 0.62. Volume 2000 >= 1.25*avg.
    candles.push(bar(100, 102, 100, 102, 2000));
    const r = calculateVolumeSignature(candles, { avgPeriod: 10 });
    const i = 10;
    // avg = (9*1000+2000)/10 = 1100. 1.25*1100 = 1375; 2000>=1375 ✓
    expect(r.avgVolume[i]).toBe(1100);
    expect(r.accumulation[i]).toBe(true);
    expect(r.distribution[i]).toBe(false);
  });
});

describe("volume-signature — distribution + count", () => {
  test("down day closing at the low on big volume = distribution and increments count", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 10; i++) candles.push(flatBar(100, 1000));
    // Down day: prior close 100, close 98 (down). Range 98..101, close at low
    // → closePosition = 0 <= 0.38. Volume 1500 >= 1.0*avg.
    candles.push(bar(101, 101, 98, 98, 1500));
    const r = calculateVolumeSignature(candles, { avgPeriod: 10, distCountWindow: 25 });
    const i = 10;
    // avg = (9*1000+1500)/10 = 1050. 1.0*1050=1050; 1500>=1050 ✓
    expect(r.avgVolume[i]).toBe(1050);
    expect(r.distribution[i]).toBe(true);
    expect(r.distributionCount).toBe(1);
    expect(r.distributionVerdict).toBe("healthy");
  });

  test("verdict escalates: 4 amber, 6 red", () => {
    // Build a series with 6 distribution days inside a 25-bar window.
    const candles: Candle[] = [];
    for (let i = 0; i < 10; i++) candles.push(flatBar(100, 1000));
    // Alternate up bar then a distribution down bar, 6 times.
    let prevClose = 100;
    for (let k = 0; k < 6; k++) {
      // up bar to reset prior close high
      candles.push(bar(prevClose, prevClose + 2, prevClose, prevClose + 2, 1000));
      prevClose = prevClose + 2;
      // distribution down bar: close at low, heavy vol
      candles.push(bar(prevClose, prevClose, prevClose - 2, prevClose - 2, 1600));
      prevClose = prevClose - 2;
    }
    const r = calculateVolumeSignature(candles, { avgPeriod: 10, distCountWindow: 25 });
    expect(r.distributionCount).toBe(6);
    expect(r.distributionVerdict).toBe("red");
  });
});

describe("volume-signature — churn / stalling", () => {
  test("heavy-volume up bar with tiny net move = churn", () => {
    const candles: Candle[] = [];
    // Build with a real ATR. Use wide ranges so ATR is large (~4),
    // then a heavy-volume up day with a tiny net close change.
    for (let i = 0; i < 20; i++) {
      // alternating closes 100/100 with wide 4-point ranges so ATR ~4
      candles.push(bar(100, 102, 98, 100, 1000));
    }
    // Up day: prior close 100, close 100.5 → up. Net move 0.5.
    // ATR ~ 4 → progress 0.5/4 = 0.125 < 0.25 ✓. Volume 1500 >= 1.25*avg.
    candles.push(bar(100, 102, 98, 100.5, 1500));
    const r = calculateVolumeSignature(candles, {
      avgPeriod: 10,
      atrPeriod: 14,
      churnVolMult: 1.25,
      maxProgressVsAtr: 0.25,
    });
    const i = candles.length - 1;
    expect(r.atr[i]).not.toBeNull();
    expect(r.churn[i]).toBe(true);
  });

  test("heavy-volume up bar with large net move is NOT churn", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 20; i++) candles.push(bar(100, 102, 98, 100, 1000));
    // Big net move: close 105 vs prior 100 → progress 5/~4 > 0.25.
    candles.push(bar(100, 106, 100, 105, 1500));
    const r = calculateVolumeSignature(candles, { avgPeriod: 10, atrPeriod: 14 });
    const i = candles.length - 1;
    expect(r.churn[i]).toBe(false);
  });
});

describe("volume-signature — latest summary", () => {
  test("latest reflects the final bar's tags and volume multiple", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 10; i++) candles.push(flatBar(100, 1000));
    candles.push(bar(100, 102, 100, 102, 2000)); // accumulation up bar
    const r = calculateVolumeSignature(candles, { avgPeriod: 10 });
    expect(r.latest.index).toBe(10);
    expect(r.latest.accumulation).toBe(true);
    // avg = 1100, vol 2000 → 1.82×
    expect(r.latest.volumeMultiple).toBeCloseTo(1.82, 2);
    expect(r.latest.closePosition).toBe(1);
    expect(r.interpretation).toContain("accumulation");
  });
});
