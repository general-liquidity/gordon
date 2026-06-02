/**
 * Omega Ratio
 * A full-distribution performance measure (Keating & Shadwick, 2002). Unlike
 * Sharpe, which only uses the first two moments, Omega is the ratio of
 * probability-weighted gains to losses relative to a threshold — it captures
 * the entire return distribution, including skew and fat tails.
 *
 *   Ω(threshold) = Σ max(r − threshold, 0) / Σ max(threshold − r, 0)
 *
 * Reading:
 *   Ω = 1  → upside and downside (vs the threshold) balance exactly.
 *   Ω > 1  → more probability-weighted upside than downside; higher is better.
 *   Ω < 1  → downside dominates.
 *
 * Returns null when the downside sum is 0 (Omega is undefined / infinite — no
 * returns fell below the threshold, so there is no risk to divide by) or when
 * the sample is too small to be meaningful. We report that rather than
 * fabricating ∞.
 *
 * Pure function. No I/O.
 */

const MIN_SAMPLE = 2;

export interface OmegaRatioResult {
  /** Omega ratio, or null when downside sum is 0 or sample too small. */
  omega: number | null;
  /** The threshold the returns were measured against. */
  threshold: number;
  /** Σ max(r − threshold, 0) — total probability-weighted upside. */
  upside: number;
  /** Σ max(threshold − r, 0) — total probability-weighted downside. */
  downside: number;
  /** Interpretation string. */
  interpretation: string;
}

/**
 * Compute the Omega ratio of a return series at a given threshold.
 *
 * @param returns - Per-period returns (decimal or whatever unit threshold uses)
 * @param threshold - Minimum acceptable return (default 0)
 * @returns OmegaRatioResult, or null if `returns` is not a usable array
 */
export function computeOmegaRatio(
  returns: number[],
  threshold: number = 0,
): OmegaRatioResult | null {
  if (!Array.isArray(returns) || returns.length < MIN_SAMPLE) return null;

  let upside = 0;
  let downside = 0;
  for (const r of returns) {
    if (!Number.isFinite(r)) continue;
    const diff = r - threshold;
    if (diff > 0) upside += diff;
    else downside += -diff;
  }

  upside = parseFloat(upside.toFixed(6));
  downside = parseFloat(downside.toFixed(6));

  if (downside === 0) {
    // No return fell below the threshold → Omega is undefined (infinite).
    return {
      omega: null,
      threshold,
      upside,
      downside,
      interpretation:
        `Omega undefined at threshold ${threshold}: no returns fell below it ` +
        `(downside sum 0, upside ${upside}). All-upside vs the threshold — ` +
        `treat with caution, the sample may be too short to show losses.`,
    };
  }

  const omega = parseFloat((upside / downside).toFixed(4));

  let verdict: string;
  if (omega > 1) {
    verdict = `Ω ${omega} > 1 — probability-weighted upside exceeds downside above threshold ${threshold}.`;
  } else if (omega < 1) {
    verdict = `Ω ${omega} < 1 — downside dominates vs threshold ${threshold}; unattractive at this hurdle.`;
  } else {
    verdict = `Ω ${omega} ≈ 1 — upside and downside balance at threshold ${threshold}.`;
  }

  return {
    omega,
    threshold,
    upside,
    downside,
    interpretation: `${verdict} (upside ${upside} / downside ${downside}, n=${returns.length}).`,
  };
}
