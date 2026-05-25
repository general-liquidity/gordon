/**
 * Earnings-Call Signal Validator + Scorer.
 *
 * The LLM extraction itself is left to the agent — Gordon's orchestrator
 * (or Researcher) reads the transcript via `get_earnings_transcript`,
 * runs an extraction prompt against it, and produces a candidate
 * structured signal. This module owns the OPPOSITE side:
 *
 *   1. Schema enforcement — reject candidates that don't conform to
 *      the field shape (saves the model from emitting garbage and
 *      having it land in audit metadata unchallenged).
 *
 *   2. Cross-check verification — when the candidate contains quoted
 *      risk factors, verify each appears in the source transcript
 *      using the `verifyQuote` primitive already in Gordon's audit
 *      layer. Hallucinated quotes are flagged.
 *
 *   3. Signal strength scoring — turn the structured fields into a
 *      single numeric score so downstream sizing logic can consume
 *      one number rather than reasoning over five.
 *
 * Why a validator rather than an extractor: LLM extraction is
 * fundamentally LLM work; the agent already has Anthropic API access
 * via Mastra. Re-implementing that here would duplicate the agent's
 * own reasoning surface and add a second extraction-quality variable
 * we'd have to maintain. Validation + verification + scoring are the
 * deterministic-by-construction parts that benefit from being in code.
 *
 * Pure compute. Zero dependencies beyond zod + the existing quote
 * verification utility. Safe to call from anywhere in Gordon.
 */

import { z } from "zod";
import { verifyQuote } from "../../platform/audit/quoteVerification.ts";

// ============================================================================
// Schema
// ============================================================================

/**
 * Canonical earnings-signal shape. Mirrors the EARNINGS_SIGNAL_PROMPT
 * pattern from the Roan piece but adapts the field semantics to be
 * actionable inside Gordon's trading decisions.
 */
export const EarningsSignalSchema = z.object({
  ticker: z.string().min(1).describe("Ticker / symbol the signal is for."),
  /**
   * Aggregate sentiment from the call. -1 = maximally bearish (downward
   * revisions, hedged language, mass apology), +1 = maximally bullish
   * (raised guidance, executed-on-plan tone, expansion confidence).
   */
  sentimentScore: z.number().min(-1).max(1),
  /**
   * Management confidence — orthogonal to sentiment direction. Captures
   * how much CONVICTION management projects, regardless of whether the
   * news is good or bad. Low = hedging, evasive, qualified; high =
   * direct, specific, committed.
   */
  managementConfidence: z.number().min(0).max(1),
  /** Guidance change relative to prior period. */
  guidanceRevision: z.enum(["raised", "maintained", "lowered", "none"]),
  /**
   * Up to 3 quoted risk factors from the call. Each must be a verbatim
   * snippet from the transcript — the verifier will reject hallucinated
   * quotes.
   */
  keyRiskFactors: z.array(z.string().min(1)).max(3).default([]),
  /**
   * Trading bias the agent inferred. 5-step Likert. NOT to be confused
   * with a sizing recommendation — this is direction + conviction;
   * actual position size flows through riskClassifier.
   */
  tradingBias: z.enum(["strong_long", "mild_long", "neutral", "mild_short", "strong_short"]),
});

export type EarningsSignal = z.infer<typeof EarningsSignalSchema>;

// ============================================================================
// Validation
// ============================================================================

export interface EarningsSignalValidationIssue {
  severity: "error" | "warning";
  field: string;
  message: string;
}

export interface EarningsSignalValidation {
  ok: boolean;
  signal?: EarningsSignal;
  issues: EarningsSignalValidationIssue[];
}

/**
 * Validate a candidate earnings signal against the schema. ERROR-level
 * issues cause `ok=false`; WARNING-level issues attach to a passing
 * result so callers can surface them.
 */
export function validateEarningsSignal(raw: unknown): EarningsSignalValidation {
  const issues: EarningsSignalValidationIssue[] = [];
  const parsed = EarningsSignalSchema.safeParse(raw);
  if (!parsed.success) {
    for (const i of parsed.error.issues) {
      issues.push({
        severity: "error",
        field: i.path.join(".") || "(root)",
        message: i.message,
      });
    }
    return { ok: false, issues };
  }

  const s = parsed.data;

  // Coherence warnings — sentiment and bias should typically align.
  // E.g. sentiment +0.9 with bias "strong_short" is contradictory.
  const biasNumeric: Record<EarningsSignal["tradingBias"], number> = {
    strong_short: -2,
    mild_short: -1,
    neutral: 0,
    mild_long: 1,
    strong_long: 2,
  };
  const biasN = biasNumeric[s.tradingBias];
  // If sentiment is strongly directional but bias disagrees in sign, warn.
  if (Math.abs(s.sentimentScore) > 0.5 && Math.sign(s.sentimentScore) !== Math.sign(biasN) && biasN !== 0) {
    issues.push({
      severity: "warning",
      field: "tradingBias",
      message: `tradingBias '${s.tradingBias}' contradicts sentimentScore=${s.sentimentScore.toFixed(2)} — possible extraction inconsistency`,
    });
  }

  // Guidance + bias coherence — "raised" with "strong_short" is contradictory.
  if (s.guidanceRevision === "raised" && (s.tradingBias === "mild_short" || s.tradingBias === "strong_short")) {
    issues.push({
      severity: "warning",
      field: "tradingBias",
      message: "tradingBias is short despite raised guidance — review extraction",
    });
  }
  if (s.guidanceRevision === "lowered" && (s.tradingBias === "mild_long" || s.tradingBias === "strong_long")) {
    issues.push({
      severity: "warning",
      field: "tradingBias",
      message: "tradingBias is long despite lowered guidance — review extraction",
    });
  }

  return { ok: true, signal: s, issues };
}

// ============================================================================
// Quote cross-check
// ============================================================================

export interface EarningsQuoteCheck {
  /** Per-risk-factor verification outcomes. */
  outcomes: Array<{
    quote: string;
    verified: boolean;
  }>;
  /** Number of risk factors that failed verification. */
  hallucinatedCount: number;
  /** Verified-rate over the supplied risk factors. */
  verifiedRate: number;
}

/**
 * Cross-check each `keyRiskFactors` entry against the source transcript
 * text. Hallucinated quotes (those that don't appear in the source) are
 * flagged so the caller can refuse to persist the signal or downgrade
 * confidence.
 */
export function crossCheckRiskFactorQuotes(
  signal: EarningsSignal,
  transcript: string,
): EarningsQuoteCheck {
  const outcomes = signal.keyRiskFactors.map((q) => ({
    quote: q,
    verified: verifyQuote(q, transcript),
  }));
  const verified = outcomes.filter((o) => o.verified).length;
  return {
    outcomes,
    hallucinatedCount: outcomes.length - verified,
    verifiedRate: outcomes.length === 0 ? 1 : verified / outcomes.length,
  };
}

// ============================================================================
// Signal strength scoring
// ============================================================================

export interface EarningsSignalScore {
  /** Composite -1..+1 score blending all four primary fields. */
  composite: number;
  /** Per-component contribution to the composite. Sums to `composite`. */
  components: {
    sentiment: number;
    confidence: number;
    guidance: number;
    bias: number;
  };
  /**
   * Conviction in [0..1] — captures how much the agent should weight
   * this signal in sizing. High conviction = strong, coherent,
   * verified signal. Low = noisy, hedged, or partially hallucinated.
   */
  conviction: number;
}

const GUIDANCE_SCORE: Record<EarningsSignal["guidanceRevision"], number> = {
  raised: 1,
  maintained: 0.2,
  none: 0,
  lowered: -1,
};

const BIAS_SCORE: Record<EarningsSignal["tradingBias"], number> = {
  strong_short: -1,
  mild_short: -0.5,
  neutral: 0,
  mild_long: 0.5,
  strong_long: 1,
};

/**
 * Composite scoring. Equal-weight blend across sentiment / guidance /
 * bias, modulated by management-confidence as a multiplier (low
 * confidence dampens conviction even when fields look strong).
 *
 * Optional `quoteCheck` argument penalizes conviction when risk-factor
 * quotes failed verification — partial hallucination is a strong
 * signal that the broader extraction may be unreliable.
 */
export function scoreEarningsSignal(
  signal: EarningsSignal,
  quoteCheck?: EarningsQuoteCheck,
): EarningsSignalScore {
  const sentimentContribution = signal.sentimentScore * 0.4;
  const guidanceContribution = GUIDANCE_SCORE[signal.guidanceRevision] * 0.3;
  const biasContribution = BIAS_SCORE[signal.tradingBias] * 0.3;
  const composite = sentimentContribution + guidanceContribution + biasContribution;

  // Conviction starts as confidence, capped by signal coherence and
  // verification quality.
  let conviction = signal.managementConfidence;

  // Penalty for component disagreement — if sentiment and bias point
  // opposite ways, conviction drops.
  if (
    Math.abs(signal.sentimentScore) > 0.3 &&
    Math.sign(signal.sentimentScore) !== Math.sign(BIAS_SCORE[signal.tradingBias]) &&
    BIAS_SCORE[signal.tradingBias] !== 0
  ) {
    conviction *= 0.5;
  }

  // Penalty for hallucinated quotes.
  if (quoteCheck && quoteCheck.outcomes.length > 0) {
    conviction *= quoteCheck.verifiedRate;
  }

  return {
    composite,
    components: {
      sentiment: sentimentContribution,
      confidence: signal.managementConfidence,
      guidance: guidanceContribution,
      bias: biasContribution,
    },
    conviction,
  };
}

// ============================================================================
// One-line summary
// ============================================================================

export function summarizeEarningsSignal(
  signal: EarningsSignal,
  score: EarningsSignalScore,
  quoteCheck?: EarningsQuoteCheck,
): string {
  const directionLabel =
    score.composite > 0.3
      ? "bullish"
      : score.composite < -0.3
        ? "bearish"
        : "neutral";
  const convictionLabel =
    score.conviction > 0.7
      ? "high conviction"
      : score.conviction > 0.4
        ? "moderate conviction"
        : "low conviction";
  const quotePart =
    quoteCheck && quoteCheck.outcomes.length > 0
      ? `, ${quoteCheck.hallucinatedCount}/${quoteCheck.outcomes.length} risk-factor quote${quoteCheck.outcomes.length === 1 ? "" : "s"} unverified`
      : "";
  return `${signal.ticker}: ${directionLabel} (composite=${score.composite.toFixed(2)}), ${convictionLabel} (${score.conviction.toFixed(2)}), guidance ${signal.guidanceRevision}, bias ${signal.tradingBias}${quotePart}.`;
}
