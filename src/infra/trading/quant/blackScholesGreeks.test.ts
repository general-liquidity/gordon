import { describe, it, expect } from "bun:test";
import {
  isBlackScholesGreeksEnabled,
  computeBlackScholesGreeks,
  blackScholesGreeksToPayload,
  BLACK_SCHOLES_GREEKS_FLAG_ENV,
} from "./blackScholesGreeks.ts";

describe("isBlackScholesGreeksEnabled", () => {
  it("respects the flag", () => {
    expect(isBlackScholesGreeksEnabled({})).toBe(false);
    expect(
      isBlackScholesGreeksEnabled({ [BLACK_SCHOLES_GREEKS_FLAG_ENV]: "1" }),
    ).toBe(true);
  });
});

// Reference values cross-checked against Hull (2017) "Options, Futures,
// and Other Derivatives" Ch 15 examples + multiple online BS calculators.
describe("computeBlackScholesGreeks — Hull Ch 15 example", () => {
  // S=42, K=40, T=0.5, r=0.10, σ=0.20, q=0, call
  // Reference: C ≈ 4.7594, Δ_call ≈ 0.7791
  const input = {
    spot: 42,
    strike: 40,
    timeYears: 0.5,
    rate: 0.1,
    volatility: 0.2,
    optionType: "call" as const,
  };

  it("call price matches Hull within 0.0005", () => {
    const r = computeBlackScholesGreeks(input);
    expect(r.price).toBeCloseTo(4.7594, 3);
  });

  it("call delta matches Hull within 0.001", () => {
    const r = computeBlackScholesGreeks(input);
    expect(r.delta).toBeCloseTo(0.7791, 3);
  });

  it("d1, d2 match Hull within 0.001", () => {
    const r = computeBlackScholesGreeks(input);
    // d1 ≈ 0.7693, d2 ≈ 0.6278
    expect(r.d1).toBeCloseTo(0.7693, 3);
    expect(r.d2).toBeCloseTo(0.6278, 3);
  });
});

describe("computeBlackScholesGreeks — put-call parity", () => {
  it("C - P = S e^(-qT) - K e^(-rT)", () => {
    const params = {
      spot: 100,
      strike: 100,
      timeYears: 1,
      rate: 0.05,
      volatility: 0.2,
      dividendYield: 0.02,
    };
    const call = computeBlackScholesGreeks({
      ...params,
      optionType: "call",
    });
    const put = computeBlackScholesGreeks({
      ...params,
      optionType: "put",
    });
    const parity =
      params.spot * Math.exp(-params.dividendYield * params.timeYears) -
      params.strike * Math.exp(-params.rate * params.timeYears);
    expect(call.price - put.price).toBeCloseTo(parity, 6);
  });

  it("Δ_call − Δ_put = e^(-qT)", () => {
    const params = {
      spot: 100,
      strike: 95,
      timeYears: 0.25,
      rate: 0.03,
      volatility: 0.3,
      dividendYield: 0.01,
    };
    const c = computeBlackScholesGreeks({ ...params, optionType: "call" });
    const p = computeBlackScholesGreeks({ ...params, optionType: "put" });
    expect(c.delta - p.delta).toBeCloseTo(
      Math.exp(-params.dividendYield * params.timeYears),
      8,
    );
  });

  it("Γ_call = Γ_put", () => {
    const params = {
      spot: 105,
      strike: 100,
      timeYears: 0.4,
      rate: 0.04,
      volatility: 0.25,
    };
    const c = computeBlackScholesGreeks({ ...params, optionType: "call" });
    const p = computeBlackScholesGreeks({ ...params, optionType: "put" });
    expect(c.gamma).toBeCloseTo(p.gamma, 10);
  });

  it("Vega_call = Vega_put", () => {
    const params = {
      spot: 50,
      strike: 50,
      timeYears: 1,
      rate: 0.05,
      volatility: 0.3,
    };
    const c = computeBlackScholesGreeks({ ...params, optionType: "call" });
    const p = computeBlackScholesGreeks({ ...params, optionType: "put" });
    expect(c.vega).toBeCloseTo(p.vega, 10);
  });
});

describe("computeBlackScholesGreeks — ATM behavior", () => {
  it("ATM (S=K) zero-rate zero-dividend: Δ_call ≈ 0.5 + small drift", () => {
    const r = computeBlackScholesGreeks({
      spot: 100,
      strike: 100,
      timeYears: 1,
      rate: 0,
      volatility: 0.2,
      optionType: "call",
    });
    // d1 = (0.5 × 0.04) / 0.2 = 0.1, N(0.1) ≈ 0.5398
    expect(r.delta).toBeCloseTo(0.5398, 3);
  });

  it("ATM call price > 0 and < spot", () => {
    const r = computeBlackScholesGreeks({
      spot: 100,
      strike: 100,
      timeYears: 1,
      rate: 0.03,
      volatility: 0.2,
      optionType: "call",
    });
    expect(r.price).toBeGreaterThan(0);
    expect(r.price).toBeLessThan(100);
  });
});

describe("computeBlackScholesGreeks — deep ITM / OTM", () => {
  it("deep ITM call: Δ → 1, price → S − Ke^(-rT)", () => {
    const r = computeBlackScholesGreeks({
      spot: 200,
      strike: 100,
      timeYears: 0.25,
      rate: 0.05,
      volatility: 0.2,
      optionType: "call",
    });
    expect(r.delta).toBeGreaterThan(0.99);
    const lowerBound = 200 - 100 * Math.exp(-0.05 * 0.25);
    expect(r.price).toBeGreaterThan(lowerBound - 0.001);
  });

  it("deep OTM call: Δ → 0, price → 0", () => {
    const r = computeBlackScholesGreeks({
      spot: 50,
      strike: 200,
      timeYears: 0.1,
      rate: 0.05,
      volatility: 0.2,
      optionType: "call",
    });
    expect(r.delta).toBeLessThan(0.001);
    expect(r.price).toBeLessThan(0.01);
  });

  it("deep ITM put: Δ → -1", () => {
    const r = computeBlackScholesGreeks({
      spot: 50,
      strike: 200,
      timeYears: 0.25,
      rate: 0.05,
      volatility: 0.2,
      optionType: "put",
    });
    expect(r.delta).toBeLessThan(-0.99);
  });
});

describe("computeBlackScholesGreeks — expiry / boundary", () => {
  it("T=0 call: intrinsic; Greeks NaN", () => {
    const r = computeBlackScholesGreeks({
      spot: 110,
      strike: 100,
      timeYears: 0,
      rate: 0.05,
      volatility: 0.2,
      optionType: "call",
    });
    expect(r.price).toBe(10);
    expect(Number.isNaN(r.delta)).toBe(true);
  });

  it("T=0 put OTM: intrinsic 0", () => {
    const r = computeBlackScholesGreeks({
      spot: 110,
      strike: 100,
      timeYears: 0,
      rate: 0.05,
      volatility: 0.2,
      optionType: "put",
    });
    expect(r.price).toBe(0);
  });
});

describe("computeBlackScholesGreeks — validation", () => {
  const ok = {
    spot: 100,
    strike: 100,
    timeYears: 1,
    rate: 0.05,
    volatility: 0.2,
    optionType: "call" as const,
  };
  it("throws on non-positive spot", () => {
    expect(() => computeBlackScholesGreeks({ ...ok, spot: 0 })).toThrow();
  });
  it("throws on non-positive strike", () => {
    expect(() => computeBlackScholesGreeks({ ...ok, strike: 0 })).toThrow();
  });
  it("throws on negative T", () => {
    expect(() =>
      computeBlackScholesGreeks({ ...ok, timeYears: -1 }),
    ).toThrow();
  });
  it("throws on non-positive sigma", () => {
    expect(() =>
      computeBlackScholesGreeks({ ...ok, volatility: 0 }),
    ).toThrow();
  });
});

describe("blackScholesGreeksToPayload", () => {
  it("emits stable shape with conventional vega/theta/rho forms", () => {
    const r = computeBlackScholesGreeks({
      spot: 100,
      strike: 100,
      timeYears: 1,
      rate: 0.05,
      volatility: 0.2,
      optionType: "call",
    });
    const p = blackScholesGreeksToPayload(r, "call") as {
      kind: string;
      vegaPerPercent: number;
      thetaPerDay: number;
    };
    expect(p.kind).toBe("black_scholes_greeks.computed");
    expect(typeof p.vegaPerPercent).toBe("number");
    expect(typeof p.thetaPerDay).toBe("number");
  });

  it("encodes NaN Greeks (T=0) as null", () => {
    const r = computeBlackScholesGreeks({
      spot: 110,
      strike: 100,
      timeYears: 0,
      rate: 0.05,
      volatility: 0.2,
      optionType: "call",
    });
    const p = blackScholesGreeksToPayload(r, "call") as { delta: number | null };
    expect(p.delta).toBeNull();
  });
});

// ----------------------------------------------------------------------------
// Implied-volatility inversion
// ----------------------------------------------------------------------------
import { impliedVolatility } from "./blackScholesGreeks.ts";

describe("impliedVolatility — round-trip recovery", () => {
  it("recovers a known call sigma within 1e-4", () => {
    const knownSigma = 0.27;
    const params = {
      spot: 100,
      strike: 105,
      timeYears: 0.5,
      rate: 0.03,
      volatility: knownSigma,
      dividendYield: 0.01,
      optionType: "call" as const,
    };
    const priced = computeBlackScholesGreeks(params);
    const r = impliedVolatility({
      marketPrice: priced.price,
      spot: 100,
      strike: 105,
      timeToExpiry: 0.5,
      riskFreeRate: 0.03,
      dividendYield: 0.01,
      optionType: "call",
    });
    expect(r.iv).not.toBeNull();
    expect(r.iv!).toBeCloseTo(knownSigma, 4);
    expect(r.method).toBe("newton");
  });

  it("recovers a known put sigma within 1e-4", () => {
    const knownSigma = 0.42;
    const priced = computeBlackScholesGreeks({
      spot: 80,
      strike: 75,
      timeYears: 1.25,
      rate: 0.05,
      volatility: knownSigma,
      optionType: "put",
    });
    const r = impliedVolatility({
      marketPrice: priced.price,
      spot: 80,
      strike: 75,
      timeToExpiry: 1.25,
      riskFreeRate: 0.05,
      optionType: "put",
    });
    expect(r.iv).not.toBeNull();
    expect(r.iv!).toBeCloseTo(knownSigma, 4);
  });

  it("ATM call converges", () => {
    const known = 0.2;
    const priced = computeBlackScholesGreeks({
      spot: 100,
      strike: 100,
      timeYears: 1,
      rate: 0.04,
      volatility: known,
      optionType: "call",
    });
    const r = impliedVolatility({
      marketPrice: priced.price,
      spot: 100,
      strike: 100,
      timeToExpiry: 1,
      riskFreeRate: 0.04,
      optionType: "call",
    });
    expect(r.iv).not.toBeNull();
    expect(r.iv!).toBeCloseTo(known, 4);
  });

  it("deep-ITM call converges (vega tiny -> bisection still recovers)", () => {
    const known = 0.35;
    const priced = computeBlackScholesGreeks({
      spot: 200,
      strike: 100,
      timeYears: 0.25,
      rate: 0.05,
      volatility: known,
      optionType: "call",
    });
    const r = impliedVolatility({
      marketPrice: priced.price,
      spot: 200,
      strike: 100,
      timeToExpiry: 0.25,
      riskFreeRate: 0.05,
      optionType: "call",
    });
    expect(r.iv).not.toBeNull();
    expect(r.iv!).toBeCloseTo(known, 4);
    expect(["newton", "bisection"]).toContain(r.method);
  });
});

describe("impliedVolatility — failure modes", () => {
  it("below-intrinsic price returns null/failed", () => {
    // Intrinsic-ish lower bound for this ITM call is well above 1.0
    const r = impliedVolatility({
      marketPrice: 1.0,
      spot: 200,
      strike: 100,
      timeToExpiry: 0.25,
      riskFreeRate: 0.05,
      optionType: "call",
    });
    expect(r.iv).toBeNull();
    expect(r.method).toBe("failed");
  });

  it("non-positive spot returns null/failed", () => {
    const r = impliedVolatility({
      marketPrice: 5,
      spot: 0,
      strike: 100,
      timeToExpiry: 0.5,
      riskFreeRate: 0.03,
      optionType: "call",
    });
    expect(r.iv).toBeNull();
    expect(r.method).toBe("failed");
  });

  it("zero time-to-expiry returns null/failed", () => {
    const r = impliedVolatility({
      marketPrice: 5,
      spot: 100,
      strike: 100,
      timeToExpiry: 0,
      riskFreeRate: 0.03,
      optionType: "call",
    });
    expect(r.iv).toBeNull();
    expect(r.method).toBe("failed");
  });
});

describe("second-order Greeks — vanna / charm / vomma", () => {
  const base = {
    spot: 100, strike: 105, timeYears: 0.5, rate: 0.03,
    volatility: 0.25, dividendYield: 0.01, optionType: "call" as const,
  };
  const h = 1e-5;
  const bump = (k: "volatility" | "timeYears", dv: number) =>
    computeBlackScholesGreeks({ ...base, [k]: base[k] + dv });

  it("vanna matches ∂Δ/∂σ by finite difference", () => {
    const g = computeBlackScholesGreeks(base);
    const fd = (bump("volatility", h).delta - bump("volatility", -h).delta) / (2 * h);
    expect(g.vanna).toBeCloseTo(fd, 4);
  });

  it("vomma matches ∂ν/∂σ by finite difference", () => {
    const g = computeBlackScholesGreeks(base);
    const fd = (bump("volatility", h).vega - bump("volatility", -h).vega) / (2 * h);
    expect(g.vomma).toBeCloseTo(fd, 2);
  });

  it("charm matches −∂Δ/∂T (calendar-forward delta decay)", () => {
    const g = computeBlackScholesGreeks(base);
    const fd = -(bump("timeYears", h).delta - bump("timeYears", -h).delta) / (2 * h);
    expect(g.charm).toBeCloseTo(fd, 4);
  });

  it("vanna and vomma are call/put symmetric; charm carries an option-type term", () => {
    const call = computeBlackScholesGreeks(base);
    const put = computeBlackScholesGreeks({ ...base, optionType: "put" });
    expect(put.vanna).toBeCloseTo(call.vanna, 10);
    expect(put.vomma).toBeCloseTo(call.vomma, 10);
    expect(Math.abs(put.charm - call.charm)).toBeGreaterThan(1e-6);
  });

  it("payload surfaces vanna/charm/vomma in raw + conventional forms", () => {
    const g = computeBlackScholesGreeks(base);
    const p = blackScholesGreeksToPayload(g, "call") as Record<string, number>;
    expect(p.vannaPerOneVol).toBeCloseTo(g.vanna, 5);
    expect(p.vannaPerPercent).toBeCloseTo(g.vanna / 100, 8);
    expect(p.charmPerDay).toBeCloseTo(g.charm / 365, 8);
    expect(p.vomma).toBeCloseTo(g.vomma, 5);
  });

  it("returns NaN second-order Greeks at expiry", () => {
    const g = computeBlackScholesGreeks({ ...base, timeYears: 0 });
    expect(g.vanna).toBeNaN();
    expect(g.charm).toBeNaN();
    expect(g.vomma).toBeNaN();
  });
});
