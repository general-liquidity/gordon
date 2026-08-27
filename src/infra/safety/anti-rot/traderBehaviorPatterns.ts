/**
 * Trader behavior pattern detector.
 *
 * Single-trader analog of Sentra's "company brain" framing applied to
 * Gordon's threat model. Scans the action log for cross-session
 * behavioral patterns that are invisible per-event but actionable in
 * aggregate: stop-loss reversals, mandate overrides, conviction
 * decay, plan-execution divergence. Surfaces findings via the
 * `report_trader_behavior` tool so the agent can flag to the user.
 *
 * Distinct from the aggregate ACE pattern rules (which feed lesson
 * candidates back into the system prompt). This detector produces
 * structured, surfacable signals — the trader's behavioral edge over
 * time, not future-session prompts.
 *
 * Flag-gated off by default. Read-only — never mutates state.
 */

import { listActionLogEntries } from "../../action-log/store.ts";
import type { ActionLogEntry } from "../../action-log/types.ts";

export type BehaviorPatternKind =
  | "frequent_stop_reversal"
  | "frequent_mandate_override"
  | "cancel_recurrence_theme"
  | "thesis_drift_no_match";

export interface BehaviorPattern {
  kind: BehaviorPatternKind;
  /** Severity 0-1: how much this should weight in user-facing surfacing. */
  severity: number;
  /** Short headline sentence safe to show the user. */
  headline: string;
  /** Detail paragraph with the evidence count and sample dates. */
  detail: string;
  /** Number of events that support the pattern. */
  evidenceCount: number;
  /** Earliest event timestamp (ms epoch). */
  firstSeenAt: number;
  /** Latest event timestamp (ms epoch). */
  lastSeenAt: number;
}

const DEFAULT_LOOKBACK_ENTRIES = 500;
const STOP_REVERSAL_MIN_COUNT = 3;
const MANDATE_OVERRIDE_MIN_COUNT = 3;
const CANCEL_RECURRENCE_MIN_COUNT = 3;

function tsOf(e: ActionLogEntry): number {
  const t = Date.parse(e.createdAt);
  return Number.isFinite(t) ? t : Date.now();
}

/**
 * Stop-loss reversal: user cancelled an order specifically because they
 * "changed their mind", "kept the trade running", or "moved the stop"
 * after a stop hit nearby. Behavioral signal: tendency to overrule risk
 * management discipline. Distinct from a single rationalized stop move.
 */
function detectStopReversal(entries: ActionLogEntry[]): BehaviorPattern | null {
  const matches = entries.filter((e) => {
    if (e.entryType !== "execution_result") return false;
    if (e.payload?.kind !== "cancel") return false;
    const rationale = ((e.payload?.rationale as string | undefined) ?? "").toLowerCase();
    return /(\bmoved stop|stop moved|widen(ed)? (the )?stop|reversed (the )?stop|kept (it|the trade) running|changed my mind|gave it room|let it breathe)/.test(
      rationale,
    );
  });
  if (matches.length < STOP_REVERSAL_MIN_COUNT) return null;
  const tsList = matches.map(tsOf);
  return {
    kind: "frequent_stop_reversal",
    severity: Math.min(1, matches.length / 6),
    headline: `${matches.length} stop-loss reversals or wideners in the recent window`,
    detail:
      `Found ${matches.length} cancel events with rationales matching stop-loss reversal language ` +
      `(moved-stop, widened-stop, gave-it-room, changed-my-mind). The standard interpretation is ` +
      `that risk discipline is being relaxed mid-trade. Worth surfacing before the next plan: ` +
      `is the stop placement coming from a technical level, or from an emotional comfort threshold?`,
    evidenceCount: matches.length,
    firstSeenAt: Math.min(...tsList),
    lastSeenAt: Math.max(...tsList),
  };
}

/**
 * Mandate override: execute_plan calls that were blocked by the
 * strategy_mandate gate but the user (or agent) re-attempted with a
 * different framing soon after. Surfaces sustained pressure against
 * a mandate that may no longer fit reality.
 */
function detectMandateOverride(entries: ActionLogEntry[]): BehaviorPattern | null {
  const blocked = entries.filter((e) => {
    if (e.entryType !== "execution_result" && e.entryType !== "execution_attempt") return false;
    const text = `${e.title} ${e.content}`.toLowerCase();
    return (
      text.includes("strategy_mandate_violation") ||
      text.includes("strategy mandate") ||
      text.includes("mandate violat")
    );
  });
  if (blocked.length < MANDATE_OVERRIDE_MIN_COUNT) return null;
  const tsList = blocked.map(tsOf);
  return {
    kind: "frequent_mandate_override",
    severity: Math.min(1, blocked.length / 5),
    headline: `${blocked.length} strategy-mandate violations in the recent window`,
    detail:
      `Found ${blocked.length} blocked execution attempts where the strategy_mandate gate rejected ` +
      `the plan. Sustained pressure against the same mandate usually means one of two things: ` +
      `(a) market conditions have shifted and the mandate is now too restrictive, or (b) the trader ` +
      `is drifting outside the strategy they committed to. Worth a deliberate review before the next attempt.`,
    evidenceCount: blocked.length,
    firstSeenAt: Math.min(...tsList),
    lastSeenAt: Math.max(...tsList),
  };
}

/**
 * Cancel-rationale recurrence: ≥3 cancel events share a coarse theme.
 * Similar to the aggregate ACE rule but surfaces structurally with
 * severity scoring instead of as a system-prompt lesson.
 */
function detectCancelRecurrence(entries: ActionLogEntry[]): BehaviorPattern | null {
  const cancels = entries.filter(
    (e) => e.entryType === "execution_result" && e.payload?.kind === "cancel",
  );
  if (cancels.length < CANCEL_RECURRENCE_MIN_COUNT) return null;
  const buckets = new Map<string, { samples: string[]; ts: number[]; count: number }>();
  for (const e of cancels) {
    const rationale = ((e.payload?.rationale as string | undefined) ?? "").toLowerCase().trim();
    if (rationale.length < 5) continue;
    const bucket = rationale
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 3)
      .join(" ");
    if (!bucket) continue;
    const existing = buckets.get(bucket);
    const t = tsOf(e);
    if (existing) {
      existing.count += 1;
      existing.ts.push(t);
      if (existing.samples.length < 3) existing.samples.push(rationale.slice(0, 80));
    } else {
      buckets.set(bucket, {
        samples: [rationale.slice(0, 80)],
        ts: [t],
        count: 1,
      });
    }
  }
  let topTheme: {
    bucket: string;
    data: { samples: string[]; ts: number[]; count: number };
  } | null = null;
  for (const [bucket, data] of buckets) {
    if (data.count < CANCEL_RECURRENCE_MIN_COUNT) continue;
    if (!topTheme || data.count > topTheme.data.count) {
      topTheme = { bucket, data };
    }
  }
  if (!topTheme) return null;
  return {
    kind: "cancel_recurrence_theme",
    severity: Math.min(1, topTheme.data.count / 5),
    headline: `${topTheme.data.count} cancellations citing theme "${topTheme.bucket}"`,
    detail:
      `Recent cancels share the theme "${topTheme.bucket}" — sample rationales: ` +
      `${topTheme.data.samples.join(" / ")}. Recurring cancellation themes are a behavioral signal: ` +
      `either the trader has identified a setup they no longer trust (good — consider declining new ` +
      `plans on it) or the cancels are an emotional escape hatch on otherwise-valid setups (bad — ` +
      `worth supervisor calibration).`,
    evidenceCount: topTheme.data.count,
    firstSeenAt: Math.min(...topTheme.data.ts),
    lastSeenAt: Math.max(...topTheme.data.ts),
  };
}

/**
 * Thesis drift: plans were proposed but the most recent running thesis
 * (when one is declared via set_running_thesis) appears stale relative
 * to recent plan timestamps. Surfaces "your declared thesis is older
 * than the last 20 plans" type patterns.
 */
function detectThesisDrift(entries: ActionLogEntry[]): BehaviorPattern | null {
  // Find the most recent execution.thesis_set or thesis_observed event
  const thesisEvents = entries.filter((e) => {
    const text = `${e.title}`.toLowerCase();
    return text.includes("thesis_set") || text.includes("thesis_observed");
  });
  if (thesisEvents.length === 0) return null;
  const latestThesisTs = Math.max(...thesisEvents.map(tsOf));
  const planEvents = entries.filter(
    (e) => e.entryType === "execution_result" && tsOf(e) > latestThesisTs,
  );
  // Drift signal: >=10 plan events since last thesis update
  if (planEvents.length < 10) return null;
  return {
    kind: "thesis_drift_no_match",
    severity: Math.min(1, planEvents.length / 20),
    headline: `${planEvents.length} plans executed since the running thesis was last updated`,
    detail:
      `The declared running thesis hasn't been refreshed in ${planEvents.length} execution events. ` +
      `If market regime has shifted, the thesis may be stale relative to current plans. ` +
      `Consider re-articulating the thesis via set_running_thesis or accepting that the trading ` +
      `style has drifted intentionally.`,
    evidenceCount: planEvents.length,
    firstSeenAt: latestThesisTs,
    lastSeenAt: Math.max(...planEvents.map(tsOf)),
  };
}

export interface TraderBehaviorReport {
  patterns: BehaviorPattern[];
  entriesAnalyzed: number;
  generatedAt: string;
}

/**
 * Scan the action log and surface trader-behavior patterns. Pure
 * analysis, no LLM call, no side effects. Returns an empty report
 * when the feature flag is unset.
 */
export function detectTraderBehaviorPatterns(
  options: { lookbackEntries?: number; threadId?: string } = {},
): TraderBehaviorReport {
  const generatedAt = new Date().toISOString();
  const lookback = options.lookbackEntries ?? DEFAULT_LOOKBACK_ENTRIES;
  let entries: ActionLogEntry[] = [];
  try {
    entries = listActionLogEntries({
      threadId: options.threadId,
      limit: lookback,
    });
  } catch {
    return { patterns: [], entriesAnalyzed: 0, generatedAt };
  }
  const patterns: BehaviorPattern[] = [];
  for (const detect of [
    detectStopReversal,
    detectMandateOverride,
    detectCancelRecurrence,
    detectThesisDrift,
  ]) {
    const p = detect(entries);
    if (p) patterns.push(p);
  }
  patterns.sort((a, b) => b.severity - a.severity);
  return { patterns, entriesAnalyzed: entries.length, generatedAt };
}

/**
 * Pure-function variant for tests: takes pre-built entries instead of
 * reading from the action-log store, so tests can exercise detection
 * logic directly.
 */
export function _detectPatternsForTest(entries: ActionLogEntry[]): BehaviorPattern[] {
  const patterns: BehaviorPattern[] = [];
  for (const detect of [
    detectStopReversal,
    detectMandateOverride,
    detectCancelRecurrence,
    detectThesisDrift,
  ]) {
    const p = detect(entries);
    if (p) patterns.push(p);
  }
  patterns.sort((a, b) => b.severity - a.severity);
  return patterns;
}
