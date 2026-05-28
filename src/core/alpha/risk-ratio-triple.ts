/**
 * Risk-ratio triple interpreter — skew read from Sharpe / Sortino / Calmar.
 *
 * From "Is Your Sharpe Lying?". Sharpe penalises upside volatility as if it
 * were downside; Sortino only penalises downside. For a SYMMETRIC return
 * distribution, Sortino ≈ √2 × Sharpe. The divergence from that identity is
 * a skew read you can take from the published ratios ALONE — no return series
 * required:
 *
 *   Sortino > √2 × Sharpe  → positively skewed  (occasional big winners;
 *                            headline Sharpe UNDERRATES the strategy)
 *   Sortino ≈ √2 × Sharpe  → symmetric          (either metric tells the same
 *                            story)
 *   Sortino < √2 × Sharpe  → negatively skewed  (rare large losers; tail risk
 *                            NOT priced into the headline ratios — the
 *                            vol-selling / short-gamma signature)
 *
 * This is the "ratios-only" path — useful when reading an allocator tearsheet
 * that lists only the ratios. When you HAVE the return series, Gordon's
 * `strategy-claim-verifier.ts` computes skew directly from the third moment,
 * which supersedes this heuristic. Use that when the returns are available.
 *
 * Allocator floors (emerging-manager conversation): Calmar > 1.0 on the
 * drawdown side, Sortino > 2.0 on the variance side.
 *
 * Pure function. No I/O.
 */

export type DistributionSkew = "positive" | "symmetric" | "negative" | "indeterminate";

export interface RiskRatioTripleInput {
  /** Sharpe ratio (excess return / total volatility). */
  sharpe: number;
  /** Sortino ratio (excess return / downside deviation). */
  sortino: number;
  /** Calmar ratio (return / max drawdown). Optional — floor check is skipped
   *  when absent. */
  calmar?: number;
  /**
   * Fractional tolerance band around √2 × Sharpe within which the
   * distribution is called symmetric. Default 0.10 (±10%).
   */
  symmetricTolerance?: number;
  /** Allocator floor on Calmar. Default 1.0. */
  calmarFloor?: number;
  /** Allocator floor on Sortino. Default 2.0. */
  sortinoFloor?: number;
}

export interface RiskRatioTripleResult {
  sharpe: number;
  sortino: number;
  calmar: number | null;
  /** √2 × Sharpe — the Sortino a symmetric distribution would produce. */
  expectedSortino: number;
  /** sortino / expectedSortino. Null when Sharpe ≤ 0 (relationship undefined)
   *  or when Sortino is non-finite (no downside deviation). */
  divergenceRatio: number | null;
  skew: DistributionSkew;
  /** Sortino materially below √2 × Sharpe — rare large losers whose tail risk
   *  isn't reflected in the headline ratios. */
  tailRiskUnpriced: boolean;
  /** Sortino materially above √2 × Sharpe — headline Sharpe understates. */
  underratedBySharpe: boolean;
  /** Null when Calmar wasn't supplied. */
  calmarPassesFloor: boolean | null;
  sortinoPassesFloor: boolean;
  interpretation: string;
}

const DEFAULT_SYMMETRIC_TOLERANCE = 0.1;
const DEFAULT_CALMAR_FLOOR = 1.0;
const DEFAULT_SORTINO_FLOOR = 2.0;

export function interpretRiskRatioTriple(
  input: RiskRatioTripleInput,
): RiskRatioTripleResult {
  const { sharpe, sortino } = input;
  const calmar = typeof input.calmar === "number" && Number.isFinite(input.calmar)
    ? input.calmar
    : null;
  const tol = input.symmetricTolerance ?? DEFAULT_SYMMETRIC_TOLERANCE;
  const calmarFloor = input.calmarFloor ?? DEFAULT_CALMAR_FLOOR;
  const sortinoFloor = input.sortinoFloor ?? DEFAULT_SORTINO_FLOOR;

  const expectedSortino = Math.SQRT2 * sharpe;

  let skew: DistributionSkew;
  let divergenceRatio: number | null;
  let tailRiskUnpriced = false;
  let underratedBySharpe = false;

  if (!Number.isFinite(sharpe) || sharpe <= 0) {
    // The √2 identity assumes a positive Sharpe. With a non-positive or
    // non-finite Sharpe the skew read is undefined — don't fabricate one.
    skew = "indeterminate";
    divergenceRatio = null;
  } else if (!Number.isFinite(sortino)) {
    // No downside deviation at all → Sortino is unbounded. Strongly positive.
    skew = "positive";
    divergenceRatio = null;
    underratedBySharpe = true;
  } else {
    divergenceRatio = expectedSortino === 0 ? null : sortino / expectedSortino;
    if (divergenceRatio === null) {
      skew = "indeterminate";
    } else if (divergenceRatio > 1 + tol) {
      skew = "positive";
      underratedBySharpe = true;
    } else if (divergenceRatio < 1 - tol) {
      skew = "negative";
      tailRiskUnpriced = true;
    } else {
      skew = "symmetric";
    }
  }

  const sortinoPassesFloor = Number.isFinite(sortino)
    ? sortino >= sortinoFloor
    : true; // unbounded Sortino trivially clears any finite floor
  const calmarPassesFloor = calmar === null ? null : calmar >= calmarFloor;

  const skewSentence =
    skew === "positive"
      ? "Positively skewed — occasional big winners. The headline Sharpe UNDERRATES this strategy; present Sortino alongside it."
      : skew === "negative"
        ? "Negatively skewed — rare large losers. TAIL RISK IS NOT PRICED INTO THE RATIOS (vol-selling / short-gamma signature). Sharpe flatters; trust Sortino + Calmar."
        : skew === "symmetric"
          ? "Approximately symmetric — Sharpe and Sortino tell the same story."
          : "Skew indeterminate — Sharpe is non-positive or undefined, so the √2 relationship does not apply.";

  const floorSentence =
    `Floors: Sortino ${Number.isFinite(sortino) ? sortino.toFixed(2) : "∞"} ` +
    `${sortinoPassesFloor ? "≥" : "<"} ${sortinoFloor.toFixed(1)}` +
    (calmar === null
      ? ", Calmar n/a."
      : `, Calmar ${calmar.toFixed(2)} ${calmarPassesFloor ? "≥" : "<"} ${calmarFloor.toFixed(1)}.`);

  const interpretation =
    `Sharpe ${Number.isFinite(sharpe) ? sharpe.toFixed(2) : "n/a"}, ` +
    `Sortino ${Number.isFinite(sortino) ? sortino.toFixed(2) : "∞"}` +
    (divergenceRatio !== null ? ` (${divergenceRatio.toFixed(2)}× the √2×Sharpe symmetric expectation of ${expectedSortino.toFixed(2)})` : "") +
    `. ${skewSentence} ${floorSentence}`;

  return {
    sharpe,
    sortino,
    calmar,
    expectedSortino,
    divergenceRatio,
    skew,
    tailRiskUnpriced,
    underratedBySharpe,
    calmarPassesFloor,
    sortinoPassesFloor,
    interpretation,
  };
}
