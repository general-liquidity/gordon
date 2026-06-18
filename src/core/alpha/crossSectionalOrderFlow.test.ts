import { describe, it, expect } from "bun:test";
import {
  orderFlowImbalance,
  crossSectionalOrderFlowSignal,
  type InstrumentFlow,
} from "./crossSectionalOrderFlow.ts";

describe("orderFlowImbalance", () => {
  it("is positive when buy-initiated volume exceeds sell-initiated", () => {
    expect(
      orderFlowImbalance({ symbol: "A", buyInitiatedVolume: 100, sellInitiatedVolume: 10 }),
    ).toBeGreaterThan(0);
  });

  it("is negative when sell-initiated volume exceeds buy-initiated", () => {
    expect(
      orderFlowImbalance({ symbol: "A", buyInitiatedVolume: 10, sellInitiatedVolume: 100 }),
    ).toBeLessThan(0);
  });

  it("is ~zero when buy and sell are balanced", () => {
    expect(
      orderFlowImbalance({ symbol: "A", buyInitiatedVolume: 50, sellInitiatedVolume: 50 }),
    ).toBeCloseTo(0, 6);
  });

  it("does not throw on zero volume (eps guard)", () => {
    expect(
      Number.isFinite(
        orderFlowImbalance({ symbol: "A", buyInitiatedVolume: 0, sellInitiatedVolume: 0 }),
      ),
    ).toBe(true);
  });
});

describe("crossSectionalOrderFlowSignal", () => {
  it("longs the high-flow name and shorts the low-flow name", () => {
    const flows: InstrumentFlow[] = [
      { symbol: "HIGH", buyInitiatedVolume: 900, sellInitiatedVolume: 100 },
      { symbol: "MID", buyInitiatedVolume: 500, sellInitiatedVolume: 500 },
      { symbol: "LOW", buyInitiatedVolume: 100, sellInitiatedVolume: 900 },
    ];
    const result = crossSectionalOrderFlowSignal(flows);
    const high = result.find((r) => r.symbol === "HIGH")!;
    const low = result.find((r) => r.symbol === "LOW")!;

    expect(high.weight).toBeGreaterThan(0);
    expect(low.weight).toBeLessThan(0);
    expect(high.zScore).toBeGreaterThan(low.zScore);
  });

  it("produces dollar-neutral weights (Σ weight ≈ 0)", () => {
    const flows: InstrumentFlow[] = [
      { symbol: "A", buyInitiatedVolume: 900, sellInitiatedVolume: 100 },
      { symbol: "B", buyInitiatedVolume: 600, sellInitiatedVolume: 400 },
      { symbol: "C", buyInitiatedVolume: 400, sellInitiatedVolume: 600 },
      { symbol: "D", buyInitiatedVolume: 100, sellInitiatedVolume: 900 },
    ];
    const result = crossSectionalOrderFlowSignal(flows);
    const sum = result.reduce((acc, r) => acc + r.weight, 0);
    expect(sum).toBeCloseTo(0, 9);
  });

  it("normalizes gross exposure to 1 (Σ|weight| ≈ 1)", () => {
    const flows: InstrumentFlow[] = [
      { symbol: "A", buyInitiatedVolume: 900, sellInitiatedVolume: 100 },
      { symbol: "B", buyInitiatedVolume: 600, sellInitiatedVolume: 400 },
      { symbol: "C", buyInitiatedVolume: 400, sellInitiatedVolume: 600 },
      { symbol: "D", buyInitiatedVolume: 100, sellInitiatedVolume: 900 },
    ];
    const result = crossSectionalOrderFlowSignal(flows);
    const gross = result.reduce((acc, r) => acc + Math.abs(r.weight), 0);
    expect(gross).toBeCloseTo(1, 9);
  });

  it("returns all-zero weights when flow is equal across the universe", () => {
    const flows: InstrumentFlow[] = [
      { symbol: "A", buyInitiatedVolume: 500, sellInitiatedVolume: 500 },
      { symbol: "B", buyInitiatedVolume: 300, sellInitiatedVolume: 300 },
      { symbol: "C", buyInitiatedVolume: 700, sellInitiatedVolume: 700 },
    ];
    const result = crossSectionalOrderFlowSignal(flows);
    for (const r of result) {
      expect(r.weight).toBe(0);
      expect(r.zScore).toBe(0);
    }
  });

  it("returns zero weights for a single instrument (<2 guard)", () => {
    const result = crossSectionalOrderFlowSignal([
      { symbol: "A", buyInitiatedVolume: 900, sellInitiatedVolume: 100 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.weight).toBe(0);
  });

  it("returns empty for an empty universe", () => {
    expect(crossSectionalOrderFlowSignal([])).toHaveLength(0);
  });

  it("winsorization clips an extreme outlier so it does not dominate", () => {
    const flows: InstrumentFlow[] = [
      { symbol: "OUT", buyInitiatedVolume: 1_000_000, sellInitiatedVolume: 1 },
      { symbol: "A", buyInitiatedVolume: 520, sellInitiatedVolume: 480 },
      { symbol: "B", buyInitiatedVolume: 500, sellInitiatedVolume: 500 },
      { symbol: "C", buyInitiatedVolume: 480, sellInitiatedVolume: 520 },
    ];
    const raw = crossSectionalOrderFlowSignal(flows, { winsorize: 0 });
    const wins = crossSectionalOrderFlowSignal(flows, { winsorize: 1.5 });
    const rawOut = raw.find((r) => r.symbol === "OUT")!;
    const winsOut = wins.find((r) => r.symbol === "OUT")!;
    // Clipping pulls the outlier's z-score down in magnitude.
    expect(Math.abs(winsOut.zScore)).toBeLessThan(Math.abs(rawOut.zScore));
    // Still dollar-neutral and unit-gross after winsorization.
    expect(wins.reduce((a, r) => a + r.weight, 0)).toBeCloseTo(0, 9);
    expect(wins.reduce((a, r) => a + Math.abs(r.weight), 0)).toBeCloseTo(1, 9);
  });

  it("returns raw z-scores as weights when longShort is false", () => {
    const flows: InstrumentFlow[] = [
      { symbol: "A", buyInitiatedVolume: 900, sellInitiatedVolume: 100 },
      { symbol: "B", buyInitiatedVolume: 100, sellInitiatedVolume: 900 },
    ];
    const result = crossSectionalOrderFlowSignal(flows, { longShort: false });
    for (const r of result) {
      expect(r.weight).toBe(r.zScore);
    }
  });
});
