/**
 * Debrief Matrix (GORDON_DEBRIEF_MATRIX).
 *
 * Port of Ch 15 (Operating System) from Ryan Wright. Wright's central
 * post-trade insight: judging a trade by its outcome alone — "resulting"
 * in Annie Duke's term — wires bad habits as winning strategies. The
 * defense is a 2-dimensional scorecard:
 *
 *                       Good Outcome          Bad Outcome
 *   Good Process    →   Deserved Success      Bad Luck (Variance)
 *                       (Reinforce)           (Resilience)
 *   Bad Process     →   Dumb Luck             Poetic Justice
 *                       (Toxic alpha)         (Learn)
 *
 * Each trade gets process (1-10) and outcome (1-10) scores. The matrix
 * classifies into one of four quadrants. Aggregating quadrant counts over
 * time reveals systemic issues: too many "dumb luck" wins means the
 * operator is reinforcing bad habits with profits.
 *
 * Composes with `decisionLog.ts` (TM3) — debriefs are recorded at
 * stage="closure" so the full pre-trade → execution → close trail is
 * queryable. Distinct from `evals/tradeEvaluator.ts` which scores
 * realized PnL ensemble — this captures the operator-state dimension
 * the PnL number alone cannot see.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { recordPortfolioTradeOutcome } from "../../safety/durableHaltState.ts";

export const DEBRIEF_MATRIX_PATH_ENV = "GORDON_DEBRIEF_MATRIX_PATH";

export function defaultDebriefPath(env: NodeJS.ProcessEnv = process.env): string {
  return env[DEBRIEF_MATRIX_PATH_ENV] || join(homedir(), ".gordon", "debriefs.jsonl");
}

export type Quadrant = "deserved_success" | "bad_luck" | "dumb_luck" | "poetic_justice";

export type QuadrantAction = "reinforce" | "resilience" | "treat_as_failure" | "learn";

const QUADRANT_ACTION: Record<Quadrant, QuadrantAction> = {
  deserved_success: "reinforce",
  bad_luck: "resilience",
  dumb_luck: "treat_as_failure",
  poetic_justice: "learn",
};

export interface ClassifyInput {
  /** 1-10 scale; how well did you follow your plan? */
  processScore: number;
  /** 1-10 scale; how did the trade perform vs risk? */
  outcomeScore: number;
  /** Threshold above which a score is "good". Default 6 (anything >=6 is good). */
  goodThreshold?: number;
}

const DEFAULT_GOOD_THRESHOLD = 6;

export interface Classification {
  quadrant: Quadrant;
  action: QuadrantAction;
  processScore: number;
  outcomeScore: number;
  processGood: boolean;
  outcomeGood: boolean;
}

function clamp(score: number): number {
  if (score < 1) return 1;
  if (score > 10) return 10;
  return score;
}

export function classifyDebrief(input: ClassifyInput): Classification {
  const threshold = input.goodThreshold ?? DEFAULT_GOOD_THRESHOLD;
  const processScore = clamp(input.processScore);
  const outcomeScore = clamp(input.outcomeScore);
  const processGood = processScore >= threshold;
  const outcomeGood = outcomeScore >= threshold;

  let quadrant: Quadrant;
  if (processGood && outcomeGood) quadrant = "deserved_success";
  else if (processGood && !outcomeGood) quadrant = "bad_luck";
  else if (!processGood && outcomeGood) quadrant = "dumb_luck";
  else quadrant = "poetic_justice";

  return {
    quadrant,
    action: QUADRANT_ACTION[quadrant],
    processScore,
    outcomeScore,
    processGood,
    outcomeGood,
  };
}

export interface DebriefEntry extends Classification {
  id: string;
  recordedAt: string;
  tradeId: string;
  symbol: string;
  pnlUsd: number;
  /** Stable venue/account/mode key used by account-scoped halt gates. */
  portfolioIdentity?: string;
  notes?: string;
}

export interface RecordDebriefInput {
  tradeId: string;
  symbol: string;
  pnlUsd: number;
  processScore: number;
  outcomeScore: number;
  portfolioIdentity?: string;
  notes?: string;
  goodThreshold?: number;
  now?: string;
}

export interface TradeClosureDebriefInput {
  tradeId: string;
  symbol: string;
  pnlUsd: number;
  pnlPercent: number;
  reason: string;
  portfolioIdentity: string | null | undefined;
}

function newDebriefId(): string {
  return `dbr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function recordDebrief(
  input: RecordDebriefInput,
  env: NodeJS.ProcessEnv = process.env,
  path: string = defaultDebriefPath(env),
): DebriefEntry | null {
  const classification = classifyDebrief({
    processScore: input.processScore,
    outcomeScore: input.outcomeScore,
    goodThreshold: input.goodThreshold,
  });
  const entry: DebriefEntry = {
    ...classification,
    id: newDebriefId(),
    recordedAt: input.now ?? new Date().toISOString(),
    tradeId: input.tradeId,
    symbol: input.symbol,
    pnlUsd: input.pnlUsd,
    portfolioIdentity: input.portfolioIdentity,
    notes: input.notes,
  };
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    return null;
  }
  return entry;
}

/**
 * Record an automatic debrief from a confirmed production close.
 *
 * Unidentified closes are deliberately not written: an unscoped loss cannot
 * later be assigned to a capital account without either forgiving the wrong
 * account or halting every account. Manual/legacy unscoped rows remain visible
 * to reports and to the explicit `default` fallback identity only.
 */
export function recordTradeClosureDebrief(
  input: TradeClosureDebriefInput,
  env: NodeJS.ProcessEnv = process.env,
  path: string = defaultDebriefPath(env),
): DebriefEntry | null {
  if (!input.portfolioIdentity) return null;

  // Streak safety evidence is not the best-effort teaching log. Persist the
  // account-scoped outcome in the authenticated halt ledger first. A lock or
  // write failure latches that ledger fail-closed, so the next new-risk order
  // cannot proceed on a vanished loss sequence.
  const outcome = input.pnlUsd > 0 ? "win" : input.pnlUsd < 0 ? "loss" : "scratch";
  const recordedAtMs = Date.now();
  if (
    !recordPortfolioTradeOutcome(input.portfolioIdentity, {
      tradeId: input.tradeId,
      outcome,
      recordedAtMs,
    })
  ) {
    return null;
  }

  const existing = readDebriefLog(path).find(
    (entry) =>
      entry.tradeId === input.tradeId && entry.portfolioIdentity === input.portfolioIdentity,
  );
  if (existing) return existing;

  const planFollowed = [
    "STOP",
    "TP1",
    "TP2",
    "TP3",
    "TRAILING",
    "stop_loss",
    "take_profit",
    "trailing_stop",
  ].includes(input.reason);
  const processScore = planFollowed ? 8 : 4;
  let outcomeScore = 5;
  if (input.pnlPercent >= 5) outcomeScore = 9;
  else if (input.pnlPercent >= 1) outcomeScore = 7;
  else if (input.pnlPercent >= 0) outcomeScore = 6;
  else if (input.pnlPercent >= -1) outcomeScore = 4;
  else if (input.pnlPercent >= -5) outcomeScore = 2;
  else outcomeScore = 1;

  return recordDebrief(
    {
      tradeId: input.tradeId,
      symbol: input.symbol,
      pnlUsd: input.pnlUsd,
      portfolioIdentity: input.portfolioIdentity,
      processScore,
      outcomeScore,
      notes: `auto-debrief: close reason=${input.reason}`,
    },
    env,
    path,
  );
}

export function readDebriefLog(path: string): DebriefEntry[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8");
  const entries: DebriefEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as DebriefEntry);
    } catch {
      /* skip */
    }
  }
  return entries;
}

export interface QuadrantAggregate {
  total: number;
  counts: Record<Quadrant, number>;
  fractions: Record<Quadrant, number>;
  /** True when "dumb luck" wins are >20% of all wins — toxic-alpha alarm. */
  toxicAlphaAlarm: boolean;
}

export function aggregateQuadrants(entries: ReadonlyArray<DebriefEntry>): QuadrantAggregate {
  const counts: Record<Quadrant, number> = {
    deserved_success: 0,
    bad_luck: 0,
    dumb_luck: 0,
    poetic_justice: 0,
  };
  for (const e of entries) counts[e.quadrant]++;
  const total = entries.length;
  const fractions: Record<Quadrant, number> = {
    deserved_success: total > 0 ? counts.deserved_success / total : 0,
    bad_luck: total > 0 ? counts.bad_luck / total : 0,
    dumb_luck: total > 0 ? counts.dumb_luck / total : 0,
    poetic_justice: total > 0 ? counts.poetic_justice / total : 0,
  };
  const wins = counts.deserved_success + counts.dumb_luck;
  const toxicAlphaAlarm = wins > 0 && counts.dumb_luck / wins > 0.2;
  return { total, counts, fractions, toxicAlphaAlarm };
}

export function formatDebrief(entry: DebriefEntry): string {
  return `Debrief ${entry.symbol} #${entry.tradeId} → ${entry.quadrant} (${entry.action}) | P=${entry.processScore} O=${entry.outcomeScore} PnL $${entry.pnlUsd.toFixed(2)}`;
}

export function debriefToPayload(entry: DebriefEntry): Record<string, unknown> {
  return {
    kind: "debrief_matrix.classified",
    tradeId: entry.tradeId,
    portfolioIdentity: entry.portfolioIdentity,
    quadrant: entry.quadrant,
    action: entry.action,
    processScore: entry.processScore,
    outcomeScore: entry.outcomeScore,
  };
}
