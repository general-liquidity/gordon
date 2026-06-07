import { describe, expect, it } from "bun:test";
import { computeFootprintImbalance, type FootprintLevel } from "./footprint-imbalance.ts";

describe("computeFootprintImbalance", () => {
  it("detects diagonal buy/sell imbalances and a stacked buy zone", () => {
    const levels: FootprintLevel[] = [
      { priceLevel: 99, buyVolume: 5, sellVolume: 40 }, // sell@99 vs buy@100=10 → sell imbalance
      { priceLevel: 100, buyVolume: 10, sellVolume: 10 },
      { priceLevel: 101, buyVolume: 40, sellVolume: 10 }, // buy@101 vs sell@100=10 → buy imbalance
      { priceLevel: 102, buyVolume: 50, sellVolume: 5 }, // buy@102 vs sell@101=10 → buy imbalance (stacked)
    ];
    const r = computeFootprintImbalance({ levels, threshold: 3, minStacked: 2 });
    expect(r.buyImbalanceCount).toBe(2);
    expect(r.sellImbalanceCount).toBe(1);
    expect(r.markers.find((m) => m.side === "buy" && m.priceLevel === 101)?.ratio).toBe(4);
    expect(r.stackedZones).toHaveLength(1);
    expect(r.stackedZones[0]).toEqual({ side: "buy", priceLow: 101, priceHigh: 102, count: 2 });
  });

  it("reports Infinity ratio when the opposing diagonal cell is empty", () => {
    const levels: FootprintLevel[] = [
      { priceLevel: 100, buyVolume: 10, sellVolume: 0 },
      { priceLevel: 101, buyVolume: 30, sellVolume: 10 }, // buy@101 vs sell@100=0 → Inf
    ];
    const r = computeFootprintImbalance({ levels });
    expect(r.markers.find((m) => m.priceLevel === 101 && m.side === "buy")?.ratio).toBe(Infinity);
  });

  it("finds no imbalances on a balanced footprint", () => {
    const levels: FootprintLevel[] = [
      { priceLevel: 100, buyVolume: 10, sellVolume: 10 },
      { priceLevel: 101, buyVolume: 10, sellVolume: 10 },
      { priceLevel: 102, buyVolume: 10, sellVolume: 10 },
    ];
    expect(computeFootprintImbalance({ levels }).markers).toHaveLength(0);
  });
});
