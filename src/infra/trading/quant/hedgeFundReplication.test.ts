import { describe, it, expect } from "bun:test";
import {
  isHedgeFundReplicationEnabled,
  computeHedgeFundReplication,
  replicationToPayload,
  HEDGE_FUND_REPLICATION_FLAG_ENV,
} from "./hedgeFundReplication.ts";

describe("isHedgeFundReplicationEnabled", () => {
  it("respects the flag", () => {
    expect(isHedgeFundReplicationEnabled({})).toBe(false);
    expect(
      isHedgeFundReplicationEnabled({ [HEDGE_FUND_REPLICATION_FLAG_ENV]: "1" }),
    ).toBe(true);
  });
});

describe("computeHedgeFundReplication — edge cases", () => {
  it("insufficient observations → NaN with reason", () => {
    const r = computeHedgeFundReplication({
      targetReturns: [0.01, 0.02],
      factors: [
        { id: "A", returns: [0.01, 0.02] },
        { id: "B", returns: [0.005, 0.01] },
      ],
    });
    expect(Number.isNaN(r.rSquared)).toBe(true);
    expect(r.reasoning).toContain("need T");
  });

  it("mismatched factor length → NaN with reason", () => {
    const r = computeHedgeFundReplication({
      targetReturns: [0.01, 0.02, 0.03, 0.04, 0.05],
      factors: [
        { id: "A", returns: [0.01, 0.02, 0.03, 0.04, 0.05] },
        { id: "B", returns: [0.005, 0.01] },
      ],
    });
    expect(Number.isNaN(r.rSquared)).toBe(true);
    expect(r.reasoning).toContain("does not match");
  });
});

describe("computeHedgeFundReplication — recovery", () => {
  it("recovers the true allocation from a noise-free target", () => {
    const T = 60;
    let s = 1;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff - 0.5;
    };
    const a = Array.from({ length: T }, () => rand() * 0.02);
    const b = Array.from({ length: T }, () => rand() * 0.02);
    const c = Array.from({ length: T }, () => rand() * 0.02);
    const target = a.map((_, i) => 0.6 * a[i]! + 0.3 * b[i]! + 0.1 * c[i]!);
    const r = computeHedgeFundReplication({
      targetReturns: target,
      factors: [
        { id: "A", returns: a },
        { id: "B", returns: b },
        { id: "C", returns: c },
      ],
    });
    expect(r.rSquared).toBeGreaterThan(0.999);
    const ids = Object.fromEntries(r.weights.map((w) => [w.id, w.weight]));
    expect(ids.A!).toBeCloseTo(0.6, 5);
    expect(ids.B!).toBeCloseTo(0.3, 5);
    expect(ids.C!).toBeCloseTo(0.1, 5);
  });

  it("normalizeWeights rescales to sum to 1", () => {
    const T = 40;
    let s = 17;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff - 0.5;
    };
    const a = Array.from({ length: T }, () => rand() * 0.02);
    const b = Array.from({ length: T }, () => rand() * 0.02);
    const target = a.map((_, i) => 1.5 * a[i]! + 0.5 * b[i]!);
    const r = computeHedgeFundReplication({
      targetReturns: target,
      factors: [
        { id: "A", returns: a },
        { id: "B", returns: b },
      ],
      normalizeWeights: true,
    });
    const total = r.weights.reduce((s, w) => s + w.weight, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it("collinear factors → singular-matrix reason", () => {
    const T = 30;
    const a = Array.from({ length: T }, (_, i) => i * 0.01);
    const r = computeHedgeFundReplication({
      targetReturns: a,
      factors: [
        { id: "A", returns: a },
        { id: "A-copy", returns: a.map((v) => v * 2) },
      ],
    });
    expect(r.reasoning).toContain("singular");
  });
});

describe("replicationToPayload", () => {
  it("emits a stable shape", () => {
    // Independent factor B so the OLS system is not singular.
    const target = [0.01, 0.02, 0.01, 0.03, 0.02, 0.01, 0.02, 0.01, 0.02, 0.01];
    const a = [0.01, 0.02, 0.01, 0.03, 0.02, 0.01, 0.02, 0.01, 0.02, 0.01];
    const b = [0.02, -0.01, 0.005, 0.012, 0.008, -0.003, 0.02, 0.0, 0.005, 0.011];
    const r = computeHedgeFundReplication({
      targetReturns: target,
      factors: [
        { id: "A", returns: a },
        { id: "B", returns: b },
      ],
    });
    const p = replicationToPayload(r) as { kind: string; rSquared: number };
    expect(p.kind).toBe("hedge_fund_replication.computed");
    expect(typeof p.rSquared).toBe("number");
  });
});
