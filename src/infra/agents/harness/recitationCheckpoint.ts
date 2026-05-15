/**
 * Recitation Checkpoint (GORDON_RECITATION_CHECKPOINT).
 *
 * Port of Manus's recitation pattern from "Context Engineering for AI
 * Agents: Lessons from Building Manus" (2026). Manus maintains a
 * `todo.md` file that the agent updates step-by-step; the periodically-
 * re-injected file content "recites its objectives into the end of the
 * context" to combat lost-in-the-middle drift on long autonomous runs
 * (~50 tool calls average per task).
 *
 * Anthropic Lost-in-the-Middle (Liu et al., 2023) is the underlying
 * mechanism: middle-context content receives ~30% the attention of
 * extreme positions. Recitation pushes important state back to the
 * extreme.
 *
 * The primitive provides:
 *
 *   1. `shouldRecite(state, opts)` — gate by cadence (every N turns
 *      or N tool calls since last recite).
 *   2. `buildRecitationBlock({ goal, progressLines, blockers })` —
 *      formats the reminder text ready to splice into the agent's
 *      current turn or system prompt.
 *   3. `markRecited(state)` — pure-functional state update.
 *
 * Pair with `goalMode.ts` (which has the goal + iteration state) and
 * `contextAnxietyDetector.ts` (which detects the failure mode this
 * primitive mitigates).
 */

export const RECITATION_CHECKPOINT_FLAG_ENV = "GORDON_RECITATION_CHECKPOINT";

export interface RecitationState {
  /** Turn index when recitation last fired. */
  lastRecitedTurn: number;
  /** Tool-call count when recitation last fired. */
  lastRecitedToolCalls: number;
}

export interface ShouldReciteInput {
  /** Current turn index. */
  currentTurn: number;
  /** Cumulative tool-call count. */
  currentToolCalls: number;
  /** Last recitation state (or initial empty state). */
  state: RecitationState;
}

export interface RecitationCadence {
  /** Recite every N turns. Default 8. */
  everyTurns?: number;
  /** Or every N tool calls. Default 20. */
  everyToolCalls?: number;
}

export interface ShouldReciteResult {
  shouldRecite: boolean;
  reason: string;
}

export interface RecitationContent {
  /** The active goal statement (one line, ≤120 chars ideal). */
  goal: string;
  /** What has been done so far. */
  progressLines?: string[];
  /** Open blockers / pending items. */
  blockers?: string[];
  /** Optional checklist items with done/pending status. */
  checklist?: Array<{ item: string; done: boolean }>;
}

export function isRecitationCheckpointEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env[RECITATION_CHECKPOINT_FLAG_ENV] === "1" ||
    env[RECITATION_CHECKPOINT_FLAG_ENV] === "true"
  );
}

export function initialRecitationState(): RecitationState {
  return { lastRecitedTurn: 0, lastRecitedToolCalls: 0 };
}

export function shouldRecite(
  input: ShouldReciteInput,
  cadence: RecitationCadence = {},
): ShouldReciteResult {
  const everyTurns = cadence.everyTurns ?? 8;
  const everyToolCalls = cadence.everyToolCalls ?? 20;

  const turnsSince = input.currentTurn - input.state.lastRecitedTurn;
  const toolCallsSince = input.currentToolCalls - input.state.lastRecitedToolCalls;

  if (turnsSince >= everyTurns) {
    return {
      shouldRecite: true,
      reason: `${turnsSince} turns since last recite (cadence: ${everyTurns})`,
    };
  }
  if (toolCallsSince >= everyToolCalls) {
    return {
      shouldRecite: true,
      reason: `${toolCallsSince} tool calls since last recite (cadence: ${everyToolCalls})`,
    };
  }
  return { shouldRecite: false, reason: "within cadence window" };
}

export function markRecited(input: ShouldReciteInput): RecitationState {
  return {
    lastRecitedTurn: input.currentTurn,
    lastRecitedToolCalls: input.currentToolCalls,
  };
}

/**
 * Build the recitation block. Format mirrors Manus's `todo.md` — concise
 * markdown that re-asserts the goal + status + pending items so the
 * model sees them at the end of context (where attention is highest).
 */
export function buildRecitationBlock(content: RecitationContent): string {
  const lines: string[] = [];
  lines.push("RECITATION — re-asserting active context:");
  lines.push(`Goal: ${content.goal}`);
  if (content.progressLines && content.progressLines.length > 0) {
    lines.push("Done so far:");
    for (const p of content.progressLines) lines.push(`  ✓ ${p}`);
  }
  if (content.blockers && content.blockers.length > 0) {
    lines.push("Blockers / open:");
    for (const b of content.blockers) lines.push(`  • ${b}`);
  }
  if (content.checklist && content.checklist.length > 0) {
    lines.push("Checklist:");
    for (const c of content.checklist) {
      lines.push(`  [${c.done ? "x" : " "}] ${c.item}`);
    }
  }
  return lines.join("\n");
}

export function recitationToPayload(
  shouldFire: ShouldReciteResult,
  cadence: RecitationCadence,
): Record<string, unknown> {
  return {
    kind: "recitation.checkpoint_recorded",
    fired: shouldFire.shouldRecite,
    reason: shouldFire.reason,
    cadenceTurns: cadence.everyTurns ?? 8,
    cadenceToolCalls: cadence.everyToolCalls ?? 20,
  };
}
