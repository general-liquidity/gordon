/**
 * Liquidation-Distance Guard — the hard SURVIVAL constraint for the competition book.
 *
 * Forced liquidation = elimination: it not only zeroes the lottery sleeve, it red-lines
 * the equity curve and disqualifies the Best-Sharpe prize (a margin call is the worst
 * possible drawdown). So before any LEVERAGED bet, estimate the probability the account
 * gets force-liquidated BEFORE the contest deadline, and block bets that exceed a
 * survival threshold.
 *
 * THE MODEL (pure, first-passage):
 *   - A position at leverage L is liquidated when an adverse move of ≈ 1/L (minus a
 *     maintenance-margin buffer) occurs against it. 30× → ~3.3% adverse move wipes the
 *     posted margin. The maintenance buffer is parameterized (exchanges liquidate a
 *     touch before margin hits exactly 0).
 *   - Model the instrument as a DRIFTLESS random walk: per-bar return σ from recent
 *     realized vol. Over `barsToDeadline` bars the cumulative move ~ Normal(0, σ·√bars).
 *   - We want P(the path EVER breaches the liquidation distance before the deadline),
 *     not just P(it ends past it). That's a first-passage problem. For a driftless
 *     Brownian motion the reflection principle gives the one-sided barrier-hit prob:
 *         P(min over [0,T] ≤ −b) = 2·Φ(−b / σ_T),   σ_T = σ·√bars
 *     i.e. hitting the barrier at any point is TWICE as likely as ending past it.
 *
 * ASSUMPTIONS (and why they're roughly conservative):
 *   - Driftless: no edge assumed in the survival check — we don't let a hoped-for drift
 *     talk us out of a margin call. (A real adverse drift would make this OPTIMISTIC; a
 *     favorable drift makes it conservative. For a survival gate, assuming no drift is
 *     the prudent default.)
 *   - Gaussian per-bar returns: real returns are fat-tailed, so true breach prob is
 *     somewhat HIGHER than this — treat the number as a floor, not a ceiling.
 *   - Ignores intrabar gaps / overnight jumps: a gap THROUGH the barrier liquidates
 *     even if no bar close is past it, so again real risk ≥ modeled. Net: the estimate
 *     is conservative-ish on tails but should not be read as an upper bound.
 *
 * Pure compute. Validate at boundaries only; never throws.
 */

export interface LiquidationRisk {
  /** Adverse fractional move that liquidates the position (≈ 1/L − buffer). */
  distance: number;
  /** First-passage P(barrier breached at any point before the deadline). */
  pBreach: number;
  /** True when pBreach ≤ maxBreachProb (the bet survives the survival gate). */
  safe: boolean;
  /** Human-readable verdict for the audit log / approval surface. */
  reason: string;
}

/** Default tolerated breach probability over the horizon — 2% survival budget. */
export const DEFAULT_MAX_BREACH_PROB = 0.02;

/**
 * Default maintenance-margin buffer (fraction of notional). Exchanges liquidate when
 * equity falls to the maintenance margin, which is a bit ABOVE 0 — so the effective
 * liquidation distance is slightly less than 1/L. 0.5% is a conservative generic value.
 */
export const DEFAULT_MAINTENANCE_BUFFER = 0.005;

/** Floor on liquidation distance — guards div-by-zero and absurd extreme leverage. */
const DISTANCE_FLOOR = 1e-4;

/**
 * Standard-normal CDF Φ via the Abramowitz-Stegun 7.1.26 erf approximation.
 * Max abs error ~1.5e-7 — ample for a risk-gate probability. No deps.
 */
export function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t) *
      Math.exp(-x * x);
  return Math.sign(x) * y;
}

/**
 * Adverse fractional move that liquidates a position at the given leverage.
 * ≈ 1/leverage − maintenanceBuffer, floored at a small positive so absurd leverage
 * (or buffer ≥ 1/L) can't produce a zero/negative barrier.
 */
export function liquidationDistance(
  leverage: number,
  maintenanceBufferPct: number = DEFAULT_MAINTENANCE_BUFFER,
): number {
  if (!Number.isFinite(leverage) || leverage <= 0) return DISTANCE_FLOOR;
  const buffer = Number.isFinite(maintenanceBufferPct) ? Math.max(maintenanceBufferPct, 0) : 0;
  return Math.max(1 / leverage - buffer, DISTANCE_FLOOR);
}

/**
 * First-passage breach probability for a driftless Gaussian path over the horizon:
 *   pBreach = 2·Φ(−distance / (perBarVol·√barsToDeadline))
 * Clamped to [0, 1]. Degenerate inputs (≤0 vol or ≤0 bars) → 0 breach (no move, no risk).
 */
function breachProbability(distance: number, perBarVol: number, barsToDeadline: number): number {
  if (!(perBarVol > 0) || !(barsToDeadline > 0) || !Number.isFinite(perBarVol) || !Number.isFinite(barsToDeadline)) {
    return 0;
  }
  const horizonSd = perBarVol * Math.sqrt(barsToDeadline);
  if (!(horizonSd > 0)) return 0;
  const p = 2 * normalCdf(-distance / horizonSd);
  return Math.min(1, Math.max(0, p));
}

/**
 * Assess liquidation risk for a leveraged bet: distance, first-passage breach prob,
 * and whether it clears the survival threshold.
 */
export function assessLiquidationRisk(input: {
  leverage: number;
  perBarVol: number;
  barsToDeadline: number;
  maxBreachProb?: number;
  maintenanceBufferPct?: number;
}): LiquidationRisk {
  const maxBreachProb = input.maxBreachProb ?? DEFAULT_MAX_BREACH_PROB;
  const distance = liquidationDistance(input.leverage, input.maintenanceBufferPct);
  const pBreach = breachProbability(distance, input.perBarVol, input.barsToDeadline);
  const safe = pBreach <= maxBreachProb;

  const reason = safe
    ? `SAFE: ${(input.leverage).toFixed(1)}× → liq at ${(distance * 100).toFixed(2)}% adverse move; ` +
      `P(breach before deadline) ${(pBreach * 100).toFixed(2)}% ≤ ${(maxBreachProb * 100).toFixed(2)}% budget.`
    : `BLOCK: ${(input.leverage).toFixed(1)}× → liq at ${(distance * 100).toFixed(2)}% adverse move; ` +
      `P(breach before deadline) ${(pBreach * 100).toFixed(2)}% > ${(maxBreachProb * 100).toFixed(2)}% budget. ` +
      `Forced liquidation = elimination — reduce leverage or shorten exposure.`;

  return { distance, pBreach, safe, reason };
}

/**
 * Largest leverage whose first-passage breach probability stays at/under the threshold —
 * use it to SIZE the lottery sleeve right at the survival edge instead of guessing.
 *
 * Closed-form inversion. The breach gate is pBreach ≤ p ⇔ Φ(−d/σ_T) ≤ p/2, and since Φ
 * is increasing this is −d/σ_T ≤ Φ⁻¹(p/2), i.e. d ≥ −σ_T·Φ⁻¹(p/2) = σ_T·z (z>0 since
 * p/2<0.5 ⇒ Φ⁻¹(p/2)<0). With d = 1/L − buffer, the binding leverage is
 *   L_max = 1 / (σ_T·z + buffer),   z = −Φ⁻¹(p/2) = |Φ⁻¹(p/2)|.
 * Returns 0 if even infinite-distance can't satisfy the threshold (vacuous here since
 * z>0, but guarded), and caps insane results implicitly via the distance floor on read-back.
 */
export function maxSafeLeverage(input: {
  perBarVol: number;
  barsToDeadline: number;
  maxBreachProb?: number;
  maintenanceBufferPct?: number;
}): number {
  const maxBreachProb = input.maxBreachProb ?? DEFAULT_MAX_BREACH_PROB;
  const buffer = Number.isFinite(input.maintenanceBufferPct ?? DEFAULT_MAINTENANCE_BUFFER)
    ? Math.max(input.maintenanceBufferPct ?? DEFAULT_MAINTENANCE_BUFFER, 0)
    : 0;

  // No vol / no horizon → no breach risk → leverage is unconstrained by this gate.
  if (!(input.perBarVol > 0) || !(input.barsToDeadline > 0) || maxBreachProb >= 1) {
    return Number.POSITIVE_INFINITY;
  }
  if (maxBreachProb <= 0) return 0;

  const horizonSd = input.perBarVol * Math.sqrt(input.barsToDeadline);
  const z = -normalInvCdf(maxBreachProb / 2); // positive: required distance in SDs
  const requiredDistance = horizonSd * z + buffer;
  if (!(requiredDistance > 0)) return Number.POSITIVE_INFINITY;
  return 1 / requiredDistance;
}

/**
 * Inverse standard-normal CDF (quantile) via Acklam's rational approximation.
 * Relative error < 1.15e-9 across (0,1) — far tighter than the Φ approximation, so the
 * maxSafeLeverage round-trip is limited by Φ's ~1e-7, not this. p∉(0,1) → ±Infinity.
 */
export function normalInvCdf(p: number): number {
  if (!(p > 0)) return Number.NEGATIVE_INFINITY;
  if (!(p < 1)) return Number.POSITIVE_INFINITY;

  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239] as const;
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1] as const;
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783] as const;
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416] as const;

  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number;
  let r: number;

  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

/** Human-readable summary of a liquidation-risk assessment for the approval surface. */
export function formatLiquidationRisk(input: {
  leverage: number;
  perBarVol: number;
  barsToDeadline: number;
  maxBreachProb?: number;
  maintenanceBufferPct?: number;
}): string {
  const maxBreachProb = input.maxBreachProb ?? DEFAULT_MAX_BREACH_PROB;
  const risk = assessLiquidationRisk(input);
  const lMax = maxSafeLeverage({
    perBarVol: input.perBarVol,
    barsToDeadline: input.barsToDeadline,
    maxBreachProb,
    maintenanceBufferPct: input.maintenanceBufferPct,
  });
  const lMaxStr = Number.isFinite(lMax) ? `${lMax.toFixed(2)}×` : "unbounded (no vol/horizon risk)";

  return [
    `Liquidation Guard — ${risk.safe ? "PASS" : "FAIL"}`,
    `  leverage          ${input.leverage.toFixed(2)}×`,
    `  liq distance      ${(risk.distance * 100).toFixed(2)}% adverse move`,
    `  per-bar vol       ${(input.perBarVol * 100).toFixed(3)}%`,
    `  bars to deadline  ${input.barsToDeadline}`,
    `  P(breach)         ${(risk.pBreach * 100).toFixed(2)}%  (budget ${(maxBreachProb * 100).toFixed(2)}%)`,
    `  max safe leverage ${lMaxStr}`,
    "",
    `  ${risk.reason}`,
  ].join("\n");
}
