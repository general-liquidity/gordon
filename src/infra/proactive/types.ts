/**
 * Proactive Mode Types
 *
 * Core type definitions for Gordon's proactive suggestion subsystem. Separate
 * from the agent framework so the engine, store, and TUI renderer can share
 * a common vocabulary without pulling in Mastra or Ink.
 *
 * Design lineage: ProactiveAgent-main's observation→propose→execute→feedback
 * loop, adapted for vibe trading. Instead of "user typed in VS Code" events,
 * Gordon watches market state, portfolio state, and event bus signals (regime
 * flips, funding anomalies, news). Instead of coding-assistant actions,
 * Gordon surfaces trading-relevant suggestions with an accept/dismiss UX.
 */

// ============================================================================
// Suggestion categories
// ============================================================================

/**
 * Trading-relevant suggestion categories. Each category has its own cooldown
 * window, default confidence threshold, and suppression behavior.
 */
export type ProactiveCategory =
  | "regime_flip"          // Market regime changed — suggest matching playbook
  | "chart_pattern"        // Geometric chart pattern (LMW) completed on a watched symbol
  | "whale_alert"          // Whale transfer/accumulation on a held or watched token
  | "volatility_spike"     // Sudden volatility increase — suggest stop tightening
  | "stop_loss_tighten"    // Price pushed — suggest trailing stop
  | "portfolio_drift"      // Position weights drifted from target
  | "missed_entry"         // Watchlist level hit while user was away
  | "position_review"      // Long-held position worth re-evaluating
  | "journal_prompt"       // End of session — suggest journal entry
  | "session_review"       // End of day/week — suggest review
  | "risk_warning"         // Drawdown, correlation, cascade risk
  | "playbook_suggest"     // New regime-matched playbook available
  | "funding_alert"        // Perp funding rate anomaly
  | "news_event"           // News triggering position review
  | "earnings_approaching" // Upcoming earnings on held or watched symbol
  | "insider_flow_alert"   // Cluster of insider buys/sells on watchlist
  | "analyst_upgrade"      // Analyst consensus rating shift
  | "congressional_trade"; // STOCK Act disclosure on held or watched symbol

/** Categories in schema/UI but with no producer wired yet. */
export const INACTIVE_PROACTIVE_CATEGORIES: ReadonlySet<ProactiveCategory> = new Set();

export const ALL_CATEGORIES: ProactiveCategory[] = [
  "regime_flip",
  "chart_pattern",
  "whale_alert",
  "volatility_spike",
  "stop_loss_tighten",
  "portfolio_drift",
  "missed_entry",
  "position_review",
  "journal_prompt",
  "session_review",
  "risk_warning",
  "playbook_suggest",
  "funding_alert",
  "news_event",
  "earnings_approaching",
  "insider_flow_alert",
  "analyst_upgrade",
  "congressional_trade",
];

/** Categories with an active producer — ALL minus inactive. */
export const ACTIVE_CATEGORIES: ProactiveCategory[] = ALL_CATEGORIES.filter(
  (c) => !INACTIVE_PROACTIVE_CATEGORIES.has(c),
);

// ============================================================================
// Suggestion lifecycle status
// ============================================================================

export type ProactiveStatus =
  | "pending"    // Surfaced, awaiting user action
  | "accepted"   // User accepted — action taken
  | "dismissed"  // User explicitly dismissed
  | "suppressed" // Auto-suppressed (category rule or cooldown)
  | "expired";   // Timed out without user action

// ============================================================================
// Outcome taxonomy (from ProactiveAgent's ProactiveBench)
// ============================================================================

/**
 * 4-outcome evaluation taxonomy adapted from ProactiveAgent-main's
 * ProactiveBench. Used to measure whether proactive mode is actually helping.
 *
 *   MN — Missed-Need:       user needed help, Gordon didn't propose
 *   CD — Correct-Detection: Gordon proposed, and the suggestion was useful
 *   FA — False-Alarm:       Gordon proposed, but the suggestion wasn't useful
 *   NR — Non-Response:      user didn't need help, Gordon stayed quiet
 */
export type SuggestionOutcome = "MN" | "CD" | "FA" | "NR";

export const OUTCOME_LABELS: Record<SuggestionOutcome, string> = {
  MN: "Missed Need",
  CD: "Correct Detection",
  FA: "False Alarm",
  NR: "Non-Response",
};

// ============================================================================
// Suggestion object
// ============================================================================

/**
 * Structured operation attached to a suggestion — when present, accepting
 * the suggestion can auto-invoke this tool call. Read-only operations can
 * execute without further confirmation; write operations should surface
 * a preview first.
 */
export interface ProactiveOperation {
  /** Tool id to invoke (must exist in Gordon's tool registry). */
  tool: string;
  /** Arguments to pass to the tool. */
  args: Record<string, unknown>;
  /**
   * True if the operation is read-only (safe to auto-execute on accept).
   * False means the user should preview the effect before Gordon runs it.
   */
  readOnly: boolean;
  /** Short human-readable description for the preview UI. */
  description: string;
}

export interface ProactiveSuggestion {
  /** Unique id (timestamp-based). */
  id: string;
  /** Category for policy routing. */
  category: ProactiveCategory;
  /** Short headline shown in the suggestion card. */
  title: string;
  /** Longer body explaining the reasoning. */
  body: string;
  /**
   * Suggested action, if any — free text the user can run or adapt.
   * e.g. "Consider switching to /pairs-trade playbook" or
   * "Tighten stop on BTC long to $94,200".
   */
  action?: string;
  /**
   * Optional structured operation — a specific tool call that the user
   * can approve with a single accept. Enables one-click resolution of
   * common suggestions (show portfolio, run technical analysis, etc.)
   * without the user having to construct the call manually.
   */
  operation?: ProactiveOperation;
  /** 0..1 confidence the suggestion is needed. Only fires above threshold. */
  confidence: number;
  /** ISO timestamp of creation. */
  createdAt: string;
  /** Current lifecycle status. */
  status: ProactiveStatus;
  /**
   * Context that triggered the suggestion — short dict for the judge and the
   * card renderer. Keep keys stable so category stats can group by trigger.
   */
  triggers: {
    source: string; // "event_bus" | "monitor_loop" | "webhook" | "regime"
    eventType?: string;
    symbol?: string;
    price?: number;
    change?: number;
    metadata?: Record<string, unknown>;
  };
  /** The observation snapshot passed to the judge. */
  observationSummary?: string;
  /** The judge's reasoning — captured for audit. */
  judgeReasoning?: string;
  /** Outcome recorded once the user responds (if at all). */
  outcome?: SuggestionOutcome;
}

// ============================================================================
// Category policy state
// ============================================================================

export interface CategoryPolicyState {
  category: ProactiveCategory;
  /** Cooldown in milliseconds between suggestions in this category. */
  cooldownMs: number;
  /** Minimum confidence required to fire a suggestion in this category. */
  minConfidence: number;
  /** Max suggestions per hour in this category. */
  maxPerHour: number;
  /** Timestamp of last fired suggestion in this category. */
  lastFiredAt?: number;
  /** Fire count rolling within the last hour. */
  recentFireTimes: number[];
  /** Suppressed until this ms timestamp (explicit suppression). */
  suppressedUntil?: number;
  /** Rolling acceptance rate 0..1 (for auto-tuning). */
  acceptanceRate: number;
  /** Rolling sample count used for acceptance rate. */
  sampleCount: number;
}

// ============================================================================
// Engine state
// ============================================================================

export interface ProactiveEngineStatus {
  running: boolean;
  startedAt: string | null;
  totalSuggestions: number;
  pendingCount: number;
  acceptedCount: number;
  dismissedCount: number;
  suppressedCount: number;
  expiredCount: number;
}
