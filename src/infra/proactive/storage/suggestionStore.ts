/**
 * Proactive Suggestion Store
 *
 * In-memory ring-buffered store for recent proactive suggestions plus a
 * feedback ledger (accept / dismiss / suppress history). Singleton scoped to
 * the Gordon process — suggestions are ephemeral and don't need to survive
 * restarts; the auditable record lives in the event bus history and in the
 * backtest experiment journal for strategy-related suggestions.
 *
 * Ring buffer capacity: 500 entries. Older suggestions roll off automatically.
 */

import type {
  ProactiveSuggestion,
  ProactiveStatus,
  ProactiveCategory,
  SuggestionOutcome,
} from "../types.ts";

const MAX_STORE = 500;

export interface FeedbackRecord {
  suggestionId: string;
  category: ProactiveCategory;
  status: ProactiveStatus;
  outcome?: SuggestionOutcome;
  at: number;
}

export class SuggestionStore {
  private suggestions: ProactiveSuggestion[] = [];
  private feedback: FeedbackRecord[] = [];

  add(suggestion: ProactiveSuggestion): void {
    this.suggestions.push(suggestion);
    if (this.suggestions.length > MAX_STORE) {
      this.suggestions.shift();
    }
  }

  get(id: string): ProactiveSuggestion | undefined {
    return this.suggestions.find((s) => s.id === id);
  }

  updateStatus(id: string, status: ProactiveStatus, outcome?: SuggestionOutcome): boolean {
    const s = this.get(id);
    if (!s) return false;
    s.status = status;
    if (outcome) s.outcome = outcome;
    this.feedback.push({
      suggestionId: id,
      category: s.category,
      status,
      outcome,
      at: Date.now(),
    });
    if (this.feedback.length > MAX_STORE * 2) {
      this.feedback.shift();
    }
    return true;
  }

  /** Return recent suggestions, newest-first. */
  getRecent(
    limit = 20,
    filter?: { status?: ProactiveStatus; category?: ProactiveCategory },
  ): ProactiveSuggestion[] {
    let list = this.suggestions.slice();
    if (filter?.status) list = list.filter((s) => s.status === filter.status);
    if (filter?.category) list = list.filter((s) => s.category === filter.category);
    return list.slice(-limit).reverse();
  }

  /** Count suggestions by lifecycle status. */
  counts(): Record<ProactiveStatus, number> & { total: number } {
    const out = {
      pending: 0,
      accepted: 0,
      dismissed: 0,
      suppressed: 0,
      expired: 0,
      total: 0,
    };
    for (const s of this.suggestions) {
      out[s.status] += 1;
      out.total += 1;
    }
    return out;
  }

  /**
   * Get per-category acceptance rate and count over a window. Used by
   * categoryPolicy to auto-tune suppression based on user behavior.
   */
  getCategoryStats(
    category: ProactiveCategory,
    windowMs: number = 60 * 60 * 1000,
  ): {
    fired: number;
    accepted: number;
    dismissed: number;
    acceptanceRate: number;
  } {
    const now = Date.now();
    const cutoff = now - windowMs;
    const relevant = this.feedback.filter((f) => f.category === category && f.at >= cutoff);
    const fired = relevant.length;
    const accepted = relevant.filter((f) => f.status === "accepted").length;
    const dismissed = relevant.filter((f) => f.status === "dismissed").length;
    const acceptanceRate = fired > 0 ? accepted / fired : 0;
    return { fired, accepted, dismissed, acceptanceRate };
  }

  /** Recent dismissal count in a window — used for auto-suppression. */
  recentDismissals(category: ProactiveCategory, windowMs: number = 60 * 60 * 1000): number {
    const cutoff = Date.now() - windowMs;
    return this.feedback.filter(
      (f) => f.category === category && f.status === "dismissed" && f.at >= cutoff,
    ).length;
  }

  /** Clear everything — used by stop() or when the user asks. */
  clear(): void {
    this.suggestions = [];
    this.feedback = [];
  }

  /** Lightweight snapshot for debugging / status tools. */
  snapshot(): {
    bufferSize: number;
    feedbackSize: number;
    oldestAt?: string;
    newestAt?: string;
  } {
    return {
      bufferSize: this.suggestions.length,
      feedbackSize: this.feedback.length,
      oldestAt: this.suggestions[0]?.createdAt,
      newestAt: this.suggestions[this.suggestions.length - 1]?.createdAt,
    };
  }

  // ---- Persistence ----

  serialize(): { suggestions: ProactiveSuggestion[]; feedback: FeedbackRecord[] } {
    return {
      suggestions: this.suggestions.slice(),
      feedback: this.feedback.slice(),
    };
  }

  deserialize(data: { suggestions?: ProactiveSuggestion[]; feedback?: FeedbackRecord[] }): void {
    this.suggestions = Array.isArray(data.suggestions) ? data.suggestions.slice(0, MAX_STORE) : [];
    this.feedback = Array.isArray(data.feedback) ? data.feedback.slice(0, MAX_STORE * 2) : [];
  }
}

// Singleton — one store per Gordon process
const store = new SuggestionStore();

export function getSuggestionStore(): SuggestionStore {
  return store;
}
