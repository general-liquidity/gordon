import { describe, expect, test } from "bun:test";
import {
  type AlphaInputs,
  computeFormulaicAlpha,
  alpha101,
  alpha012,
  alpha006,
  alpha004,
  alpha054,
  IMPLEMENTED_ALPHAS,
} from "./formulaic-alphas.ts";
import { type Panel, makePanel } from "./formulaic-alpha-operators.ts";

// Build a panel where each ticker is a column and each date a row.
// cols: array of per-ticker series (oldest->newest), all equal length.
function panel(tickers: string[], cols: (number | null)[][]): Panel {
  const T = cols[0]!.length;
  const dates = Array.from({ length: T }, (_, i) => `d${i}`);
  const values: (number | null)[][] = [];
  for (let d = 0; d < T; d++) {
    values.push(tickers.map((_, c) => cols[c]![d]!));
  }
  return makePanel(dates, tickers, values);
}

const lastRow = (p: Panel): (number | null)[] => p.values[p.values.length - 1]!;

describe("alpha101 — (close-open)/((high-low)+.001)", () => {
  test("single ticker hand value: (12-10)/((15-8)+.001) = 2/7.001", () => {
    const tk = ["A"];
    const inp: AlphaInputs = {
      open: panel(tk, [[10]]),
      high: panel(tk, [[15]]),
      low: panel(tk, [[8]]),
      close: panel(tk, [[12]]),
    };
    const out = alpha101(inp).values[0]![0]!;
    expect(out).toBeCloseTo(2 / 7.001, 8);
  });
});

describe("alpha012 — sign(delta(volume,1)) * (-1*delta(close,1))", () => {
  test("close [10,12], volume [100,150] -> sign(50)*(-2) = -2", () => {
    const tk = ["A"];
    const inp: AlphaInputs = {
      close: panel(tk, [[10, 12]]),
      volume: panel(tk, [[100, 150]]),
    };
    const out = alpha012(inp);
    expect(out.values[0]![0]).toBeNull(); // no delta on first date
    expect(out.values[1]![0]).toBe(-2);
  });
  test("falling volume flips the sign: close [10,12], volume [100,80] -> +2", () => {
    const tk = ["A"];
    const inp: AlphaInputs = {
      close: panel(tk, [[10, 12]]),
      volume: panel(tk, [[100, 80]]),
    };
    expect(alpha012(inp).values[1]![0]).toBe(2);
  });
});

describe("alpha006 — -1 * correlation(open, volume, 10)", () => {
  test("open and volume perfectly correlated over the window -> -1", () => {
    const tk = ["A"];
    const series = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const inp: AlphaInputs = {
      close: panel(tk, [series]),
      open: panel(tk, [series]),
      volume: panel(tk, [series.map((x) => x * 100)]), // affine -> corr 1
    };
    const out = lastRow(alpha006(inp))[0]!;
    expect(out).toBeCloseTo(-1, 6);
  });
});

describe("alpha004 — -1 * Ts_Rank(rank(low), 9)", () => {
  test("single ticker: rank(low)=0.5 const -> ts_rank of constant = 0 -> alpha 0", () => {
    // With one ticker the cross-sectional rank is 0.5 every day (single name).
    // ts_rank of a constant 0.5 series: current equals all -> strictly-smaller
    // count 0/(d-1) = 0, so alpha = -0.
    const tk = ["A"];
    const low = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const inp: AlphaInputs = {
      close: panel(tk, [low]),
      low: panel(tk, [low]),
    };
    expect(lastRow(alpha004(inp))[0]).toBeCloseTo(-0, 6);
  });

  test("two tickers: the higher-low name ranks 1 cross-sectionally", () => {
    // A always has the larger low. Cross-sectional rank(low): A->1, B->0 each day.
    // ts_rank over a constant 1-series (A) = 1 ; over constant 0 (B) = 1 as well
    // (current equals all -> strictly-smaller count 0/(d-1)=0). Check signs/range.
    const tk = ["A", "B"];
    const T = 10;
    const aLow = Array.from({ length: T }, (_, i) => 100 + i);
    const bLow = Array.from({ length: T }, (_, i) => 1 + i);
    const inp: AlphaInputs = {
      close: panel(tk, [aLow, bLow]),
      low: panel(tk, [aLow, bLow]),
    };
    const out = lastRow(alpha004(inp));
    // rank(low) is 1 for A and 0 for B every day (constant series). ts_rank of a
    // constant series = 0 (no strictly-smaller). So alpha = -0 = 0 for both.
    expect(out[0]).toBeCloseTo(-0, 6);
    expect(out[1]).toBeCloseTo(-0, 6);
  });
});

describe("alpha054 — (-1*((low-close)*open^5)) / ((low-high)*close^5)", () => {
  test("hand value: low=8 close=12 open=10 high=15", () => {
    // num = -1 * ((8-12) * 10^5) = -1 * (-4 * 100000) = 400000
    // den = (8-15) * 12^5 = -7 * 248832 = -1741824
    // alpha = 400000 / -1741824 = -0.229644...
    const tk = ["A"];
    const inp: AlphaInputs = {
      open: panel(tk, [[10]]),
      high: panel(tk, [[15]]),
      low: panel(tk, [[8]]),
      close: panel(tk, [[12]]),
    };
    const expected = 400000 / -1741824;
    expect(alpha054(inp).values[0]![0]).toBeCloseTo(expected, 8);
  });
});

describe("registry / dispatcher", () => {
  test("computeFormulaicAlpha dispatches by name", () => {
    const tk = ["A"];
    const inp: AlphaInputs = {
      open: panel(tk, [[10]]),
      high: panel(tk, [[15]]),
      low: panel(tk, [[8]]),
      close: panel(tk, [[12]]),
    };
    const out = computeFormulaicAlpha("alpha101", inp)!;
    expect(out.values[0]![0]).toBeCloseTo(2 / 7.001, 8);
  });
  test("unknown name -> null (no throw)", () => {
    const tk = ["A"];
    expect(computeFormulaicAlpha("alpha999", { close: panel(tk, [[1]]) })).toBeNull();
  });
  test("IMPLEMENTED_ALPHAS lists 11 alphas", () => {
    expect(IMPLEMENTED_ALPHAS.length).toBe(11);
  });
  test("missing required panel throws at boundary", () => {
    const tk = ["A"];
    // alpha006 needs open + volume
    expect(() => computeFormulaicAlpha("alpha006", { close: panel(tk, [[1, 2]]) })).toThrow();
  });
});
