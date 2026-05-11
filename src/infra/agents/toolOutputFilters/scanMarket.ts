/**
 * scan_market output filter — keep top movers + bottom movers + regime
 * distribution + a configurable focus set verbatim.
 *
 * Raw: array of 50-500 symbols with price / change / volume / sometimes
 * regime tag. The model decides on extremes (winners + losers) and on
 * the symbols it already cares about; the long middle of "no move,
 * average volume" is filler.
 *
 * Filter strategy:
 *   - Top N gainers verbatim (default 10)
 *   - Top N losers verbatim (default 10)
 *   - Top N by volume verbatim (default 5, deduplicated from above)
 *   - Aggregate regime distribution (count per regime tag)
 *   - Median / average change for the dropped middle
 *
 * Bypass when:
 *   - Not an array of scan-row-shaped objects
 *   - Already small (≤ 2 × topN)
 *   - Error envelope
 */

import {
  passthrough,
  safeStringifyLength,
  looksLikeError,
  type FilterResult,
} from "./types.ts";

interface ScanRow {
  symbol: string;
  changePct?: number;
  change_percent?: number;
  price?: number;
  volume?: number;
  quoteVolume?: number;
  regime?: string;
  [k: string]: unknown;
}

interface ScanContainer {
  results?: unknown;
  data?: unknown;
  symbols?: unknown;
  movers?: unknown;
}

const TOP_GAINERS = 10;
const TOP_LOSERS = 10;
const TOP_BY_VOLUME = 5;

function isScanRow(v: unknown): v is ScanRow {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.symbol === "string";
}

function pickArray(raw: unknown): ScanRow[] | null {
  if (Array.isArray(raw) && raw.length > 0 && isScanRow(raw[0])) {
    return raw.filter(isScanRow);
  }
  if (typeof raw === "object" && raw !== null) {
    const c = raw as ScanContainer;
    for (const key of ["results", "data", "symbols", "movers"] as const) {
      const candidate = c[key];
      if (Array.isArray(candidate) && candidate.length > 0 && isScanRow(candidate[0])) {
        return candidate.filter(isScanRow);
      }
    }
  }
  return null;
}

function changeOf(r: ScanRow): number {
  if (typeof r.changePct === "number") return r.changePct;
  if (typeof r.change_percent === "number") return r.change_percent;
  return 0;
}

function volumeOf(r: ScanRow): number {
  if (typeof r.quoteVolume === "number") return r.quoteVolume;
  if (typeof r.volume === "number") return r.volume;
  return 0;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export interface ScanFilterOptions {
  /** Symbols to keep verbatim regardless of rank (e.g. user's watchlist). */
  focusSymbols?: ReadonlySet<string>;
}

export function filterScanMarket(raw: unknown, options: ScanFilterOptions = {}): FilterResult {
  if (looksLikeError(raw)) return passthrough(raw);
  const rows = pickArray(raw);
  if (!rows) return passthrough(raw);
  if (rows.length <= TOP_GAINERS + TOP_LOSERS) return passthrough(raw);

  const bytesBefore = safeStringifyLength(raw);

  const sortedByChange = [...rows].sort((a, b) => changeOf(b) - changeOf(a));
  const gainers = sortedByChange.slice(0, TOP_GAINERS);
  const losers = sortedByChange.slice(-TOP_LOSERS).reverse();

  const keptSymbols = new Set<string>();
  for (const r of gainers) keptSymbols.add(r.symbol);
  for (const r of losers) keptSymbols.add(r.symbol);

  const sortedByVolume = [...rows].sort((a, b) => volumeOf(b) - volumeOf(a));
  const volumeLeaders: ScanRow[] = [];
  for (const r of sortedByVolume) {
    if (volumeLeaders.length >= TOP_BY_VOLUME) break;
    if (!keptSymbols.has(r.symbol)) {
      volumeLeaders.push(r);
      keptSymbols.add(r.symbol);
    }
  }

  // Focus symbols always pass through verbatim.
  const focus = options.focusSymbols ?? new Set<string>();
  const focusRows: ScanRow[] = [];
  for (const r of rows) {
    if (focus.has(r.symbol) && !keptSymbols.has(r.symbol)) {
      focusRows.push(r);
      keptSymbols.add(r.symbol);
    }
  }

  // Regime distribution (when present)
  const regimeCounts: Record<string, number> = {};
  let regimeKnown = 0;
  for (const r of rows) {
    if (typeof r.regime === "string") {
      regimeCounts[r.regime] = (regimeCounts[r.regime] ?? 0) + 1;
      regimeKnown++;
    }
  }

  // Stats on the dropped middle
  const droppedRows = rows.filter((r) => !keptSymbols.has(r.symbol));
  const droppedChanges = droppedRows.map(changeOf);
  const droppedVols = droppedRows.map(volumeOf);

  const filtered = {
    summary: {
      totalSymbols: rows.length,
      kept: keptSymbols.size,
      dropped: droppedRows.length,
      medianChangePctDropped: Number(median(droppedChanges).toFixed(4)),
      avgChangePctDropped: droppedRows.length
        ? Number(
            (droppedChanges.reduce((s, v) => s + v, 0) / droppedRows.length).toFixed(4),
          )
        : 0,
      totalVolumeDropped: droppedVols.reduce((s, v) => s + v, 0),
    },
    regimeDistribution: regimeKnown > 0 ? regimeCounts : null,
    gainers,
    losers,
    volumeLeaders,
    ...(focusRows.length > 0 ? { focusSymbols: focusRows } : {}),
    _meta: {
      filter: "scan_market",
      note: "extremes + focus + regime aggregate. Long middle dropped.",
    },
  };

  const bytesAfter = safeStringifyLength(filtered);
  return {
    filtered,
    bytesBefore,
    bytesAfter,
    filterTag: `scan_market: ${rows.length}→${keptSymbols.size}`,
  };
}
