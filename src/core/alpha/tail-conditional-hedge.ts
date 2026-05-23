/**
 * Tail-Conditional Hedge Classifier
 *
 * Matt's framing: "Treasuries are a peace-time hedge. They work
 * really well until they really really really don't." Given a target
 * asset's return series + N candidate hedges' return series, score
 * each hedge separately for peace-time vs tail-event correlation
 * structure. Classify by reliability across regimes.
 *
 * Distinct from:
 *   - `effective-n.ts`           (unconditional pairwise correlations
 *                                  across the whole window; treats all
 *                                  observations equally)
 *   - `marginal-contribution.ts` (drawdown overlap, aggregated; doesn't
 *                                  expose peace-time vs tail-time
 *                                  separately)
 *   - `reversal-timing.ts`       (level-by-level reversal correlation
 *                                  in time; not regime-conditional)
 *
 * Use case:
 *   - "Which hedge for my long X portfolio holds up in a riskoff move?"
 *   - "Is my treasury hedge actually robust or am I exposed in tail?"
 *
 * The regime is defined by the rolling N-day volatility quantile of
 * the TARGET asset itself. Default: top 10% of volatility = tail
 * regime; bottom 50% = peace regime. Caller can override.
 *
 * Output per hedge:
 *   - Peace-time correlation (low-vol regime)
 *   - Tail-time correlation (high-vol regime)
 *   - Reliability class:
 *       robust          — both correlations strongly negative
 *       peace_time      — strongly negative in peace, fails in tail
 *       fair_weather    — weakly negative in peace, fails in tail
 *       volatile        — sign flips between regimes
 *       anti_hedge      — positive correlation (wrong sign)
 *       insufficient    — not enough observations in either regime
 *
 * Pure function.
 */
import { pearsonCorrelation, sampleStd } from "./helpers.ts";

export interface HedgeCandidate {
  symbol: string;
  /** Hedge returns aligned 1:1 with target returns. */
  returns: ReadonlyArray<number>;
}

export interface TailConditionalHedgeInput {
  /** Target asset returns (the thing being hedged), ordered oldest → newest. */
  targetReturns: ReadonlyArray<number>;
  /** Candidate hedges, each return series aligned 1:1 with targetReturns. */
  candidateHedges: ReadonlyArray<HedgeCandidate>;
  /**
   * Rolling window for computing target-asset volatility used to
   * regime-classify observations. Default 20.
   */
  volWindow?: number;
  /**
   * Volatility quantile above which observations are "tail." Default
   * 0.90 (top 10%).
   */
  tailQuantile?: number;
  /**
   * Volatility quantile below which observations are "peace." Default
   * 0.50 (bottom 50%).
   */
  peaceQuantile?: number;
  /**
   * Minimum observations in each regime for a confident verdict.
   * Default 20.
   */
  minObservationsPerRegime?: number;
  /**
   * Correlation magnitude above which a hedge is considered "strong"
   * (and thus robust if also negative-signed). Default 0.40.
   */
  strongCorrThreshold?: number;
  /**
   * Correlation magnitude above which a hedge is considered "weak"
   * (but non-zero). Default 0.15.
   */
  weakCorrThreshold?: number;
}

export type HedgeReliability =
  | "robust"
  | "peace_time"
  | "fair_weather"
  | "volatile"
  | "anti_hedge"
  | "insufficient";

export interface HedgeClassification {
  symbol: string;
  peaceTimeCorrelation: number | null;
  tailTimeCorrelation: number | null;
  unconditionalCorrelation: number | null;
  peaceObservations: number;
  tailObservations: number;
  reliability: HedgeReliability;
  reason: string;
}

export type OverallVerdict = "ranked" | "insufficient_data";

export interface TailConditionalHedgeResult {
  sampleSize: number;
  peaceObservations: number;
  tailObservations: number;
  /** Per-hedge classification, sorted with robust hedges first. */
  hedges: HedgeClassification[];
  /** Best robust hedge if any exists; else null. */
  bestRobustHedge: string | null;
  verdict: OverallVerdict;
  summary: string;
}

const DEFAULT_VOL_WINDOW = 20;
const DEFAULT_TAIL_Q = 0.90;
const DEFAULT_PEACE_Q = 0.50;
const DEFAULT_MIN_OBS = 20;
const DEFAULT_STRONG = 0.40;
const DEFAULT_WEAK = 0.15;

function rollingVol(returns: ReadonlyArray<number>, window: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < returns.length; i++) {
    if (i < window - 1) {
      out.push(0);
      continue;
    }
    const slice = returns.slice(i - window + 1, i + 1) as number[];
    out.push(sampleStd(slice));
  }
  return out;
}

function quantileOf(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(q * sorted.length)));
  return sorted[idx]!;
}

function classifyReliability(
  peace: number | null,
  tail: number | null,
  strong: number,
  weak: number,
): { reliability: HedgeReliability; reason: string } {
  if (peace === null || tail === null) {
    return {
      reliability: "insufficient",
      reason: "Not enough observations in one or both regimes.",
    };
  }
  // Positive correlation = anti-hedge (wrong sign)
  if (peace > weak && tail > weak) {
    return {
      reliability: "anti_hedge",
      reason: `Both correlations positive (peace +${peace.toFixed(2)}, tail +${tail.toFixed(2)}) — moves WITH the target, not against.`,
    };
  }
  // Sign flips between regimes
  if ((peace < -weak && tail > weak) || (peace > weak && tail < -weak)) {
    return {
      reliability: "volatile",
      reason: `Correlation flips sign across regimes (peace ${peace.toFixed(2)}, tail ${tail.toFixed(2)}).`,
    };
  }
  // Robust: both regimes strongly negative
  if (peace <= -strong && tail <= -strong) {
    return {
      reliability: "robust",
      reason: `Both regimes strongly negative (peace ${peace.toFixed(2)}, tail ${tail.toFixed(2)}). Holds up in crisis.`,
    };
  }
  // Peace-time hedge: strong in peace, breaks in tail
  if (peace <= -strong && tail > -weak) {
    return {
      reliability: "peace_time",
      reason: `Strong peace-time correlation ${peace.toFixed(2)} but fails in tail (${tail.toFixed(2)}). Matt's canonical Treasury-style peace-time hedge.`,
    };
  }
  // Fair-weather: weak in peace, fails in tail
  if (peace <= -weak && tail > -weak) {
    return {
      reliability: "fair_weather",
      reason: `Weak peace correlation ${peace.toFixed(2)}, fails in tail (${tail.toFixed(2)}).`,
    };
  }
  // Default to volatile when none of the above patterns hold cleanly
  return {
    reliability: "volatile",
    reason: `Peace ${peace.toFixed(2)}, tail ${tail.toFixed(2)} — no clear pattern.`,
  };
}

function reliabilityRank(reliability: HedgeReliability): number {
  switch (reliability) {
    case "robust":
      return 0;
    case "peace_time":
      return 1;
    case "fair_weather":
      return 2;
    case "volatile":
      return 3;
    case "anti_hedge":
      return 4;
    case "insufficient":
      return 5;
  }
}

export function classifyTailConditionalHedges(
  input: TailConditionalHedgeInput,
): TailConditionalHedgeResult {
  const target = input.targetReturns;
  const volWindow = input.volWindow ?? DEFAULT_VOL_WINDOW;
  const tailQ = input.tailQuantile ?? DEFAULT_TAIL_Q;
  const peaceQ = input.peaceQuantile ?? DEFAULT_PEACE_Q;
  const minObs = input.minObservationsPerRegime ?? DEFAULT_MIN_OBS;
  const strong = input.strongCorrThreshold ?? DEFAULT_STRONG;
  const weak = input.weakCorrThreshold ?? DEFAULT_WEAK;

  if (target.length < volWindow + minObs * 2) {
    return {
      sampleSize: target.length,
      peaceObservations: 0,
      tailObservations: 0,
      hedges: [],
      bestRobustHedge: null,
      verdict: "insufficient_data",
      summary: `Insufficient target observations (${target.length}; need ≥ ${volWindow + minObs * 2}).`,
    };
  }

  const vols = rollingVol(target, volWindow);
  // Use only observations after the rolling-window warm-up
  const valid: number[] = [];
  for (let i = volWindow - 1; i < vols.length; i++) valid.push(vols[i]!);
  const peaceThreshold = quantileOf(valid, peaceQ);
  const tailThreshold = quantileOf(valid, tailQ);

  const peaceIdx: number[] = [];
  const tailIdx: number[] = [];
  for (let i = volWindow - 1; i < vols.length; i++) {
    const v = vols[i]!;
    if (v <= peaceThreshold) peaceIdx.push(i);
    if (v >= tailThreshold) tailIdx.push(i);
  }

  const peaceTarget = peaceIdx.map((i) => target[i]!);
  const tailTarget = tailIdx.map((i) => target[i]!);

  const hedges: HedgeClassification[] = [];
  for (const candidate of input.candidateHedges) {
    if (candidate.returns.length !== target.length) {
      hedges.push({
        symbol: candidate.symbol,
        peaceTimeCorrelation: null,
        tailTimeCorrelation: null,
        unconditionalCorrelation: null,
        peaceObservations: 0,
        tailObservations: 0,
        reliability: "insufficient",
        reason: `Length mismatch: target ${target.length}, hedge ${candidate.returns.length}.`,
      });
      continue;
    }
    const peaceHedge = peaceIdx.map((i) => candidate.returns[i]!);
    const tailHedge = tailIdx.map((i) => candidate.returns[i]!);

    const peaceCorr =
      peaceTarget.length >= minObs
        ? pearsonCorrelation(peaceTarget, peaceHedge)
        : null;
    const tailCorr =
      tailTarget.length >= minObs
        ? pearsonCorrelation(tailTarget, tailHedge)
        : null;
    const unconditional = pearsonCorrelation(
      [...target] as number[],
      [...candidate.returns] as number[],
    );

    const cls = classifyReliability(peaceCorr, tailCorr, strong, weak);
    hedges.push({
      symbol: candidate.symbol,
      peaceTimeCorrelation: peaceCorr === null ? null : parseFloat(peaceCorr.toFixed(4)),
      tailTimeCorrelation: tailCorr === null ? null : parseFloat(tailCorr.toFixed(4)),
      unconditionalCorrelation:
        unconditional === null ? null : parseFloat(unconditional.toFixed(4)),
      peaceObservations: peaceTarget.length,
      tailObservations: tailTarget.length,
      reliability: cls.reliability,
      reason: cls.reason,
    });
  }

  hedges.sort((a, b) => reliabilityRank(a.reliability) - reliabilityRank(b.reliability));

  const bestRobust = hedges.find((h) => h.reliability === "robust");
  const verdict: OverallVerdict =
    peaceTarget.length >= minObs && tailTarget.length >= minObs
      ? "ranked"
      : "insufficient_data";

  const summary =
    `${target.length} target observations: ${peaceTarget.length} peace, ${tailTarget.length} tail. ` +
    `Vol thresholds — peace ≤ ${peaceThreshold.toFixed(6)}, tail ≥ ${tailThreshold.toFixed(6)}. ` +
    `${hedges.filter((h) => h.reliability === "robust").length} robust hedges, ` +
    `${hedges.filter((h) => h.reliability === "peace_time").length} peace-time-only. ` +
    (bestRobust ? `Best robust: ${bestRobust.symbol}.` : "No robust hedge identified.");

  return {
    sampleSize: target.length,
    peaceObservations: peaceTarget.length,
    tailObservations: tailTarget.length,
    hedges,
    bestRobustHedge: bestRobust?.symbol ?? null,
    verdict,
    summary,
  };
}

export function formatTailConditionalHedge(
  result: TailConditionalHedgeResult,
): string {
  const lines = [
    `Tail-Conditional Hedge — ${result.verdict.toUpperCase()}`,
    "",
    `  Target observations: ${result.sampleSize}`,
    `  Peace regime: ${result.peaceObservations}`,
    `  Tail regime:  ${result.tailObservations}`,
    "",
    "  Candidates (sorted best to worst):",
  ];
  for (const h of result.hedges) {
    const peaceStr = h.peaceTimeCorrelation === null ? " n/a " : h.peaceTimeCorrelation.toFixed(3).padStart(5);
    const tailStr = h.tailTimeCorrelation === null ? " n/a " : h.tailTimeCorrelation.toFixed(3).padStart(5);
    lines.push(
      `    ${h.symbol.padEnd(10)} peace=${peaceStr}  tail=${tailStr}  → ${h.reliability}`,
    );
    lines.push(`      ${h.reason}`);
  }
  lines.push("");
  lines.push(`Summary: ${result.summary}`);
  return lines.join("\n");
}
