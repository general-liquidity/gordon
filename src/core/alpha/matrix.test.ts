import { describe, it, expect } from "bun:test";
import {
  transpose,
  multiply,
  multiplyVector,
  dot,
  invert,
  shrinkToDiagonal,
  computeCovarianceMatrix,
} from "./matrix.ts";

describe("transpose", () => {
  it("transposes a 2x3 matrix into 3x2", () => {
    const m = [
      [1, 2, 3],
      [4, 5, 6],
    ];
    expect(transpose(m)).toEqual([
      [1, 4],
      [2, 5],
      [3, 6],
    ]);
  });

  it("handles empty input", () => {
    expect(transpose([])).toEqual([]);
  });
});

describe("multiply + multiplyVector + dot", () => {
  it("multiplies 2x3 * 3x2 = 2x2", () => {
    const a = [
      [1, 2, 3],
      [4, 5, 6],
    ];
    const b = [
      [7, 8],
      [9, 10],
      [11, 12],
    ];
    expect(multiply(a, b)).toEqual([
      [58, 64],
      [139, 154],
    ]);
  });

  it("throws on shape mismatch", () => {
    expect(() => multiply([[1, 2]], [[1, 2]])).toThrow();
  });

  it("multiplyVector applies matrix to a vector", () => {
    const m = [
      [1, 2],
      [3, 4],
    ];
    expect(multiplyVector(m, [5, 6])).toEqual([17, 39]); // 1*5+2*6=17, 3*5+4*6=39
  });

  it("dot computes inner product", () => {
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(32); // 4+10+18
  });
});

describe("invert", () => {
  it("inverts a 2x2 identity → identity", () => {
    const inv = invert([
      [1, 0],
      [0, 1],
    ]);
    expect(inv).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });

  it("inverts a 2x2 diagonal correctly", () => {
    const inv = invert([
      [2, 0],
      [0, 4],
    ]);
    expect(inv![0]![0]).toBeCloseTo(0.5, 6);
    expect(inv![1]![1]).toBeCloseTo(0.25, 6);
  });

  it("inverts a 2x2 non-diagonal correctly", () => {
    // M = [[4, 7], [2, 6]], det = 24 - 14 = 10
    // M⁻¹ = [[0.6, -0.7], [-0.2, 0.4]]
    const inv = invert([
      [4, 7],
      [2, 6],
    ]);
    expect(inv![0]![0]).toBeCloseTo(0.6, 6);
    expect(inv![0]![1]).toBeCloseTo(-0.7, 6);
    expect(inv![1]![0]).toBeCloseTo(-0.2, 6);
    expect(inv![1]![1]).toBeCloseTo(0.4, 6);
  });

  it("returns null for singular matrix", () => {
    // Rank-1 matrix: rows are proportional → singular
    expect(
      invert([
        [1, 2],
        [2, 4],
      ]),
    ).toBeNull();
  });

  it("returns empty for empty input", () => {
    expect(invert([])).toEqual([]);
  });

  it("M × M⁻¹ ≈ I for a 3x3 SPD matrix", () => {
    const M = [
      [2, 1, 0],
      [1, 3, 1],
      [0, 1, 2],
    ];
    const inv = invert(M)!;
    const product = multiply(M, inv);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        expect(product[i]![j]).toBeCloseTo(i === j ? 1 : 0, 6);
      }
    }
  });
});

describe("shrinkToDiagonal", () => {
  it("alpha=0 leaves matrix unchanged", () => {
    const m = [
      [1, 0.5],
      [0.5, 1],
    ];
    expect(shrinkToDiagonal(m, 0)).toEqual(m);
  });

  it("alpha=1 zeroes off-diagonals", () => {
    const m = [
      [1, 0.5],
      [0.5, 1],
    ];
    const s = shrinkToDiagonal(m, 1);
    expect(s[0]![0]).toBe(1);
    expect(s[1]![1]).toBe(1);
    expect(s[0]![1]).toBe(0);
    expect(s[1]![0]).toBe(0);
  });

  it("alpha=0.5 halves off-diagonals", () => {
    const s = shrinkToDiagonal(
      [
        [1, 0.4],
        [0.4, 1],
      ],
      0.5,
    );
    expect(s[0]![1]).toBeCloseTo(0.2, 6);
    expect(s[1]![0]).toBeCloseTo(0.2, 6);
  });

  it("clamps alpha out of [0, 1]", () => {
    const m = [
      [1, 0.5],
      [0.5, 1],
    ];
    expect(shrinkToDiagonal(m, -0.5)).toEqual(m); // clamped to 0
    const s = shrinkToDiagonal(m, 1.5); // clamped to 1
    expect(s[0]![1]).toBe(0);
  });
});

describe("computeCovarianceMatrix", () => {
  it("returns null for length mismatch", () => {
    expect(computeCovarianceMatrix([[1, 2, 3], [1, 2]])).toBeNull();
  });

  it("returns null for insufficient samples", () => {
    expect(computeCovarianceMatrix([[1]])).toBeNull();
  });

  it("diagonal entries = sample variance", () => {
    const cov = computeCovarianceMatrix([[1, 2, 3, 4, 5]])!;
    // var = ((1-3)² + (2-3)² + 0 + (4-3)² + (5-3)²) / 4 = 10/4 = 2.5
    expect(cov[0]![0]).toBeCloseTo(2.5, 6);
  });

  it("off-diagonal = sample covariance", () => {
    // Perfectly correlated series
    const cov = computeCovarianceMatrix([
      [1, 2, 3, 4, 5],
      [2, 4, 6, 8, 10],
    ])!;
    expect(cov[0]![1]).toBeCloseTo(cov[1]![0]!, 6); // symmetric
    expect(cov[0]![1]).toBeGreaterThan(0); // positive correlation
  });

  it("returns null on non-finite input", () => {
    expect(computeCovarianceMatrix([[1, 2, NaN]])).toBeNull();
    expect(computeCovarianceMatrix([[1, 2, Infinity]])).toBeNull();
  });
});
