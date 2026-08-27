/**
 * Shadow Mode (GORDON_SHADOW_MODE).
 *
 * Port of item 9 from the harness-engineering Tier 3 plan, L10 analog.
 *
 * Records a "ghost fill" for every plan the system generates, regardless
 * of whether the plan was actually executed. Each ghost fill captures the
 * plan parameters + a hypothetical fill price (typically current market
 * mid at the time the plan fired). When the market later moves, the
 * exit can be reconciled and a hypothetical PnL computed.
 *
 * Side-by-side comparison of shadow PnL vs realized PnL is the closest
 * thing trading has to "E2E tests passed" — it tells the operator whether
 * the agent's *recommendations* are profitable, independent of whether
 * the operator chose to take them.
 *
 * This module does NOT subscribe to events itself. Callers (planner /
 * autonomous-loop event consumer) decide when to call `recordShadowOpen`
 * and `recordShadowClose`. Keeping ingestion separate from storage makes
 * the module testable and lets callers gate on the flag.
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const SHADOW_FLAG_ENV = "GORDON_SHADOW_MODE";
export const SHADOW_PATH_ENV = "GORDON_SHADOW_FILLS_PATH";

export type ShadowStatus = "open" | "closed" | "expired";
export type ShadowSide = "long" | "short";

export interface ShadowFill {
  /** Plan id this ghost fill mirrors. */
  planId: string;
  /** Market symbol (e.g. BTC/USD, AAPL). */
  symbol: string;
  /** Trade direction. */
  side: ShadowSide;
  /** Hypothetical entry price — usually mid at plan_ready time. */
  entryPrice: number;
  /** Intended position size (units). */
  intendedSize: number;
  /** Strategy id/name for grouping reports. */
  strategy: string;
  /** Stop level from the plan (used for `expired` resolution). */
  stopLoss: number | null;
  /** First take-profit level from the plan. */
  takeProfit: number | null;
  /** Timestamp the ghost fill opened (ms). */
  openedAt: number;
  /** Timestamp closed; null while open. */
  closedAt: number | null;
  /** Exit price when closed; null while open. */
  exitPrice: number | null;
  /** Computed PnL when closed (quote currency); null while open. */
  pnl: number | null;
  /** PnL as fraction of notional; null while open. */
  pnlFraction: number | null;
  /** Reason the fill closed (stop / target / manual / time / expired). */
  closeReason: string | null;
  status: ShadowStatus;
}

export interface OpenShadowInput {
  planId: string;
  symbol: string;
  side: ShadowSide;
  entryPrice: number;
  intendedSize: number;
  strategy: string;
  stopLoss?: number | null;
  takeProfit?: number | null;
  /** Override for tests. Defaults to Date.now(). */
  now?: number;
}

export interface CloseShadowInput {
  planId: string;
  exitPrice: number;
  closeReason: string;
  /** Override for tests. Defaults to Date.now(). */
  now?: number;
}

export interface ShadowReadOptions {
  /** Filter by symbol (exact match). */
  symbol?: string;
  /** Filter by status. */
  status?: ShadowStatus;
  /** Filter by strategy. */
  strategy?: string;
  /** Earliest openedAt (inclusive). */
  sinceMs?: number;
  /** Latest entries by openedAt. */
  limit?: number;
}

export interface ShadowSummary {
  totalFills: number;
  openFills: number;
  closedFills: number;
  totalPnl: number;
  winRate: number | null;
  winners: number;
  losers: number;
  avgWinnerPnl: number | null;
  avgLoserPnl: number | null;
  /** Sharpe-ish: mean / std of pnlFraction across closed fills. */
  pnlFractionMean: number | null;
  pnlFractionStd: number | null;
}

export interface ShadowVsRealComparison {
  shadow: ShadowSummary;
  real: ShadowSummary;
  divergencePnl: number;
  /** Shadow pnl - real pnl, positive means shadow outperformed. */
  divergencePnlFraction: number | null;
}

export function isShadowModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[SHADOW_FLAG_ENV] === "1" || env[SHADOW_FLAG_ENV] === "true";
}

export function defaultShadowFillsPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[SHADOW_PATH_ENV];
  if (override && override.length > 0) return override;
  return join(homedir(), ".gordon", "shadow-fills.jsonl");
}

function ensureParentDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Append an open ghost fill to the JSONL. Returns the fill record.
 *
 * Idempotency note: this module does NOT dedupe on planId. Callers that
 * may fire `plan_ready` multiple times should track which plan ids have
 * been shadowed and skip duplicates. Keeping dedupe out of this module
 * keeps the storage purely append-only.
 */
export function recordShadowOpen(input: OpenShadowInput, path?: string): ShadowFill {
  const fill: ShadowFill = {
    planId: input.planId,
    symbol: input.symbol,
    side: input.side,
    entryPrice: input.entryPrice,
    intendedSize: input.intendedSize,
    strategy: input.strategy,
    stopLoss: input.stopLoss ?? null,
    takeProfit: input.takeProfit ?? null,
    openedAt: input.now ?? Date.now(),
    closedAt: null,
    exitPrice: null,
    pnl: null,
    pnlFraction: null,
    closeReason: null,
    status: "open",
  };
  const target = path ?? defaultShadowFillsPath();
  ensureParentDir(target);
  appendFileSync(target, `${JSON.stringify(fill)}\n`, "utf8");
  return fill;
}

/**
 * Append a `closed` JSONL entry referencing an earlier open fill. Reader
 * functions reconcile open + closed entries to produce the final view.
 *
 * This is append-only: closed entries are diffs, not rewrites. Reading
 * is responsible for merging.
 */
export function recordShadowClose(
  input: CloseShadowInput,
  path?: string,
): {
  planId: string;
  exitPrice: number;
  closeReason: string;
  closedAt: number;
} {
  const record = {
    type: "close" as const,
    planId: input.planId,
    exitPrice: input.exitPrice,
    closeReason: input.closeReason,
    closedAt: input.now ?? Date.now(),
  };
  const target = path ?? defaultShadowFillsPath();
  ensureParentDir(target);
  appendFileSync(target, `${JSON.stringify(record)}\n`, "utf8");
  return record;
}

function computePnl(side: ShadowSide, entry: number, exit: number, size: number): number {
  const delta = side === "long" ? exit - entry : entry - exit;
  return delta * size;
}

/**
 * Read all shadow fills, reconciling open+close JSONL entries into a
 * final view per planId.
 *
 * Tolerant of malformed lines (skipped silently).
 */
export function readShadowFills(opts: ShadowReadOptions = {}, path?: string): ShadowFill[] {
  const target = path ?? defaultShadowFillsPath();
  if (!existsSync(target)) return [];

  const lines = readFileSync(target, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  const byPlanId = new Map<string, ShadowFill>();
  const closeRecords: Array<{
    planId: string;
    exitPrice: number;
    closeReason: string;
    closedAt: number;
  }> = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed.type === "close") {
        closeRecords.push({
          planId: parsed.planId as string,
          exitPrice: parsed.exitPrice as number,
          closeReason: parsed.closeReason as string,
          closedAt: parsed.closedAt as number,
        });
      } else if (typeof parsed.planId === "string") {
        byPlanId.set(parsed.planId, parsed as unknown as ShadowFill);
      }
    } catch {
      // skip malformed
    }
  }

  for (const close of closeRecords) {
    const fill = byPlanId.get(close.planId);
    if (fill?.status !== "open") continue;
    const pnl = computePnl(fill.side, fill.entryPrice, close.exitPrice, fill.intendedSize);
    const notional = fill.entryPrice * fill.intendedSize;
    const pnlFraction = notional > 0 ? pnl / notional : null;
    fill.exitPrice = close.exitPrice;
    fill.closedAt = close.closedAt;
    fill.closeReason = close.closeReason;
    fill.pnl = pnl;
    fill.pnlFraction = pnlFraction;
    fill.status = "closed";
  }

  let fills = Array.from(byPlanId.values());
  if (opts.symbol) fills = fills.filter((f) => f.symbol === opts.symbol);
  if (opts.status) fills = fills.filter((f) => f.status === opts.status);
  if (opts.strategy) fills = fills.filter((f) => f.strategy === opts.strategy);
  if (opts.sinceMs !== undefined) {
    const since = opts.sinceMs;
    fills = fills.filter((f) => f.openedAt >= since);
  }
  fills.sort((a, b) => b.openedAt - a.openedAt);
  if (opts.limit !== undefined) fills = fills.slice(0, opts.limit);
  return fills;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((sum, x) => sum + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

export function summarizeShadowFills(fills: ShadowFill[]): ShadowSummary {
  const closed = fills.filter((f) => f.status === "closed");
  const winners = closed.filter((f) => (f.pnl ?? 0) > 0);
  const losers = closed.filter((f) => (f.pnl ?? 0) < 0);
  const winnerPnls = winners.map((f) => f.pnl ?? 0);
  const loserPnls = losers.map((f) => f.pnl ?? 0);
  const fractions = closed.map((f) => f.pnlFraction ?? 0);
  const totalPnl = closed.reduce((sum, f) => sum + (f.pnl ?? 0), 0);

  return {
    totalFills: fills.length,
    openFills: fills.filter((f) => f.status === "open").length,
    closedFills: closed.length,
    totalPnl,
    winRate: closed.length > 0 ? winners.length / closed.length : null,
    winners: winners.length,
    losers: losers.length,
    avgWinnerPnl: winners.length > 0 ? mean(winnerPnls) : null,
    avgLoserPnl: losers.length > 0 ? mean(loserPnls) : null,
    pnlFractionMean: closed.length > 0 ? mean(fractions) : null,
    pnlFractionStd: closed.length > 0 ? std(fractions) : null,
  };
}

/**
 * Compare shadow vs real summaries. Real summaries are produced by
 * the caller (the existing trade-evaluator); this just diffs them.
 *
 * Positive `divergencePnl` means shadow outperformed real — i.e. Gordon's
 * recommendations were better than what was actually executed (operator
 * skipped winners or sized down).
 */
export function compareShadowVsReal(
  shadow: ShadowSummary,
  real: ShadowSummary,
): ShadowVsRealComparison {
  const divergencePnl = shadow.totalPnl - real.totalPnl;
  const divergencePnlFraction =
    shadow.pnlFractionMean !== null && real.pnlFractionMean !== null
      ? shadow.pnlFractionMean - real.pnlFractionMean
      : null;
  return { shadow, real, divergencePnl, divergencePnlFraction };
}

export function shadowSummaryToPayload(summary: ShadowSummary): Record<string, unknown> {
  return { kind: "shadow.summary_recorded", ...summary };
}
