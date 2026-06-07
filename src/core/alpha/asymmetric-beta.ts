/**
 * Asymmetric up/down-market beta ("fake market-neutral" detector).
 *
 * From Andrew Lo, "Risk Management for Hedge Funds" (2001). A strategy that
 * looks market-neutral on an unconditional beta can still carry a large DOWN
 * beta — it makes money in calm/up markets and blows up in selloffs. Split the
 * benchmark return into its positive and negative halves and run:
 *
 *   R = α + β⁺·Λ⁺ + β⁻·Λ⁻ + ε,   Λ⁺ = max(Λ,0),  Λ⁻ = min(Λ,0)
 *
 * then test β⁺ = β⁻. A significant β⁻ > β⁺ (especially with a near-zero β⁺) is
 * the "fake market-neutral" signature. Pure; never throws.
 */

import { invert, transpose, multiply, multiplyVector } from "./matrix.ts";

export interface AsymmetricBetaInput {
  /** Strategy / position returns. */
  strategyReturns: number[];
  /** Benchmark returns, aligned 1:1. */
  benchmarkReturns: number[];
  /** |t| above this counts β⁺≠β⁻ as significant. Default 2 (~95%). */
  tThreshold?: number;
}

export type AsymmetricBetaVerdict =
  | "symmetric"
  | "asymmetric_downside"
  | "asymmetric_upside"
  | "market_neutral"
  | "insufficient";

export interface AsymmetricBetaResult {
  alpha: number;
  betaUp: number;
  betaDown: number;
  /** β⁺ − β⁻ and the t-stat of that difference. */
  betaDiff: number;
  betaDiffT: number;
  rSquared: number;
  verdict: AsymmetricBetaVerdict;
  /** True when β⁻ materially exceeds β⁺ while β⁺ is small — looks neutral, isn't. */
  fakeMarketNeutral: boolean;
  sampleSize: number;
  interpretation: string;
}

const round = (x: number, p = 4): number => parseFloat(x.toFixed(p));
const mean = (a: number[]): number => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

const MIN_OBS = 12;

export function computeAsymmetricBeta(input: AsymmetricBetaInput): AsymmetricBetaResult {
  const y = input.strategyReturns;
  const b = input.benchmarkReturns;
  const tThreshold = input.tThreshold && input.tThreshold > 0 ? input.tThreshold : 2;
  const n = Math.min(y.length, b.length);

  const neutral = (reason: string): AsymmetricBetaResult => ({
    alpha: 0, betaUp: 0, betaDown: 0, betaDiff: 0, betaDiffT: 0, rSquared: 0,
    verdict: "insufficient", fakeMarketNeutral: false, sampleSize: n, interpretation: reason,
  });
  if (n < MIN_OBS) return neutral(`need ≥ ${MIN_OBS} aligned returns, got ${n}`);

  // X = [1, Λ⁺, Λ⁻]; y = strategy returns.
  const X: number[][] = [];
  const Y: number[] = [];
  for (let i = 0; i < n; i++) {
    const lam = b[i]!;
    X.push([1, Math.max(lam, 0), Math.min(lam, 0)]);
    Y.push(y[i]!);
  }

  let XtXinv: number[][] | null;
  let beta: number[];
  try {
    const Xt = transpose(X);
    const XtX = multiply(Xt, X);
    XtXinv = invert(XtX);
    if (!XtXinv) return neutral("regression singular (collinear up/down benchmark)");
    beta = multiplyVector(XtXinv, multiplyVector(Xt, Y));
  } catch {
    return neutral("regression failed");
  }

  const [alpha, betaUp, betaDown] = beta as [number, number, number];
  // Residuals + σ̂².
  const resid = Y.map((yi, i) => yi - (alpha + betaUp * X[i]![1]! + betaDown * X[i]![2]!));
  const rss = resid.reduce((s, e) => s + e * e, 0);
  const df = n - 3;
  const sigma2 = df > 0 ? rss / df : 0;
  const my = mean(Y);
  const tss = Y.reduce((s, yi) => s + (yi - my) * (yi - my), 0);
  const rSquared = tss > 0 ? round(1 - rss / tss) : 0;

  // Cov(β) = σ̂²·(XᵀX)⁻¹.  Var(β⁺−β⁻) = σ̂²·[C11 + C22 − 2·C12], indices 1,2.
  const c11 = XtXinv[1]![1]!;
  const c22 = XtXinv[2]![2]!;
  const c12 = XtXinv[1]![2]!;
  const varDiff = sigma2 * (c11 + c22 - 2 * c12);
  const betaDiff = betaUp - betaDown;
  const seDiff = varDiff > 0 ? Math.sqrt(varDiff) : 0;
  const betaDiffT = seDiff > 0 ? betaDiff / seDiff : 0;

  const SMALL_BETA = 0.1;
  const significant = Math.abs(betaDiffT) >= tThreshold;
  let verdict: AsymmetricBetaVerdict;
  if (!significant && Math.abs(betaUp) < SMALL_BETA && Math.abs(betaDown) < SMALL_BETA) {
    verdict = "market_neutral";
  } else if (significant && betaDown > betaUp) {
    verdict = "asymmetric_downside";
  } else if (significant && betaUp > betaDown) {
    verdict = "asymmetric_upside";
  } else {
    verdict = "symmetric";
  }
  const fakeMarketNeutral = verdict === "asymmetric_downside" && Math.abs(betaUp) < SMALL_BETA && betaDown > 0.3;

  const interpretation =
    verdict === "asymmetric_downside"
      ? `ASYMMETRIC DOWNSIDE: β⁺=${round(betaUp)} vs β⁻=${round(betaDown)} (diff t=${round(betaDiffT, 2)})` +
        (fakeMarketNeutral ? " — FAKE MARKET-NEUTRAL: looks neutral up, heavy beta in selloffs" : " — bigger exposure in down markets")
      : verdict === "asymmetric_upside"
        ? `asymmetric upside: β⁺=${round(betaUp)} > β⁻=${round(betaDown)} (diff t=${round(betaDiffT, 2)})`
        : verdict === "market_neutral"
          ? `genuinely market-neutral: β⁺=${round(betaUp)}, β⁻=${round(betaDown)} (no significant asymmetry)`
          : `symmetric beta: β⁺=${round(betaUp)} ≈ β⁻=${round(betaDown)} (diff t=${round(betaDiffT, 2)})`;

  return {
    alpha: round(alpha),
    betaUp: round(betaUp),
    betaDown: round(betaDown),
    betaDiff: round(betaDiff),
    betaDiffT: round(betaDiffT, 3),
    rSquared,
    verdict,
    fakeMarketNeutral,
    sampleSize: n,
    interpretation,
  };
}
