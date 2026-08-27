/**
 * Proactive Category Policy
 *
 * Per-category cooldowns, confidence thresholds, hourly rate limits, and
 * auto-suppression behavior. Mirrors the feedback-shaping pattern from
 * ProactiveAgent-main: "try not to disturb when the user ignores, try
 * another approach when they reject."
 *
 * Categories are independent — a volatility spike suggestion can fire even
 * if regime flips are on cooldown. Each category has its own defaults,
 * tuned to how noisy the underlying signal typically is.
 */

import type { CategoryPolicyState, ProactiveCategory } from "../types.ts";
import { ALL_CATEGORIES, INACTIVE_PROACTIVE_CATEGORIES } from "../types.ts";
import { getSuggestionStore } from "../storage/suggestionStore.ts";

// ============================================================================
// Default category configs
// ============================================================================

const MIN = 60 * 1000;
const HR = 60 * MIN;

const DEFAULT_POLICIES: Record<
  ProactiveCategory,
  {
    cooldownMs: number;
    minConfidence: number;
    maxPerHour: number;
  }
> = {
  regime_flip: { cooldownMs: 30 * MIN, minConfidence: 0.7, maxPerHour: 2 },
  chart_pattern: { cooldownMs: 30 * MIN, minConfidence: 0.55, maxPerHour: 2 },
  whale_alert: { cooldownMs: 5 * MIN, minConfidence: 0.65, maxPerHour: 12 },
  volatility_spike: { cooldownMs: 10 * MIN, minConfidence: 0.7, maxPerHour: 6 },
  stop_loss_tighten: { cooldownMs: 15 * MIN, minConfidence: 0.75, maxPerHour: 4 },
  portfolio_drift: { cooldownMs: 60 * MIN, minConfidence: 0.65, maxPerHour: 1 },
  missed_entry: { cooldownMs: 20 * MIN, minConfidence: 0.75, maxPerHour: 3 },
  position_review: { cooldownMs: 4 * HR, minConfidence: 0.65, maxPerHour: 1 },
  journal_prompt: { cooldownMs: 8 * HR, minConfidence: 0.6, maxPerHour: 1 },
  session_review: { cooldownMs: 12 * HR, minConfidence: 0.6, maxPerHour: 1 },
  risk_warning: { cooldownMs: 5 * MIN, minConfidence: 0.8, maxPerHour: 8 },
  playbook_suggest: { cooldownMs: 30 * MIN, minConfidence: 0.7, maxPerHour: 2 },
  funding_alert: { cooldownMs: 30 * MIN, minConfidence: 0.65, maxPerHour: 4 },
  news_event: { cooldownMs: 10 * MIN, minConfidence: 0.65, maxPerHour: 6 },
  // Stock event categories (Finnhub-driven)
  earnings_approaching: { cooldownMs: 6 * HR, minConfidence: 0.6, maxPerHour: 3 },
  insider_flow_alert: { cooldownMs: 4 * HR, minConfidence: 0.65, maxPerHour: 2 },
  analyst_upgrade: { cooldownMs: 2 * HR, minConfidence: 0.65, maxPerHour: 3 },
  congressional_trade: { cooldownMs: 6 * HR, minConfidence: 0.65, maxPerHour: 2 },
  // A live edge degrading or retiring is capital-at-risk — fires only on a
  // health transition (already self-throttled), so a tight cooldown is fine.
  edge_health: { cooldownMs: 15 * MIN, minConfidence: 0.75, maxPerHour: 4 },
};

// ============================================================================
// Policy manager
// ============================================================================

export class CategoryPolicyManager {
  private state: Map<ProactiveCategory, CategoryPolicyState> = new Map();

  constructor() {
    for (const cat of ALL_CATEGORIES) {
      const defaults = DEFAULT_POLICIES[cat];
      this.state.set(cat, {
        category: cat,
        cooldownMs: defaults.cooldownMs,
        minConfidence: defaults.minConfidence,
        maxPerHour: defaults.maxPerHour,
        lastFiredAt: undefined,
        recentFireTimes: [],
        suppressedUntil: undefined,
        acceptanceRate: 1.0,
        sampleCount: 0,
      });
    }
  }

  /** Get a snapshot of policy state for a category. */
  get(category: ProactiveCategory): CategoryPolicyState {
    const s = this.state.get(category);
    if (!s) throw new Error(`Unknown proactive category: ${category}`);
    return { ...s, recentFireTimes: [...s.recentFireTimes] };
  }

  /** Get all policy state entries. */
  getAll(): CategoryPolicyState[] {
    return [...this.state.values()].map((s) => ({
      ...s,
      recentFireTimes: [...s.recentFireTimes],
    }));
  }

  /**
   * Decide whether a candidate suggestion can fire. Checks: confidence gate,
   * cooldown, hourly rate limit, and explicit / auto-suppression.
   */
  canFire(category: ProactiveCategory, confidence: number): { allowed: boolean; reason?: string } {
    const s = this.state.get(category);
    if (!s) return { allowed: false, reason: `unknown category: ${category}` };

    if (INACTIVE_PROACTIVE_CATEGORIES.has(category)) {
      return { allowed: false, reason: "category has no producer wired" };
    }

    // Explicit suppression (user or auto)
    if (s.suppressedUntil && s.suppressedUntil > Date.now()) {
      const mins = Math.ceil((s.suppressedUntil - Date.now()) / MIN);
      return { allowed: false, reason: `suppressed for ${mins}m` };
    }

    // Confidence gate
    if (confidence < s.minConfidence) {
      return {
        allowed: false,
        reason: `confidence ${confidence.toFixed(2)} < ${s.minConfidence.toFixed(2)} threshold`,
      };
    }

    // Cooldown
    if (s.lastFiredAt && Date.now() - s.lastFiredAt < s.cooldownMs) {
      const remaining = Math.ceil((s.cooldownMs - (Date.now() - s.lastFiredAt)) / 1000);
      return { allowed: false, reason: `cooldown ${remaining}s remaining` };
    }

    // Hourly rate limit
    const cutoff = Date.now() - HR;
    const recent = s.recentFireTimes.filter((t) => t >= cutoff);
    if (recent.length >= s.maxPerHour) {
      return {
        allowed: false,
        reason: `hourly cap reached (${recent.length}/${s.maxPerHour})`,
      };
    }

    // Auto-suppression: if dismissed 3+ times in the last hour, suppress
    const store = getSuggestionStore();
    const dismissed = store.recentDismissals(category, HR);
    if (dismissed >= 3) {
      // Auto-suppress for 1 hour. Caller can still fire via suppress override.
      s.suppressedUntil = Date.now() + HR;
      return {
        allowed: false,
        reason: `auto-suppressed: ${dismissed} dismissals in last hour`,
      };
    }

    return { allowed: true };
  }

  /** Mark that a suggestion was fired — updates cooldown and rate window. */
  markFired(category: ProactiveCategory): void {
    const s = this.state.get(category);
    if (!s) return;
    const now = Date.now();
    s.lastFiredAt = now;
    s.recentFireTimes.push(now);
    // Trim to last hour
    const cutoff = now - HR;
    s.recentFireTimes = s.recentFireTimes.filter((t) => t >= cutoff);
  }

  /** Explicitly suppress a category until a future time. */
  suppress(category: ProactiveCategory, durationMs: number): void {
    const s = this.state.get(category);
    if (!s) return;
    s.suppressedUntil = Date.now() + durationMs;
  }

  /** Explicitly un-suppress a category. */
  unsuppress(category: ProactiveCategory): void {
    const s = this.state.get(category);
    if (!s) return;
    s.suppressedUntil = undefined;
  }

  /**
   * Update a category's config. Useful for runtime tuning. Unknown fields
   * are ignored — only cooldownMs, minConfidence, maxPerHour are settable.
   */
  configure(
    category: ProactiveCategory,
    changes: Partial<Pick<CategoryPolicyState, "cooldownMs" | "minConfidence" | "maxPerHour">>,
  ): void {
    const s = this.state.get(category);
    if (!s) return;
    if (changes.cooldownMs !== undefined) s.cooldownMs = changes.cooldownMs;
    if (changes.minConfidence !== undefined) s.minConfidence = changes.minConfidence;
    if (changes.maxPerHour !== undefined) s.maxPerHour = changes.maxPerHour;
  }

  /** Reset everything to defaults. */
  reset(): void {
    for (const cat of ALL_CATEGORIES) {
      const defaults = DEFAULT_POLICIES[cat];
      this.state.set(cat, {
        category: cat,
        cooldownMs: defaults.cooldownMs,
        minConfidence: defaults.minConfidence,
        maxPerHour: defaults.maxPerHour,
        lastFiredAt: undefined,
        recentFireTimes: [],
        suppressedUntil: undefined,
        acceptanceRate: 1.0,
        sampleCount: 0,
      });
    }
  }

  // ---- Persistence ----

  serialize(): CategoryPolicyState[] {
    return [...this.state.values()].map((s) => ({ ...s, recentFireTimes: [...s.recentFireTimes] }));
  }

  deserialize(saved: CategoryPolicyState[]): void {
    if (!Array.isArray(saved)) return;
    for (const entry of saved) {
      if (!entry || typeof entry !== "object" || !entry.category) continue;
      const cur = this.state.get(entry.category);
      if (!cur) continue;
      // Preserve the current default cooldown/confidence unless the saved
      // entry had user-tuned overrides. Saved state wins on lastFiredAt,
      // recentFireTimes, suppressedUntil, acceptance rate.
      this.state.set(entry.category, {
        category: entry.category,
        cooldownMs: typeof entry.cooldownMs === "number" ? entry.cooldownMs : cur.cooldownMs,
        minConfidence:
          typeof entry.minConfidence === "number" ? entry.minConfidence : cur.minConfidence,
        maxPerHour: typeof entry.maxPerHour === "number" ? entry.maxPerHour : cur.maxPerHour,
        lastFiredAt: entry.lastFiredAt,
        recentFireTimes: Array.isArray(entry.recentFireTimes) ? [...entry.recentFireTimes] : [],
        suppressedUntil: entry.suppressedUntil,
        acceptanceRate: typeof entry.acceptanceRate === "number" ? entry.acceptanceRate : 1.0,
        sampleCount: typeof entry.sampleCount === "number" ? entry.sampleCount : 0,
      });
    }
  }
}

// Singleton
const manager = new CategoryPolicyManager();
export function getCategoryPolicy(): CategoryPolicyManager {
  return manager;
}
