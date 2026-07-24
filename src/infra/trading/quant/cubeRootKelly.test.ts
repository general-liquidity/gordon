import { describe, it, expect } from "bun:test";
import {
  computeCubeRootKelly,
  cubeRootKellyToPayload,
} from "./cubeRootKelly.ts";

describe("computeCubeRootKelly — formula", () => {
  it("β = 1 recovers linear Kelly", () => {
    const r = computeCubeRootKelly({
      alpha: 0.02,
      returnVariance: 0.04,
      exponent: 1,
    });
    expect(r.position).toBeCloseTo(r.linearKellyPosition, 9);
    expect(r.scaleFactor).toBeCloseTo(1, 9);
  });

  it("β = 1/3 backs off from large signals", () => {
    // Large alpha relative to variance — magnitude > 1 → cube root smaller than linear.
    const large = computeCubeRootKelly({
      alpha: 0.5,
      returnVariance: 0.04,
      exponent: 1 / 3,
    });
    expect(Math.abs(large.position)).toBeLessThan(Math.abs(large.linearKellyPosition));
    expect(large.scaleFactor).toBeLessThan(1);
  });

  it("sign of position = sign of alpha", () => {
    const pos = computeCubeRootKelly({ alpha: 0.01, returnVariance: 0.04 });
    const neg = computeCubeRootKelly({ alpha: -0.01, returnVariance: 0.04 });
    expect(pos.position).toBeGreaterThan(0);
    expect(neg.position).toBeLessThan(0);
  });

  it("alpha = 0 → position = 0", () => {
    const r = computeCubeRootKelly({ alpha: 0, returnVariance: 0.04 });
    expect(r.position).toBe(0);
    expect(r.scaleFactor).toBe(0);
  });

  it("position limit clips and flags", () => {
    const r = computeCubeRootKelly({
      alpha: 10,
      returnVariance: 0.0001, // gives huge linear Kelly
      exponent: 1,
      positionLimit: 1,
    });
    expect(r.position).toBe(1);
    expect(r.clipped).toBe(true);
  });

  it("riskAversion λ scales inversely (linear Kelly)", () => {
    const a = computeCubeRootKelly({
      alpha: 0.02,
      returnVariance: 0.04,
      riskAversion: 0.5,
      exponent: 1,
    });
    const b = computeCubeRootKelly({
      alpha: 0.02,
      returnVariance: 0.04,
      riskAversion: 1,
      exponent: 1,
    });
    expect(b.position).toBeCloseTo(a.position / 2, 9);
  });
});

describe("computeCubeRootKelly — validation", () => {
  it("throws on non-positive variance", () => {
    expect(() => computeCubeRootKelly({ alpha: 0.01, returnVariance: 0 })).toThrow();
  });
  it("throws on β outside (0, 1]", () => {
    expect(() =>
      computeCubeRootKelly({ alpha: 0.01, returnVariance: 0.04, exponent: 0 }),
    ).toThrow();
    expect(() =>
      computeCubeRootKelly({ alpha: 0.01, returnVariance: 0.04, exponent: 1.5 }),
    ).toThrow();
  });
});

describe("cubeRootKellyToPayload", () => {
  it("emits stable shape", () => {
    const r = computeCubeRootKelly({ alpha: 0.01, returnVariance: 0.04 });
    const p = cubeRootKellyToPayload(r) as { kind: string };
    expect(p.kind).toBe("cube_root_kelly.computed");
  });
});
