/**
 * Filing-section year-over-year diff.
 *
 * The forensic-finance "single best read": pull a named section out of two
 * consecutive filings (this year's 10-K Risk Factors vs last year's) and
 * surface only what is NEW or REMOVED, ignoring the boilerplate present in
 * both. A quietly-added customer-concentration paragraph or a deleted
 * key-supplier line is information that never hits a press release.
 *
 * This is the DETERMINISTIC half — segment, normalize, and diff by token
 * similarity so near-identical boilerplate is treated as unchanged. The LLM
 * summarizes the resulting added/removed segments on top (the agent's job, via
 * the `filing_diff` surface op). Distinct from the `filing-analysis` skill,
 * which does structured single-filing extraction, not a YoY section diff.
 *
 * Pure functions.
 */

const DEFAULT_SIMILARITY = 0.6; // a current segment ≥ this to a prior one = unchanged
const MIN_TOKENS = 4; // segments shorter than this are dropped (headers, "true.", etc.)

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2),
  );
}

/** Jaccard similarity of two token sets: |∩| / |∪|. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

interface Segment {
  text: string;
  tokens: Set<string>;
}

/** Split filing text into comparison segments (sentence- and line-level). */
function segment(text: string): Segment[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => ({ text: s, tokens: tokenize(s) }))
    .filter((s) => s.tokens.size >= MIN_TOKENS);
}

/**
 * Extract a named section from a full filing by start/end markers. Returns the
 * text between the first start-marker match and the next end-marker match (or
 * end of document). Heuristic — robust enough for the common Item-delimited
 * 10-K layout; returns "" if the start marker isn't found.
 */
export function extractSection(
  filingText: string,
  start: RegExp,
  end?: RegExp,
): string {
  const startMatch = start.exec(filingText);
  if (!startMatch) return "";
  const from = startMatch.index + startMatch[0].length;
  if (!end) return filingText.slice(from).trim();
  const rest = filingText.slice(from);
  const endMatch = end.exec(rest);
  return (endMatch ? rest.slice(0, endMatch.index) : rest).trim();
}

/** Common 10-K section markers. */
export const SECTION_MARKERS = {
  risk_factors: { start: /item\s*1a\.?\s*risk\s*factors/i, end: /item\s*1b\b|item\s*2\b/i },
  mdna: { start: /item\s*7\.?\s*management'?s\s*discussion/i, end: /item\s*7a\b|item\s*8\b/i },
} as const;

export interface FilingDiffInput {
  /** Prior-period section text. */
  prior: string;
  /** Current-period section text. */
  current: string;
  /** Segments matching an existing one above this Jaccard score count as unchanged. Default 0.6. */
  similarityThreshold?: number;
}

export interface FilingDiffResult {
  /** Segments present in `current` with no close match in `prior`. */
  added: string[];
  /** Segments present in `prior` with no close match in `current`. */
  removed: string[];
  addedCount: number;
  removedCount: number;
  /** Current segments that matched a prior segment (boilerplate carried over). */
  unchangedCount: number;
  /** True if there is any material change to summarize. */
  changed: boolean;
  summary: string;
}

function bestMatch(seg: Segment, against: Segment[]): number {
  let best = 0;
  for (const other of against) {
    const sim = jaccard(seg.tokens, other.tokens);
    if (sim > best) best = sim;
  }
  return best;
}

export function diffFilingSections(input: FilingDiffInput): FilingDiffResult {
  const threshold = input.similarityThreshold ?? DEFAULT_SIMILARITY;
  const priorSegs = segment(input.prior);
  const currentSegs = segment(input.current);

  const added: string[] = [];
  let unchanged = 0;
  for (const seg of currentSegs) {
    if (bestMatch(seg, priorSegs) >= threshold) unchanged++;
    else added.push(seg.text);
  }

  const removed: string[] = [];
  for (const seg of priorSegs) {
    if (bestMatch(seg, currentSegs) < threshold) removed.push(seg.text);
  }

  const changed = added.length > 0 || removed.length > 0;
  const summary = changed
    ? `${added.length} new segment(s), ${removed.length} removed, ${unchanged} carried over. ` +
      `Read the new/removed language — that is where the signal is.`
    : `No material change: ${unchanged} segments carried over unchanged.`;

  return {
    added,
    removed,
    addedCount: added.length,
    removedCount: removed.length,
    unchangedCount: unchanged,
    changed,
    summary,
  };
}

/** Convenience: extract a known section from two full filings, then diff. */
export function diffNamedSection(
  priorFiling: string,
  currentFiling: string,
  section: keyof typeof SECTION_MARKERS,
  similarityThreshold?: number,
): FilingDiffResult {
  const m = SECTION_MARKERS[section];
  return diffFilingSections({
    prior: extractSection(priorFiling, m.start, m.end),
    current: extractSection(currentFiling, m.start, m.end),
    ...(similarityThreshold !== undefined && { similarityThreshold }),
  });
}
