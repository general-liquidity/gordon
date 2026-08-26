/**
 * Retrieval helpers — point-in-time filter + thin-evidence detection.
 *
 * Both come from the Quarq Agent comparison (OSS, Apache 2.0):
 *
 *   - asOf (Temporal Truth Protocol): when an operator/skill asks
 *     "what did we know at time T?", retrieval results must be constrained
 *     to entries whose `createdAt` (or `publishedAt`) is ≤ T. Replay
 *     accuracy on post-trade reviews depends on this.
 *
 *   - thin-evidence detection (REQUIRED_DATA fallback): the inline
 *     equivalent of Quarq's "second-pass retrieval" — if a first search
 *     pass yields few or low-confidence results, auto-trigger an
 *     expanded second pass and merge + dedupe. The caller surfaces an
 *     `evidenceQuality` flag so the LLM knows whether it got rich,
 *     thin, or fallback-expanded context.
 *
 * Pure functions — no I/O, no state. The surface tools call these to
 * stay deterministic and testable.
 */

export type EvidenceQuality = "rich" | "thin" | "expanded";

/** Default — fewer than this many records counts as "thin." */
export const DEFAULT_THIN_COUNT = 3;
/** Default — top result score below this counts as "thin." */
export const DEFAULT_THIN_SCORE = 0.3;

/**
 * How undated / malformed-date records are treated by `filterByAsOf`.
 *
 *   - "strict": a record whose timestamp is missing or unparseable is
 *     DROPPED. Required on any path whose output can inform a trade —
 *     a leaked post-cutoff headline is worse than a missing one.
 *   - "permissive": such a record is KEPT. Only defensible for assistant
 *     memory retrieval, where an undated note carries no leak risk.
 *
 * An unparseable CUTOFF is an error in both modes: a caller asking
 * "as of T" with a T the code cannot read must not silently receive
 * everything.
 */
export type AsOfMode = "strict" | "permissive";

export class InvalidAsOfCutoffError extends Error {
  constructor(asOf: string) {
    super(`Unparseable asOf cutoff: ${JSON.stringify(asOf)}`);
    this.name = "InvalidAsOfCutoffError";
  }
}

/**
 * Drop records whose timestamp is strictly after `asOf`. Returns the
 * input unchanged when `asOf` is missing, so callers don't have to guard.
 *
 * Throws `InvalidAsOfCutoffError` when `asOf` is present but unparseable.
 */
export function filterByAsOf<T>(
  records: T[],
  asOf: string | undefined,
  getTimestamp: (r: T) => string | number | undefined | null,
  mode: AsOfMode,
): T[] {
  if (!asOf) return records;
  const cutoff = Date.parse(asOf);
  if (!Number.isFinite(cutoff)) throw new InvalidAsOfCutoffError(asOf);
  const keepUndated = mode === "permissive";
  return records.filter((r) => {
    const raw = getTimestamp(r);
    if (raw == null) return keepUndated;
    const ts = typeof raw === "number" ? raw : Date.parse(String(raw));
    if (!Number.isFinite(ts)) return keepUndated;
    return ts <= cutoff;
  });
}

export interface ThinEvidenceOptions {
  /** Below this count, evidence is considered thin. Default 3. */
  minCount?: number;
  /** Below this top-score, evidence is considered thin. Default 0.3. */
  minTopScore?: number;
}

/** Decide whether a first-pass retrieval yielded thin evidence and an
 *  expanded second pass is warranted. Tracks BOTH count and quality:
 *  one good hit beats five marginal hits, and ten weak hits beats one
 *  weak hit. */
export function isThinEvidence(
  results: Array<{ score?: number }>,
  options: ThinEvidenceOptions = {},
): boolean {
  const minCount = options.minCount ?? DEFAULT_THIN_COUNT;
  const minTopScore = options.minTopScore ?? DEFAULT_THIN_SCORE;
  if (results.length === 0) return true;
  if (results.length < minCount) {
    const topScore = Math.max(...results.map((r) => r.score ?? 0));
    return topScore < minTopScore;
  }
  return false;
}

/** Classify the final retrieval state for surfacing back to the LLM. */
export function classifyEvidenceQuality(
  firstPassCount: number,
  finalCount: number,
  expanded: boolean,
): EvidenceQuality {
  if (expanded) return "expanded";
  if (firstPassCount === 0) return "thin";
  // Heuristic: if we kept everything from the first pass and there were
  // enough results to begin with, we're rich.
  if (finalCount >= DEFAULT_THIN_COUNT) return "rich";
  return "thin";
}

/** Merge two result lists and deduplicate. Dedupe key falls back through
 *  candidate fields so callers don't have to normalize first. */
export function mergeAndDedupe<T extends Record<string, unknown>>(
  primary: T[],
  fallback: T[],
  getKey?: (r: T) => string,
): T[] {
  const keyOf = getKey ?? defaultKey;
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of primary) {
    const k = keyOf(r);
    if (k && seen.has(k)) continue;
    if (k) seen.add(k);
    out.push(r);
  }
  for (const r of fallback) {
    const k = keyOf(r);
    if (k && seen.has(k)) continue;
    if (k) seen.add(k);
    out.push(r);
  }
  return out;
}

function defaultKey(r: Record<string, unknown>): string {
  // Try common identity fields. Falls back to JSON shape — collision-
  // proof but expensive; only triggered on records with no id-ish field.
  for (const candidate of ["id", "recordId", "uuid", "link", "url"]) {
    const v = r[candidate];
    if (typeof v === "string" && v.length > 0) return `${candidate}:${v}`;
  }
  // Content + first available timestamp is a reasonable fingerprint.
  const content = typeof r.content === "string" ? r.content.slice(0, 80) : "";
  const ts =
    typeof r.createdAt === "string" ? r.createdAt :
    typeof r.publishedAt === "string" ? r.publishedAt :
    typeof r.timestamp === "number" ? String(r.timestamp) : "";
  return content || ts ? `c:${content}|t:${ts}` : "";
}
