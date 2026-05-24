import { describe, expect, test } from "bun:test";
import {
  verifyHiddenBeta,
  formatHiddenBetaVerifier,
} from "./hidden-beta-verifier.ts";
import type { FactorSeries } from "../../infra/trading/quant/hedgeFundReplication.ts";

function genReturns(seed: number, n: number, mean = 0, vol = 0.01): number[] {
  let x = seed;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    const u1 = (x / 0x7fffffff + 1e-9) % 1;
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    const u2 = (x / 0x7fffffff + 1e-9) % 1;
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    out.push(mean + vol * z);
  }
  return out;
}

function addSeries(a: number[], b: number[], scale = 1): number[] {
  const n = Math.min(a.length, b.length);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(a[i]! + scale * b[i]!);
  return out;
}

describe("verifyHiddenBeta", () => {
  test("no factors → insufficient_data", () => {
    const r = verifyHiddenBeta({
      portfolioReturns: genReturns(1, 50),
      factors: [],
    });
    expect(r.verdict).toBe("insufficient_data");
  });

  test("sample too small → insufficient_data", () => {
    const r = verifyHiddenBeta({
      portfolioReturns: genReturns(1, 10),
      factors: [{ id: "BTC", returns: genReturns(2, 10) }],
    });
    expect(r.verdict).toBe("insufficient_data");
  });

  test("truly independent portfolio → factor_neutral", () => {
    // Large n to keep OLS finite-sample noise below the 0.10 threshold.
    const btc = genReturns(101, 1000);
    const alts = genReturns(102, 1000);
    const portfolio = genReturns(999, 1000); // independent
    const r = verifyHiddenBeta({
      portfolioReturns: portfolio,
      factors: [
        { id: "BTC", returns: btc },
        { id: "ALTS", returns: alts },
      ],
    });
    expect(r.verdict).toBe("factor_neutral");
    expect(r.leakingFactors.length).toBe(0);
  });

  test("portfolio = 0.6 × BTC + noise → hidden_beta_single on BTC", () => {
    const btc = genReturns(101, 200);
    const alts = genReturns(102, 200);
    const noise = genReturns(999, 200, 0, 0.005);
    const portfolio = addSeries(noise, btc, 0.6);
    const r = verifyHiddenBeta({
      portfolioReturns: portfolio,
      factors: [
        { id: "BTC", returns: btc },
        { id: "ALTS", returns: alts },
      ],
    });
    expect(r.verdict).toBe("hidden_beta_single");
    expect(r.leakingFactors).toContain("BTC");
    const btcCheck = r.perFactor.find((p) => p.factorId === "BTC")!;
    expect(btcCheck.beta).toBeCloseTo(0.6, 1);
    expect(btcCheck.exceedsThreshold).toBe(true);
  });

  test("portfolio = 0.4 × BTC + 0.3 × ALTS → hidden_beta_multiple", () => {
    const btc = genReturns(101, 200);
    const alts = genReturns(102, 200);
    const noise = genReturns(999, 200, 0, 0.003);
    const portfolio = addSeries(
      addSeries(noise, btc, 0.4),
      alts,
      0.3,
    );
    const r = verifyHiddenBeta({
      portfolioReturns: portfolio,
      factors: [
        { id: "BTC", returns: btc },
        { id: "ALTS", returns: alts },
      ],
    });
    expect(r.verdict).toBe("hidden_beta_multiple");
    expect(r.leakingFactors).toContain("BTC");
    expect(r.leakingFactors).toContain("ALTS");
  });

  test("threshold can be tightened to flag previously-clean portfolios", () => {
    // Inject β=0.07 — within default ±0.10 tolerance, but outside ±0.05.
    // Large n to ensure the estimate is close to the injected value.
    const btc = genReturns(101, 1000);
    const noise = genReturns(999, 1000, 0, 0.005);
    const portfolio = addSeries(noise, btc, 0.07);
    const lax = verifyHiddenBeta({
      portfolioReturns: portfolio,
      factors: [{ id: "BTC", returns: btc }],
    });
    const strict = verifyHiddenBeta({
      portfolioReturns: portfolio,
      factors: [{ id: "BTC", returns: btc }],
      hiddenBetaThreshold: 0.05,
    });
    expect(lax.verdict).toBe("factor_neutral");
    expect(strict.verdict).toBe("hidden_beta_single");
  });

  test("estimated alpha leak signed by β × factor mean", () => {
    // Factor with positive mean drift; β = 0.5 → positive leak
    const factor = genReturns(101, 200, 0.001, 0.01); // mean +10bps/day
    const noise = genReturns(999, 200, 0, 0.003);
    const portfolio = addSeries(noise, factor, 0.5);
    const r = verifyHiddenBeta({
      portfolioReturns: portfolio,
      factors: [{ id: "F", returns: factor }],
    });
    const check = r.perFactor.find((p) => p.factorId === "F")!;
    expect(check.estimatedAlphaLeak).toBeGreaterThan(0);
  });

  test("neutralityConfidence in [0, 1]", () => {
    const btc = genReturns(101, 200);
    const noise = genReturns(999, 200, 0, 0.005);
    const portfolios = [
      genReturns(7, 200), // independent
      addSeries(noise, btc, 0.05), // small β
      addSeries(noise, btc, 0.5), // large β
    ];
    for (const p of portfolios) {
      const r = verifyHiddenBeta({
        portfolioReturns: p,
        factors: [{ id: "BTC", returns: btc }],
      });
      expect(r.neutralityConfidence).toBeGreaterThanOrEqual(0);
      expect(r.neutralityConfidence).toBeLessThanOrEqual(1);
    }
  });

  test("factor-explained R² is reported and in [0, 1]", () => {
    const btc = genReturns(101, 200);
    const noise = genReturns(999, 200, 0, 0.003);
    const portfolio = addSeries(noise, btc, 0.8);
    const r = verifyHiddenBeta({
      portfolioReturns: portfolio,
      factors: [{ id: "BTC", returns: btc }],
    });
    expect(r.factorExplainedRSquared).toBeGreaterThanOrEqual(0);
    expect(r.factorExplainedRSquared).toBeLessThanOrEqual(1);
    expect(r.residualVarianceFraction).toBeCloseTo(
      1 - r.factorExplainedRSquared,
      6,
    );
  });

  test("perFactor preserves factor ordering from input", () => {
    const btc = genReturns(101, 100);
    const alts = genReturns(102, 100);
    const spy = genReturns(103, 100);
    const r = verifyHiddenBeta({
      portfolioReturns: genReturns(999, 100),
      factors: [
        { id: "BTC", returns: btc },
        { id: "ALTS", returns: alts },
        { id: "SPY", returns: spy },
      ],
    });
    expect(r.perFactor.length).toBe(3);
    const ids = r.perFactor.map((p) => p.factorId);
    expect(ids).toContain("BTC");
    expect(ids).toContain("ALTS");
    expect(ids).toContain("SPY");
  });

  test("dirty-carry video scenario: 'neutral' basket actually has 0.6 BTC β", () => {
    // Reproduces the trader's complaint: vol-targeted + dollar-neutral basket
    // still has massive residual BTC exposure
    const btc = genReturns(101, 252); // 1 year of daily returns
    const noise = genReturns(7777, 252, 0, 0.004);
    const supposedlyNeutralBasket = addSeries(noise, btc, 0.6);
    const r = verifyHiddenBeta({
      portfolioReturns: supposedlyNeutralBasket,
      factors: [{ id: "BTC", returns: btc }],
    });
    expect(r.verdict).toBe("hidden_beta_single");
    expect(r.leakingFactors).toContain("BTC");
    expect(r.summary).toContain("HIDDEN BETA");
  });
});

describe("formatHiddenBetaVerifier", () => {
  test("renders verdict + per-factor table with [LEAK] markers", () => {
    const btc = genReturns(101, 200);
    const noise = genReturns(999, 200, 0, 0.003);
    const portfolio = addSeries(noise, btc, 0.6);
    const r = verifyHiddenBeta({
      portfolioReturns: portfolio,
      factors: [{ id: "BTC", returns: btc }],
    });
    const text = formatHiddenBetaVerifier(r);
    expect(text).toContain("Hidden Beta Verifier");
    expect(text).toContain("[LEAK]");
    expect(text).toContain("BTC");
  });

  test("renders [ok] markers when factor-neutral", () => {
    const btc = genReturns(101, 100);
    const portfolio = genReturns(999, 100);
    const r = verifyHiddenBeta({
      portfolioReturns: portfolio,
      factors: [{ id: "BTC", returns: btc }],
    });
    const text = formatHiddenBetaVerifier(r);
    expect(text).toContain("Hidden Beta Verifier");
  });
});
