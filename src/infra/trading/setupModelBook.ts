/**
 * Setup Model-Book (B12)
 *
 * A deliberate-practice loop for setup fluency: a persistent cohort of
 * screener candidates, each auto-updated with 3d / 5d forward outcomes
 * (MFE / MAE / close + an outcome tag), rolled up into per-setup-tag
 * cohort statistics that mint rule candidates ("this tag carries edge -
 * prefer it" / "this tag bleeds - avoid it").
 *
 * Distinct from `pattern-edge` (validates an edge you already believe in)
 * and `hindsight-check` (reviews a single decision). The model-book is a
 * FORWARD, sample-building loop: you log what the screener surfaced today,
 * and the book tells you weeks later which setups actually paid.
 *
 * Persistence mirrors the skill-usage / trade-ledger pattern: append-only
 * JSONL, one tagged row per event, reconstructed last-write-wins per id.
 * The stats + outcome math are pure and deterministic (tested).
 *
 *   - Path: ~/.gordon/setup-model-book.jsonl
 *   - Override via GORDON_SETUP_MODEL_BOOK_PATH (testing).
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { GORDON_DIR } from "../storage/paths.ts";

// ============================================================================
// Types
// ============================================================================

export type SetupSide = "long" | "short";
export type ForwardHorizon = "3d" | "5d";
export type OutcomeTag = "target_hit" | "stopped_out" | "win" | "loss" | "scratch";

/** A screener candidate frozen at logging time. */
export interface SetupCandidate {
  /** Stable id (caller-supplied or timestamp+symbol). */
  id: string;
  /** ISO-8601 time the candidate was logged. */
  loggedAt: string;
  symbol: string;
  side: SetupSide;
  /** Reference price at logging (usually last close or planned entry). */
  entryRef: number;
  /** Optional protective stop and profit target for tag classification. */
  stop?: number;
  target?: number;
  /** Setup taxonomy tags the cohort stats group by. */
  setupTags: string[];
  note?: string;
}

/** A forward-outcome measurement at a given horizon. */
export interface ForwardOutcome {
  horizon: ForwardHorizon;
  computedAt: string;
  /** Max favorable excursion, fraction, signed in the side's favor (>= 0 normally). */
  mfePct: number;
  /** Max adverse excursion, fraction, signed against the side (<= 0 normally). */
  maePct: number;
  /** Close-to-reference return, fraction, signed in the side's favor. */
  closePct: number;
  outcomeTag: OutcomeTag;
}

export interface SetupModelBookEntry {
  candidate: SetupCandidate;
  outcomes: ForwardOutcome[];
}

/** OHLC-ish bar. Only high/low/close are consumed. */
export interface OutcomeBar {
  high: number;
  low: number;
  close: number;
}

type ModelBookRow =
  | { type: "candidate"; candidate: SetupCandidate }
  | { type: "outcome"; candidateId: string; outcome: ForwardOutcome };

/** Returns below this |close| band count as a scratch rather than win/loss. */
export const SCRATCH_BAND = 0.005;

// ============================================================================
// Persistence
// ============================================================================

export function defaultModelBookPath(): string {
  return process.env.GORDON_SETUP_MODEL_BOOK_PATH ?? join(GORDON_DIR, "setup-model-book.jsonl");
}

function appendRow(row: ModelBookRow, pathOverride?: string): void {
  const filePath = pathOverride ?? defaultModelBookPath();
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(filePath, JSON.stringify(row) + "\n");
}

/** Log a new screener candidate into the model-book. */
export function recordCandidate(candidate: SetupCandidate, pathOverride?: string): void {
  appendRow({ type: "candidate", candidate }, pathOverride);
}

/** Attach (or replace) a matured forward outcome for a candidate. */
export function recordOutcome(
  candidateId: string,
  outcome: ForwardOutcome,
  pathOverride?: string,
): void {
  appendRow({ type: "outcome", candidateId, outcome }, pathOverride);
}

/**
 * Read + reconstruct the model-book. Candidate rows set the candidate;
 * outcome rows attach one outcome per horizon (last write wins per
 * (id, horizon)). Malformed lines and orphan outcomes are skipped.
 */
export function readModelBook(pathOverride?: string): SetupModelBookEntry[] {
  const filePath = pathOverride ?? defaultModelBookPath();
  if (!existsSync(filePath)) return [];
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  const byId = new Map<string, SetupModelBookEntry>();
  const pendingOutcomes: Array<{ id: string; outcome: ForwardOutcome }> = [];

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let row: ModelBookRow;
    try {
      row = JSON.parse(line) as ModelBookRow;
    } catch {
      continue;
    }
    if (row.type === "candidate" && row.candidate?.id) {
      const existing = byId.get(row.candidate.id);
      byId.set(row.candidate.id, {
        candidate: row.candidate,
        outcomes: existing?.outcomes ?? [],
      });
    } else if (row.type === "outcome" && row.candidateId && row.outcome) {
      pendingOutcomes.push({ id: row.candidateId, outcome: row.outcome });
    }
  }

  for (const { id, outcome } of pendingOutcomes) {
    const entry = byId.get(id);
    if (!entry) continue; // orphan outcome (no candidate) - skip
    const idx = entry.outcomes.findIndex((o) => o.horizon === outcome.horizon);
    if (idx >= 0) entry.outcomes[idx] = outcome;
    else entry.outcomes.push(outcome);
  }

  return [...byId.values()];
}

// ============================================================================
// Forward-outcome math (pure)
// ============================================================================

export interface ComputeOutcomeParams {
  entryRef: number;
  side: SetupSide;
  horizon: ForwardHorizon;
  bars: OutcomeBar[];
  stop?: number;
  target?: number;
  /** ISO time the outcome was computed. Defaults to now. */
  computedAt?: string;
}

/**
 * Compute MFE / MAE / close for a candidate over its forward bars, plus an
 * outcome tag. Excursions are expressed in the side's favor: mfePct >= 0 is
 * the best favorable move, maePct <= 0 the worst adverse move.
 *
 * Tag priority walks bars in order and, on the first bar that touches a
 * level, resolves adverse-first (stop before target within the same bar -
 * conservative, since intrabar sequence is unknown). If no level is
 * touched, the tag falls out of `closePct` against `SCRATCH_BAND`.
 */
export function computeForwardOutcome(params: ComputeOutcomeParams): ForwardOutcome {
  const { entryRef, side, horizon, bars, stop, target } = params;
  const computedAt = params.computedAt ?? new Date().toISOString();

  if (entryRef <= 0 || bars.length === 0) {
    return { horizon, computedAt, mfePct: 0, maePct: 0, closePct: 0, outcomeTag: "scratch" };
  }

  const long = side === "long";
  let mfePct = -Infinity;
  let maePct = Infinity;
  let levelTag: OutcomeTag | null = null;

  for (const bar of bars) {
    const favorable = long
      ? (bar.high - entryRef) / entryRef
      : (entryRef - bar.low) / entryRef;
    const adverse = long
      ? (bar.low - entryRef) / entryRef
      : (entryRef - bar.high) / entryRef;
    if (favorable > mfePct) mfePct = favorable;
    if (adverse < maePct) maePct = adverse;

    if (levelTag === null) {
      const stopHit = stop !== undefined && (long ? bar.low <= stop : bar.high >= stop);
      const targetHit = target !== undefined && (long ? bar.high >= target : bar.low <= target);
      if (stopHit) levelTag = "stopped_out";
      else if (targetHit) levelTag = "target_hit";
    }
  }

  const lastClose = bars[bars.length - 1]!.close;
  const closePct = long ? (lastClose - entryRef) / entryRef : (entryRef - lastClose) / entryRef;

  let outcomeTag: OutcomeTag;
  if (levelTag !== null) {
    outcomeTag = levelTag;
  } else if (closePct > SCRATCH_BAND) {
    outcomeTag = "win";
  } else if (closePct < -SCRATCH_BAND) {
    outcomeTag = "loss";
  } else {
    outcomeTag = "scratch";
  }

  return {
    horizon,
    computedAt,
    mfePct: Number.isFinite(mfePct) ? mfePct : 0,
    maePct: Number.isFinite(maePct) ? maePct : 0,
    closePct,
    outcomeTag,
  };
}

// ============================================================================
// Cohort statistics + rule candidates
// ============================================================================

export interface CohortStat {
  tag: string;
  /** Candidates carrying this tag. */
  n: number;
  /** Candidates with a matured outcome at the requested horizon. */
  matured: number;
  /** Fraction of matured with closePct > 0. */
  winRate: number;
  avgMfePct: number;
  avgMaePct: number;
  avgClosePct: number;
  /** avgMfe / |avgMae|; 0 when avgMae is 0. */
  mfeToMaeRatio: number;
  targetHitRate: number;
  stoppedRate: number;
}

export interface CohortStatsOptions {
  horizon?: ForwardHorizon;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Roll up per-setup-tag statistics. A candidate contributes to every tag
 * in its `setupTags`. Only the outcome matching `horizon` (default 5d)
 * counts toward the matured stats.
 */
export function cohortStats(
  entries: SetupModelBookEntry[],
  options: CohortStatsOptions = {},
): CohortStat[] {
  const horizon = options.horizon ?? "5d";
  const byTag = new Map<
    string,
    { n: number; mfe: number[]; mae: number[]; close: number[]; wins: number; targets: number; stops: number }
  >();

  for (const entry of entries) {
    const outcome = entry.outcomes.find((o) => o.horizon === horizon);
    for (const tag of entry.candidate.setupTags) {
      let acc = byTag.get(tag);
      if (!acc) {
        acc = { n: 0, mfe: [], mae: [], close: [], wins: 0, targets: 0, stops: 0 };
        byTag.set(tag, acc);
      }
      acc.n++;
      if (outcome) {
        acc.mfe.push(outcome.mfePct);
        acc.mae.push(outcome.maePct);
        acc.close.push(outcome.closePct);
        if (outcome.closePct > 0) acc.wins++;
        if (outcome.outcomeTag === "target_hit") acc.targets++;
        if (outcome.outcomeTag === "stopped_out") acc.stops++;
      }
    }
  }

  const stats: CohortStat[] = [];
  for (const [tag, acc] of byTag) {
    const matured = acc.close.length;
    const avgMae = mean(acc.mae);
    stats.push({
      tag,
      n: acc.n,
      matured,
      winRate: matured > 0 ? acc.wins / matured : 0,
      avgMfePct: mean(acc.mfe),
      avgMaePct: avgMae,
      avgClosePct: mean(acc.close),
      mfeToMaeRatio: avgMae !== 0 ? mean(acc.mfe) / Math.abs(avgMae) : 0,
      targetHitRate: matured > 0 ? acc.targets / matured : 0,
      stoppedRate: matured > 0 ? acc.stops / matured : 0,
    });
  }

  stats.sort((a, b) => b.matured - a.matured || b.winRate - a.winRate);
  return stats;
}

export interface SetupRuleCandidate {
  tag: string;
  kind: "prefer" | "avoid";
  rationale: string;
  stat: CohortStat;
}

export interface RuleDerivationOptions {
  /** Minimum matured sample before a tag can mint a rule. Default 8. */
  minSample?: number;
  /** Win-rate at/above which a tag is a "prefer" candidate. Default 0.6. */
  preferWinRate?: number;
  /** MFE/MAE ratio at/above which a "prefer" candidate qualifies. Default 1.5. */
  preferRatio?: number;
  /** Win-rate at/below which a tag is an "avoid" candidate. Default 0.35. */
  avoidWinRate?: number;
}

/**
 * Mint rule candidates from cohort stats. A tag only mints a rule once it
 * has enough matured sample - deliberate practice, not a two-trade
 * superstition (aligns with the no-hardcoded-calibration / min-sample
 * discipline elsewhere in Gordon).
 */
export function deriveRuleCandidates(
  stats: CohortStat[],
  options: RuleDerivationOptions = {},
): SetupRuleCandidate[] {
  const minSample = options.minSample ?? 8;
  const preferWinRate = options.preferWinRate ?? 0.6;
  const preferRatio = options.preferRatio ?? 1.5;
  const avoidWinRate = options.avoidWinRate ?? 0.35;

  const out: SetupRuleCandidate[] = [];
  for (const stat of stats) {
    if (stat.matured < minSample) continue;
    const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
    if (stat.winRate >= preferWinRate && stat.mfeToMaeRatio >= preferRatio) {
      out.push({
        tag: stat.tag,
        kind: "prefer",
        rationale: `'${stat.tag}': ${pct(stat.winRate)} win-rate over ${stat.matured} matured setups, MFE/MAE ${stat.mfeToMaeRatio.toFixed(2)}. Prefer this setup.`,
        stat,
      });
    } else if (stat.winRate <= avoidWinRate) {
      out.push({
        tag: stat.tag,
        kind: "avoid",
        rationale: `'${stat.tag}': ${pct(stat.winRate)} win-rate over ${stat.matured} matured setups, avg close ${pct(stat.avgClosePct)}. Avoid or re-qualify this setup.`,
        stat,
      });
    }
  }
  return out;
}
