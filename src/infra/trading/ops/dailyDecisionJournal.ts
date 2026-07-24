/**
 * Daily Decision Journal (GORDON_DECISION_JOURNAL).
 *
 * Port of Ch 16 Protocol 1 from Ryan Wright. Pre-trade structured form
 * the operator must complete before every significant trade, forcing
 * System 2 (slow, deliberative) thinking to engage before System 1
 * (fast, intuitive) execution takes over. The act of writing slows
 * decision-making and exposes gaps that intuition glosses over.
 *
 * Three required sections + a pre-mortem checklist:
 *
 *   Thesis:    Narrative (one-sentence WHY) + Trigger (one-sentence WHEN)
 *              + Invalidation (the structural price level where you are wrong)
 *   Math:      Free capital → risk % → stop distance → position size.
 *              Sizing is the OUTPUT, never the input — see pathDependentSizer.
 *   Pre-mortem: 5 binary failure-mode questions. Any 'yes' = re-consider:
 *     - B-setup trap: am I bored, taking a marginal setup?
 *     - Tilt check:   am I trying to make back yesterday's losses?
 *     - Event risk:   is there a Fed/earnings/data print in the next 2h?
 *     - Liquidity trap: wide spreads, thin volume?
 *     - Correlation blind spot: am I doubling down on an existing theme?
 *
 * Distinct from `decisionLog.ts` (general-purpose decision capture
 * across the agent lifecycle). The journal is specifically the Protocol-1
 * pre-trade form, with a fixed schema and go/no-go verdict.
 *
 * Persists to ~/.gordon/decision-journal.jsonl. Composes with TM3 by
 * mirroring entries into decisionLog at stage="planning".
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DECISION_JOURNAL_PATH_ENV = "GORDON_DECISION_JOURNAL_PATH";

export function defaultJournalPath(env: NodeJS.ProcessEnv = process.env): string {
  return env[DECISION_JOURNAL_PATH_ENV] || join(homedir(), ".gordon", "decision-journal.jsonl");
}

export interface ThesisSection {
  narrative: string;     // one-sentence fundamental/macro story
  trigger: string;       // one-sentence technical setup that confirms timing
  invalidation: string;  // structural price level (free-text — operator picks)
}

export interface MathSection {
  freeCapitalUsd: number;
  riskPercent: number;       // 0..1 (e.g. 0.01 = 1%)
  dollarRiskBudget: number;  // freeCapital × riskPercent
  stopDistance: number;      // |entry - stop|, post-buffer
  positionUnits: number;     // dollarRiskBudget / stopDistance
}

export interface PreMortemChecks {
  bSetupTrap: boolean;
  tiltCheck: boolean;
  eventRisk: boolean;
  liquidityTrap: boolean;
  correlationBlindSpot: boolean;
}

export type Verdict = "go" | "no_go";

export interface JournalEntry {
  id: string;
  recordedAt: string;
  tradeId?: string;
  symbol: string;
  direction: "long" | "short";
  thesis: ThesisSection;
  math: MathSection;
  preMortem: PreMortemChecks;
  verdict: Verdict;
  blockers: string[];
}

export interface RecordJournalInput {
  symbol: string;
  direction: "long" | "short";
  tradeId?: string;
  thesis: ThesisSection;
  math: MathSection;
  preMortem: PreMortemChecks;
  now?: string;
}

const BLOCKER_REASONS: Record<keyof PreMortemChecks, string> = {
  bSetupTrap: "B-setup trap — setup is good-enough but not compelling; chasing action",
  tiltCheck: "Tilt check — revenge trading to recover yesterday's losses",
  eventRisk: "Event risk — Fed/earnings/data print scheduled within 2h",
  liquidityTrap: "Liquidity trap — wide spread or thin volume",
  correlationBlindSpot: "Correlation blind spot — doubles existing directional exposure",
};

export function evaluateVerdict(
  thesis: ThesisSection,
  math: MathSection,
  preMortem: PreMortemChecks,
): { verdict: Verdict; blockers: string[] } {
  const blockers: string[] = [];

  if (!thesis.narrative.trim()) blockers.push("Thesis missing narrative");
  if (!thesis.trigger.trim()) blockers.push("Thesis missing trigger");
  if (!thesis.invalidation.trim()) blockers.push("Thesis missing invalidation");

  if (!Number.isFinite(math.freeCapitalUsd) || math.freeCapitalUsd <= 0) {
    blockers.push("Math: free capital must be positive");
  }
  if (!Number.isFinite(math.riskPercent) || math.riskPercent <= 0 || math.riskPercent > 0.1) {
    blockers.push("Math: risk percent out of band (0, 0.1]");
  }
  if (!Number.isFinite(math.stopDistance) || math.stopDistance <= 0) {
    blockers.push("Math: stop distance must be positive");
  }
  if (!Number.isFinite(math.positionUnits) || math.positionUnits <= 0) {
    blockers.push("Math: position units must be positive");
  }

  for (const key of Object.keys(BLOCKER_REASONS) as Array<keyof PreMortemChecks>) {
    if (preMortem[key]) blockers.push(BLOCKER_REASONS[key]);
  }

  return { verdict: blockers.length === 0 ? "go" : "no_go", blockers };
}

function newJournalId(): string {
  return `jrn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function recordJournalEntry(
  input: RecordJournalInput,
  env: NodeJS.ProcessEnv = process.env,
  path: string = defaultJournalPath(env),
): JournalEntry | null {
  const { verdict, blockers } = evaluateVerdict(input.thesis, input.math, input.preMortem);
  const entry: JournalEntry = {
    id: newJournalId(),
    recordedAt: input.now ?? new Date().toISOString(),
    tradeId: input.tradeId,
    symbol: input.symbol,
    direction: input.direction,
    thesis: input.thesis,
    math: input.math,
    preMortem: input.preMortem,
    verdict,
    blockers,
  };
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(entry) + "\n", "utf8");
  } catch {
    /* best-effort */
  }
  return entry;
}

export function readJournalLog(path: string): JournalEntry[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8");
  const entries: JournalEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as JournalEntry);
    } catch {
      /* skip */
    }
  }
  return entries;
}

export function formatEntry(entry: JournalEntry): string {
  const lines: string[] = [];
  lines.push(
    `Decision Journal ${entry.symbol} ${entry.direction.toUpperCase()} — ${entry.verdict.toUpperCase()}`,
  );
  lines.push(`  Narrative: ${entry.thesis.narrative}`);
  lines.push(`  Trigger:   ${entry.thesis.trigger}`);
  lines.push(`  Invalid:   ${entry.thesis.invalidation}`);
  lines.push(
    `  Math: $${entry.math.dollarRiskBudget.toFixed(0)} risk → ${entry.math.positionUnits.toFixed(4)} units (stop dist ${entry.math.stopDistance.toFixed(4)})`,
  );
  if (entry.blockers.length > 0) {
    lines.push("  Blockers:");
    for (const b of entry.blockers) lines.push(`    - ${b}`);
  }
  return lines.join("\n");
}

export function entryToPayload(entry: JournalEntry): Record<string, unknown> {
  return {
    kind: "decision_journal.recorded",
    id: entry.id,
    symbol: entry.symbol,
    direction: entry.direction,
    verdict: entry.verdict,
    blockerCount: entry.blockers.length,
    positionUnits: entry.math.positionUnits,
  };
}
