import { describe, it, expect } from "bun:test";
import {
  computeMarketProfile,
  marketProfileToPayload,
  type ProfileBar,
} from "./marketProfile.ts";

function bars(samples: Array<[number, number, number]>): ProfileBar[] {
  return samples.map(([t, low, high]) => ({ timestamp: t, low, high }));
}

const HOUR = 60 * 60 * 1000;

describe("computeMarketProfile — edge cases", () => {
  it("empty input → insufficient", () => {
    const r = computeMarketProfile({ bars: [] });
    expect(r.dayType).toBe("insufficient");
    expect(r.pointOfControl).toBeNull();
  });
});

describe("computeMarketProfile — normal day", () => {
  it("bell-shaped touch pattern centers POC near middle", () => {
    // Build a price action that pivots tightly around 100 with one period
    // each in [99, 101], [99.5, 100.5], [99, 101], [98.5, 101.5].
    const r = computeMarketProfile({
      bars: bars([
        [0, 99, 101],
        [HOUR, 99.5, 100.5],
        [2 * HOUR, 99, 101],
        [3 * HOUR, 98.5, 101.5],
      ]),
      tickSize: 0.5,
    });
    expect(r.pointOfControl).not.toBeNull();
    expect(Math.abs(r.pocSkew)).toBeLessThan(0.35);
    expect(["normal", "non-trending"]).toContain(r.dayType);
  });
});

describe("computeMarketProfile — trending day", () => {
  it("monotone rise produces high positive skew", () => {
    const r = computeMarketProfile({
      bars: bars([
        [0, 100, 101],
        [HOUR, 101, 102],
        [2 * HOUR, 102, 103],
        [3 * HOUR, 103, 104],
        [4 * HOUR, 104, 110],
        [5 * HOUR, 108, 110],
      ]),
      tickSize: 0.5,
    });
    expect(r.dayType).toBe("trending");
    expect(r.pocSkew).toBeGreaterThan(0);
  });

  it("monotone fall lingering at the low produces negative skew", () => {
    // Mirror of the up-trend test: brief touches at the top, then a
    // long sit at the bottom (multiple adjacent blocks each touching
    // the same low-price range).
    const r = computeMarketProfile({
      bars: bars([
        [0, 109, 110],
        [HOUR, 108, 109],
        [2 * HOUR, 107, 108],
        [3 * HOUR, 106, 107],
        [4 * HOUR, 100, 106],
        [5 * HOUR, 100, 101],
        [6 * HOUR, 100, 101],
        [7 * HOUR, 100, 101],
      ]),
      tickSize: 0.5,
    });
    expect(r.dayType).toBe("trending");
    expect(r.pocSkew).toBeLessThan(0);
  });
});

describe("computeMarketProfile — value area contains 70%", () => {
  it("VA TPO count ≥ 70% of total", () => {
    const r = computeMarketProfile({
      bars: bars([
        [0, 99, 101],
        [HOUR, 99.5, 100.5],
        [2 * HOUR, 99, 101],
        [3 * HOUR, 99.5, 100.5],
      ]),
      tickSize: 0.5,
    });
    expect(r.valueAreaTpoCount / r.totalTpos).toBeGreaterThanOrEqual(0.7);
  });
});

describe("marketProfileToPayload", () => {
  it("emits a stable shape", () => {
    const r = computeMarketProfile({
      bars: bars([
        [0, 100, 101],
        [HOUR, 100.5, 101.5],
      ]),
      tickSize: 0.5,
    });
    const p = marketProfileToPayload(r) as { kind: string; dayType: string };
    expect(p.kind).toBe("market_profile.computed");
    expect(typeof p.dayType).toBe("string");
  });
});
