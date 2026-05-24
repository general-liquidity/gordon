/**
 * Ensemble Signal Combiner — weak-learners-to-strong-learner aggregation.
 *
 * Premise (López de Prado *Advances in Financial Machine Learning* ch. on
 * ensembles; algo trader 2026 video framing): a collection of mediocre
 * indicators each producing a directional signal in [-1, +1] can be
 * combined into one composite signal that is more robust than any
 * individual member. Two assets agreeing weakly is structurally
 * different from two assets disagreeing — both have the same
 * arithmetic mean signal but very different conviction.
 *
 * Each source emits a signal in [-1, +1]:
 *   - −1 = full short, +1 = full long, 0 = neutral
 *   - intermediate values express partial conviction
 *
 * Composite = Σ(w_i × s_i) / Σ(w_i). The composite is itself in [-1, +1]
 * and is the natural input to continuous (vol-targeted or otherwise)
 * position sizing: `notional = max_notional × compositeScore`.
 *
 * Agreement diagnostic: fraction of sources whose sign matches the
 * composite direction. High composite + low agreement = "one big signal
 * overwhelms many small opposite signals" — the ensemble is FRAGILE.
 *
 * Distinct from:
 *   - `infra/trading/ops/confluenceScorer.ts` (TraderMorin A-star / A /
 *      B / C tier count of present/absent confluences; categorical RISK
 *      MULTIPLIER, not directional aggregation)
 *   - `composite-attribution.ts` (per-DIMENSION attribution of risk-
 *      classifier verdicts — explains why a risk gate fired; doesn't
 *      aggregate directional signals)
 *   - `cross-sectional-momentum.ts` (single-signal ranking across assets;
 *      this primitive aggregates MULTIPLE signals on ONE asset/decision)
 *
 * Composes with:
 *   - `cross-sectional-momentum`, `fip-momentum-quality` (LV38),
 *     `aggression-ratio` (LV22), `volume-pattern-edge` (LV32),
 *     `ma-crossover-cleanness` (LV31)  — feed their per-asset
 *     directional signals here
 *   - `vol-target-sizer` (LV37) / `volScaledSizing` — multiply
 *     compositeScore by max notional, then apply vol-target
 *
 * Pure compute. Pedigree: López de Prado AFML; ensemble-method
 * literature in ML adapted to trading.
 */

export interface EnsembleSignal {
  id: string;
  /** Directional signal in [-1, +1]. Out-of-range values are clipped. */
  value: number;
  /** Optional non-negative weight. Default 1. */
  weight?: number;
  /** Optional one-line evidence/description. */
  description?: string;
}

export interface EnsembleCombinerOptions {
  /**
   * |composite| ≥ this counts as "strong" (strong_long / strong_short).
   * Default 0.6.
   */
  strongThreshold?: number;
  /**
   * |composite| ≥ this counts as at least "weak". Below = neutral.
   * Default 0.2. Must satisfy weak < strong.
   */
  weakThreshold?: number;
  /**
   * Minimum number of valid signals required for a verdict.
   * Default 2.
   */
  minSources?: number;
  /**
   * Minimum agreement fraction (sources matching composite direction)
   * below which the verdict is downgraded to "disagreement". Default 0.6.
   */
  agreementThreshold?: number;
  /**
   * If true (default), values outside [-1, +1] are clipped to the range
   * with a warning logged in `perSource`. If false, they're rejected.
   */
  clipOutOfRange?: boolean;
}

export interface PerSourceContribution {
  id: string;
  value: number;
  weight: number;
  /** w_i × s_i. Signed; in same scale as the weighted composite numerator. */
  weightedContribution: number;
  /** True iff sign(value) === sign(composite). Neutral sources count as agreeing. */
  agreesWithComposite: boolean;
  description?: string;
}

export type EnsembleDirection = "long" | "short" | "neutral";

export type EnsembleVerdict =
  | "strong_long"
  | "weak_long"
  | "neutral"
  | "weak_short"
  | "strong_short"
  | "disagreement"
  | "insufficient_data";

export interface EnsembleSignalResult {
  totalSources: number;
  validSources: number;
  /** Σ(w_i × s_i) / Σ(w_i). In [-1, +1] under valid inputs. */
  compositeScore: number;
  direction: EnsembleDirection;
  /** |compositeScore| in [0, 1]. */
  conviction: number;
  /** Fraction of valid sources whose sign matches direction. In [0, 1]. */
  agreementFraction: number;
  perSource: PerSourceContribution[];
  /**
   * Suggested continuous position size as a fraction of max notional.
   * Equal to compositeScore (signed). Caller multiplies by their cap.
   */
  continuousPositionFraction: number;
  verdict: EnsembleVerdict;
  summary: string;
}

const DEFAULT_STRONG = 0.6;
const DEFAULT_WEAK = 0.2;
const DEFAULT_MIN_SOURCES = 2;
const DEFAULT_AGREEMENT = 0.6;

function clipToUnit(x: number): number {
  if (x > 1) return 1;
  if (x < -1) return -1;
  return x;
}

export function combineEnsembleSignals(
  signals: ReadonlyArray<EnsembleSignal>,
  options: EnsembleCombinerOptions = {},
): EnsembleSignalResult {
  const strong = options.strongThreshold ?? DEFAULT_STRONG;
  const weak = options.weakThreshold ?? DEFAULT_WEAK;
  const minSources = options.minSources ?? DEFAULT_MIN_SOURCES;
  const agreementThreshold = options.agreementThreshold ?? DEFAULT_AGREEMENT;
  const clip = options.clipOutOfRange ?? true;

  if (!(weak >= 0 && weak < strong && strong <= 1)) {
    return {
      totalSources: signals.length,
      validSources: 0,
      compositeScore: 0,
      direction: "neutral",
      conviction: 0,
      agreementFraction: 0,
      perSource: [],
      continuousPositionFraction: 0,
      verdict: "insufficient_data",
      summary: `Invalid thresholds (weak=${weak}, strong=${strong}). Need 0 ≤ weak < strong ≤ 1.`,
    };
  }

  const valid: Array<{
    id: string;
    value: number;
    weight: number;
    description?: string;
  }> = [];
  for (const s of signals) {
    if (!Number.isFinite(s.value)) continue;
    const weight = s.weight ?? 1;
    if (!Number.isFinite(weight) || weight < 0) continue;
    let v = s.value;
    if (v < -1 || v > 1) {
      if (!clip) continue;
      v = clipToUnit(v);
    }
    valid.push({ id: s.id, value: v, weight, description: s.description });
  }

  if (valid.length < minSources) {
    return {
      totalSources: signals.length,
      validSources: valid.length,
      compositeScore: 0,
      direction: "neutral",
      conviction: 0,
      agreementFraction: 0,
      perSource: [],
      continuousPositionFraction: 0,
      verdict: "insufficient_data",
      summary: `Need ≥${minSources} valid signals (have ${valid.length}).`,
    };
  }

  const totalWeight = valid.reduce((s, v) => s + v.weight, 0);
  if (totalWeight <= 0) {
    return {
      totalSources: signals.length,
      validSources: valid.length,
      compositeScore: 0,
      direction: "neutral",
      conviction: 0,
      agreementFraction: 0,
      perSource: [],
      continuousPositionFraction: 0,
      verdict: "insufficient_data",
      summary: "All source weights are zero.",
    };
  }

  const weightedSum = valid.reduce((s, v) => s + v.weight * v.value, 0);
  const compositeScore = weightedSum / totalWeight;
  const conviction = Math.abs(compositeScore);
  const direction: EnsembleDirection =
    compositeScore > 0 ? "long" : compositeScore < 0 ? "short" : "neutral";

  // Per-source contribution + agreement
  const perSource: PerSourceContribution[] = valid.map((v) => {
    const wc = v.weight * v.value;
    const agrees =
      direction === "neutral"
        ? true
        : (direction === "long" && v.value >= 0) ||
          (direction === "short" && v.value <= 0);
    return {
      id: v.id,
      value: parseFloat(v.value.toFixed(6)),
      weight: parseFloat(v.weight.toFixed(6)),
      weightedContribution: parseFloat(wc.toFixed(6)),
      agreesWithComposite: agrees,
      description: v.description,
    };
  });

  const agreementFraction =
    perSource.filter((p) => p.agreesWithComposite).length / perSource.length;

  // Verdict: first classify by conviction, then check agreement
  let verdict: EnsembleVerdict;
  if (conviction < weak) {
    verdict = "neutral";
  } else if (agreementFraction < agreementThreshold) {
    verdict = "disagreement";
  } else if (conviction >= strong) {
    verdict = compositeScore > 0 ? "strong_long" : "strong_short";
  } else {
    verdict = compositeScore > 0 ? "weak_long" : "weak_short";
  }

  const summary = (() => {
    const dirLabel = direction === "long" ? "LONG" : direction === "short" ? "SHORT" : "NEUTRAL";
    const conv = (conviction * 100).toFixed(0);
    const agree = (agreementFraction * 100).toFixed(0);
    switch (verdict) {
      case "neutral":
        return `NEUTRAL — composite ${compositeScore.toFixed(3)} below weak threshold ${weak.toFixed(2)}. No directional bet.`;
      case "weak_long":
      case "weak_short":
        return `${dirLabel} (weak) — composite ${compositeScore.toFixed(3)}, conviction ${conv}%, agreement ${agree}%. Continuous sizing fraction ${compositeScore.toFixed(3)}.`;
      case "strong_long":
      case "strong_short":
        return `${dirLabel} (strong) — composite ${compositeScore.toFixed(3)}, conviction ${conv}%, agreement ${agree}%. Continuous sizing fraction ${compositeScore.toFixed(3)}.`;
      case "disagreement":
        return `DISAGREEMENT — composite ${compositeScore.toFixed(3)} has conviction ${conv}% but agreement only ${agree}% (need ≥${(agreementThreshold * 100).toFixed(0)}%). One source likely dominating; ensemble is fragile.`;
      default:
        return `Insufficient data.`;
    }
  })();

  return {
    totalSources: signals.length,
    validSources: valid.length,
    compositeScore: parseFloat(compositeScore.toFixed(6)),
    direction,
    conviction: parseFloat(conviction.toFixed(6)),
    agreementFraction: parseFloat(agreementFraction.toFixed(4)),
    perSource,
    continuousPositionFraction: parseFloat(compositeScore.toFixed(6)),
    verdict,
    summary,
  };
}

export function formatEnsembleSignal(result: EnsembleSignalResult): string {
  const lines = [
    `Ensemble Signal — ${result.verdict.toUpperCase()}`,
    "",
    `  Total / valid sources:   ${result.totalSources} / ${result.validSources}`,
    `  Composite score:         ${result.compositeScore.toFixed(3)}  (direction: ${result.direction})`,
    `  Conviction:              ${(result.conviction * 100).toFixed(1)}%`,
    `  Agreement fraction:      ${(result.agreementFraction * 100).toFixed(1)}%`,
    `  Continuous position frac:${result.continuousPositionFraction.toFixed(3)}`,
    "",
    `  Per-source:`,
  ];
  for (const p of result.perSource) {
    const tag = p.agreesWithComposite ? "[ok] " : "[opp]";
    lines.push(
      `    ${tag} ${p.id.padEnd(16)} val=${p.value.toFixed(3).padStart(6)} w=${p.weight.toFixed(2).padStart(4)} contrib=${p.weightedContribution.toFixed(3).padStart(6)}${p.description ? `  ${p.description}` : ""}`,
    );
  }
  lines.push("");
  lines.push(`Summary: ${result.summary}`);
  return lines.join("\n");
}
