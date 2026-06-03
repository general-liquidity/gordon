import { describe, expect, it } from "bun:test";
import { codependenceMatrix, computeCodependence } from "./codependence.ts";

describe("computeCodependence", () => {
  it("linear y = x → pearson≈1, distanceCorr≈1, normalizedMI high", () => {
    const x: number[] = [];
    for (let i = 0; i < 60; i++) x.push(i);
    const y = x.slice();
    const r = computeCodependence({ x, y });
    expect(r.pearson).toBeGreaterThan(0.99);
    expect(r.distanceCorr).toBeGreaterThan(0.95);
    expect(r.normalizedMI).toBeGreaterThan(0.5);
    expect(r.sampleSize).toBe(60);
  });

  it("y = x^2 with x symmetric → pearson≈0 BUT distanceCorr>0.3 and mutualInfo>0", () => {
    const x: number[] = [];
    const y: number[] = [];
    for (let i = -50; i <= 50; i++) {
      x.push(i);
      y.push(i * i);
    }
    const r = computeCodependence({ x, y });
    expect(Math.abs(r.pearson)).toBeLessThan(0.1);
    expect(r.distanceCorr).toBeGreaterThan(0.3);
    expect(r.mutualInfo).toBeGreaterThan(0);
  });

  it("independent seeded-LCG series → all measures low", () => {
    let sx = 123456789;
    let sy = 987654321;
    const lcg = (s: number) => (1103515245 * s + 12345) % 2147483648;
    const x: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < 300; i++) {
      sx = lcg(sx);
      sy = lcg(sy);
      x.push(sx / 2147483648);
      y.push(sy / 2147483648);
    }
    const r = computeCodependence({ x, y });
    expect(Math.abs(r.pearson)).toBeLessThan(0.2);
    expect(r.distanceCorr).toBeLessThan(0.2);
    expect(r.normalizedMI).toBeLessThan(0.2);
  });

  it("codependenceMatrix returns one row per pair", () => {
    const series: Record<string, number[]> = {
      A: [1, 2, 3, 4, 5, 6, 7, 8],
      B: [2, 4, 6, 8, 10, 12, 14, 16],
      C: [8, 7, 6, 5, 4, 3, 2, 1],
    };
    const rows = codependenceMatrix(series);
    expect(rows.length).toBe(3); // C(3,2)
    expect(rows[0]!.a).toBe("A");
    expect(rows[0]!.b).toBe("B");
  });

  it("insufficient data → neutral", () => {
    const r = computeCodependence({ x: [1, 2, 3], y: [4, 5, 6] });
    expect(r.pearson).toBe(0);
    expect(r.mutualInfo).toBe(0);
    expect(r.distanceCorr).toBe(0);
    expect(r.sampleSize).toBe(3);
    expect(r.interpretation).toContain("Insufficient");
  });
});
