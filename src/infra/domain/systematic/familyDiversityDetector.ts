/**
 * Family Diversity Detector — autoresearch exploration steering.
 *
 * The one genuinely novel idea from the autoresearch-trading port:
 * when the recent window of research experiments clusters in a single
 * strategy family, the agent is likely caught in a local optimum.
 * Fires a diversity hint suggesting alternative families to explore.
 *
 * Distinct from the (already-existing) `systematic` keep/revert
 * lifecycle: this is a *signal to the researcher agent* to propose
 * something different next turn, not a decision about any particular
 * experiment's status.
 *
 * Pure compute. Operates on any experiment-like record with a `tags`
 * field; family is derived from a caller-supplied extractor (default:
 * first tag) so the detector works against the existing
 * `ResearchExperimentRecord` shape without requiring schema changes.
 */

export interface DiversityHint {
  dominantFamily: string;
  /** Fraction of the recent window occupied by the dominant family (0..1). */
  saturation: number;
  /** Other families seen in the full history, up to topK. */
  suggestedAlternatives: string[];
  /** Recent window size used to compute the hint. */
  windowSize: number;
}

export interface DiversityDetectorOptions<T> {
  /** Look at the most recent `window` experiments. Default 6. */
  window?: number;
  /** Fraction of window that must share a family to fire the hint. Default 0.66. */
  clusterFraction?: number;
  /** Number of alternative families to suggest. Default 3. */
  topK?: number;
  /** Extractor that returns the strategy family. Default: first tag, lowercased. */
  familyOf?: (exp: T) => string | null;
}

const DEFAULT_WINDOW = 6;
const DEFAULT_CLUSTER_FRACTION = 0.66;
const DEFAULT_TOP_K = 3;

function defaultFamilyOf(exp: { tags?: ReadonlyArray<string> }): string | null {
  const tag = exp.tags?.[0];
  return tag ? tag.toLowerCase() : null;
}

export function detectFamilyClustering<T extends { tags?: ReadonlyArray<string> }>(
  experiments: ReadonlyArray<T>,
  options: DiversityDetectorOptions<T> = {},
): DiversityHint | null {
  const window = options.window ?? DEFAULT_WINDOW;
  const fraction = options.clusterFraction ?? DEFAULT_CLUSTER_FRACTION;
  const topK = options.topK ?? DEFAULT_TOP_K;
  const familyOf = options.familyOf ?? (defaultFamilyOf as (exp: T) => string | null);

  if (experiments.length < window) return null;

  const tail = experiments.slice(-window);
  const tailFamilies = tail.map(familyOf).filter((f): f is string => !!f);
  if (tailFamilies.length < window) return null;

  const counts: Record<string, number> = {};
  for (const family of tailFamilies) counts[family] = (counts[family] ?? 0) + 1;

  let dominantFamily = "";
  let dominantCount = 0;
  for (const [family, count] of Object.entries(counts)) {
    if (count > dominantCount) {
      dominantFamily = family;
      dominantCount = count;
    }
  }

  const saturation = dominantCount / tail.length;
  if (saturation < fraction) return null;

  const allFamilies = new Set<string>();
  for (const exp of experiments) {
    const family = familyOf(exp);
    if (family) allFamilies.add(family);
  }
  const suggestedAlternatives = Array.from(allFamilies)
    .filter((f) => f !== dominantFamily)
    .slice(0, topK);

  return {
    dominantFamily,
    saturation,
    suggestedAlternatives,
    windowSize: tail.length,
  };
}

export function diversityHintToPayload(hint: DiversityHint | null): Record<string, unknown> {
  if (!hint) return { kind: "family_diversity.no_cluster" };
  return {
    kind: "family_diversity.cluster_detected",
    dominantFamily: hint.dominantFamily,
    saturation: Number(hint.saturation.toFixed(3)),
    suggestedAlternatives: hint.suggestedAlternatives,
    windowSize: hint.windowSize,
  };
}
