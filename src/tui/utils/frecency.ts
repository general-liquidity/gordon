/**
 * frecency — a combined frequency + recency score over the usage-tracking
 * primitive (useSkillTracking's { usageCount, lastUsed } shape).
 *
 * Used as a *tiebreaker* in the command palette and slash typeahead: it never
 * overrides a stronger fuzzy/exact match, it only ranks equally-scored items
 * so the ones the operator reaches for most (and most recently) surface first.
 */

export interface FrecencyEntry {
  usageCount: number;
  lastUsed: number;
}

/** Read-only so a Map<string, SkillMetric> (a superset) assigns cleanly. */
export type FrecencyMap = ReadonlyMap<string, FrecencyEntry>;

/**
 * Higher is more relevant. Zero for never-used entries. Recency multiplies the
 * usage count so a command used once a minute ago can outrank one used twice
 * last week, but a heavily-used command still dominates a barely-used one.
 */
export function frecencyScore(entry: FrecencyEntry | undefined, now: number = Date.now()): number {
  if (!entry || entry.usageCount <= 0) return 0;
  const hours = Math.max(0, now - entry.lastUsed) / 3_600_000;
  const recency = hours < 1 ? 4 : hours < 24 ? 3 : hours < 168 ? 2 : 1;
  return entry.usageCount * recency;
}
