import { describe, it, expect } from "bun:test";

import {
  computeTriangularArbitrageParity,
  triangularArbitrageParityToPayload,
} from "./triangularArbitrageParity.ts";

/** Build a perfectly-consistent triangle: directAC = legAB * legBC exactly. */
function consistentTriangle(n: number): { legAB: number[]; legBC: number[]; directAC: number[] } {
  const legAB: number[] = [];
  const legBC: number[] = [];
  const directAC: number[] = [];
  for (let i = 0; i < n; i++) {
    const ab = 0.05 + 0.001 * Math.sin(i); // ETH/BTC-ish
    const bc = 60000 + 100 * Math.cos(i); // BTC/USDT-ish
    legAB.push(ab);
    legBC.push(bc);
    directAC.push(ab * bc); // implied == direct
  }
  return { legAB, legBC, directAC };
}

describe("computeTriangularArbitrageParity — consistent triangle → ~0 std", () => {
  it("directAC == legAB * legBC gives near-zero TAP-std", () => {
    const t = consistentTriangle(60);
    const r = computeTriangularArbitrageParity(t);
    expect(r.observations).toBe(60);
    expect(r.tapStd).toBeLessThan(1e-9);
    expect(r.tapStdBps).toBeLessThan(1e-4);
    expect(r.maxAbsDeviation).toBeLessThan(1e-9);
    expect(r.dislocationFlag).toBe(false);
  });
});

describe("computeTriangularArbitrageParity — parity break → positive std reacting to magnitude", () => {
  it("std rises monotonically with break magnitude", () => {
    const base = consistentTriangle(60);

    const withBreak = (magnitude: number) => {
      const directAC = base.directAC.map((v, i) =>
        // Perturb a subset of observations by +magnitude (fractional).
        i % 5 === 0 ? v * (1 + magnitude) : v,
      );
      return computeTriangularArbitrageParity({
        legAB: base.legAB,
        legBC: base.legBC,
        directAC,
      });
    };

    const small = withBreak(0.001);
    const medium = withBreak(0.01);
    const large = withBreak(0.05);

    expect(small.tapStd).toBeGreaterThan(0);
    expect(medium.tapStd).toBeGreaterThan(small.tapStd);
    expect(large.tapStd).toBeGreaterThan(medium.tapStd);
  });
});

describe("computeTriangularArbitrageParity — opposite-direction breaks do not cancel", () => {
  it("symmetric +break / -break keeps std positive while mean stays ~0", () => {
    const base = consistentTriangle(60);
    const e = 0.02;
    const directAC = base.directAC.map((v, i) =>
      // Alternate positive and negative dislocations of equal magnitude.
      i % 2 === 0 ? v * (1 + e) : v * (1 - e),
    );
    const r = computeTriangularArbitrageParity({
      legAB: base.legAB,
      legBC: base.legBC,
      directAC,
    });

    // Opposite-direction breaks average toward zero...
    expect(Math.abs(r.meanDeviation)).toBeLessThan(1e-3);
    // ...but the std does NOT cancel — it reflects the two-sided dislocation.
    expect(r.tapStd).toBeGreaterThan(0.01);
  });

  it("a mean-based measure WOULD cancel where std does not", () => {
    const base = consistentTriangle(40);
    const e = 0.03;
    const directAC = base.directAC.map((v, i) => (i % 2 === 0 ? v * (1 + e) : v * (1 - e)));
    const r = computeTriangularArbitrageParity({
      legAB: base.legAB,
      legBC: base.legBC,
      directAC,
    });
    expect(Math.abs(r.meanDeviation)).toBeLessThan(r.tapStd);
  });
});

describe("computeTriangularArbitrageParity — rising dislocation flag", () => {
  it("flags a late-onset dislocation via the rolling-std z-score", () => {
    const base = consistentTriangle(120);
    // Clean first half, dislocated tail — the trailing rolling std should spike.
    const directAC = base.directAC.map((v, i) =>
      i >= 100 && i % 2 === 0 ? v * 1.03 : i >= 100 ? v * 0.97 : v,
    );
    const r = computeTriangularArbitrageParity({
      legAB: base.legAB,
      legBC: base.legBC,
      directAC,
      rollingWindow: 20,
    });
    expect(r.rollingStd).not.toBeNull();
    expect(r.dislocationZScore).not.toBeNull();
    expect(r.dislocationFlag).toBe(true);
  });

  it("no rolling read when the sample is too short", () => {
    const t = consistentTriangle(10);
    const r = computeTriangularArbitrageParity({ ...t, rollingWindow: 20 });
    expect(r.rollingStd).toBeNull();
    expect(r.dislocationZScore).toBeNull();
    expect(r.dislocationFlag).toBe(false);
  });
});

describe("computeTriangularArbitrageParity — boundary cases", () => {
  it("non-positive rates are skipped", () => {
    const r = computeTriangularArbitrageParity({
      legAB: [0.05, -1, 0.05],
      legBC: [60000, 60000, 0],
      directAC: [3000, 3000, 3000],
    });
    // Only the first observation has all-positive legs.
    expect(r.observations).toBe(1);
  });

  it("empty input → zeroed result", () => {
    const r = computeTriangularArbitrageParity({ legAB: [], legBC: [], directAC: [] });
    expect(r.observations).toBe(0);
    expect(r.tapStd).toBe(0);
    expect(r.reason).toContain("no valid observations");
  });
});

describe("triangularArbitrageParityToPayload", () => {
  it("emits a stable shape", () => {
    const t = consistentTriangle(60);
    const r = computeTriangularArbitrageParity(t);
    const p = triangularArbitrageParityToPayload(r) as {
      kind: string;
      dislocationFlag: boolean;
    };
    expect(p.kind).toBe("triangular_arbitrage_parity.evaluated");
    expect(typeof p.dislocationFlag).toBe("boolean");
  });
});
