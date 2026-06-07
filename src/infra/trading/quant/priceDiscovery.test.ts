import { describe, expect, it } from "bun:test";
import { computePriceDiscovery } from "./priceDiscovery.ts";

/**
 * Build two cointegrated price series with controlled error-correction speeds.
 * Δy1 = sharedShock + noise1 − a1·z[t-1];  Δy2 = sharedShock + noise2 + a2·z[t-1]
 * where z = y1 − y2. The market with the SMALLER correction coefficient leads.
 */
function build(a1: number, a2: number, n = 220): { s1: number[]; s2: number[] } {
  const s1 = [100];
  const s2 = [100];
  for (let t = 1; t < n; t++) {
    const shock = 0.6 * Math.sin(0.3 * t) + 0.4 * Math.cos(0.17 * t);
    const noise1 = 0.3 * Math.sin(1.3 * t + 0.5);
    const noise2 = 0.3 * Math.cos(1.1 * t + 0.2);
    const z = s1[t - 1]! - s2[t - 1]!;
    s1.push(s1[t - 1]! + shock + noise1 - a1 * z);
    s2.push(s2[t - 1]! + shock + noise2 + a2 * z);
  }
  return { s1, s2 };
}

describe("computePriceDiscovery", () => {
  it("identifies market1 as leader when it barely adjusts (small α1)", () => {
    const { s1, s2 } = build(0.05, 0.45); // market1 corrects little → leads
    const r = computePriceDiscovery({ series1: s1, series2: s2, label1: "venueA", label2: "venueB" });
    expect(r.confidence).toBe("high");
    expect(r.leader).toBe("venueA");
    expect(r.componentShare1).toBeGreaterThan(0.7);
    expect(r.alpha1).toBeLessThan(0); // corrects down when spread positive
    expect(r.alpha2).toBeGreaterThan(0);
    expect(r.componentShare1 + r.componentShare2).toBeCloseTo(1, 3);
    // Hasbrouck IS well-formed and leaning to venueA.
    expect(r.hasbrouckIS1.lower).toBeGreaterThanOrEqual(0);
    expect(r.hasbrouckIS1.upper).toBeLessThanOrEqual(1);
    expect(r.hasbrouckIS1.upper).toBeGreaterThanOrEqual(r.hasbrouckIS1.lower);
    expect(r.hasbrouckIS1.mid).toBeGreaterThan(r.hasbrouckIS2.mid);
  });

  it("identifies market2 as leader in the mirror case", () => {
    const { s1, s2 } = build(0.45, 0.05);
    const r = computePriceDiscovery({ series1: s1, series2: s2 });
    expect(r.leader).toBe("market2");
    expect(r.componentShare2).toBeGreaterThan(0.7);
  });

  it("reports no clear leader when both adjust equally", () => {
    const { s1, s2 } = build(0.25, 0.25);
    const r = computePriceDiscovery({ series1: s1, series2: s2 });
    expect(r.componentShare1).toBeGreaterThan(0.35);
    expect(r.componentShare1).toBeLessThan(0.65);
    expect(r.leader).toBe("indeterminate");
  });

  it("flags low confidence on identical series (no error correction)", () => {
    const s = Array.from({ length: 100 }, (_, i) => 100 + Math.sin(i));
    const r = computePriceDiscovery({ series1: s, series2: s.slice() });
    expect(r.confidence).toBe("low");
    expect(r.leader).toBe("indeterminate");
  });

  it("is neutral on insufficient data", () => {
    const r = computePriceDiscovery({ series1: [1, 2, 3], series2: [1, 2, 3] });
    expect(r.confidence).toBe("low");
    expect(r.sampleSize).toBe(3);
  });
});
