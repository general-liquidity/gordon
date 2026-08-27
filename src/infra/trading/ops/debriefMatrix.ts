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
  notes?: string;
}

export interface RecordDebriefInput {
  tradeId: string;
  symbol: string;
  pnlUsd: number;
  processScore: number;
  outcomeScore: number;
  notes?: string;
  goodThreshold?: number;
  now?: string;
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
    notes: input.notes,
  };
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    /* best-effort */
  }
  return entry;
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
    quadrant: entry.quadrant,
    action: entry.action,
    processScore: entry.processScore,
    outcomeScore: entry.outcomeScore,
  };
}
