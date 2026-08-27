/**
 * Just-in-time revisable planning (B8, Zenith "Milestone-RALPH" port).
 *
 * `tradingFeatureList.ts` is a FIXED milestone list: the categories, steps,
 * and priorities are immutable, and the autonomous loop only reads it +
 * flips `passes`. That is the right shape for MILESTONES, but the concrete
 * work items to attack a milestone should be derived from the CURRENT state
 * each cycle, not planned once upfront:
 *
 *   - milestones stay fixed (the immutable feature list)
 *   - the DETAILS (which item to do now, in what order, what to remediate)
 *     are re-derived just-in-time from the live cycle state
 *
 * So if a feature becomes blocked, or a fresh failure appears, the derived
 * items differ next cycle WITHOUT editing the fixed list. This is the
 * "derive next work from current state" mechanism the RALPH report names.
 *
 * Pure + total: reads the (fixed) feature list + a state snapshot, returns
 * fresh work items. No mutation of the list, no I/O.
 */

import { type FeatureEntry, type FeatureList, pickHighestPriority } from "./tradingFeatureList.ts";

// ============================================================================
// Types
// ============================================================================

/** Live snapshot the loop supplies each cycle — the "current state". */
export interface CycleState {
  /**
   * Feature ids that cannot be worked THIS cycle (missing venue, degraded
   * data feed, awaiting an external dependency). Their milestone is deferred
   * and the loop moves to the next actionable one.
   */
  blockedFeatureIds?: string[];
  /**
   * Exact step strings that are currently unsatisfiable (a dependency is
   * down). Steps listed here become deferred sub-items, not active ones.
   */
  blockedSteps?: string[];
  /** Ids attempted earlier this session — deprioritized to avoid churn. */
  recentlyAttemptedIds?: string[];
}

export type WorkItemKind = "remediate" | "step";

export interface WorkItem {
  featureId: string;
  category: FeatureEntry["category"];
  kind: WorkItemKind;
  /** Concrete instruction for this cycle. */
  action: string;
  /** Why this item was derived now (traces to current state). */
  rationale: string;
  /** True when the item is currently unsatisfiable and parked. */
  blocked: boolean;
}

export interface CyclePlan {
  /** The fixed milestone selected for this cycle (or null when all pass). */
  milestone: FeatureEntry | null;
  /** Ordered, actionable items for this cycle. */
  items: WorkItem[];
  /** Items derived but parked because current state blocks them. */
  deferred: WorkItem[];
  /** Feature ids whose whole milestone was skipped as blocked this cycle. */
  skippedFeatureIds: string[];
  reason: string;
}

// ============================================================================
// Derivation
// ============================================================================

/**
 * Select this cycle's milestone: the highest-priority not-yet-passing entry
 * that is NOT blocked in the current state. Passing entries and blocked
 * entries are skipped; the skipped-but-failing ids are reported so the loop
 * can see what it deferred.
 */
function selectMilestone(
  list: FeatureList,
  blocked: Set<string>,
): { milestone: FeatureEntry | null; skipped: string[] } {
  const skipped: string[] = [];
  // list.entries is priority-sorted by the loader; respect that order.
  for (const entry of list.entries) {
    if (entry.passes) continue;
    if (blocked.has(entry.id)) {
      skipped.push(entry.id);
      continue;
    }
    return { milestone: entry, skipped };
  }
  return { milestone: null, skipped };
}

/**
 * Derive the concrete work items for a milestone from the CURRENT state.
 * A prior failure becomes a leading remediation item; each step becomes a
 * step item, split into active vs deferred by the blocked-step set.
 */
function deriveItemsFor(
  entry: FeatureEntry,
  blockedSteps: Set<string>,
): {
  items: WorkItem[];
  deferred: WorkItem[];
} {
  const items: WorkItem[] = [];
  const deferred: WorkItem[] = [];

  // Just-in-time: a fresh failure reshapes the plan — remediate first.
  if (entry.failedReason) {
    items.push({
      featureId: entry.id,
      category: entry.category,
      kind: "remediate",
      action: `Diagnose and fix the prior failure before re-verifying: ${entry.failedReason}`,
      rationale: "current state carries a failedReason on this milestone",
      blocked: false,
    });
  }

  for (const step of entry.steps) {
    const isBlocked = blockedSteps.has(step);
    const item: WorkItem = {
      featureId: entry.id,
      category: entry.category,
      kind: "step",
      action: step,
      rationale: isBlocked
        ? "step dependency is unsatisfiable in the current state"
        : "next unmet step toward the milestone",
      blocked: isBlocked,
    };
    if (isBlocked) deferred.push(item);
    else items.push(item);
  }

  return { items, deferred };
}

/**
 * Derive the next work items from the CURRENT state each cycle, against the
 * fixed feature list. Milestones are fixed (from the list); details are
 * just-in-time. Deterministic and side-effect free.
 */
export function deriveCyclePlan(list: FeatureList, state: CycleState = {}): CyclePlan {
  const blocked = new Set(state.blockedFeatureIds ?? []);
  const blockedSteps = new Set(state.blockedSteps ?? []);

  const { milestone, skipped } = selectMilestone(list, blocked);

  if (!milestone) {
    const anyFailing = pickHighestPriority(list) !== null;
    return {
      milestone: null,
      items: [],
      deferred: [],
      skippedFeatureIds: skipped,
      reason:
        anyFailing || skipped.length > 0
          ? "All actionable milestones are blocked this cycle"
          : "All features passing — nothing to plan",
    };
  }

  const { items, deferred } = deriveItemsFor(milestone, blockedSteps);

  // A recently-attempted milestone with no remediation and everything else
  // blocked yields an empty active set; surface that honestly in the reason.
  const recentlyAttempted = new Set(state.recentlyAttemptedIds ?? []);
  const churnNote = recentlyAttempted.has(milestone.id)
    ? " (revisiting a recently-attempted milestone)"
    : "";

  return {
    milestone,
    items,
    deferred,
    skippedFeatureIds: skipped,
    reason: `Cycle milestone [${milestone.category}] ${milestone.description}: ${items.length} active, ${deferred.length} deferred${churnNote}`,
  };
}

export function cyclePlanToPayload(plan: CyclePlan): Record<string, unknown> {
  return {
    kind: "jit_planning.cycle_derived",
    milestoneId: plan.milestone?.id ?? null,
    activeCount: plan.items.length,
    deferredCount: plan.deferred.length,
    skippedCount: plan.skippedFeatureIds.length,
  };
}
