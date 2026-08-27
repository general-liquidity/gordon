import { describe, expect, it } from "bun:test";
import {
  checkOrderAdmissibility,
  economicOrderFloor,
  evaluateSplit,
  feeForNotional,
  trancheCount,
} from "./economic-floor.ts";
import type { FeeSchedule } from "./economic-floor.ts";

const USD = (dollars: number): number => Math.round(dollars * 100);

/** c = $2.50 per started $100 tranche. */
const TICKETED: FeeSchedule = { fixedPerTrancheMinor: USD(2.5), trancheSizeMinor: USD(100) };
const ZERO_COMMISSION: FeeSchedule = { fixedPerTrancheMinor: 0, trancheSizeMinor: 0 };
const ONE_PERCENT = { feeToleranceBps: 100 };

describe("economicOrderFloor", () => {
  it("is derived from the fee schedule: $2.50 at 1% tolerance floors at $250", () => {
    expect(economicOrderFloor(TICKETED, ONE_PERCENT)).toBe(USD(250));
  });

  it("moves with the fixed cost: a $1.00 ticket floors at $100 and a $9.99 ticket at $999", () => {
    expect(economicOrderFloor({ ...TICKETED, fixedPerTrancheMinor: USD(1) }, ONE_PERCENT)).toBe(
      USD(100),
    );
    expect(economicOrderFloor({ ...TICKETED, fixedPerTrancheMinor: USD(9.99) }, ONE_PERCENT)).toBe(
      USD(999),
    );
  });

  it("moves with the tolerance: halving tau doubles the floor", () => {
    expect(economicOrderFloor(TICKETED, { feeToleranceBps: 50 })).toBe(USD(500));
    expect(economicOrderFloor(TICKETED, { feeToleranceBps: 200 })).toBe(USD(125));
  });

  it("folds the per-order minimum in, since it is fixed cost under another name", () => {
    const schedule: FeeSchedule = { ...TICKETED, minimumPerOrderMinor: USD(5) };
    expect(economicOrderFloor(schedule, ONE_PERCENT)).toBe(USD(500));
  });

  it("collapses to zero under zero commission and admits any size", () => {
    expect(economicOrderFloor(ZERO_COMMISSION, ONE_PERCENT)).toBe(0);

    const result = checkOrderAdmissibility({
      orders: [{ symbol: "BTCUSDT", notionalMinor: USD(1) }],
      schedule: ZERO_COMMISSION,
      policy: ONE_PERCENT,
    });
    expect(result.admissible).toBe(true);
    expect(result.violations).toHaveLength(0);
  });
});

describe("evaluateSplit", () => {
  it("flags a three-way split that starts an extra tranche, with the excess cost exact", () => {
    const verdict = evaluateSplit(TICKETED, [USD(150), USD(150), USD(150)]);
    expect(verdict.kind).toBe("fee-worsening");
    expect(verdict.consolidatedTranches).toBe(5);
    expect(verdict.splitTranches).toBe(6);
    expect(verdict.excessCostMinor).toBe(USD(2.5));
  });

  it("admits a split that lands on tranche boundaries as fee-neutral", () => {
    const verdict = evaluateSplit(TICKETED, [USD(100), USD(200), USD(300)]);
    expect(verdict.kind).toBe("fee-neutral");
    expect(verdict.splitTranches).toBe(6);
    expect(verdict.consolidatedTranches).toBe(6);
    expect(verdict.excessCostMinor).toBe(0);
  });

  it("never makes consolidation the more expensive choice, over a range of sizes", () => {
    for (let a = 1; a <= 500; a += 7) {
      for (let b = 1; b <= 500; b += 11) {
        const consolidated = feeForNotional(TICKETED, USD(a) + USD(b));
        const split = feeForNotional(TICKETED, USD(a)) + feeForNotional(TICKETED, USD(b));
        expect(consolidated).toBeLessThanOrEqual(split);
      }
    }
  });

  it("charges nothing and flags nothing when the venue takes no commission", () => {
    const verdict = evaluateSplit(ZERO_COMMISSION, [USD(150), USD(150), USD(150)]);
    expect(verdict.kind).toBe("fee-neutral");
    expect(verdict.splitFeeMinor).toBe(0);
  });

  it("counts a single order as a split of one and never penalises it", () => {
    const verdict = evaluateSplit(TICKETED, [USD(150)]);
    expect(verdict.kind).toBe("single-order");
    expect(verdict.excessCostMinor).toBe(0);
  });
});

describe("money arithmetic", () => {
  it("counts tranches exactly where floating point would add a phantom one", () => {
    const dimeTranches: FeeSchedule = { fixedPerTrancheMinor: 1, trancheSizeMinor: 10 };
    const verdict = evaluateSplit(dimeTranches, [10, 10, 10]);
    expect(verdict.consolidatedTranches).toBe(3);
    expect(verdict.kind).toBe("fee-neutral");

    // The same sum in dollars-as-floats overshoots the boundary and would bill a fourth tranche.
    expect(Math.ceil((0.1 + 0.1 + 0.1) / 0.1)).toBe(4);
  });

  it("keeps sums to the cent where floating point drifts", () => {
    expect(10 + 20).toBe(30);
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(trancheCount({ fixedPerTrancheMinor: 1, trancheSizeMinor: 10 }, 30)).toBe(3);
  });

  it("rounds a proportional fee up to the next whole cent", () => {
    const schedule: FeeSchedule = {
      fixedPerTrancheMinor: 0,
      trancheSizeMinor: 0,
      proportionalBps: 10,
    };
    expect(feeForNotional(schedule, USD(100.5))).toBe(11);
  });
});

describe("venue minimum versus economic floor", () => {
  it("an order can clear the venue and still fail economics", () => {
    const result = checkOrderAdmissibility({
      orders: [{ symbol: "ETHUSDT", notionalMinor: USD(30), venueMinNotionalMinor: USD(10) }],
      schedule: TICKETED,
      policy: ONE_PERCENT,
    });
    expect(result.orders[0]!.clearsVenueMinimum).toBe(true);
    expect(result.orders[0]!.clearsEconomicFloor).toBe(false);
    expect(result.admissible).toBe(false);

    const violation = result.violations.find((v) => v.kind === "below-economic-floor");
    expect(violation).toMatchObject({
      kind: "below-economic-floor",
      floorMinor: USD(250),
      shortfallMinor: USD(220),
    });
    expect(result.violations.some((v) => v.kind === "below-venue-minimum")).toBe(false);
  });

  it("an order can clear economics and still fail the venue", () => {
    const result = checkOrderAdmissibility({
      orders: [{ symbol: "ILLIQ", notionalMinor: USD(300), venueMinNotionalMinor: USD(500) }],
      schedule: TICKETED,
      policy: ONE_PERCENT,
    });
    expect(result.orders[0]!.clearsEconomicFloor).toBe(true);
    expect(result.orders[0]!.clearsVenueMinimum).toBe(false);

    const violation = result.violations.find((v) => v.kind === "below-venue-minimum");
    expect(violation).toMatchObject({
      kind: "below-venue-minimum",
      venueMinNotionalMinor: USD(500),
      shortfallMinor: USD(200),
    });
    expect(result.violations.some((v) => v.kind === "below-economic-floor")).toBe(false);
  });

  it("reports no venue verdict when the caller supplies no venue minimum", () => {
    const result = checkOrderAdmissibility({
      orders: [{ symbol: "BTCUSDT", notionalMinor: USD(300) }],
      schedule: TICKETED,
      policy: ONE_PERCENT,
    });
    expect(result.orders[0]!.clearsVenueMinimum).toBe(true);
    expect(result.admissible).toBe(true);
  });
});

describe("checkOrderAdmissibility", () => {
  it("returns typed violations a caller can branch on, not prose", () => {
    const result = checkOrderAdmissibility({
      orders: [
        { symbol: "AAA", notionalMinor: USD(150) },
        { symbol: "BBB", notionalMinor: USD(150) },
        { symbol: "CCC", notionalMinor: USD(150) },
      ],
      schedule: TICKETED,
      policy: ONE_PERCENT,
    });
    expect(result.admissible).toBe(false);
    expect(result.violations).toContainEqual({
      kind: "fee-worsening-split",
      symbols: ["AAA", "BBB", "CCC"],
      splitTranches: 6,
      consolidatedTranches: 5,
      splitFeeMinor: USD(15),
      consolidatedFeeMinor: USD(12.5),
      excessCostMinor: USD(2.5),
    });
  });

  it("admits a fee-neutral diversification that also clears the floor", () => {
    const result = checkOrderAdmissibility({
      orders: [
        { symbol: "AAA", notionalMinor: USD(300), venueMinNotionalMinor: USD(10) },
        { symbol: "BBB", notionalMinor: USD(400), venueMinNotionalMinor: USD(10) },
      ],
      schedule: TICKETED,
      policy: ONE_PERCENT,
    });
    expect(result.admissible).toBe(true);
    expect(result.split.kind).toBe("fee-neutral");
  });

  it("produces identical results on repeated calls with no clock or I/O", () => {
    const input = {
      orders: [
        { symbol: "AAA", notionalMinor: USD(150) },
        { symbol: "BBB", notionalMinor: USD(150) },
      ],
      schedule: TICKETED,
      policy: ONE_PERCENT,
    };
    expect(checkOrderAdmissibility(input)).toEqual(checkOrderAdmissibility(input));
  });
});
