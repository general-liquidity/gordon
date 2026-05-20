/**
 * Per-Goal Deferred-Actions Log — GE3.
 *
 * Trading-domain port of the article's `docs/V1-CANDIDATES.md`
 * overflow valve, scoped to active goals. During a `/goal` session,
 * the operator may surface observations or actions worth revisiting
 * later but explicitly out of scope for the current goal. These get
 * captured here with structured rationale.
 *
 * The pure-compute primitive validates + structures the record.
 * The Mastra wrapper appends to `~/.gordon/goal-deferred.jsonl` and
 * supports filtering by goalId / category / time window.
 *
 * Distinct from:
 *   - `harness-deferred-wiring.md` — Gordon's own development-deferred
 *     items, written by developers
 *   - `agent-feedback.jsonl` — agent self-signaled stuck states
 *   - `MEMORY.md` — durable cross-session learnings
 *
 * This log is operator-authored, per-goal, ephemeral (cleared with
 * the goal it was scoped to).
 */

export const GOAL_DEFERRED_ACTIONS_FLAG_ENV = "GORDON_GOAL_DEFERRED_ACTIONS";

export function isGoalDeferredActionsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env[GOAL_DEFERRED_ACTIONS_FLAG_ENV] === "1" ||
    env[GOAL_DEFERRED_ACTIONS_FLAG_ENV] === "true"
  );
}

export type DeferredCategory =
  | "feature"
  | "investigation"
  | "data"
  | "observation"
  | "strategy"
  | "other";

export interface DeferredAction {
  goalId: string;
  action: string;
  rationale: string;
  category: DeferredCategory;
  /** ISO timestamp. */
  recordedAt: string;
  /** Optional free-form tags for searching. */
  tags?: ReadonlyArray<string>;
}

export interface BuildDeferredActionInput {
  goalId: string;
  action: string;
  rationale: string;
  category?: DeferredCategory;
  tags?: ReadonlyArray<string>;
  recordedAt?: string;
}

const MIN_ACTION_LEN = 5;
const MIN_RATIONALE_LEN = 5;

export function buildDeferredAction(input: BuildDeferredActionInput): DeferredAction {
  if (!input.goalId || input.goalId.trim().length === 0) {
    throw new Error("goalId must not be empty");
  }
  const action = input.action?.trim() ?? "";
  if (action.length < MIN_ACTION_LEN) {
    throw new Error(`action must be ≥ ${MIN_ACTION_LEN} chars (got ${action.length})`);
  }
  const rationale = input.rationale?.trim() ?? "";
  if (rationale.length < MIN_RATIONALE_LEN) {
    throw new Error(`rationale must be ≥ ${MIN_RATIONALE_LEN} chars (got ${rationale.length})`);
  }
  const recordedAt = input.recordedAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(recordedAt))) {
    throw new Error(`recordedAt must be a valid ISO timestamp (got "${recordedAt}")`);
  }
  const category: DeferredCategory = input.category ?? "other";

  const out: DeferredAction = {
    goalId: input.goalId,
    action,
    rationale,
    category,
    recordedAt,
  };
  if (input.tags && input.tags.length > 0) {
    out.tags = input.tags;
  }
  return out;
}

export interface DeferredFilter {
  goalId?: string;
  category?: DeferredCategory;
  /** Only entries recorded at or after this ms timestamp. */
  sinceMs?: number;
  /** Only entries recorded at or before this ms timestamp. */
  untilMs?: number;
  /** Match if any tag is in this list. */
  anyTag?: ReadonlyArray<string>;
}

export function filterDeferredActions(
  actions: ReadonlyArray<DeferredAction>,
  filter: DeferredFilter,
): DeferredAction[] {
  const tagSet = filter.anyTag && filter.anyTag.length > 0 ? new Set(filter.anyTag) : null;
  return actions.filter((a) => {
    if (filter.goalId !== undefined && a.goalId !== filter.goalId) return false;
    if (filter.category !== undefined && a.category !== filter.category) return false;
    const tsMs = Date.parse(a.recordedAt);
    if (filter.sinceMs !== undefined && tsMs < filter.sinceMs) return false;
    if (filter.untilMs !== undefined && tsMs > filter.untilMs) return false;
    if (tagSet !== null) {
      if (!a.tags || a.tags.length === 0) return false;
      let any = false;
      for (const t of a.tags) {
        if (tagSet.has(t)) {
          any = true;
          break;
        }
      }
      if (!any) return false;
    }
    return true;
  });
}

export function serializeForJsonl(action: DeferredAction): string {
  return JSON.stringify(action);
}

export function parseFromJsonl(line: string): DeferredAction {
  const obj = JSON.parse(line);
  // Re-validate via build path to enforce shape.
  return buildDeferredAction({
    goalId: obj.goalId,
    action: obj.action,
    rationale: obj.rationale,
    category: obj.category,
    tags: obj.tags,
    recordedAt: obj.recordedAt,
  });
}

export function deferredActionToPayload(action: DeferredAction): Record<string, unknown> {
  return {
    kind: "goal_deferred_action.recorded",
    goalId: action.goalId,
    category: action.category,
    recordedAt: action.recordedAt,
    actionPreview: action.action.length > 80 ? action.action.slice(0, 77) + "..." : action.action,
    tagCount: action.tags?.length ?? 0,
  };
}
