/**
 * Crowd Positioning Verdict (Shapiro framing).
 *
 * Jason Shapiro's definition of "contrarian" is about POSITIONING, not
 * direction. Most retail contrarian trading fades recent price moves;
 * Shapiro's frame waits for a setup where the crowd has become so
 * concentrated in one direction that the eventual EXIT creates the
 * tradeable move — and that exit usually moves WITH price momentum,
 * not against it.
 *
 * Gordon has the raw inputs to do this already:
 *   - funding rate (perp markets) — paid by the side with more demand
 *   - open interest change — directional accumulation
 *   - sentiment score — qualitative positioning bias
 *   - liquidation intelligence — recent forced-exit data
 *
 * What's missing is a SYNTHESIZER that turns these signals into a
 * single structured verdict:
 *
 *   {
 *     side: "long" | "short" | "balanced",
 *     concentration: "low" | "elevated" | "extreme",
 *     contributingSignals: [...],
 *     expectedExitDirection: "down" | "up" | null,
 *   }
 *
 * Reading the output:
 *
 *   - side="long" + concentration="extreme" → the crowd is trapped long.
 *     Expected exit direction is DOWN (longs liquidating). The Shapiro
 *     trade is short, taken at the START of the liquidation move (not
 *     before — that's the timing problem operator has to solve).
 *
 *   - side="short" + concentration="extreme" → trapped short. Expected
 *     exit is UP (shorts covering). Shapiro trade is long.
 *
 *   - side="balanced" → no edge in this frame.
 *
 * Pure synthesizer — caller supplies the raw inputs. The function
 * doesn't fetch data; it scores what you give it. Same design as
 * correlationBreakdown.ts (caller responsibility for input quality).
 *
 * NOT a signal generator by itself. Shapiro's edge is in TIMING the
 * exit move, which requires operator judgment + execution discipline.
 * This primitive flags the SETUP (concentration); the operator decides
 * when (and whether) to take the trade.
 */

export type PositioningSide = "long" | "short" | "balanced";
export type ConcentrationSeverity = "low" | "elevated" | "extreme";
export type ExitDirection = "down" | "up" | null;

export interface CrowdPositioningInputs {
  /**
   * Annualized funding rate (perp markets). Positive = longs paying
   * shorts (longs in demand → potential trapped-long signal).
   * Decimal (e.g. 0.20 for 20% annualized).
   *
   * Optional — when not supplied, this signal doesn't contribute.
   */
  fundingRateAnnualized?: number;
  /**
   * Funding-rate Z-score against a baseline (e.g. 30-day rolling).
   * When supplied, takes precedence over raw funding rate for
   * concentration severity scoring — a 20% annualized rate means
   * different things in calm vs heated markets.
   *
   * Optional.
   */
  fundingRateZ?: number;
  /**
   * Recent change in open interest as a fraction of baseline.
   * Positive = accumulation, negative = unwind. E.g. 0.15 = OI is up
   * 15% vs baseline.
   *
   * Optional.
   */
  openInterestChange?: number;
  /**
   * Aggregate sentiment score in [-1, +1]. Positive = bullish skew.
   * Optional.
   */
  sentimentScore?: number;
  /**
   * Recent liquidation imbalance. Positive = more longs liquidated
   * than shorts in the recent window (suggests prior long over-
   * concentration that's now unwinding). Negative = more shorts
   * liquidated.
   *
   * Optional. Note: this is BACKWARD-looking — large recent
   * liquidations reduce concentration; this signal opposes the
   * funding+OI signals when present.
   */
  recentLiquidationImbalance?: number;
}

export interface PositioningSignalContribution {
  signal: string;
  /** Directional contribution: positive=long-concentration, negative=short. */
  contribution: number;
  /** Plain-English note. */
  note: string;
}

export interface CrowdPositioningVerdict {
  side: PositioningSide;
  concentration: ConcentrationSeverity;
  /**
   * Net concentration score in [-1, +1]. Positive = long-concentrated,
   * negative = short-concentrated. Magnitude maps to severity.
   */
  netScore: number;
  /** Per-signal contributions; sums approximately to netScore. */
  contributingSignals: PositioningSignalContribution[];
  /**
   * Expected direction of the eventual exit move. Opposite sign of
   * `side` (long-concentrated → exit down). Null when balanced.
   */
  expectedExitDirection: ExitDirection;
  /**
   * Number of input signals supplied. Verdicts based on fewer signals
   * are less reliable — the caller should treat low signalCount with
   * appropriate skepticism.
   */
  signalCount: number;
}

// ============================================================================
// Scoring constants
// ============================================================================

/**
 * Funding-rate annualized thresholds. Above 0.20 (20% annualized) is
 * historically high for perp markets; above 0.50 is extreme.
 *
 * These are conservative crypto-defaults. Operators in calmer asset
 * classes will want smaller numbers; in altcoin perp meta during
 * speculative blowoffs, 100%+ funding is common.
 */
const FUNDING_RATE_MILD = 0.10;
const FUNDING_RATE_STRONG = 0.30;

/**
 * Z-score thresholds. ±1.5 = elevated, ±3 = extreme. Matches the
 * convention from correlationBreakdown.ts.
 */
const Z_MILD = 1.5;
const Z_STRONG = 3.0;

/** OI change thresholds (fraction). */
const OI_MILD = 0.10;
const OI_STRONG = 0.30;

/** Sentiment thresholds. */
const SENTIMENT_MILD = 0.3;
const SENTIMENT_STRONG = 0.7;

/** Severity thresholds on the final netScore (absolute value). */
const SEVERITY_LOW = 0.3;
const SEVERITY_ELEVATED = 0.7;

// ============================================================================
// Per-signal contribution scoring
// ============================================================================

/**
 * Score a single value into a -1..+1 contribution, mapped through
 * mild/strong thresholds. Returns 0 when input is null/undefined.
 */
function scoreThresholded(
  value: number | undefined,
  mild: number,
  strong: number,
): number {
  if (value === undefined || Number.isNaN(value)) return 0;
  const sign = Math.sign(value);
  const mag = Math.abs(value);
  if (mag < mild) return (mag / mild) * sign * 0.4;
  if (mag < strong) return sign * (0.4 + ((mag - mild) / (strong - mild)) * 0.4);
  return sign * Math.min(1, 0.8 + ((mag - strong) / strong) * 0.2);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Synthesize crowd-positioning inputs into a structured verdict.
 * Pure function. Caller is responsible for input quality + freshness.
 */
export function computeCrowdPositioningVerdict(
  inputs: CrowdPositioningInputs,
): CrowdPositioningVerdict {
  const contributingSignals: PositioningSignalContribution[] = [];

  // 1. Funding rate (prefer Z-score when available)
  let fundingContribution = 0;
  if (inputs.fundingRateZ !== undefined) {
    fundingContribution = scoreThresholded(inputs.fundingRateZ, Z_MILD, Z_STRONG);
    contributingSignals.push({
      signal: "funding_rate_z",
      contribution: fundingContribution,
      note: `Funding-rate Z=${inputs.fundingRateZ.toFixed(2)} vs baseline.`,
    });
  } else if (inputs.fundingRateAnnualized !== undefined) {
    fundingContribution = scoreThresholded(
      inputs.fundingRateAnnualized,
      FUNDING_RATE_MILD,
      FUNDING_RATE_STRONG,
    );
    contributingSignals.push({
      signal: "funding_rate_annualized",
      contribution: fundingContribution,
      note: `Funding rate ${(inputs.fundingRateAnnualized * 100).toFixed(2)}% annualized.`,
    });
  }

  // 2. Open interest change
  let oiContribution = 0;
  if (inputs.openInterestChange !== undefined) {
    oiContribution = scoreThresholded(inputs.openInterestChange, OI_MILD, OI_STRONG);
    contributingSignals.push({
      signal: "open_interest_change",
      contribution: oiContribution,
      note: `OI change ${(inputs.openInterestChange * 100).toFixed(1)}% vs baseline.`,
    });
  }

  // 3. Sentiment
  let sentimentContribution = 0;
  if (inputs.sentimentScore !== undefined) {
    sentimentContribution = scoreThresholded(
      inputs.sentimentScore,
      SENTIMENT_MILD,
      SENTIMENT_STRONG,
    );
    contributingSignals.push({
      signal: "sentiment_score",
      contribution: sentimentContribution,
      note: `Sentiment ${inputs.sentimentScore.toFixed(2)} (-1..+1).`,
    });
  }

  // 4. Recent liquidation imbalance — OPPOSES the other signals
  //    because recent forced exits REDUCE concentration. So we
  //    subtract its contribution.
  let liquidationContribution = 0;
  if (inputs.recentLiquidationImbalance !== undefined) {
    // Liquidation imbalance is already directional in the same sign
    // convention as the others (positive = longs got hit). But
    // because liquidations REDUCE concentration on the side that got
    // hit, we negate.
    const raw = scoreThresholded(inputs.recentLiquidationImbalance, 0.2, 0.6);
    liquidationContribution = -raw;
    contributingSignals.push({
      signal: "recent_liquidation_imbalance",
      contribution: liquidationContribution,
      note: `Recent liquidation imbalance ${inputs.recentLiquidationImbalance.toFixed(2)} (positive=longs hit). Already-unwound positioning reduces remaining concentration.`,
    });
  }

  const signalCount = contributingSignals.length;
  const netScore =
    fundingContribution + oiContribution + sentimentContribution + liquidationContribution;
  // Normalize to keep netScore roughly in [-1, +1] regardless of
  // signal count (otherwise 4 strong-aligned signals would sum to 4).
  const normalizedNet =
    signalCount === 0 ? 0 : Math.max(-1, Math.min(1, netScore / Math.max(1, signalCount * 0.8)));

  const absScore = Math.abs(normalizedNet);
  let concentration: ConcentrationSeverity;
  if (absScore < SEVERITY_LOW) concentration = "low";
  else if (absScore < SEVERITY_ELEVATED) concentration = "elevated";
  else concentration = "extreme";

  let side: PositioningSide;
  if (absScore < SEVERITY_LOW) side = "balanced";
  else if (normalizedNet > 0) side = "long";
  else side = "short";

  const expectedExitDirection: ExitDirection =
    side === "long" ? "down" : side === "short" ? "up" : null;

  return {
    side,
    concentration,
    netScore: normalizedNet,
    contributingSignals,
    expectedExitDirection,
    signalCount,
  };
}

/** Operator-facing one-line summary. */
export function summarizeCrowdPositioning(v: CrowdPositioningVerdict): string {
  if (v.signalCount === 0) {
    return "Crowd positioning: no signals supplied — no verdict.";
  }
  if (v.side === "balanced") {
    return `Crowd positioning: balanced (netScore=${v.netScore.toFixed(2)}, ${v.signalCount} signal${v.signalCount === 1 ? "" : "s"}). No Shapiro setup.`;
  }
  const trappedSide = v.side === "long" ? "longs" : "shorts";
  const exitMove = v.expectedExitDirection === "down" ? "downward (longs liquidating)" : "upward (shorts covering)";
  const tradeSide = v.expectedExitDirection === "down" ? "short" : "long";
  return `Crowd positioning: ${trappedSide} ${v.concentration}-concentrated (netScore=${v.netScore.toFixed(2)}). Expected exit move ${exitMove}; Shapiro trade is ${tradeSide} on the move start.`;
}
