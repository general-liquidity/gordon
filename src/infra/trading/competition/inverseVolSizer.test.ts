import { describe, it, expect } from "bun:test";
import {
  realizedVol,
  inverseVolSize,
  targetNotionals,
  formatInverseVol,
} from "./inverseVolSizer.ts";

const sumAbs = (w: Record<string, number>): number =>
  Object.values(w).reduce((s, x) => s + Math.abs(x), 0);
const sumNet = (w: Record<string, number>): number =>
  Object.values(w).reduce((s, x) => s + x, 0);

describe("inverseVolSize", () => {
  it("(1) low-vol name gets inversely-proportional weight; Σ|w| = 1", () => {
    // vol 0.1 vs 0.4 → inverse 10 vs 2.5 → weights 0.8 vs 0.2 → 4× ratio.
    const { weights, perRiskContribution } = inverseVolSize({ A: 0.1, B: 0.4 });
    expect(weights.A).toBeCloseTo(0.8, 10);
    expect(weights.B).toBeCloseTo(0.2, 10);
    expect(weights.A! / weights.B!).toBeCloseTo(4, 10);
    expect(sumAbs(weights)).toBeCloseTo(1, 10);
    // Equal risk contribution: 0.8*0.1 == 0.2*0.4 == 0.08 each → 0.5 / 0.5.
    expect(perRiskContribution.A).toBeCloseTo(0.5, 10);
    expect(perRiskContribution.B).toBeCloseTo(0.5, 10);
  });

  it("(2) equal vols → equal weights", () => {
    const { weights } = inverseVolSize({ A: 0.2, B: 0.2, C: 0.2, D: 0.2 });
    for (const s of ["A", "B", "C", "D"]) expect(weights[s]).toBeCloseTo(0.25, 10);
    expect(sumAbs(weights)).toBeCloseTo(1, 10);
  });

  it("(3) longShort signs produce a dollar-neutral book (Σw≈0, Σ|w|=1)", () => {
    // Two equal-vol names, one long one short → +0.5 / −0.5.
    const { weights } = inverseVolSize(
      { A: 0.2, B: 0.2 },
      { longShort: { A: 1, B: -1 } },
    );
    expect(weights.A).toBeCloseTo(0.5, 10);
    expect(weights.B).toBeCloseTo(-0.5, 10);
    expect(sumNet(weights)).toBeCloseTo(0, 10);
    expect(sumAbs(weights)).toBeCloseTo(1, 10);
  });

  it("(3b) unequal-vol long/short still Σ|w|=1; net direction reflects magnitudes", () => {
    // vol 0.1 (long, |w|=0.8) vs vol 0.4 (short, |w|=0.2) → Σw = 0.8 − 0.2 = 0.6.
    const { weights } = inverseVolSize(
      { A: 0.1, B: 0.4 },
      { longShort: { A: 1, B: -1 } },
    );
    expect(weights.A).toBeCloseTo(0.8, 10);
    expect(weights.B).toBeCloseTo(-0.2, 10);
    expect(sumAbs(weights)).toBeCloseTo(1, 10);
    expect(sumNet(weights)).toBeCloseTo(0.6, 10);
  });

  it("(4) maxWeight cap redistributes the excess; Σ|w| stays 1", () => {
    // Without cap: A would be 0.8 (vol 0.1). Cap at 0.5 → A=0.5, remaining 0.5
    // split across B (0.4) and C (0.4) by their inverse-vol (equal) → 0.25 each.
    const { weights } = inverseVolSize(
      { A: 0.1, B: 0.4, C: 0.4 },
      { maxWeight: 0.5 },
    );
    expect(weights.A).toBeCloseTo(0.5, 9);
    expect(weights.B).toBeCloseTo(0.25, 9);
    expect(weights.C).toBeCloseTo(0.25, 9);
    expect(sumAbs(weights)).toBeCloseTo(1, 9);
    // No name exceeds the cap.
    for (const w of Object.values(weights)) expect(Math.abs(w)).toBeLessThanOrEqual(0.5 + 1e-9);
  });

  it("(4b) cap iterates to a fixed point when redistribution overflows another name", () => {
    // Three names, one tiny vol that would dominate; tight cap forces multiple to cap.
    const { weights } = inverseVolSize(
      { A: 0.05, B: 0.1, C: 1.0 },
      { maxWeight: 0.4 },
    );
    expect(sumAbs(weights)).toBeCloseTo(1, 9);
    for (const w of Object.values(weights)) expect(Math.abs(w)).toBeLessThanOrEqual(0.4 + 1e-9);
  });

  it("skips non-finite / non-positive vols", () => {
    const { weights } = inverseVolSize({ A: 0.2, B: 0, C: NaN, D: -0.3, E: 0.2 });
    expect(Object.keys(weights).sort()).toEqual(["A", "E"]);
    expect(weights.A).toBeCloseTo(0.5, 10);
    expect(weights.E).toBeCloseTo(0.5, 10);
  });

  it("empty / all-invalid input returns empty maps", () => {
    expect(inverseVolSize({})).toEqual({ weights: {}, perRiskContribution: {} });
    expect(inverseVolSize({ A: 0, B: NaN })).toEqual({ weights: {}, perRiskContribution: {} });
  });
});

describe("realizedVol", () => {
  it("(5) recovers a known vol on a deterministic synthetic series", () => {
    // Construct constant-magnitude alternating log returns ±k. Then prices are
    // c_t = c_0 * exp(cumulative). Sample std of {+k,−k,+k,…} with mean≈0 is ≈k.
    const k = 0.01;
    const n = 200;
    const closes: number[] = [100];
    for (let i = 1; i < n; i++) {
      const r = i % 2 === 1 ? k : -k;
      closes.push(closes[i - 1]! * Math.exp(r));
    }
    const barsPerYear = 35040; // matches module default (15-min)
    const annual = realizedVol(closes, 64, barsPerYear);

    // Per-bar std of an alternating ±k sequence (n even count, mean 0):
    // sample variance = Σ(r−0)²/(m−1) = m·k²/(m−1) ≈ k². So per-bar ≈ k.
    const expectedAnnual = k * Math.sqrt(barsPerYear);
    // Within 1% — small (m−1) bias on a finite window.
    expect(annual).toBeCloseTo(expectedAnnual, 1);
    expect(Math.abs(annual - expectedAnnual) / expectedAnnual).toBeLessThan(0.01);
  });

  it("returns 0 for degenerate input", () => {
    expect(realizedVol([])).toBe(0);
    expect(realizedVol([100])).toBe(0);
    expect(realizedVol([100, 100, 100, 100])).toBe(0); // zero variance → 0 vol
  });

  it("flat (zero-return) series has zero vol", () => {
    const closes = Array(100).fill(50);
    expect(realizedVol(closes)).toBe(0);
  });

  it("vol ratio is invariant to annualization scale (cross-sectional weights stable)", () => {
    // Two series, one 2× the per-bar magnitude → vol ratio ≈ 2 regardless of scale.
    const mk = (k: number): number[] => {
      const c = [100];
      for (let i = 1; i < 200; i++) c.push(c[i - 1]! * Math.exp(i % 2 ? k : -k));
      return c;
    };
    const vLow = realizedVol(mk(0.005), 64);
    const vHigh = realizedVol(mk(0.01), 64);
    expect(vHigh / vLow).toBeCloseTo(2, 1);
  });
});

describe("targetNotionals", () => {
  it("converts weights → notional and units; signs carry through", () => {
    const weights = { A: 0.8, B: -0.2 };
    const prices = { A: 100, B: 50 };
    const out = targetNotionals(weights, 1_000_000, prices);
    expect(out.A!.notional).toBeCloseTo(800_000, 6);
    expect(out.A!.units).toBeCloseTo(8_000, 6);
    expect(out.B!.notional).toBeCloseTo(-200_000, 6);
    expect(out.B!.units).toBeCloseTo(-4_000, 6);
  });

  it("skips bad prices and bad book notional", () => {
    expect(targetNotionals({ A: 1 }, 0, { A: 100 })).toEqual({});
    const out = targetNotionals({ A: 0.5, B: 0.5 }, 1000, { A: 100, B: 0 });
    expect(Object.keys(out)).toEqual(["A"]);
  });

  it("end-to-end: inverse-vol weights → notionals sum to book gross", () => {
    const { weights } = inverseVolSize({ A: 0.1, B: 0.4 });
    const out = targetNotionals(weights, 1_000_000, { A: 100, B: 200 });
    const gross = Object.values(out).reduce((s, x) => s + Math.abs(x.notional), 0);
    expect(gross).toBeCloseTo(1_000_000, 4);
  });
});

describe("formatInverseVol", () => {
  it("renders a summary and flags dollar-neutral books", () => {
    const vol = { A: 0.2, B: 0.2 };
    const neutral = inverseVolSize(vol, { longShort: { A: 1, B: -1 } });
    const s = formatInverseVol(neutral, vol);
    expect(s).toContain("Inverse-Vol Sizer");
    expect(s).toContain("dollar-neutral");

    const directional = inverseVolSize({ A: 0.1, B: 0.4 });
    expect(formatInverseVol(directional)).toContain("Directional book");

    expect(formatInverseVol({ weights: {}, perRiskContribution: {} })).toContain("no eligible");
  });
});
