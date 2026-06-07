import { describe, expect, it } from "bun:test";
import { computeAsymmetricBeta } from "./asymmetric-beta.ts";

const bench = Array.from({ length: 60 }, (_, i) => Math.sin(i * 0.7) * 2); // up & down days
const noise = (i: number) => 0.05 * Math.cos(i * 1.3);

describe("computeAsymmetricBeta", () => {
  it("flags a FAKE market-neutral strategy (flat up, heavy beta down)", () => {
    // ~0 beta on up days, 1.5 beta on down days.
    const strat = bench.map((x, i) => (x < 0 ? 1.5 * x : 0.02 * x) + noise(i));
    const r = computeAsymmetricBeta({ strategyReturns: strat, benchmarkReturns: bench });
    expect(r.verdict).toBe("asymmetric_downside");
    expect(r.fakeMarketNeutral).toBe(true);
    expect(r.betaDown).toBeGreaterThan(1);
    expect(r.betaUp).toBeLessThan(0.1);
    expect(Math.abs(r.betaDiffT)).toBeGreaterThan(2);
  });

  it("calls a genuinely symmetric strategy symmetric", () => {
    const strat = bench.map((x, i) => 0.5 * x + noise(i));
    const r = computeAsymmetricBeta({ strategyReturns: strat, benchmarkReturns: bench });
    expect(r.verdict).toBe("symmetric");
    expect(r.betaUp).toBeCloseTo(0.5, 1);
    expect(r.betaDown).toBeCloseTo(0.5, 1);
  });

  it("calls a benchmark-independent strategy market-neutral", () => {
    const strat = bench.map((_, i) => noise(i));
    const r = computeAsymmetricBeta({ strategyReturns: strat, benchmarkReturns: bench });
    expect(r.verdict).toBe("market_neutral");
    expect(Math.abs(r.betaUp)).toBeLessThan(0.1);
    expect(Math.abs(r.betaDown)).toBeLessThan(0.1);
  });

  it("is insufficient on too little data", () => {
    expect(computeAsymmetricBeta({ strategyReturns: [1, 2, 3], benchmarkReturns: [1, 2, 3] }).verdict).toBe("insufficient");
  });
});
