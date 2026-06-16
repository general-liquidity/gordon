/**
 * Tournament Rank / Standing Tracker — estimates our live competitive standing in
 * the ~500-entrant field and emits the "bang-bang" risk signal that times the
 * core → lottery-sleeve flip.
 *
 * THEORY (the whole point). Tournament-optimal play is BANG-BANG, not continuous:
 *   - the LEADER picks MINIMUM variance ("lock in" — protect the prize slot),
 *   - the LAGGARD picks MAXIMUM variance ("nothing to lose" — swing for the top),
 *   - intermediate / middle-of-the-pack risk is DOMINATED.
 * (Bronars; Cabral, "Football, sabotage and the value of breakaways"; Brown–Harlow–
 * Starks, "Of Tournaments and Temptations" — fund-manager risk-shifting on rank.)
 *
 * To ACT on this we need an estimate of our percentile rank vs the field. If a live
 * leaderboard feed is available, the caller supplies the sorted board and we take the
 * empirical rank (`percentileFromBoard`). If not, we model the field's return
 * distribution as a single wide, fat-ish Normal of leveraged bets and read our
 * percentile off Φ((ourReturn − mean)/std) (`estimatePercentile`).
 *
 * The stance machine encodes "middle is dominated": the `neutral` band is NARROW —
 * it only fires when we're genuinely safe-but-not-winning pre-cut. Everywhere else we
 * resolve to one of the two bang-bang extremes.
 *
 * Pure compute. Validate at boundaries only; never throws. No deps, no Math.random.
 */

/** The field's return distribution. Override `mean`/`std`/`n` from a live board if available. */
export interface FieldModel {
  /** Field mean return (fraction, e.g. 0.0 = flat). */
  mean: number;
  /** Field return std (fraction, e.g. 0.40 = 40%). Wide — leveraged bets. */
  std: number;
  /** Number of entrants in the field. */
  n: number;
}

/**
 * Default field model: ~500 leveraged entrants, mean ≈ flat, wide dispersion. A
 * tournament of leveraged bets has a fat, wide return distribution; std 40% is a
 * deliberately wide placeholder until a live board is wired in.
 */
export const DEFAULT_FIELD: FieldModel = { mean: 0, std: 0.4, n: 500 };

export type RiskStance = "lock_in" | "neutral" | "max_variance";

export interface StandingSignal {
  /** Our percentile rank in [0,1]; 1 = top of the field. */
  percentile: number;
  /** Estimated absolute rank, 1 = best. ≈ (1 − percentile)·n, clamped to [1, n]. */
  estimatedRank: number;
  /** Bang-bang stance: lock_in (min variance) | neutral (narrow) | max_variance. */
  stance: RiskStance;
  /** Human-readable justification for the stance. */
  reason: string;
  /** Whether we currently clear the cut line (percentile ≥ cutPercentile). */
  clearsCut: boolean;
}

/**
 * Φ — standard Normal CDF via the Abramowitz & Stegun 7.1.26 erf approximation
 * (max abs error ~1.5e-7). Inline so the module has no deps.
 */
export function normalCdf(z: number): number {
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0;
  // erf(x) via A&S 7.1.26, with the sign carried out front (erf is odd).
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  const erf = sign * y;
  return 0.5 * (1 + erf);
}

/**
 * Our percentile rank (0–1) under a Normal field model: Φ((ourReturn − mean)/std).
 * Degenerate std (≤0 or non-finite) collapses to a step at the mean: above → 1,
 * below → 0, exactly at → 0.5.
 */
export function estimatePercentile(ourReturn: number, field: FieldModel): number {
  const { mean, std } = field;
  if (!Number.isFinite(ourReturn) || !Number.isFinite(mean)) return 0.5;
  if (!Number.isFinite(std) || std <= 0) {
    if (ourReturn > mean) return 1;
    if (ourReturn < mean) return 0;
    return 0.5;
  }
  return clamp01(normalCdf((ourReturn - mean) / std));
}

/**
 * Empirical percentile from an actual sorted-or-unsorted leaderboard of returns.
 * Rank = (# entrants we strictly beat + half of those we tie) / total — the
 * mid-rank convention, so ties don't bias us up or down. Empty board → 0.5.
 */
export function percentileFromBoard(ourReturn: number, boardReturns: number[]): number {
  const board = boardReturns.filter((r) => Number.isFinite(r));
  if (board.length === 0 || !Number.isFinite(ourReturn)) return 0.5;
  let below = 0;
  let equal = 0;
  for (const r of board) {
    if (ourReturn > r) below += 1;
    else if (ourReturn === r) equal += 1;
  }
  return clamp01((below + equal / 2) / board.length);
}

export interface AssessStandingInput {
  ourReturn: number;
  field: FieldModel;
  /**
   * Cut line as a percentile (0–1). E.g. Top-100 of 500 = top 20% = percentile ≥ 0.8,
   * so `cutPercentile: 0.8`. Default 0.8.
   */
  cutPercentile?: number;
  phase: "pre_cut" | "post_cut";
}

/** Pre-cut: how far above the cut we must be before locking in vs staying neutral. */
const PRE_CUT_SAFE_MARGIN = 0.1;
/** Post-cut: percentile above which we protect a prize slot (lock in). */
const POST_CUT_PRIZE_PERCENTILE = 0.9;

/**
 * Compute percentile + estimated rank + the bang-bang stance.
 *
 * pre_cut (the cut hasn't happened yet — survival is binary):
 *   - below the cut line              → max_variance (must move up or be eliminated)
 *   - just above (within safe margin) → neutral      (NARROW band: safe-but-not-winning)
 *   - comfortably above the cut       → lock_in       (don't risk the cut you've made)
 *
 * post_cut (you're in the prize pool — now it's about WHERE you finish):
 *   - top of the field (≥ prize pct)  → lock_in       (protect a prize slot)
 *   - mid / low                       → max_variance  (swing for #1 — the lottery sleeve)
 *
 * The `neutral` band exists ONLY in pre_cut, and only in the thin slice between the
 * cut line and the safe margin — encoding that intermediate risk is otherwise dominated.
 */
export function assessStanding(input: AssessStandingInput): StandingSignal {
  const { ourReturn, field, phase } = input;
  const cutPercentile = clamp01(
    Number.isFinite(input.cutPercentile as number) ? (input.cutPercentile as number) : 0.8,
  );

  const percentile = estimatePercentile(ourReturn, field);
  const n = Number.isFinite(field.n) && field.n > 0 ? Math.floor(field.n) : 1;
  // Rank 1 = best. Top percentile → rank ~1; bottom → rank n. ≈ (1−percentile)·n + 1,
  // clamped to [1, n] (p=1 → 1, p=0 → n).
  const estimatedRank = Math.min(n, Math.max(1, Math.round((1 - percentile) * (n - 1)) + 1));
  const clearsCut = percentile >= cutPercentile;

  let stance: RiskStance;
  let reason: string;

  if (phase === "pre_cut") {
    if (!clearsCut) {
      stance = "max_variance";
      reason =
        `Below the cut (p${pct(percentile)} < cut p${pct(cutPercentile)}); ` +
        `must increase variance to climb above the cut line or be eliminated.`;
    } else if (percentile < cutPercentile + PRE_CUT_SAFE_MARGIN) {
      stance = "neutral";
      reason =
        `Just above the cut (p${pct(percentile)}, cut p${pct(cutPercentile)}); ` +
        `safe-but-thin margin — hold, neither risk the cut nor over-tighten.`;
    } else {
      stance = "lock_in";
      reason =
        `Comfortably above the cut (p${pct(percentile)} ≥ cut p${pct(cutPercentile)} + margin); ` +
        `lock in minimum variance — don't risk a cut you've already made.`;
    }
  } else {
    // post_cut
    if (percentile >= POST_CUT_PRIZE_PERCENTILE) {
      stance = "lock_in";
      reason =
        `Top of the field post-cut (p${pct(percentile)} ≥ p${pct(POST_CUT_PRIZE_PERCENTILE)}); ` +
        `lock in minimum variance to protect a prize slot.`;
    } else {
      stance = "max_variance";
      reason =
        `Mid/low post-cut (p${pct(percentile)} < p${pct(POST_CUT_PRIZE_PERCENTILE)}); ` +
        `nothing to lose on rank — flip to the lottery sleeve and swing for #1.`;
    }
  }

  return { percentile, estimatedRank, stance, reason, clearsCut };
}

/** Human-readable standing summary. */
export function formatStanding(signal: StandingSignal, field?: FieldModel): string {
  const fieldStr = field && Number.isFinite(field.n) ? ` of ${Math.floor(field.n)}` : "";
  const stanceLabel: Record<RiskStance, string> = {
    lock_in: "LOCK IN (min variance)",
    neutral: "NEUTRAL (hold)",
    max_variance: "MAX VARIANCE (lottery sleeve)",
  };
  return [
    `Standing — rank ~#${signal.estimatedRank}${fieldStr} (p${pct(signal.percentile)})` +
      `${signal.clearsCut ? " — clears cut" : " — below cut"}`,
    `Stance: ${stanceLabel[signal.stance]}`,
    `Why: ${signal.reason}`,
  ].join("\n");
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0.5;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

const pct = (x: number): string => (x * 100).toFixed(1);
