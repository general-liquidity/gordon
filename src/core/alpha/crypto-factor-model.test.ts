import { describe, expect, it } from "bun:test";
import { computeCryptoFactorModel, type CryptoTokenInput } from "./crypto-factor-model.ts";

/** Base token with neutral characteristics; override per test. */
const tok = (symbol: string, o: Partial<CryptoTokenInput> = {}): CryptoTokenInput => ({
  symbol,
  lookbackReturn: 0,
  marketCap: 1_000_000,
  residualVol: 1,
  fundingRate: 0,
  ...o,
});

const bySym = (r: ReturnType<typeof computeCryptoFactorModel>, s: string) =>
  r!.tokens.find((t) => t.symbol === s)!;

const cov = (a: number[], b: number[]) => {
  const ma = a.reduce((s, v) => s + v, 0) / a.length;
  const mb = b.reduce((s, v) => s + v, 0) / b.length;
  return a.reduce((s, _, i) => s + (a[i]! - ma) * (b[i]! - mb), 0) / a.length;
};

describe("computeCryptoFactorModel", () => {
  it("returns null below the minimum cross-section", () => {
    expect(computeCryptoFactorModel([tok("A"), tok("B")])).toBeNull();
  });

  it("reversal: past losers get the highest exposure (mcap/funding held constant)", () => {
    const r = computeCryptoFactorModel([
      tok("WIN", { lookbackReturn: 0.2 }),
      tok("FLAT", { lookbackReturn: 0.0 }),
      tok("LOSER", { lookbackReturn: -0.2 }),
    ])!;
    expect(bySym(r, "LOSER").exposures.reversal).toBeGreaterThan(
      bySym(r, "FLAT").exposures.reversal,
    );
    expect(bySym(r, "FLAT").exposures.reversal).toBeGreaterThan(bySym(r, "WIN").exposures.reversal);
  });

  it("funding: crowded longs (high funding) get the most negative exposure (contrarian)", () => {
    const r = computeCryptoFactorModel([
      tok("CROWDED", { fundingRate: 0.01 }),
      tok("NEUTRAL", { fundingRate: 0.0 }),
      tok("SHORT", { fundingRate: -0.01 }),
    ])!;
    expect(bySym(r, "CROWDED").exposures.funding).toBeLessThan(bySym(r, "SHORT").exposures.funding);
  });

  it("volatility: high-vol tokens get positive exposure (crypto inverts the low-vol anomaly)", () => {
    const r = computeCryptoFactorModel([
      tok("LOW", { residualVol: 0.2 }),
      tok("MID", { residualVol: 0.6 }),
      tok("HIGH", { residualVol: 1.5 }),
    ])!;
    expect(bySym(r, "HIGH").exposures.volatility).toBeGreaterThan(
      bySym(r, "LOW").exposures.volatility,
    );
  });

  it("quality: genuine on-chain usage gets the highest exposure", () => {
    const r = computeCryptoFactorModel([
      tok("DEAD", { qualityMetrics: [10, 10] }),
      tok("OK", { qualityMetrics: [50, 50] }),
      tok("ALIVE", { qualityMetrics: [200, 200] }),
    ])!;
    expect(bySym(r, "ALIVE").exposures.quality).toBeGreaterThan(bySym(r, "DEAD").exposures.quality);
  });

  it("value: cheap (low mcap/output ratio) gets the highest exposure", () => {
    const r = computeCryptoFactorModel([
      tok("EXPENSIVE", { valuationRatios: [100, 100] }),
      tok("MID", { valuationRatios: [50, 50] }),
      tok("CHEAP", { valuationRatios: [10, 10] }),
    ])!;
    expect(bySym(r, "CHEAP").exposures.value).toBeGreaterThan(
      bySym(r, "EXPENSIVE").exposures.value,
    );
  });

  it("orthogonalization: quality exposure is ⊥ size in the cross-section even when raw quality tracks mcap", () => {
    // quality metric increases with mcap → raw quality correlates with (−size); residualization must remove it.
    const r = computeCryptoFactorModel([
      tok("S", { marketCap: 1e6, qualityMetrics: [1] }),
      tok("M", { marketCap: 1e7, qualityMetrics: [2] }),
      tok("L", { marketCap: 1e8, qualityMetrics: [3] }),
      tok("XL", { marketCap: 1e9, qualityMetrics: [4] }),
    ])!;
    const size = r.tokens.map((t) => t.exposures.size);
    const quality = r.tokens.map((t) => t.exposures.quality);
    expect(Math.abs(cov(size, quality))).toBeLessThan(1e-9);
  });

  it("handles partial on-chain coverage: missing inputs → neutral (0) exposure, flagged", () => {
    const r = computeCryptoFactorModel([
      tok("HASDATA", { qualityMetrics: [100, 100] }),
      tok("NODATA"), // no on-chain
      tok("HASDATA2", { qualityMetrics: [10, 10] }),
    ])!;
    expect(bySym(r, "NODATA").exposures.quality).toBe(0);
    expect(bySym(r, "NODATA").hasOnChain).toBe(false);
    expect(bySym(r, "HASDATA").hasOnChain).toBe(true);
  });

  it("composite ranks tokens and excludes size by default (control only)", () => {
    const r = computeCryptoFactorModel([
      tok("A", { lookbackReturn: -0.3, fundingRate: -0.01 }), // strong reversal + cheap funding
      tok("B", { lookbackReturn: 0.0 }),
      tok("C", { lookbackReturn: 0.3, fundingRate: 0.01 }), // momentum + crowded
    ])!;
    expect(r.tokens[0]!.symbol).toBe("A"); // highest composite first
    expect(r.weights.size).toBe(0);
    // sorted descending
    expect(r.tokens[0]!.composite).toBeGreaterThanOrEqual(r.tokens[r.tokens.length - 1]!.composite);
  });
});
