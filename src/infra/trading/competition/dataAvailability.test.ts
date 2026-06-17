import { describe, it, expect } from "bun:test";
import {
  filterToAvailableSymbols,
  formatExcludedNote,
} from "./dataAvailability.ts";

/** Build a throwaway bar array of length n — content is irrelevant; only length is checked. */
function bars(n: number): unknown[] {
  return Array.from({ length: n }, (_, i) => ({ close: 100 + i }));
}

describe("filterToAvailableSymbols", () => {
  const minBars = 96; // mirrors COMPETITION_LIVE_CONFIG.barsLookback — the live lookback window

  it("keeps a symbol with >= minBars bars", () => {
    const r = filterToAvailableSymbols(["EURUSD"], { EURUSD: bars(minBars) }, minBars);
    expect(r.available).toEqual(["EURUSD"]);
    expect(r.excluded).toHaveLength(0);
  });

  it("keeps a symbol with well more than minBars", () => {
    const r = filterToAvailableSymbols(["BTCUSD"], { BTCUSD: bars(500) }, minBars);
    expect(r.available).toEqual(["BTCUSD"]);
  });

  it("excludes a symbol with zero bars (missing feed) as no_bars", () => {
    // A symbol in the universe but with no entry in the bar map at all (failed/absent feed).
    const r = filterToAvailableSymbols(
      ["EURUSD", "BARUSD"],
      { EURUSD: bars(minBars) }, // BARUSD absent
      minBars,
    );
    expect(r.available).toEqual(["EURUSD"]);
    expect(r.excluded).toEqual([
      { symbol: "BARUSD", reason: "no_bars", barCount: 0, minBars },
    ]);
  });

  it("excludes a symbol present but with an empty array as no_bars", () => {
    const r = filterToAvailableSymbols(["BARUSD"], { BARUSD: [] }, minBars);
    expect(r.excluded).toEqual([
      { symbol: "BARUSD", reason: "no_bars", barCount: 0, minBars },
    ]);
  });

  it("excludes a symbol with too few bars as insufficient_bars", () => {
    const r = filterToAvailableSymbols(["XRPUSD"], { XRPUSD: bars(40) }, minBars);
    expect(r.available).toHaveLength(0);
    expect(r.excluded).toEqual([
      { symbol: "XRPUSD", reason: "insufficient_bars", barCount: 40, minBars },
    ]);
  });

  it("keeps a symbol exactly at the threshold (boundary is inclusive)", () => {
    const r = filterToAvailableSymbols(["SOLUSD"], { SOLUSD: bars(minBars) }, minBars);
    expect(r.available).toEqual(["SOLUSD"]);
  });

  it("preserves input order for the surviving symbols", () => {
    const universe = ["EURUSD", "BARUSD", "BTCUSD", "XRPUSD"];
    const r = filterToAvailableSymbols(
      universe,
      { EURUSD: bars(200), BTCUSD: bars(200), XRPUSD: bars(5) }, // BARUSD missing, XRP thin
      minBars,
    );
    expect(r.available).toEqual(["EURUSD", "BTCUSD"]);
    expect(r.excluded.map((e) => e.symbol)).toEqual(["BARUSD", "XRPUSD"]);
  });

  it("floors a fractional minBars and treats minBars < 1 as 1", () => {
    expect(filterToAvailableSymbols(["X"], { X: bars(1) }, 0).available).toEqual(["X"]);
    expect(filterToAvailableSymbols(["X"], {}, 0).excluded[0]!.minBars).toBe(1);
  });

  it("returns an empty split on empty input", () => {
    const r = filterToAvailableSymbols([], {}, minBars);
    expect(r.available).toEqual([]);
    expect(r.excluded).toEqual([]);
  });
});

describe("formatExcludedNote", () => {
  it("is empty when nothing was excluded", () => {
    expect(formatExcludedNote([])).toBe("");
  });

  it("formats a single no_bars exclusion", () => {
    const note = formatExcludedNote([
      { symbol: "BARUSD", reason: "no_bars", barCount: 0, minBars: 96 },
    ]);
    expect(note).toBe(
      "Excluded 1 instrument for insufficient data: BARUSD (no bars).",
    );
  });

  it("formats a mixed no_bars + insufficient_bars exclusion (plural)", () => {
    const note = formatExcludedNote([
      { symbol: "BARUSD", reason: "no_bars", barCount: 0, minBars: 96 },
      { symbol: "XRPUSD", reason: "insufficient_bars", barCount: 40, minBars: 96 },
    ]);
    expect(note).toBe(
      "Excluded 2 instruments for insufficient data: BARUSD (no bars), XRPUSD (40/96 bars).",
    );
  });
});
