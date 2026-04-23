/**
 * Canonical timeframe identifiers.
 *
 * Sourced from the superset of timeframes Gordon's data layer supports
 * across broker and exchange adapters. Individual callsites (Zod enum
 * validators, broker/exchange `DEFAULT_TIMEFRAMES` lists, pattern detectors)
 * typically declare a SUBSET of these — use `as const satisfies readonly
 * Timeframe[]` at the callsite to preserve both the subset semantics and
 * compile-time enforcement that every entry is a valid `Timeframe`.
 *
 * Note: casing matters. "1m" = one minute, "1M" = one month.
 */
export const TIMEFRAME_IDS = [
  "1m", "3m", "5m", "15m", "30m",
  "1h", "2h", "4h", "6h", "8h", "12h",
  "1d", "3d", "1w", "1M",
] as const;

export type Timeframe = (typeof TIMEFRAME_IDS)[number];
