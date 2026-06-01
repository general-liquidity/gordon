import { describe, expect, test } from "bun:test";
import { computeForensicScores, type ForensicYearInput } from "./forensic-accounting.ts";

// A coherent single-year statement. With current == prior and netIncome == cfo,
// every Beneish ratio is 1 and TATA is 0, so M reduces to the constant
// -4.84 + 0.92 + 0.528 + 0.404 + 0.892 + 0.115 - 0.172 - 0.327 = -2.48.
const base: ForensicYearInput = {
  sales: 1200,
  cogs: 700,
  sga: 200,
  netIncome: 100,
  cfo: 100,
  receivables: 150,
  currentAssets: 600,
  currentLiabilities: 200,
  ppeNet: 300,
  depreciation: 50,
  totalAssets: 1000,
  totalLiabilities: 400,
  longTermDebt: 150,
  retainedEarnings: 400,
  ebit: 150,
  marketCap: 2000,
  sharesOutstanding: 100,
};

describe("Beneish M-Score", () => {
  test("identical years with NI=CFO reduce to the -2.48 constant (clean)", () => {
    const r = computeForensicScores({ current: base, prior: base });
    expect(r.beneishM.score!).toBeCloseTo(-2.48, 2);
    expect(r.beneishM.flag).toBe(false);
  });

  test("inflated accruals (NI >> CFO) push M above the -2.22 cutoff → flag", () => {
    const r = computeForensicScores({ current: { ...base, netIncome: 250, cfo: 50 }, prior: base });
    // TATA = (250-50)/1000 = 0.2 → M = -2.48 + 4.679*0.2 ≈ -1.54.
    expect(r.beneishM.score!).toBeCloseTo(-1.54, 1);
    expect(r.beneishM.flag).toBe(true);
    expect(r.verdict).toBe("INVESTIGATE");
  });

  test("null without a prior year", () => {
    const r = computeForensicScores({ current: base });
    expect(r.beneishM.score).toBeNull();
  });
});

describe("Altman Z-Score", () => {
  test("computes the weighted distress score and zone", () => {
    const r = computeForensicScores({ current: base });
    // 1.2*0.4 + 1.4*0.4 + 3.3*0.15 + 0.6*5 + 1.0*1.2 = 5.735
    expect(r.altmanZ.score!).toBeCloseTo(5.735, 2);
    expect(r.altmanZ.zone).toBe("safe");
  });

  test("distress zone when below 1.81", () => {
    const distressed: ForensicYearInput = {
      ...base,
      retainedEarnings: -200,
      ebit: -50,
      marketCap: 100,
      totalLiabilities: 900,
      currentAssets: 150,
      currentLiabilities: 400,
    };
    const r = computeForensicScores({ current: distressed });
    expect(r.altmanZ.zone).toBe("distress");
  });
});

describe("Piotroski F-Score", () => {
  const improvingPrior = base;
  const improvingCurrent: ForensicYearInput = {
    ...base,
    sales: 1230,
    netIncome: 110,
    cfo: 130,
    currentAssets: 620,
    currentLiabilities: 195,
    longTermDebt: 140,
    sharesOutstanding: 98,
  };

  test("a strengthening company scores high", () => {
    const r = computeForensicScores({ current: improvingCurrent, prior: improvingPrior });
    expect(r.piotroskiF.score).toBe(9);
  });

  test("a deteriorating company scores low and flags", () => {
    const r = computeForensicScores({ current: improvingPrior, prior: improvingCurrent });
    expect(r.piotroskiF.score!).toBeLessThanOrEqual(4);
  });
});

describe("Sloan accruals", () => {
  test("clean when earnings are backed by cash", () => {
    const r = computeForensicScores({ current: { ...base, netIncome: 100, cfo: 40 } });
    expect(r.sloanAccruals.ratio!).toBeCloseTo(0.06, 6);
    expect(r.sloanAccruals.flag).toBe(false);
  });

  test("flags when accruals exceed 25% of assets", () => {
    const r = computeForensicScores({ current: { ...base, netIncome: 300, cfo: 20 } });
    expect(r.sloanAccruals.ratio!).toBeCloseTo(0.28, 6);
    expect(r.sloanAccruals.flag).toBe(true);
  });
});

describe("verdict + null-safety", () => {
  test("a clean, strengthening company verdicts CLEAN", () => {
    const r = computeForensicScores({
      current: {
        ...base,
        sales: 1230,
        netIncome: 110,
        cfo: 130,
        currentAssets: 620,
        currentLiabilities: 195,
        longTermDebt: 140,
        sharesOutstanding: 98,
      },
      prior: base,
    });
    expect(r.beneishM.flag).toBe(false);
    expect(r.altmanZ.zone).toBe("safe");
    expect(r.piotroskiF.score).toBe(9);
    expect(r.sloanAccruals.flag).toBe(false);
    expect(r.verdict).toBe("CLEAN");
  });

  test("no data → every score null, verdict INSUFFICIENT", () => {
    const r = computeForensicScores({ current: {} });
    expect(r.beneishM.score).toBeNull();
    expect(r.altmanZ.score).toBeNull();
    expect(r.piotroskiF.score).toBeNull();
    expect(r.sloanAccruals.ratio).toBeNull();
    expect(r.verdict).toBe("INSUFFICIENT");
    expect(r.interpretation).toContain("Insufficient");
  });

  test("partial inputs (Altman only) still verdict cleanly", () => {
    const r = computeForensicScores({
      current: {
        currentAssets: 600,
        currentLiabilities: 200,
        totalAssets: 1000,
        retainedEarnings: 400,
        ebit: 150,
        marketCap: 2000,
        totalLiabilities: 400,
        sales: 1200,
      },
    });
    expect(r.altmanZ.score!).toBeGreaterThan(2.99);
    expect(r.beneishM.score).toBeNull();
    expect(r.verdict).toBe("CLEAN");
  });
});
