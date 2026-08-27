/**
 * Population Stability Index (PSI) — distribution-drift detector.
 *
 * The canonical model-monitoring metric for "has this distribution shifted from
 * its baseline?" — the trading/agent answer to the "behavioral drift alerting"
 * gap (detect when an output/feature distribution shifts over time, even when
 * individual values still look fine). A signal, a feature, a fill-quality
 * series, or the agent's own decision distribution can quietly drift away from
 * the regime it was validated on; PSI quantifies that before realized
 * performance does.
 *
 *   PSI = Σ_bins (actual% − expected%) · ln(actual% / expected%)
 *
 * Bins are the baseline's quantile edges (so each baseline bin holds ~equal
 * mass), then the current sample is counted into those bins. Standard reading:
 * < 0.10 stable, 0.10–0.25 moderate shift, > 0.25 significant shift. Pure.
 */

export interface PSIBin {
  range: [number, number];
  expectedPct: number;
  actualPct: number;
  /** This bin's contribution to the total PSI. */
  contribution: number;
}

export type DriftVerdict = "stable" | "moderate_shift" | "significant_shift";

export interface PSIResult {
  psi: number;
  bins: number;
  verdict: DriftVerdict;
  /** Per-bin breakdown — the largest contributions name where the drift is. */
  perBin: PSIBin[];
  summary: string;
}

/** Quantile edges of `xs` for `bins` buckets (inner edges only). */
function quantileEdges(xs: number[], bins: number): number[] {
  const sorted = [...xs].sort((a, b) => a - b);
  const edges: number[] = [];
  for (let i = 1; i < bins; i++) {
    const pos = (i / bins) * (sorted.length - 1);
    const lo = Math.floor(pos);
    const frac = pos - lo;
    edges.push(sorted[lo]! + frac * ((sorted[lo + 1] ?? sorted[lo]!) - sorted[lo]!));
  }
  return edges;
}

/** Bucket index for `v` given inner `edges` (length bins-1). */
function bucketOf(v: number, edges: number[]): number {
  let i = 0;
  while (i < edges.length && v > edges[i]!) i++;
  return i;
}

/**
 * Compute PSI of `current` against `baseline`. Empty bins are floored at a small
 * epsilon (standard practice) so a bin the current sample never lands in does
 * not blow ln() up to infinity.
 */
export function computePSI(baseline: number[], current: number[], bins = 10): PSIResult | null {
  if (baseline.length < bins || current.length === 0) return null;

  const edges = quantileEdges(baseline, bins);
  const eps = 1e-4;

  const expectedCounts = new Array<number>(bins).fill(0);
  const actualCounts = new Array<number>(bins).fill(0);
  for (const v of baseline) expectedCounts[bucketOf(v, edges)]!++;
  for (const v of current) actualCounts[bucketOf(v, edges)]!++;

  const perBin: PSIBin[] = [];
  let psi = 0;
  for (let i = 0; i < bins; i++) {
    const expectedPct = Math.max(expectedCounts[i]! / baseline.length, eps);
    const actualPct = Math.max(actualCounts[i]! / current.length, eps);
    const contribution = (actualPct - expectedPct) * Math.log(actualPct / expectedPct);
    psi += contribution;
    const lo = i === 0 ? -Infinity : edges[i - 1]!;
    const hi = i === bins - 1 ? Infinity : edges[i]!;
    perBin.push({ range: [lo, hi], expectedPct, actualPct, contribution });
  }

  const verdict: DriftVerdict =
    psi < 0.1 ? "stable" : psi < 0.25 ? "moderate_shift" : "significant_shift";
  const top = [...perBin].sort((a, b) => b.contribution - a.contribution)[0];
  const summary =
    `PSI ${psi.toFixed(3)} — ${verdict.replace("_", " ")}` +
    (verdict !== "stable" && top
      ? ` (largest shift in bin [${fmt(top.range[0])}, ${fmt(top.range[1])}]: ${(top.expectedPct * 100).toFixed(0)}%→${(top.actualPct * 100).toFixed(0)}%)`
      : "");

  return { psi, bins, verdict, perBin, summary };
}

function fmt(x: number): string {
  return x === Infinity ? "∞" : x === -Infinity ? "−∞" : x.toFixed(2);
}
