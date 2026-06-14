/**
 * Lever-Attribution Diagnostic.
 *
 * Edge-Driven Development treats an edge as pass/fail: the live monitor retires
 * the WHOLE edge when a kill fires or realized R decays. Neither says WHICH lever
 * of the edge is load-bearing vs dead weight. This is the missing "diagnostic"
 * (the superdense framing): a measurement that explains why a lever did or did
 * not move the outcome — so a degrading edge points to the lever to sharpen
 * instead of being scrapped.
 *
 * The levers are the edge's invariants. An invariant is binary-satisfied at the
 * gate, but every TAKEN trade satisfied all invariants — so segmenting by
 * satisfied/not has no variation. The signal is the lever's ENTRY-MARGIN: the
 * continuous strength with which it held at entry (netEdgeBps 45 vs barely 2;
 * regime confidence 0.9 vs 0.6). For each lever this buckets trades into strong
 * vs marginal by entry-margin and asks whether realized R differs.
 *
 * Pure — caller supplies the lever-tagged trades (same contract as the sibling
 * inaction-value estimator). Advisory only: it recommends, it never auto-acts
 * (cf. composite-attribution). Statistics are reused validated primitives
 * (Wilson CI, Student-t, significance tiers) with a Bonferroni correction across
 * the N levers tested — a lever that looks good at 0.05 but fails at 0.05/N is
 * not flagged to sharpen.
 */

import { wilsonInterval } from "../../infra/safety/expectancyByTag.ts";
import { studentTTwoSidedPValue } from "../indicators/linearRegression.ts";
import type { EdgeSpec } from "../edge/types.ts";

export interface LeverTaggedTrade {
  tradeId: string;
  /** Realized R-multiple of the closed trade. */
  realizedR: number;
  /** leverId (= EdgeInvariant.id) → entry margin. Higher = the lever held more
   *  strongly at entry. A trade omits a lever it carries no margin for. */
  leverMargins: Record<string, number>;
}

export type LeverRecommendation = "sharpen" | "keep" | "drop" | "invert" | "defer";
export type SignificanceTier = "robust" | "preliminary" | "insufficient";

export interface LeverBucketStats {
  n: number;
  /** Mean realized R in the bucket. */
  expectancyR: number;
  winRate: number;
  /** 95% Wilson interval on the win rate. */
  winRateCi: { lower: number; upper: number };
  significance: SignificanceTier;
}

export interface LeverDiagnostic {
  leverId: string;
  metric: string;
  /** Entry-margin ≥ split. */
  strong: LeverBucketStats;
  /** Entry-margin < split. */
  marginal: LeverBucketStats;
  /** strong.expectancyR − marginal.expectancyR. */
  discriminationR: number;
  /** Two-sided Welch t-test p-value of the difference; null when undeterminable. */
  pValue: number | null;
  recommendation: LeverRecommendation;
  reason: string;
}

export interface LeverAttributionReport {
  edge: string;
  leversTested: number;
  /** Bonferroni-corrected alpha = baseAlpha / leversTested. */
  correctedAlpha: number;
  /** Sorted by |discriminationR| descending. */
  levers: LeverDiagnostic[];
  /** Largest significant discrimination — the lever to sharpen first. */
  topLever: LeverDiagnostic | null;
  summary: string;
}

export interface LeverAttributionOptions {
  /** Base significance level before Bonferroni. Default 0.05. */
  alpha?: number;
  /** Per-lever entry-margin split point; default is that lever's median margin. */
  split?: Record<string, number>;
  /** Min sample for the "robust" tier. Default 50. */
  robustThreshold?: number;
  /** Min sample for the "preliminary" tier. Default 30. */
  preliminaryThreshold?: number;
  /** A discrimination smaller than this (and not significant) reads as a dead
   *  lever → drop. Default 0.1 R. */
  deadLeverThresholdR?: number;
}

const DEFAULTS = { alpha: 0.05, robust: 50, preliminary: 30, dead: 0.1 } as const;

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Welch's unequal-variance t-test → { t, df }, or null when undeterminable. */
function welchT(a: number[], b: number[]): { t: number; df: number } | null {
  if (a.length < 2 || b.length < 2) return null;
  const ma = mean(a);
  const mb = mean(b);
  const va = a.reduce((s, v) => s + (v - ma) ** 2, 0) / (a.length - 1);
  const vb = b.reduce((s, v) => s + (v - mb) ** 2, 0) / (b.length - 1);
  const sa = va / a.length;
  const sb = vb / b.length;
  const denom = sa + sb;
  if (denom <= 0) return null; // both buckets constant — no testable difference
  const t = (ma - mb) / Math.sqrt(denom);
  const df = (denom * denom) / ((sa * sa) / (a.length - 1) + (sb * sb) / (b.length - 1));
  return { t, df };
}

function bucketStats(rs: number[], robust: number, preliminary: number): LeverBucketStats {
  const n = rs.length;
  const wins = rs.filter((r) => r > 0).length;
  const significance: SignificanceTier = n >= robust ? "robust" : n >= preliminary ? "preliminary" : "insufficient";
  return {
    n,
    expectancyR: mean(rs),
    winRate: n ? wins / n : 0,
    winRateCi: wilsonInterval(wins, n),
    significance,
  };
}

function scoreLever(
  leverId: string,
  metric: string,
  trades: LeverTaggedTrade[],
  correctedAlpha: number,
  opts: LeverAttributionOptions,
): LeverDiagnostic {
  const robust = opts.robustThreshold ?? DEFAULTS.robust;
  const preliminary = opts.preliminaryThreshold ?? DEFAULTS.preliminary;
  const deadR = opts.deadLeverThresholdR ?? DEFAULTS.dead;

  const tagged = trades.filter((t) => typeof t.leverMargins[leverId] === "number");
  const split = opts.split?.[leverId] ?? median(tagged.map((t) => t.leverMargins[leverId]!));

  const strongRs = tagged.filter((t) => t.leverMargins[leverId]! >= split).map((t) => t.realizedR);
  const marginalRs = tagged.filter((t) => t.leverMargins[leverId]! < split).map((t) => t.realizedR);

  const strong = bucketStats(strongRs, robust, preliminary);
  const marginal = bucketStats(marginalRs, robust, preliminary);
  const discriminationR = strong.expectancyR - marginal.expectancyR;

  const w = welchT(strongRs, marginalRs);
  const pValue = w ? studentTTwoSidedPValue(w.t, w.df) : null;
  const significant = pValue !== null && pValue < correctedAlpha;

  let recommendation: LeverRecommendation;
  let reason: string;
  if (strong.significance === "insufficient" || marginal.significance === "insufficient") {
    recommendation = "defer";
    reason = `Insufficient sample to judge (strong n=${strong.n}, marginal n=${marginal.n})`;
  } else if (significant && discriminationR > 0) {
    recommendation = "sharpen";
    reason = `Strong entries average ${strong.expectancyR.toFixed(2)}R vs ${marginal.expectancyR.toFixed(2)}R marginal (p=${pValue!.toFixed(3)} < ${correctedAlpha.toFixed(3)}) — tighten the ${metric} threshold`;
  } else if (significant && discriminationR <= 0) {
    recommendation = "invert";
    reason = `Marginal entries beat strong (${marginal.expectancyR.toFixed(2)}R vs ${strong.expectancyR.toFixed(2)}R, p=${pValue!.toFixed(3)}) — the ${metric} lever is backwards`;
  } else if (Math.abs(discriminationR) < deadR) {
    recommendation = "drop";
    reason = `No separation by ${metric} (Δ=${discriminationR.toFixed(2)}R, not significant) — the lever gates trades without improving them`;
  } else {
    recommendation = "keep";
    reason = `Suggestive (Δ=${discriminationR.toFixed(2)}R) but not robust at α=${correctedAlpha.toFixed(3)}`;
  }

  return { leverId, metric, strong, marginal, discriminationR, pValue, recommendation, reason };
}

/**
 * Attribute an edge's realized performance to its levers (= invariants). For each
 * lever, split the trades by entry-margin and test whether realized R differs,
 * Bonferroni-corrected across the levers tested.
 */
export function analyzeLeverAttribution(
  edge: EdgeSpec,
  trades: LeverTaggedTrade[],
  opts: LeverAttributionOptions = {},
): LeverAttributionReport {
  const baseAlpha = opts.alpha ?? DEFAULTS.alpha;
  const leversTested = Math.max(1, edge.invariants.length);
  const correctedAlpha = baseAlpha / leversTested;

  const levers = edge.invariants
    .map((inv) => scoreLever(inv.id, inv.metric, trades, correctedAlpha, opts))
    .sort((a, b) => Math.abs(b.discriminationR) - Math.abs(a.discriminationR));

  const sharpenable = levers.filter((l) => l.recommendation === "sharpen");
  const topLever = sharpenable.length
    ? sharpenable.reduce((best, l) => (l.discriminationR > best.discriminationR ? l : best))
    : null;

  const counts = levers.reduce<Record<string, number>>((acc, l) => {
    acc[l.recommendation] = (acc[l.recommendation] ?? 0) + 1;
    return acc;
  }, {});
  const summary =
    `Edge "${edge.name}": ${edge.invariants.length} levers — ` +
    (["sharpen", "invert", "drop", "keep", "defer"] as const)
      .filter((r) => counts[r])
      .map((r) => `${counts[r]} ${r}`)
      .join(", ") +
    (topLever ? `. Sharpen first: ${topLever.leverId} (+${topLever.discriminationR.toFixed(2)}R).` : ".");

  return { edge: edge.name, leversTested: edge.invariants.length, correctedAlpha, levers, topLever, summary };
}
