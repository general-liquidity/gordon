/**
 * Price-discovery decomposition — Gonzalo-Granger component share + Hasbrouck
 * Information Share (bivariate).
 *
 * For two cointegrated price series of the same asset (two venues, or perp vs
 * spot), answers "which market LEADS in impounding new information?" Method
 * (Hu-Hou-Oxley 2020 / Hasbrouck 1995 / Gonzalo-Granger 1995):
 *
 *   1. Engle-Granger first stage: y1 = c + β·y2 + z  → spread z (cointegration error).
 *   2. Error-correction speeds α via  Δyᵢ = μᵢ + αᵢ·z[t−1] + εᵢ.  The market that
 *      adjusts LESS (αᵢ ≈ 0) is the leader; the other does the catching-up.
 *   3. Gonzalo-Granger component share from α⊥ = (α2, −α1):  CSⱼ = α⊥ⱼ / Σα⊥.
 *   4. Hasbrouck IS from the common factor ψ ∝ α⊥ and the EC-residual covariance
 *      Ω, with Cholesky upper/lower bounds (ordering matters; bounds widen as the
 *      contemporaneous correlation ρ rises — a known property).
 *
 * Only valid when the two series are cointegrated — verify first with the
 * existing `adf_test` / `johansen_cointegration` ops. Pass log prices for the
 * standard interpretation. Pure; never throws.
 */

export interface PriceDiscoveryInput {
  /** Price series for market 1 (e.g. venue A / perp). */
  series1: number[];
  /** Price series for market 2 (e.g. venue B / spot), aligned 1:1 with series1. */
  series2: number[];
  label1?: string;
  label2?: string;
  /** Apply natural log to both series first (standard for price discovery). Default false. */
  applyLog?: boolean;
}

export interface ISBounds {
  lower: number;
  upper: number;
  mid: number;
}

export interface PriceDiscoveryResult {
  label1: string;
  label2: string;
  beta: number;
  alpha1: number;
  alpha2: number;
  innovationCorr: number;
  /** Gonzalo-Granger component shares (sum to 1). */
  componentShare1: number;
  componentShare2: number;
  hasbrouckIS1: ISBounds;
  hasbrouckIS2: ISBounds;
  leader: string;
  confidence: "high" | "low";
  sampleSize: number;
  interpretation: string;
}

const round = (x: number, p = 4): number => parseFloat(x.toFixed(p));

function mean(a: number[]): number {
  let s = 0;
  for (const x of a) s += x;
  return a.length > 0 ? s / a.length : 0;
}

/** OLS y = intercept + slope·x; returns slope, intercept, residuals. */
function ols(x: number[], y: number[]): { slope: number; intercept: number; residuals: number[] } {
  const mx = mean(x);
  const my = mean(y);
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < x.length; i++) {
    const dx = x[i]! - mx;
    sxx += dx * dx;
    sxy += dx * (y[i]! - my);
  }
  const slope = sxx !== 0 ? sxy / sxx : 0;
  const intercept = my - slope * mx;
  const residuals = x.map((xi, i) => y[i]! - (intercept + slope * xi));
  return { slope, intercept, residuals };
}

function variance(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  let s = 0;
  for (const x of a) s += (x - m) * (x - m);
  return s / (a.length - 1);
}

function corr(a: number[], b: number[]): number {
  const va = variance(a);
  const vb = variance(b);
  if (va <= 0 || vb <= 0) return 0;
  const ma = mean(a);
  const mb = mean(b);
  let cov = 0;
  for (let i = 0; i < a.length; i++) cov += (a[i]! - ma) * (b[i]! - mb);
  cov /= a.length - 1;
  return cov / Math.sqrt(va * vb);
}

const MIN_OBS = 30;

export function computePriceDiscovery(input: PriceDiscoveryInput): PriceDiscoveryResult {
  const label1 = input.label1 ?? "market1";
  const label2 = input.label2 ?? "market2";
  const tx = (v: number[]): number[] => (input.applyLog ? v.map((x) => Math.log(x)) : v.slice());
  const y1 = tx(input.series1);
  const y2 = tx(input.series2);
  const n = Math.min(y1.length, y2.length);

  const neutral = (reason: string): PriceDiscoveryResult => ({
    label1,
    label2,
    beta: 0,
    alpha1: 0,
    alpha2: 0,
    innovationCorr: 0,
    componentShare1: 0.5,
    componentShare2: 0.5,
    hasbrouckIS1: { lower: 0, upper: 0, mid: 0 },
    hasbrouckIS2: { lower: 0, upper: 0, mid: 0 },
    leader: "indeterminate",
    confidence: "low",
    sampleSize: n,
    interpretation: reason,
  });

  if (n < MIN_OBS) return neutral(`need ≥ ${MIN_OBS} aligned observations, got ${n}`);

  const a1 = y1.slice(0, n);
  const a2 = y2.slice(0, n);

  // 1. Cointegrating relation y1 = c + β·y2 + z.
  const level = ols(a2, a1);
  const beta = level.slope;
  const z = level.residuals; // the spread, length n

  // 2. Error-correction regressions Δyᵢ = μ + αᵢ·z[t−1] + εᵢ.
  const zLag: number[] = [];
  const dy1: number[] = [];
  const dy2: number[] = [];
  for (let t = 1; t < n; t++) {
    zLag.push(z[t - 1]!);
    dy1.push(a1[t]! - a1[t - 1]!);
    dy2.push(a2[t]! - a2[t - 1]!);
  }
  const ec1 = ols(zLag, dy1);
  const ec2 = ols(zLag, dy2);
  const alpha1 = ec1.slope;
  const alpha2 = ec2.slope;

  // 3. Innovation covariance from the EC residuals.
  const s1 = Math.sqrt(variance(ec1.residuals));
  const s2 = Math.sqrt(variance(ec2.residuals));
  const rho = corr(ec1.residuals, ec2.residuals);

  // 4. Common factor ψ ∝ α⊥ = (α2, −α1).
  const psi1 = alpha2;
  const psi2 = -alpha1;
  const sumPerp = psi1 + psi2;

  // Gonzalo-Granger component shares.
  let cs1 = sumPerp !== 0 ? psi1 / sumPerp : 0.5;
  let cs2 = sumPerp !== 0 ? psi2 / sumPerp : 0.5;

  // Hasbrouck IS (bivariate closed form, both Cholesky orderings).
  const D = psi1 * psi1 * s1 * s1 + 2 * psi1 * psi2 * rho * s1 * s2 + psi2 * psi2 * s2 * s2;
  let is1Upper = 0;
  let is1Lower = 0;
  if (D > 0) {
    is1Upper = Math.pow(psi1 * s1 + psi2 * rho * s2, 2) / D; // market1 ordered first
    is1Lower = (psi1 * psi1 * s1 * s1 * (1 - rho * rho)) / D; // market1 ordered second
  }

  // Confidence: a meaningful decomposition needs real error correction (at least
  // one market adjusts), a non-degenerate α⊥ sum, well-defined IS, and shares
  // that land in [0,1] (out-of-range shares signal same-signed αs = no valid
  // common factor). Does NOT replace a cointegration test — see interpretation.
  const ecStrength = Math.abs(alpha1) + Math.abs(alpha2);
  const sharesInRange = cs1 >= -0.05 && cs1 <= 1.05 && cs2 >= -0.05 && cs2 <= 1.05;
  const validEC = Math.abs(sumPerp) > 1e-9 && D > 0 && ecStrength > 0.005;
  const confidence: "high" | "low" = validEC && sharesInRange ? "high" : "low";

  // Clamp shares for reporting.
  cs1 = Math.min(1, Math.max(0, cs1));
  cs2 = Math.min(1, Math.max(0, cs2));

  const is1: ISBounds = {
    lower: round(Math.min(is1Lower, is1Upper)),
    upper: round(Math.max(is1Lower, is1Upper)),
    mid: round((is1Lower + is1Upper) / 2),
  };
  const is2: ISBounds = {
    lower: round(1 - is1.upper),
    upper: round(1 - is1.lower),
    mid: round(1 - is1.mid),
  };

  const BAND = 0.1;
  let leader: string;
  if (confidence === "low") leader = "indeterminate";
  else if (cs1 > 0.5 + BAND) leader = label1;
  else if (cs1 < 0.5 - BAND) leader = label2;
  else leader = "indeterminate";

  const interpretation =
    confidence === "low"
      ? `price-discovery decomposition unreliable (αs same-signed or degenerate) — verify the series are cointegrated (adf_test / johansen_cointegration) first`
      : `${leader === "indeterminate" ? "no clear leader (balanced)" : `${leader} leads price discovery`}: ` +
        `Gonzalo-Granger share ${label1} ${round(cs1 * 100, 1)}% / ${label2} ${round(cs2 * 100, 1)}%, ` +
        `Hasbrouck IS ${label1} mid ${round(is1.mid * 100, 1)}% [${round(is1.lower * 100, 1)}–${round(is1.upper * 100, 1)}]` +
        (Math.abs(rho) > 0.7 ? ` (ρ=${round(rho, 2)} high → wide IS bounds)` : "");

  return {
    label1,
    label2,
    beta: round(beta),
    alpha1: round(alpha1),
    alpha2: round(alpha2),
    innovationCorr: round(rho),
    componentShare1: round(cs1),
    componentShare2: round(cs2),
    hasbrouckIS1: is1,
    hasbrouckIS2: is2,
    leader,
    confidence,
    sampleSize: n,
    interpretation,
  };
}
