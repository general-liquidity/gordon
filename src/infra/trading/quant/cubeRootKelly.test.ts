import { describe, it, expect } from "bun:test";
import {
  computeCubeRootKelly,
  cubeRootKellyToPayload,
} from "./cubeRootKelly.ts";

/** Full-size holding for the fixtures below. h₀ is required, so name it once. */
const SCALE = 0.25;
const LIMIT = 1;

describe("computeCubeRootKelly — formula", () => {
  it("β = 1 recovers linear Kelly", () => {
    const r = computeCubeRootKelly({
      alpha: 0.02,
      returnVariance: 0.04,
      positionScale: SCALE,
      positionLimit: LIMIT,
      exponent: 1,
    });
    expect(r.position).toBeCloseTo(r.linearKellyPosition, 9);
    expect(r.scaleFactor).toBeCloseTo(1, 9);
  });

  it("β = 1/3 backs off from signals above the position scale", () => {
    const large = computeCubeRootKelly({
      alpha: 0.5,
      returnVariance: 0.04,
      positionScale: SCALE,
      positionLimit: 100,
      exponent: 1 / 3,
    });
    expect(Math.abs(large.linearKellyPosition)).toBeGreaterThan(SCALE);
    expect(Math.abs(large.position)).toBeLessThan(Math.abs(large.linearKellyPosition));
    expect(large.scaleFactor).toBeLessThan(1);
  });

  it("sign of position = sign of alpha", () => {
    const pos = computeCubeRootKelly({
      alpha: 0.01,
      returnVariance: 0.04,
      positionScale: SCALE,
      positionLimit: LIMIT,
    });
    const neg = computeCubeRootKelly({
      alpha: -0.01,
      returnVariance: 0.04,
      positionScale: SCALE,
      positionLimit: LIMIT,
    });
    expect(pos.position).toBeGreaterThan(0);
    expect(neg.position).toBeLessThan(0);
  });

  it("alpha = 0 → position = 0", () => {
    const r = computeCubeRootKelly({
      alpha: 0,
      returnVariance: 0.04,
      positionScale: SCALE,
      positionLimit: LIMIT,
    });
    expect(r.position).toBe(0);
    expect(r.scaleFactor).toBe(0);
  });

  it("position limit clips and flags", () => {
    const r = computeCubeRootKelly({
      alpha: 10,
      returnVariance: 0.0001, // gives huge linear Kelly
      positionScale: SCALE,
      positionLimit: 1,
      exponent: 1,
    });
    expect(r.position).toBe(1);
    expect(r.clipped).toBe(true);
  });

  it("riskAversion λ scales inversely (linear Kelly)", () => {
    const a = computeCubeRootKelly({
      alpha: 0.02,
      returnVariance: 0.04,
      positionScale: SCALE,
      positionLimit: LIMIT,
      riskAversion: 0.5,
      exponent: 1,
    });
    const b = computeCubeRootKelly({
      alpha: 0.02,
      returnVariance: 0.04,
      positionScale: SCALE,
      positionLimit: LIMIT,
      riskAversion: 1,
      exponent: 1,
    });
    expect(b.position).toBeCloseTo(a.position / 2, 9);
  });
});

describe("computeCubeRootKelly — dimensional homogeneity", () => {
  // The power law is only defined relative to a reference holding. Without
  // h₀ the code was the h₀ = 1 special case and every one of these failed.

  it("agrees exactly with linear Kelly at the position scale", () => {
    // α = 0.02, λ = 0.5, σ² = 0.04 → linear Kelly = 0.02 / (2·0.5·0.04) = 0.5.
    const r = computeCubeRootKelly({
      alpha: 0.02,
      returnVariance: 0.04,
      positionScale: 0.5,
      positionLimit: 10,
      exponent: 1 / 3,
    });
    expect(r.linearKellyPosition).toBeCloseTo(0.5, 12);
    expect(r.position).toBeCloseTo(0.5, 12);
    expect(r.scaleFactor).toBeCloseTo(1, 12);
  });

  it("never amplifies a holding that sits at its own scale, at any magnitude", () => {
    // Old behaviour: linear Kelly 0.01 → 0.2154 (21.5x) and 0.0001 → 0.0464
    // (464x), because sub-unit magnitudes grow under a fractional exponent.
    for (const kelly of [1e-4, 1e-2, 1, 100]) {
      // α chosen so linear Kelly = kelly with λ = 0.5, σ² = 0.04.
      const alpha = kelly * 2 * 0.5 * 0.04;
      const r = computeCubeRootKelly({
        alpha,
        returnVariance: 0.04,
        positionScale: kelly,
        positionLimit: 1e6,
        exponent: 1 / 3,
      });
      expect(r.position).toBeCloseTo(kelly, 10);
      expect(r.scaleFactor).toBeCloseTo(1, 10);
    }
  });

  it("is homogeneous of degree one: scaling holding and h₀ together scales the position", () => {
    // h(cL, ch₀) = c·h(L, h₀). Under the h₀ = 1 code this held only at c = 1.
    const base = computeCubeRootKelly({
      alpha: 0.02,
      returnVariance: 0.04,
      positionScale: 0.5,
      positionLimit: 1e9,
      exponent: 1 / 3,
    });
    const c = 1000;
    const scaled = computeCubeRootKelly({
      alpha: 0.02 * c,
      returnVariance: 0.04,
      positionScale: 0.5 * c,
      positionLimit: 1e9,
      exponent: 1 / 3,
    });
    expect(scaled.position).toBeCloseTo(base.position * c, 6);
    expect(scaled.scaleFactor).toBeCloseTo(base.scaleFactor, 9);
  });

  it("a small linear Kelly against a full-size scale stays small", () => {
    // linear Kelly 0.01, h₀ = 1: h = 1·(0.01)^(1/3) = 0.2154. Still an
    // amplification, but a deliberate one the operator declared by naming a
    // full-size holding of 1, and it is capped.
    const r = computeCubeRootKelly({
      alpha: 0.01 * 2 * 0.5 * 0.04,
      returnVariance: 0.04,
      positionScale: 1,
      positionLimit: 0.05,
      exponent: 1 / 3,
    });
    expect(r.clipped).toBe(true);
    expect(r.position).toBe(0.05);
  });
});

describe("computeCubeRootKelly — validation", () => {
  it("throws on non-positive variance", () => {
    expect(() =>
      computeCubeRootKelly({
        alpha: 0.01,
        returnVariance: 0,
        positionScale: SCALE,
        positionLimit: LIMIT,
      }),
    ).toThrow();
  });
  it("throws on β outside (0, 1]", () => {
    expect(() =>
      computeCubeRootKelly({
        alpha: 0.01,
        returnVariance: 0.04,
        positionScale: SCALE,
        positionLimit: LIMIT,
        exponent: 0,
      }),
    ).toThrow();
    expect(() =>
      computeCubeRootKelly({
        alpha: 0.01,
        returnVariance: 0.04,
        positionScale: SCALE,
        positionLimit: LIMIT,
        exponent: 1.5,
      }),
    ).toThrow();
  });
  it("throws on a non-positive position scale", () => {
    expect(() =>
      computeCubeRootKelly({
        alpha: 0.01,
        returnVariance: 0.04,
        positionScale: 0,
        positionLimit: LIMIT,
      }),
    ).toThrow();
  });
  it("throws on an infinite position limit", () => {
    // The old default. A power law with no cap is an unbounded sizing rule.
    expect(() =>
      computeCubeRootKelly({
        alpha: 0.01,
        returnVariance: 0.04,
        positionScale: SCALE,
        positionLimit: Number.POSITIVE_INFINITY,
      }),
    ).toThrow();
  });
});

describe("cubeRootKellyToPayload", () => {
  it("emits stable shape", () => {
    const r = computeCubeRootKelly({
      alpha: 0.01,
      returnVariance: 0.04,
      positionScale: SCALE,
      positionLimit: LIMIT,
    });
    const p = cubeRootKellyToPayload(r) as { kind: string; positionScale: number };
    expect(p.kind).toBe("cube_root_kelly.computed");
    expect(p.positionScale).toBe(SCALE);
  });
});
