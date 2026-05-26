/**
 * In-memory tracker of symbol observations during the current session.
 *
 * Records every time a data-reading tool runs against a specific symbol.
 * `verify_plan` consults this tracker as a soft source-chain check: if a
 * plan is being created for a symbol with no recent data reads in this
 * session, surface a SOURCE_UNVERIFIED warning. The plan still passes —
 * this is observability, not a block.
 *
 * Process-local on purpose. The semantics we want: did THIS session
 * actually look at the data backing this plan, or did the LLM (or
 * operator) propose a trade on a stale memory of prices? A restart
 * legitimately resets the window — fresh session, fresh observations.
 *
 * Comparable to SkillOpt's source-table check, but light-touch:
 * presence/absence rather than text-level citation matching.
 */

const observations = new Map<string, number[]>();

const DEFAULT_WINDOW_MS = 4 * 60 * 60 * 1000; // 4 hours
const MAX_TIMESTAMPS_PER_SYMBOL = 200; // bound memory; trim oldest when over

function normalize(symbol: string): string {
  return symbol.trim().toUpperCase();
}

/** Record that a data tool ran against this symbol. Safe to call from
 *  hot tool paths — does no I/O, just a Map update. Silently ignores
 *  empty / non-string inputs so call sites can pass `args.symbol`
 *  without guard. */
export function recordSymbolObservation(symbol: unknown): void {
  if (typeof symbol !== "string") return;
  const trimmed = symbol.trim();
  if (trimmed.length === 0) return;
  const key = normalize(trimmed);
  let list = observations.get(key);
  if (!list) {
    list = [];
    observations.set(key, list);
  }
  list.push(Date.now());
  if (list.length > MAX_TIMESTAMPS_PER_SYMBOL) {
    list.splice(0, list.length - MAX_TIMESTAMPS_PER_SYMBOL);
  }
}

/** Did any data tool touch this symbol in the last `windowMs` ms?
 *  Default window: 4 hours. */
export function hasRecentSymbolObservation(symbol: string, windowMs: number = DEFAULT_WINDOW_MS): boolean {
  if (typeof symbol !== "string") return false;
  const list = observations.get(normalize(symbol));
  if (!list || list.length === 0) return false;
  const cutoff = Date.now() - windowMs;
  for (const ts of list) if (ts >= cutoff) return true;
  return false;
}

/** Count observations on this symbol within the window. */
export function getSymbolObservationCount(symbol: string, windowMs: number = DEFAULT_WINDOW_MS): number {
  if (typeof symbol !== "string") return 0;
  const list = observations.get(normalize(symbol));
  if (!list) return 0;
  const cutoff = Date.now() - windowMs;
  let count = 0;
  for (const ts of list) if (ts >= cutoff) count++;
  return count;
}

/** Most-recent observation timestamp for this symbol, or null. */
export function lastObservationAt(symbol: string): number | null {
  if (typeof symbol !== "string") return null;
  const list = observations.get(normalize(symbol));
  if (!list || list.length === 0) return null;
  return list[list.length - 1] ?? null;
}

/** Test helper — flush all observations. */
export function _resetObservationsForTests(): void {
  observations.clear();
}
