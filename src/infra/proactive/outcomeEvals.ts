/**
 * Proactive Outcome Evaluation
 *
 * Tracks and reports the 4-outcome taxonomy from ProactiveAgent-main:
 *   MN — Missed-Need       (needed help, we stayed quiet)
 *   CD — Correct-Detection (needed help, we proposed)
 *   FA — False-Alarm       (didn't need help, we proposed)
 *   NR — Non-Response      (didn't need help, we stayed quiet)
 *
 * Most of the time Gordon can't know MN/NR because we don't see what the user
 * silently wished we'd done. But when we fire a suggestion, user accept =
 * CD, user dismiss = FA. That's enough for precision (CD / (CD + FA)) even
 * without the full confusion matrix.
 *
 * MN/NR are populated only when the user explicitly reports them via the
 * `record_proactive_outcome` tool ("you missed this one" / "glad you stayed
 * quiet"). Useful for periodic manual review.
 */

import type { SuggestionOutcome, ProactiveCategory } from "./types.ts";
import { OUTCOME_LABELS } from "./types.ts";
import { getSuggestionStore } from "./suggestionStore.ts";

export interface OutcomeStats {
  missedNeed: number;
  correctDetection: number;
  falseAlarm: number;
  nonResponse: number;
  total: number;
  /** CD / (CD + FA) — of the suggestions we fired, what fraction were useful. */
  precision: number;
  /** CD / (CD + MN) — of all needed suggestions, what fraction did we catch. */
  recall: number;
  /** Harmonic mean of precision and recall. */
  f1: number;
}

export interface OutcomeRecord {
  suggestionId: string;
  category: ProactiveCategory;
  outcome: SuggestionOutcome;
  at: number;
}

export class OutcomeTracker {
  private outcomes: OutcomeRecord[] = [];

  record(suggestionId: string, category: ProactiveCategory, outcome: SuggestionOutcome): void {
    this.outcomes.push({ suggestionId, category, outcome, at: Date.now() });
    if (this.outcomes.length > 2000) {
      this.outcomes.shift();
    }
  }

  // ---- Persistence ----

  serialize(): OutcomeRecord[] {
    return this.outcomes.slice();
  }

  deserialize(saved: OutcomeRecord[]): void {
    if (!Array.isArray(saved)) return;
    this.outcomes = saved.slice(0, 2000);
  }

  /** Overall stats across all recorded outcomes. */
  stats(windowMs?: number): OutcomeStats {
    const cutoff = windowMs ? Date.now() - windowMs : 0;
    const relevant = this.outcomes.filter((o) => o.at >= cutoff);
    return this.computeStats(relevant);
  }

  /** Stats for a specific category. */
  statsByCategory(category: ProactiveCategory, windowMs?: number): OutcomeStats {
    const cutoff = windowMs ? Date.now() - windowMs : 0;
    const relevant = this.outcomes.filter(
      (o) => o.category === category && o.at >= cutoff,
    );
    return this.computeStats(relevant);
  }

  /** Per-category breakdown, useful for "which categories are noisy?" */
  breakdown(windowMs?: number): Array<{ category: ProactiveCategory; stats: OutcomeStats }> {
    const cutoff = windowMs ? Date.now() - windowMs : 0;
    const byCategory = new Map<ProactiveCategory, typeof this.outcomes>();
    for (const o of this.outcomes) {
      if (o.at < cutoff) continue;
      if (!byCategory.has(o.category)) byCategory.set(o.category, []);
      byCategory.get(o.category)!.push(o);
    }
    return [...byCategory.entries()]
      .map(([category, list]) => ({ category, stats: this.computeStats(list) }))
      .sort((a, b) => b.stats.total - a.stats.total);
  }

  /** Reset the outcome log. */
  clear(): void {
    this.outcomes = [];
  }

  // ---- internal ----

  private computeStats(list: typeof this.outcomes): OutcomeStats {
    let mn = 0, cd = 0, fa = 0, nr = 0;
    for (const o of list) {
      if (o.outcome === "MN") mn += 1;
      else if (o.outcome === "CD") cd += 1;
      else if (o.outcome === "FA") fa += 1;
      else if (o.outcome === "NR") nr += 1;
    }
    const total = mn + cd + fa + nr;
    const precision = cd + fa > 0 ? cd / (cd + fa) : 0;
    const recall = cd + mn > 0 ? cd / (cd + mn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    return {
      missedNeed: mn,
      correctDetection: cd,
      falseAlarm: fa,
      nonResponse: nr,
      total,
      precision: Number(precision.toFixed(3)),
      recall: Number(recall.toFixed(3)),
      f1: Number(f1.toFixed(3)),
    };
  }
}

// Singleton
const tracker = new OutcomeTracker();
export function getOutcomeTracker(): OutcomeTracker {
  return tracker;
}

/**
 * Auto-derive CD / FA outcomes from recent store feedback. Called by the
 * engine whenever a suggestion transitions to accepted or dismissed — so
 * we don't need the user to manually record outcomes for the basic case.
 */
export function autoRecordFromStore(limit = 100): number {
  const store = getSuggestionStore();
  const recent = store.getRecent(limit);
  const t = getOutcomeTracker();
  let recorded = 0;
  for (const s of recent) {
    if (s.outcome) continue;
    if (s.status === "accepted") {
      t.record(s.id, s.category, "CD");
      s.outcome = "CD";
      recorded += 1;
    } else if (s.status === "dismissed") {
      t.record(s.id, s.category, "FA");
      s.outcome = "FA";
      recorded += 1;
    }
  }
  return recorded;
}

export { OUTCOME_LABELS };
