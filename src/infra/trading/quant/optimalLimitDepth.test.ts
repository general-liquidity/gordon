import { describe, it, expect } from "bun:test";
import {
  computeOptimalLimitDepth,
  optimalLimitDepthToPayload,
} from "./optimalLimitDepth.ts";

describe("computeOptimalLimitDepth — validation", () => {
  const base = {
    timeRemaining: 10,
    inventoryRemaining: 5,
    intensityScale: 1,
    intensityDecay: 1,
  };

  it("rejects non-positive time remaining", () => {
    expect(() => computeOptimalLimitDepth({ ...base, timeRemaining: 0 })).toThrow();
    expect(() => computeOptimalLimitDepth({ ...base, timeRemaining: -1 })).toThrow();
  });

  it("rejects non-integer inventory", () => {
    expect(() => computeOptimalLimitDepth({ ...base, inventoryRemaining: 1.5 })).toThrow();
  });

  it("rejects inventory < 1", () => {
    expect(() => computeOptimalLimitDepth({ ...base, inventoryRemaining: 0 })).toThrow();
  });

  it("rejects non-positive intensity parameters", () => {
    expect(() => computeOptimalLimitDepth({ ...base, intensityScale: 0 })).toThrow();
    expect(() => computeOptimalLimitDepth({ ...base, intensityDecay: 0 })).toThrow();
  });

  it("rejects negative terminal penalty", () => {
    expect(() => computeOptimalLimitDepth({ ...base, terminalPenalty: -1 })).toThrow();
  });
});

describe("computeOptimalLimitDepth — invariants", () => {
  it("optimal depth and fill intensity are both positive", () => {
    const r = computeOptimalLimitDepth({
      timeRemaining: 10,
      inventoryRemaining: 5,
      intensityScale: 1,
      intensityDecay: 1,
    });
    expect(r.optimalDepth).toBeGreaterThan(0);
    expect(r.fillIntensityAtOptimal).toBeGreaterThan(0);
  });

  it("higher inventory → tighter (smaller) depth (sell faster)", () => {
    const base = {
      timeRemaining: 10,
      intensityScale: 1,
      intensityDecay: 1,
      terminalPenalty: 0.1,
    };
    const lowInv = computeOptimalLimitDepth({ ...base, inventoryRemaining: 1 });
    const highInv = computeOptimalLimitDepth({ ...base, inventoryRemaining: 10 });
    expect(highInv.optimalDepth).toBeLessThan(lowInv.optimalDepth);
  });

  it("longer horizon → wider depth (can be patient)", () => {
    const base = {
      inventoryRemaining: 5,
      intensityScale: 1,
      intensityDecay: 1,
      terminalPenalty: 0.1,
    };
    const short = computeOptimalLimitDepth({ ...base, timeRemaining: 1 });
    const long = computeOptimalLimitDepth({ ...base, timeRemaining: 50 });
    expect(long.optimalDepth).toBeGreaterThan(short.optimalDepth);
  });

  it("higher terminal penalty → tighter depth (urgency to flatten)", () => {
    const base = {
      timeRemaining: 10,
      inventoryRemaining: 5,
      intensityScale: 1,
      intensityDecay: 1,
    };
    const lowAlpha = computeOptimalLimitDepth({ ...base, terminalPenalty: 0.001 });
    const highAlpha = computeOptimalLimitDepth({ ...base, terminalPenalty: 10 });
    expect(highAlpha.optimalDepth).toBeLessThan(lowAlpha.optimalDepth);
  });
});

describe("computeOptimalLimitDepth — q=1 boundary case", () => {
  it("computes finite depth for inventory=1", () => {
    const r = computeOptimalLimitDepth({
      timeRemaining: 10,
      inventoryRemaining: 1,
      intensityScale: 1,
      intensityDecay: 1,
    });
    expect(Number.isFinite(r.optimalDepth)).toBe(true);
  });
});

describe("computeOptimalLimitDepth — lambda ratio", () => {
  it("Λ = A/κ as documented", () => {
    const r = computeOptimalLimitDepth({
      timeRemaining: 10,
      inventoryRemaining: 5,
      intensityScale: 2,
      intensityDecay: 0.5,
    });
    expect(r.lambdaRatio).toBeCloseTo(4, 6); // 2 / 0.5
  });
});

describe("optimalLimitDepthToPayload", () => {
  it("emits stable shape", () => {
    const r = computeOptimalLimitDepth({
      timeRemaining: 10,
      inventoryRemaining: 5,
      intensityScale: 1,
      intensityDecay: 1,
    });
    const p = optimalLimitDepthToPayload(r) as {
      kind: string;
      optimalDepth: number;
      fillIntensityAtOptimal: number;
    };
    expect(p.kind).toBe("optimal_limit_depth.computed");
    expect(p.optimalDepth).toBeGreaterThan(0);
  });
});
