import { describe, expect, test } from "bun:test";
import { simulateSleeve, type SleeveScenario } from "./sleeveWhatIf.ts";

const baseInput = {
  startingEquity: 10_000,
  currentEquity: 10_000,
  sleeveMargin: 500,
  sleeveLeverage: 30,
  perBarVol: 0.01,
  barsHeld: 4,
  returnField: { mean: 0, std: 0.4 },
};

const find = (
  scenarios: SleeveScenario[],
  label: SleeveScenario["label"],
): SleeveScenario => scenarios.find((s) => s.label === label)!;

describe("simulateSleeve", () => {
  test("a winning scenario lifts the rank vs a losing one", () => {
    const { scenarios } = simulateSleeve(baseInput);
    const win = find(scenarios, "win1sd");
    const lose = find(scenarios, "lose1sd");

    expect(win.resultingReturn).toBeGreaterThan(lose.resultingReturn);
    expect(win.resultingPercentile).toBeGreaterThan(lose.resultingPercentile);
    // Higher percentile ⇒ better (numerically smaller) rank number.
    expect(win.resultingRank).toBeLessThan(lose.resultingRank);
  });

  test("P10 and P90 PnL magnitudes are symmetric about hold", () => {
    const { scenarios } = simulateSleeve(baseInput);
    const p10 = find(scenarios, "P10");
    const p50 = find(scenarios, "P50");
    const p90 = find(scenarios, "P90");

    expect(p50.sleevePnLUsd).toBeCloseTo(0, 9);
    expect(p10.sleevePnLUsd).toBeCloseTo(-p90.sleevePnLUsd, 6);
    expect(p90.sleevePnLUsd).toBeGreaterThan(0);
  });

  test("pWinVsHold is a coin flip", () => {
    expect(simulateSleeve(baseInput).pWinVsHold).toBe(0.5);
  });

  test("degenerate inputs → no-op (all scenarios = hold)", () => {
    for (const bad of [
      { ...baseInput, perBarVol: 0 },
      { ...baseInput, perBarVol: -0.01 },
      { ...baseInput, barsHeld: 0 },
      { ...baseInput, barsHeld: -4 },
    ]) {
      const { scenarios } = simulateSleeve(bad);
      const holdReturn = (bad.currentEquity - bad.startingEquity) / bad.startingEquity;
      for (const s of scenarios) {
        expect(s.sleevePnLUsd).toBe(0);
        expect(s.resultingReturn).toBeCloseTo(holdReturn, 12);
      }
      // All ranks identical — the sleeve did nothing.
      const ranks = new Set(scenarios.map((s) => s.resultingRank));
      expect(ranks.size).toBe(1);
    }
  });

  test("resultingRank is monotonic (non-increasing) in resultingReturn", () => {
    const { scenarios } = simulateSleeve(baseInput);
    const sorted = [...scenarios].sort((a, b) => a.resultingReturn - b.resultingReturn);
    for (let i = 1; i < sorted.length; i++) {
      const lower = sorted[i - 1]!;
      const higher = sorted[i]!;
      // Lower return must never rank better than a higher return.
      expect(higher.resultingRank).toBeLessThanOrEqual(lower.resultingRank);
    }
  });

  test("percentile and rank stay in valid bounds", () => {
    const { scenarios } = simulateSleeve(baseInput);
    const fieldN = 500;
    for (const s of scenarios) {
      expect(s.resultingPercentile).toBeGreaterThanOrEqual(0);
      expect(s.resultingPercentile).toBeLessThanOrEqual(1);
      expect(s.resultingRank).toBeGreaterThanOrEqual(1);
      expect(s.resultingRank).toBeLessThanOrEqual(fieldN);
    }
  });
});
