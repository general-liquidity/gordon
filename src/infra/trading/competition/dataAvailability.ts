/**
 * Data-availability universe guard for the competition.
 *
 * The competition lists 15 tradeable instruments, but at RUNTIME our bar feed for any one of
 * them can be missing or thin — a failed fetch, a bridge hiccup, or (the original motivation)
 * an instrument we never backfilled history for. Trading a symbol we have no — or too little —
 * bar data for is unsafe: the signal/sizer either silently no-ops or sizes off a degenerate
 * window.
 *
 * This module derives the tradeable set FROM DATA AVAILABILITY rather than any hardcoded
 * symbol membership list — pass the candidate universe plus the bars we actually have, and
 * it splits into the symbols with enough history (`available`) and the ones to exclude
 * (`excluded`, each with the reason: missing feed vs too few bars). The strategy layer then
 * runs only over `available`, so a missing/thin instrument is dropped generally — no special
 * case for any one ticker.
 *
 * PURE: no I/O, no clock, no logging. The caller fetches bars and decides what to do with
 * the excluded note. Generic over the bar element type so it composes with any bar shape.
 */

/** Why a symbol was excluded from the tradeable set. */
export type ExclusionReason = "no_bars" | "insufficient_bars";

export interface ExcludedSymbol {
  symbol: string;
  reason: ExclusionReason;
  /** Bars we actually have for this symbol (0 when the feed is missing entirely). */
  barCount: number;
  /** The threshold it failed to meet. */
  minBars: number;
}

export interface AvailabilityResult {
  /** Candidate symbols with `>= minBars` bars — the tradeable set. */
  available: string[];
  /** Candidate symbols dropped for missing or insufficient data. */
  excluded: ExcludedSymbol[];
}

/**
 * Split a candidate universe into the symbols we can trade vs the ones to exclude, based
 * purely on how many bars we have for each.
 *
 * A symbol is kept iff `barsBySymbol[symbol]` exists and has at least `minBars` entries.
 * A symbol with no entry or an empty array is excluded as `no_bars`; one with `1..minBars-1`
 * bars is excluded as `insufficient_bars`. Order of `available` follows the input `symbols`
 * order (stable), so the frozen universe ordering is preserved for the symbols that survive.
 *
 * @param symbols       Candidate universe (e.g. the frozen competition-tradeable list).
 * @param barsBySymbol  Bars we actually have, keyed by symbol. Values are length-checked only.
 * @param minBars       Minimum bar count required to trade a symbol (must be >= 1).
 */
export function filterToAvailableSymbols(
  symbols: readonly string[],
  barsBySymbol: Readonly<Record<string, ReadonlyArray<unknown>>>,
  minBars: number,
): AvailabilityResult {
  const threshold = Math.max(1, Math.floor(minBars));
  const available: string[] = [];
  const excluded: ExcludedSymbol[] = [];

  for (const symbol of symbols) {
    const bars = barsBySymbol[symbol];
    const barCount = bars?.length ?? 0;
    if (barCount >= threshold) {
      available.push(symbol);
    } else {
      excluded.push({
        symbol,
        reason: barCount === 0 ? "no_bars" : "insufficient_bars",
        barCount,
        minBars: threshold,
      });
    }
  }

  return { available, excluded };
}

/**
 * One-line human note describing what was dropped and why — for the live-runner log so a
 * silently-shrunk universe is visible. Returns "" when nothing was excluded (no noise on the
 * happy path).
 */
export function formatExcludedNote(excluded: readonly ExcludedSymbol[]): string {
  if (excluded.length === 0) return "";
  const parts = excluded.map((e) =>
    e.reason === "no_bars"
      ? `${e.symbol} (no bars)`
      : `${e.symbol} (${e.barCount}/${e.minBars} bars)`,
  );
  return `Excluded ${excluded.length} instrument${excluded.length === 1 ? "" : "s"} for insufficient data: ${parts.join(", ")}.`;
}
