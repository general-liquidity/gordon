/**
 * Fractional Kelly position sizing.
 *
 * Two API shapes the same underlying formula serves:
 *
 *  (a) Binary win/loss (prediction-market style):
 *        f* = (b·p − q) / b
 *      where b = payout multiple per $1 risked, p = win prob, q = 1 − p.
 *      For a $1 contract at price c that pays $1: b = (1−c)/c.
 *
 *  (b) Continuous risk/reward (typical trade plan):
 *        f* ≈ edge / (stopFrac²) under Gaussian assumption, but the
 *        cleaner formulation is the same as (a) treating winRatio + stopFrac
 *        as the binary payoff structure of a single trade:
 *           b = winFrac / lossFrac (R-multiple)
 *           p = realisticHitRate
 *
 * Default fraction multiplier is 0.25 (quarter-Kelly) — the professional
 * standard. Full Kelly is provably optimal asymptotically but its
 * drawdowns are emotionally and operationally unbearable in finite
 * sample, and a single estimation error on p can be catastrophic.
 *
 * Returns the recommended bet fraction of bankroll, the underlying full
 * Kelly fraction, and the implied dollar size. Caller is responsible
 * for downstream risk-gate compatibility — Kelly may produce a fraction
 * that violates concentration limits.
 */

export type KellyMode = "binary" | "rr";

export interface KellySizeInput {
  /** Probability of winning the trade or contract. Required, 0..1. */
  winProbability: number;
  /** Account bankroll in USD. */
  bankrollUsd: number;
  /**
   * Mode "binary" — payoutRatio is the b in (b·p − q)/b. For a $1
   * contract bought at price c: b = (1 − c)/c. Required in binary mode.
   *
   * Mode "rr" — payoutRatio is the win/loss R-multiple. e.g. 2.0 means
   * stop loses 1R, target wins 2R. Required in rr mode.
   */
  payoutRatio: number;
  /** Mode flag. Default "rr" since most Gordon flows are trade plans. */
  mode?: KellyMode;
  /**
   * Multiplier on full Kelly. Default 0.25 (quarter-Kelly). Set to 1.0
   * to get the analytic optimum; anything > 0.5 is "Kelly cowboy"
   * territory and almost always wrong for live trading.
   */
  fractionMultiplier?: number;
}

export interface KellySizeResult {
  /** Underlying full Kelly fraction (mode-aware), clamped to [0, 1]. */
  fullKellyFraction: number;
  /** Recommended fraction after applying the multiplier. */
  recommendedFraction: number;
  /** Recommended position size in USD. */
  positionUsd: number;
  /** Implied edge in basis points (positive = trade has edge). */
  edgeBps: number;
  /** Verdict label for downstream UI / audit summaries. */
  verdict: "skip" | "small" | "normal" | "large" | "all-in";
  summary: string;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

export function kellySize(input: KellySizeInput): KellySizeResult {
  const mode: KellyMode = input.mode ?? "rr";
  const p = clamp01(input.winProbability);
  const q = 1 - p;
  const b = Math.max(input.payoutRatio, 1e-9);
  const multiplier = Math.max(0, Math.min(1, input.fractionMultiplier ?? 0.25));

  // Same formula for both modes — the difference is what `b` represents
  // (price-implied payout vs trade R-multiple). The math is identical.
  const fullKelly = clamp01((b * p - q) / b);
  const recommended = clamp01(fullKelly * multiplier);
  const positionUsd = Math.max(0, input.bankrollUsd) * recommended;
  const edgeBps = (p - 1 / (1 + b)) * 10_000;

  let verdict: KellySizeResult["verdict"];
  if (recommended <= 0) verdict = "skip";
  else if (recommended < 0.01) verdict = "small";
  else if (recommended < 0.08) verdict = "normal";
  else if (recommended < 0.25) verdict = "large";
  else verdict = "all-in";

  const summary =
    fullKelly === 0
      ? `Negative or zero edge — Kelly says skip. p=${(p * 100).toFixed(1)}%, fair=${((1 / (1 + b)) * 100).toFixed(1)}%`
      : [
          `${mode} Kelly: full=${(fullKelly * 100).toFixed(1)}% of bankroll, recommended ${(recommended * 100).toFixed(1)}% at ${multiplier}× multiplier`,
          `→ size $${positionUsd.toFixed(2)} (edge ${edgeBps >= 0 ? "+" : ""}${edgeBps.toFixed(0)} bps)`,
        ].join(" ");

  return {
    fullKellyFraction: fullKelly,
    recommendedFraction: recommended,
    positionUsd,
    edgeBps,
    verdict,
    summary,
  };
}
