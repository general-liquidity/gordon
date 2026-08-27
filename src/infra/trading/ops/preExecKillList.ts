/**
 * Pre-Execution Kill List (GORDON_PRE_EXEC_KILL_LIST).
 *
 * Port of Ch 16 Protocol 6 from Ryan Wright. The last gate before you
 * click "Buy" or "Sell" — five binary self-checks that take ten seconds
 * to run and short-circuit the impulses that produce the worst trades.
 *
 *   - Am I bored?              (trading for entertainment)
 *   - Am I angry?              (revenge after a loss)
 *   - Am I rushing?            (FOMO chase after the candle already moved)
 *   - Did I move my stop?      (already in bargaining mode)
 *   - Is this money I can't afford to lose?
 *
 * If any single answer is "yes", the kill list fails. This is the L0
 * operator-state check that runs BEFORE Layer 1 pre-trade safety
 * (termination Layer 1 checks the trade; the kill list checks the operator).
 *
 * Distinct from `dailyDecisionJournal` pre-mortem (which evaluates the
 * setup) — the kill list is purely about operator state in the moment of
 * execution. The journal pre-mortem is filled minutes before; the kill
 * list runs seconds before. Both can pass while the other fails.
 *
 * Pure compute, no persistence — by design. The point is the friction of
 * the check itself, not the audit trail.
 */

export const PRE_EXEC_KILL_LIST_FLAG_ENV = "GORDON_PRE_EXEC_KILL_LIST";

export function isPreExecKillListEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  // Default-on protective gate: absence = enabled. Explicit "0"/"false" opts out.
  // Operator-state self-checks default to false → pass, so it never fires spuriously.
  const raw = env[PRE_EXEC_KILL_LIST_FLAG_ENV];
  return raw !== "0" && raw !== "false";
}

export interface KillListInput {
  bored: boolean;
  angry: boolean;
  rushing: boolean;
  movedStop: boolean;
  scaredMoney: boolean;
}

export type KillListBlocker = "bored" | "angry" | "rushing" | "moved_stop" | "scared_money";

const BLOCKER_DESCRIPTIONS: Record<KillListBlocker, string> = {
  bored: "Trading for entertainment — the market charges admission for excitement",
  angry: "Revenge trading after a loss — anger narrows cognition",
  rushing: "FOMO chase — paying a premium to be late",
  moved_stop: "Stop was widened — already in bargaining mode with reality",
  scared_money: "Risk dollar amount would cause genuine hardship if lost",
};

export interface KillListResult {
  pass: boolean;
  blockers: KillListBlocker[];
  /** Human-readable reasons aligned to `blockers` order. */
  reasons: string[];
  evaluatedAt: string;
}

const INPUT_TO_BLOCKER: Array<[keyof KillListInput, KillListBlocker]> = [
  ["bored", "bored"],
  ["angry", "angry"],
  ["rushing", "rushing"],
  ["movedStop", "moved_stop"],
  ["scaredMoney", "scared_money"],
];

export function runKillList(
  input: KillListInput,
  now: string = new Date().toISOString(),
): KillListResult {
  const blockers: KillListBlocker[] = [];
  const reasons: string[] = [];
  for (const [field, blocker] of INPUT_TO_BLOCKER) {
    if (input[field]) {
      blockers.push(blocker);
      reasons.push(BLOCKER_DESCRIPTIONS[blocker]);
    }
  }
  return { pass: blockers.length === 0, blockers, reasons, evaluatedAt: now };
}

export function formatResult(result: KillListResult): string {
  if (result.pass) return "Kill list: PASS";
  const lines: string[] = [`Kill list: BLOCK (${result.blockers.length} flag(s))`];
  for (const r of result.reasons) lines.push(`  - ${r}`);
  return lines.join("\n");
}

export function resultToPayload(result: KillListResult): Record<string, unknown> {
  return {
    kind: "pre_exec_kill_list.evaluated",
    pass: result.pass,
    blockerCount: result.blockers.length,
    blockers: result.blockers,
  };
}
