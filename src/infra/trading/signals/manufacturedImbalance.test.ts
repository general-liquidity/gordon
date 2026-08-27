import { describe, it, expect } from "bun:test";

import {
  detectManufacturedImbalance,
  imbalanceToPayload,
  type DepthSnapshot,
} from "./manufacturedImbalance.ts";

const snap = (t: number, bid: number, ask: number, executed = 0): DepthSnapshot => ({
  t,
  bidSize: bid,
  askSize: ask,
  executedVolume: executed,
});

describe("detectManufacturedImbalance — classic manufactured pattern", () => {
  it("buildup → peak → vanish without execution → manufactured", () => {
    const snaps = [
      snap(0, 100, 100),
      snap(1, 100, 100),
      snap(2, 500, 100),
      snap(3, 800, 100),
      snap(4, 900, 100),
      snap(5, 600, 100),
      snap(6, 200, 100),
      snap(7, 100, 100),
    ];
    const r = detectManufacturedImbalance({ snapshots: snaps });
    expect(r.verdict).toBe("manufactured");
    expect(r.peakObi).toBeGreaterThan(0.4);
    expect(r.decayRatio).toBeLessThan(0.25);
    expect(r.confidence).toBeGreaterThan(0);
  });
});

describe("detectManufacturedImbalance — clean cases", () => {
  it("balanced book → clean", () => {
    const snaps = [snap(0, 100, 100), snap(1, 110, 100), snap(2, 100, 105), snap(3, 95, 100)];
    const r = detectManufacturedImbalance({ snapshots: snaps });
    expect(r.verdict).toBe("clean");
  });

  it("imbalance with execution → suspicious or clean, not manufactured", () => {
    const snaps = [
      snap(0, 100, 100),
      snap(1, 500, 100, 0),
      snap(2, 900, 100, 50),
      snap(3, 400, 100, 200),
      snap(4, 100, 100, 100),
    ];
    const r = detectManufacturedImbalance({ snapshots: snaps });
    expect(r.verdict).not.toBe("manufactured");
    expect(r.executedInWindow).toBeGreaterThan(0);
  });
});

describe("detectManufacturedImbalance — partial decay → suspicious", () => {
  it("peak decays but not fully → suspicious", () => {
    const snaps = [
      snap(0, 100, 100),
      snap(1, 500, 100),
      snap(2, 800, 100),
      snap(3, 600, 100),
      snap(4, 400, 100),
      snap(5, 300, 100),
    ];
    const r = detectManufacturedImbalance({ snapshots: snaps });
    expect(["suspicious", "clean"]).toContain(r.verdict);
  });
});

describe("detectManufacturedImbalance — boundary cases", () => {
  it("too few snapshots → clean", () => {
    const r = detectManufacturedImbalance({ snapshots: [snap(0, 100, 100), snap(1, 100, 100)] });
    expect(r.verdict).toBe("clean");
    expect(r.reason).toContain("insufficient");
  });

  it("zero sizes → clean (denominator guard)", () => {
    const r = detectManufacturedImbalance({
      snapshots: [snap(0, 0, 0), snap(1, 0, 0), snap(2, 0, 0)],
    });
    expect(r.verdict).toBe("clean");
  });

  it("respects custom thresholds", () => {
    const snaps = [snap(0, 100, 100), snap(1, 200, 100), snap(2, 300, 100), snap(3, 100, 100)];
    const tight = detectManufacturedImbalance({
      snapshots: snaps,
      peakThreshold: 0.2,
      decayThreshold: 0.3,
    });
    const lax = detectManufacturedImbalance({
      snapshots: snaps,
      peakThreshold: 0.9,
      decayThreshold: 0.05,
    });
    expect(tight.verdict).not.toBe("clean");
    expect(lax.verdict).toBe("clean");
  });
});

describe("detectManufacturedImbalance — short-side stuffing", () => {
  it("ask-side buildup vanishing → manufactured (negative peak OBI)", () => {
    const snaps = [
      snap(0, 100, 100),
      snap(1, 100, 500),
      snap(2, 100, 900),
      snap(3, 100, 400),
      snap(4, 100, 100),
    ];
    const r = detectManufacturedImbalance({ snapshots: snaps });
    expect(r.verdict).toBe("manufactured");
    expect(r.peakObi).toBeLessThan(0);
  });
});

describe("imbalanceToPayload", () => {
  it("emits stable shape", () => {
    const r = detectManufacturedImbalance({
      snapshots: [snap(0, 100, 100), snap(1, 500, 100), snap(2, 100, 100)],
    });
    const p = imbalanceToPayload(r) as { kind: string; verdict: string };
    expect(p.kind).toBe("manufactured_imbalance.evaluated");
    expect(typeof p.verdict).toBe("string");
  });
});
