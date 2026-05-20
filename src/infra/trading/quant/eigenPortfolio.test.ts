import { describe, it, expect } from "bun:test";
import {
  isEigenPortfolioEnabled,
  computeEigenPortfolio,
  eigenPortfolioToPayload,
  EIGEN_PORTFOLIO_FLAG_ENV,
} from "./eigenPortfolio.ts";

describe("isEigenPortfolioEnabled", () => {
  it("respects the flag", () => {
    expect(isEigenPortfolioEnabled({})).toBe(false);
    expect(isEigenPortfolioEnabled({ [EIGEN_PORTFOLIO_FLAG_ENV]: "1" })).toBe(true);
  });
});

describe("computeEigenPortfolio — eigenvalue correctness", () => {
  it("diagonal covariance → eigenvalues = diagonal entries (sorted)", () => {
    const cov = [
      [4, 0, 0],
      [0, 9, 0],
      [0, 0, 1],
    ];
    const r = computeEigenPortfolio({ covarianceMatrix: cov, weights: [1, 1, 1] });
    expect(r.components.map((c) => c.eigenvalue)).toEqual([9, 4, 1]);
  });

  it("2x2 symmetric matrix has correct eigenvalues", () => {
    // [[2, 1], [1, 2]] → eigenvalues 3, 1
    const cov = [
      [2, 1],
      [1, 2],
    ];
    const r = computeEigenPortfolio({ covarianceMatrix: cov, weights: [0.5, 0.5] });
    expect(r.components[0]!.eigenvalue).toBeCloseTo(3, 9);
    expect(r.components[1]!.eigenvalue).toBeCloseTo(1, 9);
  });

  it("eigenvalues sorted in descending order", () => {
    const cov = [
      [1, 0.3, 0.1],
      [0.3, 4, 0.2],
      [0.1, 0.2, 2],
    ];
    const r = computeEigenPortfolio({ covarianceMatrix: cov, weights: [1, 1, 1] });
    const eigs = r.components.map((c) => c.eigenvalue);
    for (let i = 1; i < eigs.length; i++) {
      expect(eigs[i]!).toBeLessThanOrEqual(eigs[i - 1]!);
    }
  });
});

describe("computeEigenPortfolio — variance attribution", () => {
  it("variance shares sum to 1 when total variance > 0", () => {
    const cov = [
      [1, 0.5],
      [0.5, 2],
    ];
    const r = computeEigenPortfolio({ covarianceMatrix: cov, weights: [1, 1] });
    const sum = r.components.reduce((a, c) => a + c.varianceShare, 0);
    expect(sum).toBeCloseTo(1, 9);
  });

  it("variance contributions sum to the portfolio variance wᵀΣw", () => {
    const cov = [
      [1, 0.5],
      [0.5, 2],
    ];
    const w = [0.6, 0.4];
    const r = computeEigenPortfolio({ covarianceMatrix: cov, weights: w });
    // Direct portfolio variance
    let direct = 0;
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 2; j++) direct += w[i]! * w[j]! * cov[i]![j]!;
    expect(r.totalVariance).toBeCloseTo(direct, 9);
  });

  it("equal-weight on a single-factor 2x2 → top concentration high", () => {
    // Highly correlated assets share variance through one dominant eigenvector.
    const cov = [
      [1, 0.95],
      [0.95, 1],
    ];
    const r = computeEigenPortfolio({ covarianceMatrix: cov, weights: [0.5, 0.5] });
    expect(r.topConcentration).toBeGreaterThan(0.95);
  });

  it("diagonal cov with equal-weight → fully diversified (top share = 1/N)", () => {
    const cov = [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ];
    const r = computeEigenPortfolio({
      covarianceMatrix: cov,
      weights: [0.25, 0.25, 0.25, 0.25],
    });
    expect(r.topConcentration).toBeCloseTo(0.25, 9);
    expect(r.effectiveBets).toBeCloseTo(4, 6);
  });
});

describe("computeEigenPortfolio — eigenvectors are orthonormal", () => {
  it("any two distinct eigenvectors are orthogonal", () => {
    const cov = [
      [2, 0.5, 0.3],
      [0.5, 3, 0.2],
      [0.3, 0.2, 1],
    ];
    const r = computeEigenPortfolio({ covarianceMatrix: cov, weights: [1, 1, 1] });
    for (let i = 0; i < r.components.length; i++) {
      for (let j = i + 1; j < r.components.length; j++) {
        let dot = 0;
        for (let k = 0; k < 3; k++)
          dot += r.components[i]!.eigenvector[k]! * r.components[j]!.eigenvector[k]!;
        expect(Math.abs(dot)).toBeLessThan(1e-9);
      }
    }
  });

  it("each eigenvector is unit length", () => {
    const cov = [
      [2, 0.5],
      [0.5, 3],
    ];
    const r = computeEigenPortfolio({ covarianceMatrix: cov, weights: [1, 1] });
    for (const c of r.components) {
      let norm2 = 0;
      for (const x of c.eigenvector) norm2 += x * x;
      expect(Math.sqrt(norm2)).toBeCloseTo(1, 9);
    }
  });
});

describe("computeEigenPortfolio — input validation", () => {
  it("throws when covariance dimensions mismatch weights", () => {
    expect(() =>
      computeEigenPortfolio({ covarianceMatrix: [[1, 0], [0, 1]], weights: [1] }),
    ).toThrow();
  });

  it("symmetrises slightly-asymmetric input rather than failing", () => {
    const cov = [
      [1, 0.5],
      [0.5000001, 1],
    ];
    const r = computeEigenPortfolio({ covarianceMatrix: cov, weights: [0.5, 0.5] });
    expect(r.components.length).toBe(2);
  });
});

describe("eigenPortfolioToPayload", () => {
  it("emits stable shape", () => {
    const cov = [
      [1, 0.3],
      [0.3, 1],
    ];
    const r = computeEigenPortfolio({ covarianceMatrix: cov, weights: [0.5, 0.5] });
    const p = eigenPortfolioToPayload(r) as {
      kind: string;
      components: Array<{ varianceShare: number }>;
    };
    expect(p.kind).toBe("eigen_portfolio.computed");
    expect(p.components.length).toBe(2);
  });
});
