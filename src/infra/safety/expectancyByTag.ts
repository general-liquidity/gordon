/**
 * Per-tag expectancy diagnostic over the trade ledger.
 *
 * Reads `ExecutionRecord`s from `~/.gordon/trade-ledger.jsonl` (or
 * whatever path `defaultTradeLedgerPath()` returns) and computes:
 *
 *   - Per-tag expectancy = (winRate × avgWin) - (lossRate × avgLoss)
 *   - Per-tag win rate + 95% Wilson confidence interval
 *   - Sample-size-based significance gate:
 *       robust       n ≥ 50
 *       preliminary  30 ≤ n < 50
 *       insufficient n < 30
 *   - Aggregate "overall" expectancy across all rows
 *   - Best + worst performing tags
 *
 * Tag extraction is operator-configurable via the `getTag` option.
 * Defaults to grouping by symbol; common alternatives:
 *
 *   - row => row.operations[0]?.action ?? "unknown"
 *   - row => row.operations[0]?.side ?? "unknown"
 *   - row => extractStrategyTag(row.rationale)  // operator regex
 *
 * Per-record P&L delta is computed from `stateAfter.realizedPnLUsd`
 * minus `stateBefore.realizedPnLUsd`. Records without both snapshots
 * are dropped from the aggregation (with a count surfaced separately).
 *
 * Honest caveats:
 *   1. Realized P&L only materializes on closing trades. Open positions
 *      aren't counted — expectancy reflects ONLY trades that completed
 *      a round trip during the observation window.
 *   2. With 10 tags and 200 trades, multiple-testing means some "edge"
 *      tags will look positive by chance. The 95% CI surfacing is the
 *      honest hedge — narrow CI + clearly-positive expectancy ≫ point
 *      estimate alone.
 *   3. Tags assigned by the operator carry survivorship bias risk.
 *      The "untagged" bucket count surfaces the gap.
 */

import { existsSync, readFileSync } from "node:fs";
import { defaultTradeLedgerPath, type ExecutionRecord } from "./tradeLedger.ts";

export type SignificanceTier = "robust" | "preliminary" | "insufficient";

export interface TagExpectancy {
  tag: string;
  sampleSize: number;
  winCount: number;
  lossCount: number;
  breakevenCount: number;
  winRate: number;
  lossRate: number;
  avgWin: number;
  avgLoss: number;
  expectancy: number;
  totalPnl: number;
  significance: SignificanceTier;
  /** 95% Wilson confidence interval on the win rate. */
  winRateCi: { lower: number; upper: number };
}

export interface ExpectancyReport {
  totalRowsRead: number;
  rowsWithPnl: number;
  rowsMissingPnl: number;
  rowsByTagCount: number;
  byTag: TagExpectancy[];
  overall: TagExpectancy;
  bestTag: TagExpectancy | null;
  worstTag: TagExpectancy | null;
  summary: string;
}

export interface ExpectancyOptions {
  /** Tag extraction function. Default: row => row.symbol ?? "untagged". */
  getTag?: (row: ExecutionRecord) => string;
  /** Minimum trades for "robust" tier. Default 50. */
  robustThreshold?: number;
  /** Minimum trades for "preliminary" tier. Default 30. */
  preliminaryThreshold?: number;
  /** Optional pre-filter (e.g. only count close_position records). Default: include all. */
  filter?: (row: ExecutionRecord) => boolean;
  /** Override the ledger path (used in tests). */
  ledgerPath?: string;
}

const DEFAULT_OPTIONS: Required<Omit<ExpectancyOptions, "filter" | "ledgerPath">> = {
  getTag: (row: ExecutionRecord) => row.symbol ?? "untagged",
  robustThreshold: 50,
  preliminaryThreshold: 30,
};

/**
 * Extract per-record realized P&L delta. Returns null when either
 * snapshot is missing — the caller drops these from aggregation.
 */
export function extractRecordPnl(record: ExecutionRecord): number | null {
  const before = record.stateBefore?.realizedPnLUsd;
  const after = record.stateAfter?.realizedPnLUsd;
  if (typeof before !== "number" || typeof after !== "number") return null;
  if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
  return after - before;
}

/**
 * Read execution records from a JSONL ledger file. Skips malformed
 * lines silently (matches the trade-ledger writer's safety pattern).
 */
export function readLedgerRecords(path?: string): ExecutionRecord[] {
  const resolved = path ?? defaultTradeLedgerPath();
  if (!existsSync(resolved)) return [];
  try {
    const raw = readFileSync(resolved, "utf-8");
    const records: ExecutionRecord[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as ExecutionRecord;
        if (parsed.recordId && Array.isArray(parsed.operations)) {
          records.push(parsed);
        }
      } catch {
        // skip malformed JSONL lines
      }
    }
    return records;
  } catch {
    return [];
  }
}

/**
 * 95% Wilson confidence interval on a binomial proportion. More
 * stable than the normal approximation for small samples + extreme
 * proportions (close to 0 or 1).
 */
export function wilsonInterval(wins: number, total: number): { lower: number; upper: number } {
  if (total === 0) return { lower: 0, upper: 1 };
  const z = 1.96; // 95%
  const p = wins / total;
  const denom = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denom;
  return {
    lower: Math.max(0, parseFloat((center - half).toFixed(4))),
    upper: Math.min(1, parseFloat((center + half).toFixed(4))),
  };
}

function computeTagExpectancy(
  tag: string,
  pnls: number[],
  robustThreshold: number,
  preliminaryThreshold: number,
): TagExpectancy {
  const sampleSize = pnls.length;
  const wins = pnls.filter((v) => v > 0);
  const losses = pnls.filter((v) => v < 0);
  const breakevens = pnls.filter((v) => v === 0);

  const winRate = sampleSize > 0 ? wins.length / sampleSize : 0;
  const lossRate = sampleSize > 0 ? losses.length / sampleSize : 0;
  const avgWin = wins.length > 0 ? wins.reduce((s, v) => s + v, 0) / wins.length : 0;
  const avgLoss =
    losses.length > 0 ? Math.abs(losses.reduce((s, v) => s + v, 0) / losses.length) : 0;
  const expectancy = winRate * avgWin - lossRate * avgLoss;
  const totalPnl = pnls.reduce((s, v) => s + v, 0);

  let significance: SignificanceTier;
  if (sampleSize >= robustThreshold) significance = "robust";
  else if (sampleSize >= preliminaryThreshold) significance = "preliminary";
  else significance = "insufficient";

  return {
    tag,
    sampleSize,
    winCount: wins.length,
    lossCount: losses.length,
    breakevenCount: breakevens.length,
    winRate: parseFloat(winRate.toFixed(4)),
    lossRate: parseFloat(lossRate.toFixed(4)),
    avgWin: parseFloat(avgWin.toFixed(4)),
    avgLoss: parseFloat(avgLoss.toFixed(4)),
    expectancy: parseFloat(expectancy.toFixed(4)),
    totalPnl: parseFloat(totalPnl.toFixed(4)),
    significance,
    winRateCi: wilsonInterval(wins.length, sampleSize),
  };
}

/**
 * Compute per-tag expectancy report. Accepts pre-loaded records or
 * reads from the default ledger path.
 */
export function computeExpectancyReport(
  recordsOrUndefined?: ExecutionRecord[],
  options: ExpectancyOptions = {},
): ExpectancyReport {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const records = recordsOrUndefined ?? readLedgerRecords(options.ledgerPath);
  const filtered = opts.filter ? records.filter(opts.filter) : records;

  const groups = new Map<string, number[]>();
  let rowsWithPnl = 0;
  let rowsMissingPnl = 0;

  for (const row of filtered) {
    const pnl = extractRecordPnl(row);
    if (pnl === null) {
      rowsMissingPnl++;
      continue;
    }
    rowsWithPnl++;
    const tag = opts.getTag(row);
    const list = groups.get(tag) ?? [];
    list.push(pnl);
    groups.set(tag, list);
  }

  const byTag: TagExpectancy[] = [];
  for (const [tag, pnls] of groups) {
    byTag.push(computeTagExpectancy(tag, pnls, opts.robustThreshold, opts.preliminaryThreshold));
  }
  byTag.sort((a, b) => b.expectancy - a.expectancy);

  // Overall = aggregate across all tags
  const allPnls = byTag.flatMap((_, idx) => {
    const tagName = byTag[idx]!.tag;
    return groups.get(tagName) ?? [];
  });
  const overall = computeTagExpectancy(
    "__overall__",
    allPnls,
    opts.robustThreshold,
    opts.preliminaryThreshold,
  );

  const robustTags = byTag.filter((t) => t.significance !== "insufficient");
  const bestTag = robustTags.length > 0 ? robustTags[0]! : null;
  const worstTag = robustTags.length > 0 ? robustTags[robustTags.length - 1]! : null;

  const summary =
    `${rowsWithPnl} trades across ${byTag.length} tags ` +
    `(${rowsMissingPnl} dropped for missing P&L). ` +
    `Overall expectancy ${overall.expectancy.toFixed(4)} per trade ` +
    `(win rate ${(overall.winRate * 100).toFixed(1)}%, n=${overall.sampleSize}). ` +
    (bestTag
      ? `Best tag: ${bestTag.tag} (E=${bestTag.expectancy.toFixed(4)}, n=${bestTag.sampleSize}, ${bestTag.significance})`
      : "No tag met preliminary significance threshold.");

  return {
    totalRowsRead: records.length,
    rowsWithPnl,
    rowsMissingPnl,
    rowsByTagCount: byTag.length,
    byTag,
    overall,
    bestTag,
    worstTag,
    summary,
  };
}
