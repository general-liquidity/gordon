import { describe, expect, test } from "bun:test";
import {
  verifyStrategyClaims,
  formatStrategyClaimVerification,
} from "./strategy-claim-verifier.ts";

// Deterministic PRNG so tests are reproducible
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianFrom(rng: () => number): number {
  // Box-Muller
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function gaussianReturns(n: number, mean: number, std: number, seed: number): number[] {
  const rng = mulberry32(seed);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(mean + std * gaussianFrom(rng));
  return out;
}

/** Short-gamma-like returns: small positive drift most days + occasional large losses. */
function shortGammaReturns(n: number, seed: number): number[] {
  const rng = mulberry32(seed);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (rng() < 0.05) {
      // 5% chance of large loss
      out.push(-0.05 - rng() * 0.05);
    } else {
      out.push(0.001 + rng() * 0.002);
    }
  }
  return out;
}

/** Long-gamma-like returns: small drift most days + occasional large gains. */
function longGammaReturns(n: number, seed: number): number[] {
  const rng = mulberry32(seed);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (rng() < 0.05) {
      out.push(0.05 + rng() * 0.05);
    } else {
      out.push(-0.0005 - rng() * 0.001);
    }
  }
  return out;
}

describe("verifyStrategyClaims", () => {
  test("insufficient periods → insufficient_data", () => {
    const r = verifyStrategyClaims({
      strategyReturns: Array(30).fill(0.001),
      claims: { sharpe: 1.5 },
    });
    expect(r.verdict).toBe("insufficient_data");
  });

  test("no claims set → insufficient_data verdict but stats computed", () => {
    const r = verifyStrategyClaims({
      strategyReturns: gaussianReturns(252, 0.0005, 0.01, 1),
      claims: {},
    });
    expect(r.verdict).toBe("insufficient_data");
    expect(r.realized.annualizedSharpe).not.toBe(0);
  });

  test("market-neutral claim with zero-beta returns → consistent", () => {
    const benchmark = gaussianReturns(252, 0.0005, 0.012, 1);
    const strategy = gaussianReturns(252, 0.0004, 0.008, 2);
    // Strategy is uncorrelated with benchmark by construction
    const r = verifyStrategyClaims({
      strategyReturns: strategy,
      benchmarkReturns: benchmark,
      claims: { beta: 0 },
    });
    expect(r.checks.length).toBe(1);
    const betaCheck = r.checks[0]!;
    expect(betaCheck.claim).toBe("beta");
    // Won't be exactly zero from random data but should be small
    expect(Math.abs(parseFloat(betaCheck.realizedValue))).toBeLessThan(0.20);
  });

  test("market-neutral claim with hidden beta → inconsistent", () => {
    const benchmark = gaussianReturns(252, 0.0005, 0.012, 1);
    // Strategy carries 0.5 beta to benchmark
    const strategy = benchmark.map(
      (b, i) => 0.5 * b + 0.005 * (mulberry32(99 + i)() - 0.5),
    );
    const r = verifyStrategyClaims({
      strategyReturns: strategy,
      benchmarkReturns: benchmark,
      claims: { beta: 0 },
    });
    const betaCheck = r.checks.find((c) => c.claim === "beta")!;
    expect(betaCheck.verdict).toBe("inconsistent");
    expect(parseFloat(betaCheck.realizedValue)).toBeGreaterThan(0.3);
  });

  test("short-gamma signature flagged when claiming flat", () => {
    const returns = shortGammaReturns(252, 1);
    const r = verifyStrategyClaims({
      strategyReturns: returns,
      claims: { gammaPosture: "flat" },
    });
    const check = r.checks.find((c) => c.claim === "gammaPosture")!;
    expect(check.verdict).toBe("inconsistent");
    expect(check.realizedValue).toBe("short");
    expect(r.realized.skewness).toBeLessThan(0);
    expect(r.realized.excessKurtosis).toBeGreaterThan(1);
  });

  test("short-gamma claim with short-gamma data → consistent", () => {
    const returns = shortGammaReturns(252, 2);
    const r = verifyStrategyClaims({
      strategyReturns: returns,
      claims: { gammaPosture: "short" },
    });
    const check = r.checks.find((c) => c.claim === "gammaPosture")!;
    expect(check.verdict).toBe("consistent");
  });

  test("long-gamma signature detected", () => {
    const returns = longGammaReturns(252, 3);
    const r = verifyStrategyClaims({
      strategyReturns: returns,
      claims: { gammaPosture: "long" },
    });
    const check = r.checks.find((c) => c.claim === "gammaPosture")!;
    expect(check.verdict).toBe("consistent");
    expect(r.realized.skewness).toBeGreaterThan(0);
  });

  test("flat gamma claim with Gaussian returns → consistent", () => {
    const returns = gaussianReturns(252, 0.0005, 0.01, 4);
    const r = verifyStrategyClaims({
      strategyReturns: returns,
      claims: { gammaPosture: "flat" },
    });
    const check = r.checks.find((c) => c.claim === "gammaPosture")!;
    expect(check.verdict).toBe("consistent");
  });

  test("sharpe claim wildly inflated → inconsistent", () => {
    const returns = gaussianReturns(252, 0.0005, 0.01, 5);
    const r = verifyStrategyClaims({
      strategyReturns: returns,
      claims: { sharpe: 5.0 }, // way higher than realized ~0.8
    });
    const check = r.checks.find((c) => c.claim === "sharpe")!;
    expect(check.verdict).toBe("inconsistent");
  });

  test("max drawdown claim much lower than realized → inconsistent", () => {
    // Generate returns with a known severe drawdown
    const returns: number[] = [];
    // 50 days of small gains
    for (let i = 0; i < 50; i++) returns.push(0.001);
    // 30 days of severe losses (~30% drawdown total)
    for (let i = 0; i < 30; i++) returns.push(-0.015);
    // Recovery period
    for (let i = 0; i < 200; i++) returns.push(0.001);
    const r = verifyStrategyClaims({
      strategyReturns: returns,
      claims: { maxDrawdown: 0.05 }, // claimed 5%; realized much worse
    });
    const check = r.checks.find((c) => c.claim === "maxDrawdown")!;
    expect(check.verdict).toBe("inconsistent");
    expect(r.realized.maxDrawdown).toBeGreaterThan(0.20);
  });

  test("holding period claim with high autocorrelation → consistent long hold", () => {
    // Persistent series: each return mostly follows the previous
    const returns: number[] = [];
    let prev = 0.001;
    const rng = mulberry32(7);
    for (let i = 0; i < 252; i++) {
      const next = 0.8 * prev + 0.2 * (0.001 + 0.005 * (rng() - 0.5));
      returns.push(next);
      prev = next;
    }
    const r = verifyStrategyClaims({
      strategyReturns: returns,
      claims: { holdingPeriodPeriods: 5 },
    });
    const check = r.checks.find((c) => c.claim === "holdingPeriodPeriods")!;
    // Implied period should be > 1
    expect(r.realized.autocorrelation).toBeGreaterThan(0.3);
  });

  test("all-consistent verdict when every check passes", () => {
    const benchmark = gaussianReturns(252, 0.0005, 0.012, 1);
    const strategy = gaussianReturns(252, 0.0004, 0.01, 8);
    const r = verifyStrategyClaims({
      strategyReturns: strategy,
      benchmarkReturns: benchmark,
      claims: {
        beta: 0,
        gammaPosture: "flat",
        sharpe: 0.6, // realistic
        maxDrawdown: 0.5, // very loose claim
      },
      betaTolerance: 0.20,
      sharpeTolerance: 1.0, // very loose
      drawdownTolerance: 1.0,
    });
    expect(r.verdict).toBe("all_consistent");
  });

  test("major_inconsistencies when multiple claims fail", () => {
    const returns = shortGammaReturns(252, 9);
    const r = verifyStrategyClaims({
      strategyReturns: returns,
      claims: {
        gammaPosture: "long", // wrong; it's short
        sharpe: 5.0, // wrong; realized is different
        maxDrawdown: 0.01, // wrong; realized is worse
      },
    });
    expect(r.inconsistentCount).toBeGreaterThanOrEqual(2);
    expect(r.verdict).toBe("major_inconsistencies");
  });

  test("missing benchmark for beta claim → missing_input", () => {
    const returns = gaussianReturns(252, 0.0005, 0.01, 10);
    const r = verifyStrategyClaims({
      strategyReturns: returns,
      claims: { beta: 0 },
    });
    const check = r.checks.find((c) => c.claim === "beta")!;
    expect(check.verdict).toBe("missing_input");
  });

  test("annualization factor respected (crypto 365 vs equity 252)", () => {
    const returns = gaussianReturns(252, 0.0005, 0.01, 11);
    const equity = verifyStrategyClaims({
      strategyReturns: returns,
      claims: { sharpe: 0.5 },
      annualizationFactor: 252,
    });
    const crypto = verifyStrategyClaims({
      strategyReturns: returns,
      claims: { sharpe: 0.5 },
      annualizationFactor: 365,
    });
    // Crypto Sharpe larger by sqrt(365/252) ≈ 1.20
    expect(crypto.realized.annualizedSharpe).toBeGreaterThan(equity.realized.annualizedSharpe);
  });

  test("Tom's basis-trader hidden-beta example", () => {
    // Strategy claims market-neutral but actually carries 0.4 beta
    const benchmark = gaussianReturns(252, 0.0005, 0.012, 1);
    const strategy = benchmark.map(
      (b, i) => 0.4 * b + 0.003 * (mulberry32(123 + i)() - 0.5),
    );
    const r = verifyStrategyClaims({
      strategyReturns: strategy,
      benchmarkReturns: benchmark,
      claims: { beta: 0, gammaPosture: "flat" },
    });
    const betaCheck = r.checks.find((c) => c.claim === "beta")!;
    expect(betaCheck.verdict).toBe("inconsistent");
    expect(parseFloat(betaCheck.realizedValue)).toBeGreaterThan(0.25);
  });
});

describe("formatStrategyClaimVerification", () => {
  test("renders sample size + realized stats + checks", () => {
    const benchmark = gaussianReturns(252, 0.0005, 0.012, 1);
    const strategy = benchmark.map((b) => 0.5 * b);
    const r = verifyStrategyClaims({
      strategyReturns: strategy,
      benchmarkReturns: benchmark,
      claims: { beta: 0 },
    });
    const text = formatStrategyClaimVerification(r);
    expect(text).toContain("Strategy-Claim Verifier");
    expect(text).toContain("Sample size:");
    expect(text).toContain("Realized stats:");
    expect(text).toContain("beta");
  });

  test("renders warning banner on major_inconsistencies", () => {
    const returns = shortGammaReturns(252, 11);
    const r = verifyStrategyClaims({
      strategyReturns: returns,
      claims: {
        gammaPosture: "long",
        sharpe: 5.0,
        maxDrawdown: 0.001,
      },
    });
    const text = formatStrategyClaimVerification(r);
    if (r.verdict === "major_inconsistencies") {
      expect(text).toContain("Multiple claims contradict the data");
    }
  });
});
