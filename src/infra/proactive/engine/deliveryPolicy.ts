/**
 * Proactive Delivery Policy
 *
 * A delivery layer that sits between the judge ("should this fire at all?")
 * and the renderer ("show a card"). The judge already enforces per-category
 * cooldowns, confidence, suppression, and backpressure. This layer solves a
 * different problem: even suggestions the judge approves can flood the
 * operator when several fire in a short window. The policy:
 *
 *   1. Delivers `urgent` cards immediately (risk / stop / kill-switch) — they
 *      protect capital and are never withheld.
 *   2. Batches `normal` / `low` cards. Once BATCH_THRESHOLD of them are
 *      pending-undelivered, it emits ONE summary-rollup card grouped by
 *      category instead of N individual cards. The individuals stay in the
 *      store (queryable via list_proactive_suggestions) but aren't each
 *      rendered.
 *   3. De-dupes by `dedupeKey`: a new suggestion whose key matches an
 *      already-pending-undelivered one is coalesced (dropped, existing
 *      timestamp refreshed) so the same condition doesn't render twice.
 *
 * The policy is a pure, self-contained state machine over suggestion
 * metadata — no store, event-bus, or Mastra coupling — so it's trivially
 * testable. The engine drives it: it calls `admit()` for each judge-approved
 * suggestion and acts on the returned decision, and `onResolved()` when a
 * suggestion is acked/dismissed so dedupe tracking stays accurate.
 *
 * Lineage: the summary-rollup mirrors the digest/notification-coalescing
 * pattern (OS notification grouping) adapted to the radar's card stream.
 */

import type { ProactiveSuggestion, ProactiveSeverity, ProactiveCategory } from "../types.ts";
import { DEFAULT_SEVERITY, SUMMARY_ROLLUP_MARKER, SUMMARY_ROLLUP_CATEGORY } from "../types.ts";

/** Pending-undelivered batchable count at which we emit a rollup instead. */
export const BATCH_THRESHOLD = 4;

/** Categories that always deliver immediately, regardless of declared severity. */
const ALWAYS_URGENT_CATEGORIES: ReadonlySet<ProactiveCategory> = new Set<ProactiveCategory>([
  "risk_warning",
  "stop_loss_tighten",
]);

/**
 * Map a category to its default severity when a producer hasn't set one.
 * Capital-protective signals are urgent; end-of-session / informational
 * cards are low; everything else is normal.
 */
export function defaultSeverityForCategory(category: ProactiveCategory): ProactiveSeverity {
  switch (category) {
    case "risk_warning":
    case "stop_loss_tighten":
      return "urgent";
    case "news_event":
    case "journal_prompt":
    case "session_review":
      return "low";
    default:
      return "normal";
  }
}

/**
 * Resolve the effective severity of a suggestion: an explicit `severity`
 * wins, otherwise fall back to the category default. Capital-protective
 * categories are forced urgent so a producer can't accidentally downgrade
 * a stop-loss warning into the batch queue.
 */
export function effectiveSeverity(suggestion: ProactiveSuggestion): ProactiveSeverity {
  if (ALWAYS_URGENT_CATEGORIES.has(suggestion.category)) return "urgent";
  return suggestion.severity ?? defaultSeverityForCategory(suggestion.category) ?? DEFAULT_SEVERITY;
}

/**
 * Build a dedupe key from `category:symbol:trigger` where available. Returns
 * undefined when there's nothing stable to key on (so it won't coalesce).
 */
export function buildDedupeKey(suggestion: ProactiveSuggestion): string | undefined {
  const symbol =
    suggestion.triggers.symbol ?? (suggestion.triggers.metadata?.symbol as string | undefined);
  const trigger = suggestion.triggers.eventType;
  const parts = [suggestion.category, symbol, trigger].filter(
    (p): p is string => typeof p === "string" && p.length > 0,
  );
  // category alone is too coarse to coalesce on — require at least one of
  // symbol / trigger to avoid collapsing unrelated cards in a category.
  if (parts.length < 2) return undefined;
  return parts.join(":");
}

// ============================================================================
// Decisions
// ============================================================================

/**
 * What the engine should do with a judge-approved suggestion.
 *
 *   deliver  — render this card now (urgent, or a non-batchable card).
 *   hold     — store it but don't render a card yet (batched, under threshold).
 *   coalesce — a pending-undelivered card with the same dedupeKey exists; drop
 *              this one, don't render. `existingId` is the survivor.
 *   rollup   — the batch reached threshold; render the single summary card
 *              `rollup` instead, and mark `rolledUpIds` as delivered.
 */
export type DeliveryDecision =
  | { kind: "deliver"; severity: ProactiveSeverity }
  | { kind: "hold"; severity: ProactiveSeverity }
  | { kind: "coalesce"; existingId: string }
  | { kind: "rollup"; rollup: ProactiveSuggestion; rolledUpIds: string[] };

interface PendingEntry {
  id: string;
  category: ProactiveCategory;
  dedupeKey?: string;
  /** ms epoch — refreshed on coalesce so a recurring condition stays "fresh". */
  lastSeen: number;
}

// ============================================================================
// Policy
// ============================================================================

export class DeliveryPolicy {
  /** Batchable (normal/low) suggestions admitted but not yet rendered. */
  private batchQueue: PendingEntry[] = [];
  /**
   * All currently pending-undelivered suggestions keyed by dedupeKey, across
   * both delivered-urgent and held-batch cards. Used purely for coalescing.
   */
  private byDedupeKey = new Map<string, PendingEntry>();

  /**
   * Admit a judge-approved suggestion and decide how to deliver it. Mutates
   * suggestion.severity / suggestion.dedupeKey in place so the stored object
   * reflects the resolved values.
   */
  admit(suggestion: ProactiveSuggestion, now: number = Date.now()): DeliveryDecision {
    const severity = effectiveSeverity(suggestion);
    suggestion.severity = severity;
    if (suggestion.dedupeKey === undefined) {
      const key = buildDedupeKey(suggestion);
      if (key !== undefined) suggestion.dedupeKey = key;
    }
    const dedupeKey = suggestion.dedupeKey;

    // 1. Dedupe — coalesce into an existing pending-undelivered card.
    if (dedupeKey !== undefined) {
      const existing = this.byDedupeKey.get(dedupeKey);
      if (existing) {
        existing.lastSeen = now;
        return { kind: "coalesce", existingId: existing.id };
      }
    }

    const entry: PendingEntry = {
      id: suggestion.id,
      category: suggestion.category,
      dedupeKey,
      lastSeen: now,
    };
    if (dedupeKey !== undefined) this.byDedupeKey.set(dedupeKey, entry);

    // 2. Urgent — deliver immediately, never batched.
    if (severity === "urgent") {
      return { kind: "deliver", severity };
    }

    // 3. Batchable — enqueue; flush a rollup once we hit the threshold.
    this.batchQueue.push(entry);
    if (this.batchQueue.length >= BATCH_THRESHOLD) {
      const rolled = this.batchQueue.slice();
      const rollup = buildSummaryRollup(rolled, now);
      this.batchQueue = [];
      return { kind: "rollup", rollup, rolledUpIds: rolled.map((e) => e.id) };
    }
    return { kind: "hold", severity };
  }

  /**
   * Drop a suggestion from dedupe / batch tracking once it's resolved
   * (acked / dismissed / expired) so a later identical condition can fire a
   * fresh card instead of silently coalescing into a stale one.
   */
  onResolved(id: string): void {
    this.batchQueue = this.batchQueue.filter((e) => e.id !== id);
    for (const [key, entry] of this.byDedupeKey) {
      if (entry.id === id) this.byDedupeKey.delete(key);
    }
  }

  /** Number of batchable suggestions currently held (for diagnostics / tests). */
  pendingBatchCount(): number {
    return this.batchQueue.length;
  }

  /** Reset all delivery state — used on engine stop and in tests. */
  reset(): void {
    this.batchQueue = [];
    this.byDedupeKey.clear();
  }
}

// ============================================================================
// Summary-rollup construction
// ============================================================================

/**
 * Build the single summary-rollup suggestion from a batch of held cards.
 * Content looks like `"8 pending · news:3 · regime:2 · funding:3"`, grouped
 * and ordered by descending category count. The title carries the
 * SUMMARY_ROLLUP_MARKER so the TUI renderer shows the rollup variant.
 */
export function buildSummaryRollup(
  entries: Pick<PendingEntry, "category">[],
  now: number = Date.now(),
): ProactiveSuggestion {
  const counts = new Map<ProactiveCategory, number>();
  for (const e of entries) {
    counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
  }
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = entries.length;
  const breakdown = ordered.map(([cat, n]) => `${cat}:${n}`).join(" · ");
  const createdAt = new Date(now).toISOString();

  return {
    id: `ps_rollup_${now.toString(36)}`,
    category: SUMMARY_ROLLUP_CATEGORY,
    title: `${SUMMARY_ROLLUP_MARKER} ${total} pending suggestions`,
    body: `${total} pending · ${breakdown}`,
    confidence: 1,
    severity: "low",
    createdAt,
    status: "pending",
    triggers: {
      source: "monitor_loop",
      eventType: "summary_rollup",
      metadata: {
        summary: true,
        total,
        byCategory: Object.fromEntries(ordered),
      },
    },
    observationSummary: `Batched ${total} suggestions: ${breakdown}`,
  };
}
