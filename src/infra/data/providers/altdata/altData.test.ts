import { describe, expect, test } from "bun:test";
import {
  normalizeAltSeries,
  alignToReturns,
  parseHashrateChart,
  fetchHashrate,
  fetchGoogleTrends,
  type AltDataPoint,
  type AltDataSeries,
} from "./altData.ts";

const approx = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

describe("normalizeAltSeries", () => {
  test("sorts by time and drops non-finite points", () => {
    const pts: AltDataPoint[] = [
      { time: 3, value: 30 },
      { time: 1, value: 10 },
      { time: 2, value: Number.NaN },
      { time: Number.POSITIVE_INFINITY, value: 5 },
      { time: 2, value: 20 },
    ];
    const out = normalizeAltSeries(pts);
    expect(out.map((p) => p.time)).toEqual([1, 2, 3]);
    expect(out.map((p) => p.value)).toEqual([10, 20, 30]);
  });

  test("returns [] for empty / all-non-finite input", () => {
    expect(normalizeAltSeries([])).toEqual([]);
    expect(normalizeAltSeries([{ time: Number.NaN, value: Number.NaN }])).toEqual([]);
  });

  test("expanding z-score matches sample-stdev computation", () => {
    // values 1..5, expanding window. Final point: mean=3, sample sd=sqrt(2.5).
    const pts = [1, 2, 3, 4, 5].map((v, i) => ({ time: i, value: v }));
    const out = normalizeAltSeries(pts, { zscore: true });

    // i=0: single-element window ⇒ sd=0 ⇒ z=0
    expect(out[0]!.value).toBe(0);
    // i=1: window [1,2], mean=1.5, sd=sqrt(0.5); z=(2-1.5)/sqrt(0.5)
    expect(approx(out[1]!.value, 0.5 / Math.sqrt(0.5))).toBe(true);
    // i=4: full window, mean=3, sd=sqrt(2.5); z=(5-3)/sqrt(2.5)
    expect(approx(out[4]!.value, 2 / Math.sqrt(2.5))).toBe(true);
    // times preserved
    expect(out.map((p) => p.time)).toEqual([0, 1, 2, 3, 4]);
  });

  test("rolling z-score uses only the lookback window", () => {
    const pts = [10, 10, 10, 10, 100].map((v, i) => ({ time: i, value: v }));
    // lookback=2: last window is [10,100]; mean=55, sd=sqrt(((45^2)*2)/1)=63.6396
    const out = normalizeAltSeries(pts, { zscore: true, lookback: 2 });
    const expectedSd = Math.sqrt((45 * 45 + 45 * 45) / 1);
    expect(approx(out[4]!.value, (100 - 55) / expectedSd)).toBe(true);
    // a constant window ⇒ sd=0 ⇒ z=0
    expect(out[2]!.value).toBe(0);
  });

  test("winsorize clamps outliers before z-scoring", () => {
    const pts = [0, 0, 0, 0, 1000].map((v, i) => ({ time: i, value: v }));
    const noWins = normalizeAltSeries(pts, { winsorize: 0 } as never);
    // raw last value passes through without winsorize
    expect(noWins[4]!.value).toBe(1000);

    const wins = normalizeAltSeries(pts, { winsorize: 1 });
    // mean=200, sd over [0,0,0,0,1000] = sqrt((4*200^2 + 800^2)/4)=sqrt(200000)
    const mu = 200;
    const sd = Math.sqrt((4 * mu * mu + 800 * 800) / 4);
    const hi = mu + sd; // +1 stdev clamp
    expect(approx(wins[4]!.value, hi)).toBe(true);
    // the clamped value is strictly below the raw 1000
    expect(wins[4]!.value).toBeLessThan(1000);
  });
});

describe("alignToReturns", () => {
  const series: AltDataSeries = {
    source: "test",
    points: [
      { time: 10, value: 1 },
      { time: 20, value: 2 },
      { time: 30, value: 3 },
    ],
  };

  test("forward-fills last known value and zeroes before first obs", () => {
    const returns = [{ time: 5 }, { time: 10 }, { time: 15 }, { time: 25 }, { time: 40 }];
    expect(alignToReturns(series, returns)).toEqual([
      0, // before first alt obs
      1, // exactly at first obs (<=)
      1, // forward-filled
      2, // forward-filled from time 20
      3, // forward-filled from time 30
    ]);
  });

  test("handles unsorted returns correctly", () => {
    const returns = [{ time: 40 }, { time: 5 }, { time: 20 }];
    expect(alignToReturns(series, returns)).toEqual([3, 0, 2]);
  });

  test("empty series ⇒ all zeros", () => {
    expect(alignToReturns({ source: "x", points: [] }, [{ time: 1 }])).toEqual([0]);
  });
});

describe("parseHashrateChart", () => {
  test("turns blockchain.info-style fixture into AltDataPoint[]", () => {
    const fixture = JSON.stringify({
      values: [
        { x: 1700000000, y: 400.5 },
        { x: 1700086400, y: 410.2 },
        { x: 1700172800, y: "bad" }, // dropped (non-finite y)
        { x: "nope", y: 1 }, // dropped (non-finite x)
        { nope: true }, // dropped (missing)
      ],
    });
    const out = parseHashrateChart(JSON.parse(fixture));
    expect(out).toEqual([
      { time: 1700000000, value: 400.5 },
      { time: 1700086400, value: 410.2 },
    ]);
  });

  test("malformed payload ⇒ []", () => {
    expect(parseHashrateChart({})).toEqual([]);
    expect(parseHashrateChart(null)).toEqual([]);
    expect(parseHashrateChart({ values: "x" })).toEqual([]);
  });
});

describe("network adapters (guarded, NOT live)", () => {
  test("fetchHashrate parses an injected fixture response", async () => {
    const fetchImpl = async () => ({
      json: async () => ({ values: [{ x: 1, y: 100 }] }),
    });
    const series = await fetchHashrate({ fetchImpl });
    expect(series.symbol).toBe("BTC");
    expect(series.points).toEqual([{ time: 1, value: 100 }]);
  });

  test("fetchHashrate returns empty series (no throw) on fetch failure", async () => {
    const throwing = async () => {
      throw new Error("network down");
    };
    const series = await fetchHashrate({ fetchImpl: throwing });
    expect(series.points).toEqual([]);
    expect(series.source).toContain("hash-rate");
  });

  test("fetchGoogleTrends returns empty series when no url supplied", async () => {
    const series = await fetchGoogleTrends("bitcoin");
    expect(series.symbol).toBe("bitcoin");
    expect(series.points).toEqual([]);
  });

  test("fetchGoogleTrends parses injected timeline fixture", async () => {
    const fetchImpl = async () => ({
      json: async () => ({
        default: {
          timelineData: [
            { time: "1700000000", value: [50] },
            { time: "1700086400", value: [75] },
          ],
        },
      }),
    });
    const series = await fetchGoogleTrends("bitcoin", {
      url: "https://op-proxy/trends",
      fetchImpl,
    });
    expect(series.points).toEqual([
      { time: 1700000000, value: 50 },
      { time: 1700086400, value: 75 },
    ]);
  });

  test("fetchGoogleTrends returns empty series (no throw) on fetch failure", async () => {
    const throwing = async () => {
      throw new Error("boom");
    };
    const series = await fetchGoogleTrends("eth", { url: "https://x", fetchImpl: throwing });
    expect(series.points).toEqual([]);
  });
});
