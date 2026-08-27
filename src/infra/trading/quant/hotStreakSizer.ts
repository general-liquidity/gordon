/**
 * Hot-Streak Sizing Multiplier — D1.
 *
 * Druckenmiller's "bet big when you're hot" rule, codified.
 * Translates recent realized P&L into a streak classification and a
 * suggested position-size multiplier.
 *
 * Default mode is **informational** — the effective multiplier stays
 * at 1.0 and the suggested multiplier is returned as an observation
 * only. This is deliberate: recommending INCREASED size based on
 * recent winning streaks has tilt-amplification risk if applied
 * automatically. The operator (or downstream sizing chain) explicitly
 * opts into "active" mode if they want the multiplier applied.
 *
 * Streak classification:
 *   recentRealizedPnLPct  ≥  hotThresholdPct       → "hot"
 *   0 < pnl < hotThresholdPct                       → "neutral_positive"
 *   coolThresholdPct ≤ pnl ≤ 0                      → "neutral_negative"
 *   pnl  <  coolThresholdPct                        → "cold"
 *
 * Suggested multiplier (before mode gating):
 *   hot:               linear interp from 1.0 to maxMultiplier as
 *                      pnl rises from hotThreshold to 2× hotThreshold
 *                      (capped at maxMultiplier above 2× threshold)
 *   neutral_positive,
 *   neutral_negative:  1.0 (baseline)
 *   cold:              coldMultiplier (default 0.5)
 *
 * Effective multiplier:
 *   informational mode (default): always 1.0
 *   active mode: suggestedMultiplier
 *
 * Pedigree: Druckenmiller (multiple interviews), via Soros. Same
 * principle the prop-trading lineage articulates as "play with house
 * money." Counterpart to revengeTradeGuard (D2) which catches the
 * other side — never bet big to get even.
 *
 * Pure compute. No I/O.
 */

export type StreakMode = "informational" | "active";
export type StreakClassification = "hot" | "neutral_positive" | "neutral_negative" | "cold";

export interface HotStreakSizerInput {
  /**
   * Recent realized P&L as a fraction (e.g., 0.20 = +20%) over the
   * caller-defined window. Caller decides the window (last N trades,
   * trailing 30 days, etc.).
   */
  recentRealizedPnLPct: number;
  /**
   * Positive P&L threshold above which "hot" engages. Default 0.20
   * (Druckenmiller's stated "up 20-30%" range begins here).
   */
  hotThresholdPct?: number;
  /**
   * Negative P&L threshold below which "cold" engages. Default -0.05.
   */
  coolThresholdPct?: number;
  /**
   * Cap on the suggested multiplier when hot. Default 1.5 (50% size-up).
   */
  maxMultiplier?: number;
  /**
   * Multiplier applied when cold. Default 0.5 (half-size; "minimum
   * probe trades to find out when I've got it again" per Druckenmiller).
   * Set to 0 to refuse trading entirely when cold.
   */
  coldMultiplier?: number;
  /**
   * "informational" (default) returns the suggested multiplier but
   * leaves effectiveMultiplier at 1.0. "active" applies the suggestion.
   */
  mode?: StreakMode;
}

export interface HotStreakSizerResult {
  classification: StreakClassification;
  suggestedMultiplier: number;
  /** Effective multiplier the caller should actually apply. */
  effectiveMultiplier: number;
  mode: StreakMode;
  recommendedAction:
    | "hold"
    | "size_up_unlocked"
    | "size_up_suggested_informational"
    | "size_down"
    | "size_down_suggested_informational"
    | "minimum_probe_only"
    | "refuse";
  reasoning: string;
}

const DEFAULT_HOT = 0.2;
const DEFAULT_COOL = -0.05;
const DEFAULT_MAX_MULTIPLIER = 1.5;
const DEFAULT_COLD_MULTIPLIER = 0.5;

function classify(pnl: number, hotThreshold: number, coolThreshold: number): StreakClassification {
  if (pnl >= hotThreshold) return "hot";
  if (pnl > 0) return "neutral_positive";
  if (pnl >= coolThreshold) return "neutral_negative";
  return "cold";
}

function computeSuggestedMultiplier(
  classification: StreakClassification,
  pnl: number,
  hotThreshold: number,
  maxMultiplier: number,
  coldMultiplier: number,
): number {
  if (classification === "cold") return coldMultiplier;
  if (classification === "neutral_positive" || classification === "neutral_negative") {
    return 1.0;
  }
  // classification === "hot": linear interp 1.0 → maxMultiplier between
  // hotThreshold and 2·hotThreshold; clamped above.
  const surplus = pnl - hotThreshold;
  const range = hotThreshold; // 2·hotThreshold − hotThreshold = hotThreshold
  const fraction = Math.min(1, Math.max(0, surplus / range));
  return 1.0 + fraction * (maxMultiplier - 1.0);
}

export function computeHotStreakSizing(input: HotStreakSizerInput): HotStreakSizerResult {
  if (!Number.isFinite(input.recentRealizedPnLPct)) {
    throw new Error("recentRealizedPnLPct must be finite");
  }
  const hotThreshold = input.hotThresholdPct ?? DEFAULT_HOT;
  const coolThreshold = input.coolThresholdPct ?? DEFAULT_COOL;
  const maxMultiplier = input.maxMultiplier ?? DEFAULT_MAX_MULTIPLIER;
  const coldMultiplier = input.coldMultiplier ?? DEFAULT_COLD_MULTIPLIER;
  const mode: StreakMode = input.mode ?? "informational";
  if (hotThreshold <= 0) {
    throw new Error("hotThresholdPct must be > 0");
  }
  if (coolThreshold >= 0) {
    throw new Error("coolThresholdPct must be < 0");
  }
  if (maxMultiplier < 1) {
    throw new Error("maxMultiplier must be ≥ 1 (this is an upsize, not a downsize)");
  }
  if (coldMultiplier < 0) {
    throw new Error("coldMultiplier must be ≥ 0");
  }

  const pnl = input.recentRealizedPnLPct;
  const classification = classify(pnl, hotThreshold, coolThreshold);
  const suggestedMultiplier = computeSuggestedMultiplier(
    classification,
    pnl,
    hotThreshold,
    maxMultiplier,
    coldMultiplier,
  );
  const effectiveMultiplier = mode === "active" ? suggestedMultiplier : 1.0;

  let recommendedAction: HotStreakSizerResult["recommendedAction"];
  if (classification === "hot") {
    recommendedAction = mode === "active" ? "size_up_unlocked" : "size_up_suggested_informational";
  } else if (classification === "cold") {
    if (coldMultiplier === 0) {
      recommendedAction = "refuse";
    } else if (mode === "active") {
      recommendedAction = coldMultiplier < 1 ? "minimum_probe_only" : "hold";
    } else {
      recommendedAction = "size_down_suggested_informational";
    }
  } else {
    recommendedAction = "hold";
  }

  const reasoning =
    `recent P&L ${(pnl * 100).toFixed(2)}% (hot≥${(hotThreshold * 100).toFixed(0)}%, ` +
    `cool≤${(coolThreshold * 100).toFixed(0)}%) → ${classification}. ` +
    `Suggested ×${suggestedMultiplier.toFixed(3)} (effective ×${effectiveMultiplier.toFixed(3)}, mode=${mode}) ` +
    `→ ${recommendedAction}.`;

  return {
    classification,
    suggestedMultiplier,
    effectiveMultiplier,
    mode,
    recommendedAction,
    reasoning,
  };
}

export function hotStreakSizerToPayload(result: HotStreakSizerResult): Record<string, unknown> {
  return {
    kind: "hot_streak_sizer.computed",
    classification: result.classification,
    suggestedMultiplier: Number(result.suggestedMultiplier.toFixed(4)),
    effectiveMultiplier: Number(result.effectiveMultiplier.toFixed(4)),
    mode: result.mode,
    recommendedAction: result.recommendedAction,
  };
}
