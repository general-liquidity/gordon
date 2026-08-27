import { describe, it, expect } from "bun:test";
import {
  detectMev,
  mevDetectionToPayload,
  type MevTrade,
  type MevSpoofEvent,
} from "./mevDetection.ts";

describe("detectMev — sandwich", () => {
  it("classic sandwich: small buy → large buy → small sell with impact", () => {
    const trades: MevTrade[] = [
      { timestamp: 1_000, side: "buy", price: 100.0, size: 0.1 },
      { timestamp: 1_500, side: "buy", price: 100.5, size: 10.0 }, // victim
      { timestamp: 2_000, side: "sell", price: 100.6, size: 0.1 },
    ];
    const r = detectMev({ trades, largeMultiplier: 4, minImpactBps: 5 });
    expect(r.sandwichCount).toBeGreaterThanOrEqual(1);
    expect(r.events[0]!.kind).toBe("sandwich");
  });

  it("no sandwich when round-trip impact below threshold", () => {
    const trades: MevTrade[] = [
      { timestamp: 1_000, side: "buy", price: 100.0, size: 0.1 },
      { timestamp: 1_500, side: "buy", price: 100.001, size: 10.0 },
      { timestamp: 2_000, side: "sell", price: 100.001, size: 0.1 },
    ];
    const r = detectMev({ trades, largeMultiplier: 4, minImpactBps: 10 });
    expect(r.sandwichCount).toBe(0);
  });

  it("no sandwich outside the temporal window", () => {
    const trades: MevTrade[] = [
      { timestamp: 0, side: "buy", price: 100.0, size: 0.1 },
      { timestamp: 100_000, side: "buy", price: 100.5, size: 10.0 },
      { timestamp: 200_000, side: "sell", price: 100.6, size: 0.1 },
    ];
    const r = detectMev({ trades, windowMs: 5_000 });
    expect(r.sandwichCount).toBe(0);
  });
});

describe("detectMev — frontrun", () => {
  it("small same-side trade immediately before large same-side trade", () => {
    const trades: MevTrade[] = [
      { timestamp: 0, side: "buy", price: 100, size: 0.05 }, // frontrunner
      { timestamp: 500, side: "buy", price: 100, size: 20 }, // victim
    ];
    const r = detectMev({ trades, largeMultiplier: 4 });
    expect(r.frontrunCount).toBeGreaterThanOrEqual(1);
    expect(r.events.some((e) => e.kind === "frontrun")).toBe(true);
  });

  it("no frontrun when predecessor is opposite side", () => {
    const trades: MevTrade[] = [
      { timestamp: 0, side: "sell", price: 100, size: 0.05 },
      { timestamp: 500, side: "buy", price: 100, size: 20 },
    ];
    const r = detectMev({ trades, largeMultiplier: 4 });
    expect(r.frontrunCount).toBe(0);
  });

  it("no frontrun when predecessor is too large (it's just another big trade)", () => {
    const trades: MevTrade[] = [
      { timestamp: 0, side: "buy", price: 100, size: 15 },
      { timestamp: 500, side: "buy", price: 100, size: 20 },
    ];
    const r = detectMev({ trades, largeMultiplier: 4 });
    expect(r.frontrunCount).toBe(0);
  });
});

describe("detectMev — spoof cancel", () => {
  it("large unfilled level disappears within maxLife → spoof", () => {
    const spoof: MevSpoofEvent[] = [
      { appearedAt: 0, disappearedAt: 200, size: 1000, filled: false },
    ];
    const r = detectMev({ trades: [], spoofEvents: spoof, spoofMaxLifeMs: 1500 });
    expect(r.spoofCount).toBe(1);
  });

  it("filled level is not a spoof", () => {
    const spoof: MevSpoofEvent[] = [
      { appearedAt: 0, disappearedAt: 200, size: 1000, filled: true },
    ];
    const r = detectMev({ trades: [], spoofEvents: spoof });
    expect(r.spoofCount).toBe(0);
  });

  it("long-lived level is not a spoof", () => {
    const spoof: MevSpoofEvent[] = [
      { appearedAt: 0, disappearedAt: 10_000, size: 1000, filled: false },
    ];
    const r = detectMev({ trades: [], spoofEvents: spoof, spoofMaxLifeMs: 1_500 });
    expect(r.spoofCount).toBe(0);
  });
});

describe("detectMev — toxicity score and ordering", () => {
  it("toxicity score is fraction of flagged events", () => {
    const trades: MevTrade[] = [
      { timestamp: 0, side: "buy", price: 100, size: 0.05 },
      { timestamp: 500, side: "buy", price: 100, size: 20 },
    ];
    const r = detectMev({ trades, largeMultiplier: 4 });
    expect(r.toxicityScore).toBeGreaterThan(0);
    expect(r.toxicityScore).toBeLessThanOrEqual(1);
  });

  it("events sorted by timestamp", () => {
    const trades: MevTrade[] = [
      { timestamp: 1_000, side: "buy", price: 100, size: 0.05 },
      { timestamp: 1_500, side: "buy", price: 100, size: 20 },
    ];
    const spoof: MevSpoofEvent[] = [
      { appearedAt: 500, disappearedAt: 800, size: 1000, filled: false },
    ];
    const r = detectMev({ trades, spoofEvents: spoof });
    const ts = r.events.map((e) => e.timestamp);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
  });

  it("empty input → zero toxicity", () => {
    const r = detectMev({ trades: [] });
    expect(r.toxicityScore).toBe(0);
    expect(r.events.length).toBe(0);
  });
});

describe("mevDetectionToPayload", () => {
  it("emits stable shape", () => {
    const r = detectMev({ trades: [] });
    const p = mevDetectionToPayload(r) as { kind: string; toxicityScore: number };
    expect(p.kind).toBe("mev_detection.computed");
    expect(typeof p.toxicityScore).toBe("number");
  });
});
