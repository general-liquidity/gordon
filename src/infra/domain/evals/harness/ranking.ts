/**
 * Statistical ranking of N variants — Bradley-Terry strength + Wilson-score
 * confidence intervals over per-scenario pairwise judgments.
 *
 * The judge (`trajectoryJudge.ts`) ranks trajectories WITHIN one scenario, and
 * `detectRegressions` compares exactly two variants pairwise. Neither answers
 * the leaderboard question: given N candidates scored across many scenarios,
 * which is best, and are the top two actually distinguishable or is the gap
 * inside the noise? This module answers it deterministically.
 *
 * Method (small, well-understood, no external deps):
 *   1. Reduce every scenario to pairwise outcomes — for each unordered pair of
 *      variants that both scored the scenario, the higher score wins (a tie
 *      splits 0.5/0.5). This is the RULER relative-ranking signal aggregated
 *      into a round-robin tournament.
 *   2. Each variant's overall WIN RATE (wins / games) gets a Wilson score
 *      interval — the correct small-sample binomial CI (never runs off [0,1],
 *      unlike the normal approximation). This is the ranking metric + its CI.
 *   3. Bradley-Terry strengths (MM iteration) are reported alongside as a
 *      model-based cross-check; a variant that beats strong opponents ranks
 *      above one with the same win rate against weak opponents.
 *   4. `tiedWithPrevious` flags a variant whose Wilson interval OVERLAPS the
 *      next-better variant's — "overlapping CI => statistically
 *      indistinguishable", the claim the pairwise gate can't express.
 *
 * Ported from the deterministic-statistics discipline in the sibling
 * SharpeBench (pure f64 math, fixed reduction order, seedless here since there
 * is no bootstrap). No I/O, no clock, no randomness.
 */

import type { VariantRunResult } from "./types.ts";

export interface RankingVariant {
  /** Stable label for the variant. */
  label: string;
  /** scenarioId -> the variant's score on that scenario (0..1). */
  scores: ReadonlyMap<string, number>;
}

export interface RankingInput {
  variants: ReadonlyArray<RankingVariant>;
  /** Two-sided confidence level for the Wilson interval. Default 0.95. */
  confidence?: number;
  /**
   * A pairwise comparison counts as a win only when the score gap exceeds this
   * margin; gaps at or below it split 0.5/0.5 as a tie. Default 0 (any strict
   * difference decides). Raise it to treat near-identical scores as ties.
   */
  tieMargin?: number;
}

export interface RankedVariant {
  label: string;
  /** 1 = best. */
  rank: number;
  /** Total pairwise wins (fractional — a tie contributes 0.5). */
  wins: number;
  /** Total pairwise comparisons this variant took part in. */
  games: number;
  /** wins / games (0 when games === 0). */
  winRate: number;
  /** Wilson lower bound on the win rate. */
  ciLow: number;
  /** Wilson upper bound on the win rate. */
  ciHigh: number;
  /** Bradley-Terry strength, normalized so the field sums to 1. */
  btStrength: number;
  /**
   * True when this variant's Wilson interval overlaps the immediately-better
   * (previous-rank) variant's — i.e. the two are statistically
   * indistinguishable at the chosen confidence. False for rank 1.
   */
  tiedWithPrevious: boolean;
}

export interface Leaderboard {
  confidence: number;
  variants: ReadonlyArray<RankedVariant>;
}

/**
 * Wilson score interval for a binomial proportion. `successes` may be
 * fractional (ties contribute 0.5) — the formula is continuous in the count.
 * Returns the point estimate plus the [low, high] bounds, clamped to [0, 1].
 */
export function wilsonInterval(
  successes: number,
  n: number,
  z: number,
): { p: number; low: number; high: number } {
  if (n <= 0) return { p: 0, low: 0, high: 1 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin =
    (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return {
    p: clamp01(p),
    low: clamp01(center - margin),
    high: clamp01(center + margin),
  };
}

/**
 * Bradley-Terry strengths via the standard MM (minorization-maximization)
 * iteration. `wins[i][j]` is the (possibly fractional) number of times i beat
 * j; `games[i][j]` the number of i-vs-j comparisons. Returns strengths
 * normalized to sum to 1. Deterministic: fixed iteration cap + tolerance, no
 * randomness. Isolated variants (no games) get an equal share.
 */
export function bradleyTerry(
  wins: ReadonlyArray<ReadonlyArray<number>>,
  games: ReadonlyArray<ReadonlyArray<number>>,
  opts: { maxIter?: number; tol?: number } = {},
): number[] {
  const n = wins.length;
  if (n === 0) return [];
  const maxIter = opts.maxIter ?? 200;
  const tol = opts.tol ?? 1e-9;

  const totalWins = wins.map((row) => row.reduce((s, w) => s + w, 0));
  let p = new Array<number>(n).fill(1 / n);

  for (let iter = 0; iter < maxIter; iter++) {
    const next = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      let denom = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const nij = games[i]![j]! + games[j]![i]!;
        if (nij === 0) continue;
        denom += nij / (p[i]! + p[j]!);
      }
      next[i] = denom > 0 ? totalWins[i]! / denom : p[i]!;
    }
    const sum = next.reduce((s, v) => s + v, 0);
    if (sum <= 0) break;
    for (let i = 0; i < n; i++) next[i] = next[i]! / sum;

    let maxDelta = 0;
    for (let i = 0; i < n; i++) maxDelta = Math.max(maxDelta, Math.abs(next[i]! - p[i]!));
    p = next;
    if (maxDelta < tol) break;
  }
  return p;
}

/**
 * Build a ranked leaderboard of N variants from their per-scenario scores.
 * Ranks by win rate (ties broken by Bradley-Terry strength, then label for
 * determinism) and flags statistically-indistinguishable neighbors via Wilson
 * interval overlap.
 */
export function rankVariants(input: RankingInput): Leaderboard {
  const confidence = input.confidence ?? 0.95;
  const tieMargin = input.tieMargin ?? 0;
  const z = zForConfidence(confidence);
  const variants = input.variants;
  const n = variants.length;

  // Union of every scenario id, in first-seen order for determinism.
  const scenarioIds: string[] = [];
  const seen = new Set<string>();
  for (const v of variants) {
    for (const id of v.scores.keys()) {
      if (!seen.has(id)) {
        seen.add(id);
        scenarioIds.push(id);
      }
    }
  }

  const wins: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const games: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));

  for (const id of scenarioIds) {
    for (let i = 0; i < n; i++) {
      const si = variants[i]!.scores.get(id);
      if (si === undefined) continue;
      for (let j = i + 1; j < n; j++) {
        const sj = variants[j]!.scores.get(id);
        if (sj === undefined) continue;
        games[i]![j]! += 1;
        games[j]![i]! += 1;
        const diff = si - sj;
        if (Math.abs(diff) <= tieMargin) {
          wins[i]![j]! += 0.5;
          wins[j]![i]! += 0.5;
        } else if (diff > 0) {
          wins[i]![j]! += 1;
        } else {
          wins[j]![i]! += 1;
        }
      }
    }
  }

  const strengths = bradleyTerry(wins, games);

  interface Row extends RankedVariant {}
  const rows: Row[] = variants.map((v, i) => {
    const totalWins = wins[i]!.reduce((s, w) => s + w, 0);
    const totalGames = games[i]!.reduce((s, g) => s + g, 0);
    const ci = wilsonInterval(totalWins, totalGames, z);
    return {
      label: v.label,
      rank: 0,
      wins: Number(totalWins.toFixed(4)),
      games: totalGames,
      winRate: Number(ci.p.toFixed(4)),
      ciLow: Number(ci.low.toFixed(4)),
      ciHigh: Number(ci.high.toFixed(4)),
      btStrength: Number((strengths[i] ?? 0).toFixed(6)),
      tiedWithPrevious: false,
    };
  });

  rows.sort((a, b) => {
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    if (b.btStrength !== a.btStrength) return b.btStrength - a.btStrength;
    return a.label.localeCompare(b.label);
  });

  rows.forEach((row, i) => {
    row.rank = i + 1;
    if (i > 0) {
      const prev = rows[i - 1]!;
      // Intervals overlap when neither sits entirely above/below the other.
      row.tiedWithPrevious = row.ciHigh >= prev.ciLow && prev.ciHigh >= row.ciLow;
    }
  });

  return { confidence, variants: rows };
}

/**
 * Convenience adapter: build a leaderboard directly from `runEvalSuite`
 * output. Each `VariantRunResult.perScenario` row becomes a per-scenario
 * score for its variant.
 */
export function rankVariantResults(
  results: ReadonlyArray<VariantRunResult>,
  opts: { confidence?: number; tieMargin?: number } = {},
): Leaderboard {
  const variants: RankingVariant[] = results.map((r) => {
    const scores = new Map<string, number>();
    for (const p of r.perScenario) scores.set(p.scenarioId, p.score);
    return { label: r.variantLabel, scores };
  });
  return rankVariants({ variants, confidence: opts.confidence, tieMargin: opts.tieMargin });
}

/** Pretty-print a leaderboard for CI logs. */
export function formatLeaderboard(board: Leaderboard): string {
  const lines: string[] = [];
  lines.push(`[leaderboard] ${board.variants.length} variants @ ${(board.confidence * 100).toFixed(0)}% CI`);
  for (const v of board.variants) {
    const tie = v.tiedWithPrevious ? "  ~tied with above" : "";
    lines.push(
      `  ${v.rank}. ${v.label}: winRate ${v.winRate.toFixed(3)} [${v.ciLow.toFixed(3)}, ${v.ciHigh.toFixed(3)}] · BT ${v.btStrength.toFixed(3)} · ${v.wins}/${v.games}${tie}`,
    );
  }
  return lines.join("\n");
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * z-value for a two-sided interval at the given confidence — the
 * `(1 + confidence) / 2` quantile of the standard normal, via Acklam's
 * inverse-normal-CDF rational approximation (|error| < 1.15e-9). Deterministic.
 */
export function zForConfidence(confidence: number): number {
  const c = Math.min(Math.max(confidence, 0), 1 - 1e-12);
  return inverseNormalCdf((1 + c) / 2);
}

function inverseNormalCdf(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;

  // Coefficients (Peter Acklam).
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const cc = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let x: number;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    x =
      (((((cc[0]! * q + cc[1]!) * q + cc[2]!) * q + cc[3]!) * q + cc[4]!) * q + cc[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  } else if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    x =
      ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x =
      -(((((cc[0]! * q + cc[1]!) * q + cc[2]!) * q + cc[3]!) * q + cc[4]!) * q + cc[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  return x;
}
