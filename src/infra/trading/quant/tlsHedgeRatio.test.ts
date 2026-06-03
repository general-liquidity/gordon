import { describe, expect, it } from "bun:test";
import { computeTlsHedgeRatio } from "./tlsHedgeRatio.ts";

describe("computeTlsHedgeRatio", () => {
  it("recovers slope 2 on perfectly collinear y = 2x (TLS ≈ OLS ≈ 2)", () => {
    const pricesX = [1, 2, 3, 4, 5, 6, 7, 8];
    const pricesY = pricesX.map((x) => 2 * x);
    const r = computeTlsHedgeRatio({ pricesY, pricesX });
    expect(r.hedgeRatio).toBeCloseTo(2, 5);
    expect(r.olsHedgeRatio).toBeCloseTo(2, 5);
    expect(r.intercept).toBeCloseTo(0, 5);
    expect(r.sampleSize).toBe(8);
  });

  it("diverges from OLS when x carries symmetric noise (errors-in-variables)", () => {
    // True relation y = 2x. Add symmetric noise to BOTH x and y so neither axis
    // is error-free; OLS attenuates the slope, TLS does not.
    const trueX = Array.from({ length: 40 }, (_, i) => i + 1);
    const noise = [0.6, -0.6, 0.9, -0.9, 0.3, -0.3, 0.7, -0.7];
    const pricesX = trueX.map((x, i) => x + noise[i % noise.length]!);
    const pricesY = trueX.map((x, i) => 2 * x + noise[(i + 1) % noise.length]!);
    const r = computeTlsHedgeRatio({ pricesY, pricesX });
    expect(Math.abs(r.hedgeRatio - r.olsHedgeRatio)).toBeGreaterThan(1e-6);
    // OLS slope is attenuated below the TLS estimate when x is noisy.
    expect(r.olsHedgeRatio).toBeLessThan(r.hedgeRatio);
  });

  it("returns neutral on insufficient data (<3 points)", () => {
    const r = computeTlsHedgeRatio({ pricesY: [1, 2], pricesX: [3, 4] });
    expect(r.hedgeRatio).toBe(0);
    expect(r.olsHedgeRatio).toBe(0);
    expect(r.intercept).toBe(0);
    expect(r.sampleSize).toBe(2);
    expect(r.interpretation).toContain("Insufficient");
  });

  it("returns neutral on degenerate zero-covariance input", () => {
    // x constant -> Sxy = 0
    const r = computeTlsHedgeRatio({
      pricesY: [1, 2, 3, 4],
      pricesX: [5, 5, 5, 5],
    });
    expect(r.hedgeRatio).toBe(0);
    expect(r.olsHedgeRatio).toBe(0);
    expect(r.interpretation).toContain("Degenerate");
  });

  it("matches the analytic closed form on a hand-computed 4-point set", () => {
    // x = [0,1,2,3] meanX=1.5 ; y = [1,1,4,4] meanY=2.5
    // dx = [-1.5,-0.5,0.5,1.5], dy=[-1.5,-1.5,1.5,1.5]
    // Sxx = 2.25+0.25+0.25+2.25 = 5
    // Syy = 2.25+2.25+2.25+2.25 = 9
    // Sxy = 2.25+0.75+0.75+2.25 = 6
    // diff = Syy-Sxx = 4 ; beta = (4 + sqrt(16 + 4*36)) / (2*6)
    //      = (4 + sqrt(160)) / 12 = (4 + 12.6491106...) / 12 = 1.3874258...
    // ols = Sxy/Sxx = 6/5 = 1.2
    // intercept = 2.5 - beta*1.5 = 2.5 - 2.0811388... = 0.4188611...
    const pricesX = [0, 1, 2, 3];
    const pricesY = [1, 1, 4, 4];
    const r = computeTlsHedgeRatio({ pricesY, pricesX });
    const expectedBeta = (4 + Math.sqrt(160)) / 12;
    expect(r.hedgeRatio).toBeCloseTo(expectedBeta, 6);
    expect(r.olsHedgeRatio).toBeCloseTo(1.2, 6);
    expect(r.intercept).toBeCloseTo(2.5 - expectedBeta * 1.5, 6);
    expect(r.sampleSize).toBe(4);
  });
});
