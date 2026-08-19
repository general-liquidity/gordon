import { describe, expect, it } from "bun:test";
import {
  allTradable,
  applyMaskPolicy,
  buildTradabilityMask,
  crossSectionalNormalize,
  maskFromFlags,
  maskedRollingMean,
  propagateMask,
  type TradabilityBar,
} from "./mask.ts";

function bar(close: number, venue: Partial<TradabilityBar> = {}): TradabilityBar {
  return {
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
    ...venue,
  };
}

describe("buildTradabilityMask", () => {
  it("marks a bar carrying an explicit venue halt as non-executable", () => {
    const mask = buildTradabilityMask([
      bar(100),
      bar(101, { halted: true }),
      bar(102),
    ]);
    expect(mask.tradable).toEqual([true, false, true]);
    expect(mask.reasons[1]).toBe("halted");
    expect(mask.maskedCount).toBe(1);
  });

  it("distinguishes suspension, delisting and venue outage in the reason", () => {
    const mask = buildTradabilityMask([
      bar(100, { suspended: true }),
      bar(100, { delisted: true }),
      bar(100, { venueOutage: true }),
    ]);
    expect(mask.reasons).toEqual(["suspended", "delisted", "venue_outage"]);
  });

  it("treats a close sitting at an exchange price bound as non-executable", () => {
    const mask = buildTradabilityMask([
      bar(100, { limitUp: 110, limitDown: 90 }),
      bar(110, { limitUp: 110, limitDown: 90 }),
      bar(90, { limitUp: 110, limitDown: 90 }),
    ]);
    expect(mask.tradable).toEqual([true, false, false]);
    expect(mask.reasons[1]).toBe("limit_bound");
    expect(mask.reasons[2]).toBe("limit_bound");
  });

  it("accepts a close a hair off the bound as locked, within tolerance", () => {
    const mask = buildTradabilityMask([bar(100, { limitUp: 100.005 })], {
      limitTolerance: 1e-3,
    });
    expect(mask.tradable[0]).toBe(false);
  });

  it("falls back to the returns heuristic only when the venue supplied no bound", () => {
    const withBounds = buildTradabilityMask([
      bar(100, { limitUp: 500, limitDown: 1 }),
      bar(150, { limitUp: 500, limitDown: 1 }),
    ]);
    expect(withBounds.tradable).toEqual([true, true]);

    const withoutBounds = buildTradabilityMask([bar(100), bar(150)]);
    expect(withoutBounds.tradable).toEqual([true, false]);
    expect(withoutBounds.reasons[1]).toBe("limit_move_heuristic");
  });

  it("lets an explicit venue flag outrank the returns heuristic", () => {
    const mask = buildTradabilityMask([bar(100), bar(150, { halted: true })]);
    expect(mask.reasons[1]).toBe("halted");
  });

  it("is pure: identical bars give identical masks and no wall clock is read", () => {
    const bars = [bar(100), bar(150, { halted: true }), bar(151)];
    const realNow = Date.now;
    Date.now = () => {
      throw new Error("the mask builder must not read the wall clock");
    };
    try {
      const first = buildTradabilityMask(bars);
      const second = buildTradabilityMask(bars);
      expect(first).toEqual(second);
      expect(first.builtAt).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });

  it("stamps builtAt from the injected clock only", () => {
    const mask = buildTradabilityMask([bar(100)], { clock: () => 1_700_000_000 });
    expect(mask.builtAt).toBe(1_700_000_000);
  });
});

describe("propagateMask", () => {
  it("keeps a window invalid for its whole length after one masked bar", () => {
    const mask = maskFromFlags([
      true,
      true,
      true,
      true,
      false,
      true,
      true,
      true,
      true,
      true,
    ]);
    const out = propagateMask(mask, 3);

    expect(out.tradable.slice(0, 2)).toEqual([false, false]);
    expect(out.tradable[3]).toBe(true);
    expect(out.tradable.slice(4, 7)).toEqual([false, false, false]);
    expect(out.tradable[7]).toBe(true);
    expect(out.reasons[5]).toBe("window_contaminated");
    expect(out.reasons[0]).toBe("insufficient_window");
  });

  it("scales contamination with the window length, not the number of halts", () => {
    const flags = Array.from({ length: 40 }, (_, i) => i !== 20);
    const mask = maskFromFlags(flags);
    const contaminated = propagateMask(mask, 20)
      .reasons.filter((r) => r === "window_contaminated")
      .length;
    expect(contaminated).toBe(20);
  });
});

describe("maskedRollingMean", () => {
  it("returns no value where the dependency window touched a masked bar", () => {
    const series = [1, 2, 3, 4, 5, 6];
    const mask = maskFromFlags([true, true, false, true, true, true]);
    const out = maskedRollingMean(series, mask, 2);

    expect(out.values[1]).toBe(1.5);
    expect(out.values[2]).toBeNull();
    expect(out.values[3]).toBeNull();
    expect(out.values[4]).toBe(4.5);
  });

  it("returns no value for an all-masked window, never a number", () => {
    const series = [1, 2, 3, 4];
    const mask = maskFromFlags([false, false, false, false]);
    const out = maskedRollingMean(series, mask, 2);
    expect(out.values).toEqual([null, null, null, null]);
    expect(out.mask.maskedCount).toBe(4);
  });

  it("matches a plain rolling mean when nothing is masked", () => {
    const out = maskedRollingMean([2, 4, 6, 8], allTradable(4), 2);
    expect(out.values).toEqual([null, 3, 5, 7]);
  });
});

describe("applyMaskPolicy", () => {
  it("nulls, zeroes or holds the last executable value per the caller's choice", () => {
    const series = [10, 20, 30, 40];
    const mask = maskFromFlags([true, false, false, true]);

    expect(applyMaskPolicy(series, mask, "invalidate")).toEqual([10, null, null, 40]);
    expect(applyMaskPolicy(series, mask, "zero")).toEqual([10, 0, 0, 40]);
    expect(applyMaskPolicy(series, mask, "hold_last")).toEqual([10, 10, 10, 40]);
  });

  it("holds null before the first executable bar rather than inventing a price", () => {
    const mask = maskFromFlags([false, false, true]);
    expect(applyMaskPolicy([5, 6, 7], mask, "hold_last")).toEqual([null, null, 7]);
  });
});

describe("crossSectionalNormalize", () => {
  it("ranks against the count of executable names, not the whole universe", () => {
    const values = [10, 20, 30, 40];
    const mask = maskFromFlags([true, true, false, false]);
    const ranks = crossSectionalNormalize(values, mask);

    expect(ranks[0]).toBe(0);
    expect(ranks[1]).toBe(1);
    expect(ranks[2]).toBeNull();
    expect(ranks[3]).toBeNull();
  });

  it("gives the same ranks whether the halted names are present or absent", () => {
    const masked = crossSectionalNormalize(
      [10, 20, 30, 40],
      maskFromFlags([true, true, false, false]),
    );
    const trimmed = crossSectionalNormalize([10, 20], allTradable(2));
    expect([masked[0], masked[1]]).toEqual(trimmed);
  });

  it("averages the rank of tied values", () => {
    const ranks = crossSectionalNormalize([5, 5, 9], allTradable(3));
    expect(ranks).toEqual([0.25, 0.25, 1]);
  });

  it("gives a lone executable name the midpoint, which carries no information", () => {
    const ranks = crossSectionalNormalize([7, 8], maskFromFlags([true, false]));
    expect(ranks).toEqual([0.5, null]);
  });

  it("computes the z-score mean and deviation from executable names only", () => {
    const z = crossSectionalNormalize(
      [1, 2, 3, 100],
      maskFromFlags([true, true, true, false]),
      { method: "zscore" },
    );
    const std = Math.sqrt(2 / 3);
    expect(z[1]).toBeCloseTo(0, 12);
    expect(z[0]).toBeCloseTo(-1 / std, 12);
    expect(z[2]).toBeCloseTo(1 / std, 12);
    expect(z[3]).toBeNull();
  });

  it("returns nothing when the whole universe is halted", () => {
    const out = crossSectionalNormalize([1, 2], maskFromFlags([false, false]));
    expect(out).toEqual([null, null]);
  });
});
