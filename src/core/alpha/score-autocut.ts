/**
 * Score-discontinuity selection ("autocut").
 *
 * Translated from gbrain's autocut into the trading domain. Instead of returning
 * a fixed top-K from a ranked list, cut at the largest *cliff* in the score
 * distribution and return the LEADING CLUSTER — 1 candidate when one clearly
 * dominates, several when they're genuinely comparable.
 *
 * Use it on a TRUSTWORTHY score: an expected-edge, calibrated-conviction, or
 * Sharpe-like number where the magnitude means something. Do NOT feed it a
 * mechanical rank or an RRF position — the gap between rank-1 and rank-2 of an
 * arbitrary sort is fixed decay, identical whether rank-1 is right or wrong, so
 * it is not a trustworthy separatrix (gbrain's key lesson).
 *
 * A cut fires only when the largest in-range gap is BOTH:
 *   (a) ≥ jumpRatio of the score spread (max − min), AND
 *   (b) ≥ dominanceRatio × the next-largest gap.
 * Requiring (b) means a uniform decline — where every gap is similar — fails
 * OPEN (returns all, up to maxKeep) instead of slicing at a meaningless top gap.
 * Pure; never throws.
 */

export interface AutocutItem {
  /** Optional identifier carried through to the result. */
  id?: string;
  /** The score to cut on — should be a meaningful magnitude, not a rank. */
  score: number;
}

export interface AutocutOptions {
  /** Largest gap must be ≥ this fraction of the score spread to cut. Default 0.20. */
  jumpRatio?: number;
  /** Largest gap must be ≥ this × the next-largest gap to cut. Default 1.5. */
  dominanceRatio?: number;
  /** Never return fewer than this many items. Default 1. */
  minKeep?: number;
  /** Never return more than this many items. Default: no cap. */
  maxKeep?: number;
}

export type AutocutReason =
  | "cliff" // a clear discontinuity was found and cut on
  | "no_cliff" // largest gap below jumpRatio — no dominant break
  | "uniform" // gaps too even to call a cliff (failed dominance)
  | "no_variation" // all scores equal
  | "too_few" // fewer than 3 items — not enough gaps to judge dominance
  | "below_min"; // count ≤ minKeep — nothing to cut

export interface AutocutResult {
  selected: AutocutItem[];
  keptCount: number;
  /** Index (0-based) after which the cut occurred; null when no cut was made. */
  cutIndex: number | null;
  /** Largest in-range gap as a fraction of the spread (0 when not applicable). */
  normalizedGap: number;
  spread: number;
  reason: AutocutReason;
  interpretation: string;
}

export function selectByScoreDiscontinuity(
  items: ReadonlyArray<AutocutItem>,
  options: AutocutOptions = {},
): AutocutResult {
  const jumpRatio = options.jumpRatio ?? 0.2;
  const dominanceRatio = options.dominanceRatio ?? 1.5;
  const minKeep = Math.max(1, Math.floor(options.minKeep ?? 1));
  const maxKeep =
    options.maxKeep != null ? Math.max(minKeep, Math.floor(options.maxKeep)) : null;

  const sorted = [...items].sort((a, b) => b.score - a.score);
  const n = sorted.length;
  const spread = n >= 1 ? sorted[0]!.score - sorted[n - 1]!.score : 0;

  const failOpen = (reason: AutocutReason): AutocutResult => {
    const selected = maxKeep != null ? sorted.slice(0, maxKeep) : sorted.slice();
    return {
      selected,
      keptCount: selected.length,
      cutIndex: null,
      normalizedGap: 0,
      spread: parseFloat(spread.toFixed(6)),
      reason,
      interpretation:
        reason === "below_min"
          ? `only ${n} candidate(s) ≤ minKeep ${minKeep} — kept all`
          : reason === "too_few"
            ? `${n} candidates — need ≥ 3 to detect a cliff; kept ${selected.length}`
            : reason === "no_variation"
              ? `all ${n} scores equal — no discontinuity; kept ${selected.length}`
              : reason === "uniform"
                ? `gaps too even to call a cliff — kept all ${selected.length} (no dominant break)`
                : `largest gap below ${(jumpRatio * 100).toFixed(0)}% of spread — kept all ${selected.length}`,
    };
  };

  if (n <= minKeep) return failOpen("below_min");
  if (n < 3) return failOpen("too_few"); // need ≥ 2 gaps to judge dominance
  if (!(spread > 0)) return failOpen("no_variation");

  const gaps: number[] = [];
  for (let i = 0; i < n - 1; i++) gaps.push(sorted[i]!.score - sorted[i + 1]!.score);

  const searchLo = minKeep - 1;
  const searchHi = maxKeep != null ? Math.min(n - 2, maxKeep - 1) : n - 2;
  if (searchHi < searchLo) return failOpen("too_few");

  let cutIdx = -1;
  let maxGap = -Infinity;
  for (let i = searchLo; i <= searchHi; i++) {
    if (gaps[i]! > maxGap) {
      maxGap = gaps[i]!;
      cutIdx = i;
    }
  }
  if (cutIdx < 0) return failOpen("too_few");

  // Largest OTHER gap (global, excluding the chosen index) for the dominance
  // test. Using the global second-largest means a bigger gap stranded inside
  // the forced-keep zone (before minKeep) still defeats dominance → fail open.
  let secondMax = 0;
  for (let i = 0; i < gaps.length; i++) {
    if (i === cutIdx) continue;
    if (gaps[i]! > secondMax) secondMax = gaps[i]!;
  }

  const normalizedGap = maxGap / spread;
  const dominates = maxGap >= dominanceRatio * secondMax;
  if (normalizedGap < jumpRatio) return failOpen("no_cliff");
  if (!dominates) return failOpen("uniform");

  const keptCount = cutIdx + 1;
  const selected = sorted.slice(0, keptCount);
  const dominanceX = secondMax > 0 ? maxGap / secondMax : Infinity;
  return {
    selected,
    keptCount,
    cutIndex: cutIdx,
    normalizedGap: parseFloat(normalizedGap.toFixed(4)),
    spread: parseFloat(spread.toFixed(6)),
    reason: "cliff",
    interpretation:
      `cut after rank ${keptCount} — leading cluster of ${keptCount} ` +
      `(gap ${(normalizedGap * 100).toFixed(1)}% of spread, ` +
      `${Number.isFinite(dominanceX) ? dominanceX.toFixed(1) + "×" : "∞×"} the next gap)`,
  };
}
