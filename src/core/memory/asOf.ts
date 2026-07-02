/**
 * Point-in-time (as-of) recall guard — no-lookahead correctness (E5).
 *
 * Gordon's live memory ranks by recency decay, but recency does not stop a
 * recall for a decision made at time T from surfacing a record that was only
 * LEARNED after T. That is temporal lookahead: injecting hindsight into a
 * past decision. This module adds a transaction-time / known-at guard.
 *
 * Bi-temporal framing: a record has a VALID time (when the fact it describes
 * was true) and a KNOWN-AT / transaction time (when the agent learned it). A
 * no-lookahead recall for a decision at `asOf` must exclude any record whose
 * known-at is strictly after `asOf`. In Gordon's SQLite store the write
 * timestamp (`created_at`) IS the known-at time; the hybrid in-memory store
 * carries an explicit optional `knownAt`.
 *
 * The guard is ADDITIVE and OPT-IN: with no `asOf` bound nothing is filtered,
 * so existing recall is unchanged. Records with an unknown known-at are
 * treated as evergreen (always visible), matching the temporal-decay
 * convention where a null timestamp means "durable, no decay".
 */

/** A known-at / transaction timestamp: epoch ms, ISO string, or unknown. */
export type KnownAt = number | string | null | undefined;

/** Normalize a known-at value to epoch milliseconds, or null when unknown. */
export function toEpochMs(t: KnownAt): number | null {
  if (t == null) return null;
  if (typeof t === "number") return Number.isFinite(t) ? t : null;
  const parsed = Date.parse(t);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Whether a record with the given known-at time is visible for a decision
 * made at `asOf`.
 *
 * - No `asOf` bound → always visible (guard disabled).
 * - Unknown known-at → visible (evergreen / durable fact).
 * - Otherwise visible iff `knownAt <= asOf` (no record learned after the
 *   decision leaks in).
 */
export function isVisibleAsOf(knownAt: KnownAt, asOf: KnownAt): boolean {
  const asOfMs = toEpochMs(asOf);
  if (asOfMs == null) return true;
  const knownMs = toEpochMs(knownAt);
  if (knownMs == null) return true;
  return knownMs <= asOfMs;
}

/**
 * Filter a list to only the records visible as of `asOf`, using
 * `getKnownAt` to extract each record's known-at time. When `asOf` is unset
 * the input is returned unchanged (opt-in — never breaks existing recall).
 */
export function filterAsOf<T>(
  items: ReadonlyArray<T>,
  asOf: KnownAt,
  getKnownAt: (item: T) => KnownAt,
): T[] {
  if (toEpochMs(asOf) == null) return [...items];
  return items.filter((item) => isVisibleAsOf(getKnownAt(item), asOf));
}
