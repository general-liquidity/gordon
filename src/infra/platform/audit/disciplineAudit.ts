/**
 * Discipline Audit — operator-behavior scorecard against the 7
 * prop-trading failure modes.
 *
 * Operationalizes the checklist from Andrew's "Why traders never become
 * funded" piece as a structured audit query over Gordon's existing
 * audit log. Each failure mode maps to a detectable pattern in the
 * audit history; the scorecard surfaces which patterns fired in a
 * given window.
 *
 * The seven modes:
 *
 *   1. RACING_THE_TARGET     — trade frequency spikes near a profit goal
 *   2. TRADING_WITHOUT_PLAN  — order placements without preceding
 *                              `approve_plan` or trading-constitution
 *                              check events
 *   3. RISK_PER_TRADE_TOO_HIGH — RULE_OVERRIDE events with originalTier
 *                                of high/critical
 *   4. OVERTRADING           — trades-per-day above a configurable cap
 *   5. NOT_JOURNALING        — trades persisted without decisionTrace
 *                              metadata or with empty rationale
 *   6. STRATEGY_SWITCHING    — many distinct strategy slots active in a
 *                              short window (high entropy across slots)
 *   7. EMOTIONAL_TRADING     — RULE_OVERRIDE events clustered immediately
 *                              after losses (heuristic: an override
 *                              within N hours of the previous override
 *                              or a failed trade)
 *
 * Each mode produces:
 *   - `triggered`  : boolean — did the pattern fire in the window?
 *   - `severity`   : "info" | "warning" | "alert" — heuristic severity
 *   - `evidence`   : structured count / IDs / examples for the operator
 *
 * The scorecard then surfaces an OVERALL discipline score in [0..1]
 * where 1.0 = no failure modes triggered, 0.0 = all seven triggered.
 *
 * Pure query over the audit log + decisionTrace metadata. No state
 * mutation, no LLM. Safe to call from agent surface or /weekend-review.
 */

import { getAuditHistory, type AuditEntry } from "./audit-log.ts";

// ============================================================================
// Failure mode enumeration
// ============================================================================

export type DisciplineFailureMode =
  | "racing_the_target"
  | "trading_without_plan"
  | "risk_per_trade_too_high"
  | "overtrading"
  | "not_journaling"
  | "strategy_switching"
  | "emotional_trading";

export type DisciplineSeverity = "info" | "warning" | "alert";

export interface FailureModeResult {
  mode: DisciplineFailureMode;
  triggered: boolean;
  severity: DisciplineSeverity;
  description: string;
  /** Structured evidence — counts, IDs, examples. */
  evidence: Record<string, unknown>;
}

export interface DisciplineAuditConfig {
  /** ISO start of window. Default: 7 days ago. */
  startTime?: string;
  /** ISO end of window. Default: now. */
  endTime?: string;
  /** Filter to one operator. Default: all. */
  userId?: string;
  /**
   * Max trades per day before flagging OVERTRADING. Default 3
   * (matches Andrew's heuristic).
   */
  maxTradesPerDay?: number;
  /**
   * Window (ms) in which a RULE_OVERRIDE following a loss is
   * classified as EMOTIONAL_TRADING. Default 2 hours.
   */
  emotionalProximityMs?: number;
  /**
   * Strategy-slot churn threshold — N distinct slots active in the
   * window flags STRATEGY_SWITCHING. Default 3.
   */
  maxDistinctSlots?: number;
}

export interface DisciplineAuditReport {
  windowStart: string;
  windowEnd: string;
  /** Per-mode results. */
  modes: FailureModeResult[];
  /** Number of modes triggered. */
  triggeredCount: number;
  /** Overall discipline score in [0..1]. 1.0 = no triggers. */
  score: number;
  /** Concise headline severity. */
  headlineSeverity: DisciplineSeverity;
}

// ============================================================================
// Defaults + helpers
// ============================================================================

const DEFAULT_MAX_TRADES_PER_DAY = 3;
const DEFAULT_EMOTIONAL_PROXIMITY_MS = 2 * 60 * 60 * 1000;
const DEFAULT_MAX_DISTINCT_SLOTS = 3;

function defaultStart(): string {
  return new Date(Date.now() - 7 * 86_400_000).toISOString();
}
function defaultEnd(): string {
  return new Date().toISOString();
}

/**
 * Trade-execution audit actions Gordon records. Used by multiple
 * failure-mode detectors below.
 */
const TRADE_ACTIONS = ["EXECUTE_PLAN", "CLOSE_TRADE", "PLACE_OCO_ORDER"] as const;

function fetchTradeExecutions(
  startTime: string,
  endTime: string,
  userId?: string,
): AuditEntry[] {
  const out: AuditEntry[] = [];
  for (const action of TRADE_ACTIONS) {
    out.push(
      ...getAuditHistory({
        action,
        result: "SUCCESS",
        startTime,
        endTime,
        userId,
        limit: 100_000,
      }),
    );
  }
  return out.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function fetchOverrides(
  startTime: string,
  endTime: string,
  userId?: string,
): AuditEntry[] {
  return getAuditHistory({
    action: "RULE_OVERRIDE",
    result: "SUCCESS",
    startTime,
    endTime,
    userId,
    limit: 100_000,
  });
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

// ============================================================================
// Failure-mode detectors
// ============================================================================

function detectRacingTheTarget(trades: AuditEntry[]): FailureModeResult {
  // Heuristic: do trades cluster heavily into a single day relative to
  // the others? A "race" pattern shows up as one day with >2× the
  // median daily count.
  const counts = new Map<string, number>();
  for (const t of trades) {
    const k = dayKey(t.timestamp);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  if (counts.size === 0) {
    return baseInfo("racing_the_target", "No trades in window — racing pattern not detectable.");
  }
  const values = [...counts.values()].sort((a, b) => a - b);
  const median = values[Math.floor(values.length / 2)] ?? 0;
  const peak = values[values.length - 1] ?? 0;
  const triggered = peak >= 6 && peak > median * 2;
  return {
    mode: "racing_the_target",
    triggered,
    severity: triggered ? "warning" : "info",
    description: triggered
      ? `One day had ${peak} trades (median ${median}/day). High intra-day clustering suggests target-racing rather than plan-driven entries.`
      : `Trade distribution across days looks balanced (peak ${peak}, median ${median}).`,
    evidence: { peakDayCount: peak, medianDayCount: median, distinctDays: counts.size },
  };
}

function detectTradingWithoutPlan(
  trades: AuditEntry[],
  startTime: string,
  endTime: string,
  userId?: string,
): FailureModeResult {
  const approvals = getAuditHistory({
    action: "APPROVE_PLAN",
    result: "SUCCESS",
    startTime,
    endTime,
    userId,
    limit: 100_000,
  });
  const approvedPlanIds = new Set(approvals.map((a) => a.planId).filter(Boolean) as string[]);
  const tradesWithoutPlan = trades.filter(
    (t) => t.action === "EXECUTE_PLAN" && t.planId && !approvedPlanIds.has(t.planId),
  );
  const triggered = tradesWithoutPlan.length > 0;
  return {
    mode: "trading_without_plan",
    triggered,
    severity: triggered ? "alert" : "info",
    description: triggered
      ? `${tradesWithoutPlan.length} EXECUTE_PLAN call(s) referenced a plan that has no APPROVE_PLAN audit entry — possible bypass or missing journaling.`
      : "All EXECUTE_PLAN calls reference approved plans.",
    evidence: {
      tradesWithoutPlanCount: tradesWithoutPlan.length,
      approvalCount: approvals.length,
      sampleTradeIds: tradesWithoutPlan.slice(0, 3).map((t) => t.id),
    },
  };
}

function detectRiskTooHigh(overrides: AuditEntry[]): FailureModeResult {
  const highTier = overrides.filter((o) => {
    const meta = o.metadata as Record<string, unknown> | undefined;
    const tier = meta?.tier;
    return tier === "high" || tier === "critical";
  });
  const triggered = highTier.length > 0;
  return {
    mode: "risk_per_trade_too_high",
    triggered,
    severity: triggered ? "alert" : "info",
    description: triggered
      ? `${highTier.length} rule-override(s) against high/critical-tier recommendations in window. Operator is approving trades the risk classifier wanted to block.`
      : "No high/critical-tier rule overrides in window.",
    evidence: {
      highTierOverrideCount: highTier.length,
      sampleIds: highTier.slice(0, 3).map((o) => o.id),
    },
  };
}

function detectOvertrading(
  trades: AuditEntry[],
  maxTradesPerDay: number,
): FailureModeResult {
  const perDay = new Map<string, number>();
  for (const t of trades) {
    const k = dayKey(t.timestamp);
    perDay.set(k, (perDay.get(k) ?? 0) + 1);
  }
  const offendingDays = [...perDay.entries()]
    .filter(([, c]) => c > maxTradesPerDay)
    .sort((a, b) => b[1] - a[1]);
  const triggered = offendingDays.length > 0;
  const worstCount = offendingDays[0]?.[1] ?? 0;
  return {
    mode: "overtrading",
    triggered,
    severity:
      worstCount > maxTradesPerDay * 3
        ? "alert"
        : triggered
          ? "warning"
          : "info",
    description: triggered
      ? `${offendingDays.length} day(s) exceeded ${maxTradesPerDay} trades — worst was ${worstCount} on ${offendingDays[0]?.[0]}.`
      : `All days within ${maxTradesPerDay}-trade cap.`,
    evidence: {
      offendingDayCount: offendingDays.length,
      maxTradesPerDay,
      worstDay: offendingDays[0]?.[0],
      worstDayCount: worstCount,
    },
  };
}

function detectNotJournaling(trades: AuditEntry[]): FailureModeResult {
  // Trades without decisionTrace metadata OR with empty rationale
  // count as un-journaled. The decisionTrace shape from
  // decisionTrace.ts uses metadata.traceVersion as a marker.
  const unjournaled = trades.filter((t) => {
    const meta = (t.metadata ?? {}) as Record<string, unknown>;
    const trace = meta.decisionTrace as Record<string, unknown> | undefined;
    const hasTrace = trace !== undefined && trace !== null;
    const hasRationale =
      typeof t.resultDetails === "string" && t.resultDetails.trim().length > 0;
    return !hasTrace && !hasRationale;
  });
  const rate = trades.length === 0 ? 0 : unjournaled.length / trades.length;
  const triggered = rate > 0.5 && trades.length > 0;
  return {
    mode: "not_journaling",
    triggered,
    severity: triggered ? "warning" : "info",
    description: triggered
      ? `${unjournaled.length}/${trades.length} trades lack decisionTrace + rationale — journaling discipline weak.`
      : trades.length === 0
        ? "No trades in window."
        : `Most trades carry decision provenance (${trades.length - unjournaled.length}/${trades.length}).`,
    evidence: {
      unjournaledCount: unjournaled.length,
      totalTrades: trades.length,
      unjournaledRate: rate,
    },
  };
}

function detectStrategySwitching(
  trades: AuditEntry[],
  maxDistinctSlots: number,
): FailureModeResult {
  const slots = new Set<string>();
  for (const t of trades) {
    const meta = (t.metadata ?? {}) as Record<string, unknown>;
    const slot = (meta.strategySlot ?? meta.slotId) as string | undefined;
    if (slot) slots.add(slot);
  }
  const triggered = slots.size > maxDistinctSlots;
  return {
    mode: "strategy_switching",
    triggered,
    severity: triggered ? "warning" : "info",
    description: triggered
      ? `${slots.size} distinct strategy slots active in window (cap ${maxDistinctSlots}). High slot churn — operator is bouncing between approaches.`
      : `${slots.size} strategy slot(s) active — within discipline cap.`,
    evidence: {
      distinctSlots: slots.size,
      maxDistinctSlots,
      sampleSlots: [...slots].slice(0, 5),
    },
  };
}

function detectEmotionalTrading(
  overrides: AuditEntry[],
  trades: AuditEntry[],
  proximityMs: number,
): FailureModeResult {
  // Emotional pattern: a RULE_OVERRIDE within `proximityMs` of a
  // previous failed trade or another override. Heuristic for "trading
  // to recover."
  const losses = trades
    .filter((t) => {
      const meta = (t.metadata ?? {}) as Record<string, unknown>;
      const realized = meta.realizedPnlUsd as number | undefined;
      return typeof realized === "number" && realized < 0;
    })
    .map((t) => new Date(t.timestamp).getTime());

  const overrideTimes = overrides
    .map((o) => new Date(o.timestamp).getTime())
    .sort((a, b) => a - b);

  let count = 0;
  for (const ot of overrideTimes) {
    // Within proximityMs of any loss or prior override.
    const nearLoss = losses.some((lt) => ot - lt > 0 && ot - lt < proximityMs);
    const nearOverride = overrideTimes.some((other) => other < ot && ot - other < proximityMs);
    if (nearLoss || nearOverride) count++;
  }

  const rate = overrides.length === 0 ? 0 : count / overrides.length;
  const triggered = count >= 2 && rate > 0.4;
  return {
    mode: "emotional_trading",
    triggered,
    severity: triggered ? "alert" : "info",
    description: triggered
      ? `${count} rule-override(s) fired within ${(proximityMs / 3600000).toFixed(1)}h of a prior loss or override. Pattern suggests reactive (emotional) decisions.`
      : "No clustered override pattern detected.",
    evidence: {
      clusteredOverrideCount: count,
      totalOverrides: overrides.length,
      clusteredRate: rate,
    },
  };
}

function baseInfo(mode: DisciplineFailureMode, description: string): FailureModeResult {
  return { mode, triggered: false, severity: "info", description, evidence: {} };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Run the full discipline audit over the given window.
 */
export function getDisciplineAudit(
  config: DisciplineAuditConfig = {},
): DisciplineAuditReport {
  const startTime = config.startTime ?? defaultStart();
  const endTime = config.endTime ?? defaultEnd();
  const maxTradesPerDay = config.maxTradesPerDay ?? DEFAULT_MAX_TRADES_PER_DAY;
  const proximityMs = config.emotionalProximityMs ?? DEFAULT_EMOTIONAL_PROXIMITY_MS;
  const maxDistinctSlots = config.maxDistinctSlots ?? DEFAULT_MAX_DISTINCT_SLOTS;

  const trades = fetchTradeExecutions(startTime, endTime, config.userId);
  const overrides = fetchOverrides(startTime, endTime, config.userId);

  const modes: FailureModeResult[] = [
    detectRacingTheTarget(trades),
    detectTradingWithoutPlan(trades, startTime, endTime, config.userId),
    detectRiskTooHigh(overrides),
    detectOvertrading(trades, maxTradesPerDay),
    detectNotJournaling(trades),
    detectStrategySwitching(trades, maxDistinctSlots),
    detectEmotionalTrading(overrides, trades, proximityMs),
  ];

  const triggeredCount = modes.filter((m) => m.triggered).length;
  const score = 1 - triggeredCount / modes.length;
  const headlineSeverity: DisciplineSeverity = modes.some(
    (m) => m.triggered && m.severity === "alert",
  )
    ? "alert"
    : modes.some((m) => m.triggered && m.severity === "warning")
      ? "warning"
      : "info";

  return {
    windowStart: startTime,
    windowEnd: endTime,
    modes,
    triggeredCount,
    score,
    headlineSeverity,
  };
}

/** One-line operator summary suitable for /weekend-review embedding. */
export function summarizeDisciplineAudit(report: DisciplineAuditReport): string {
  if (report.triggeredCount === 0) {
    return `Discipline audit: clean (score ${report.score.toFixed(2)}, no failure modes triggered).`;
  }
  const triggered = report.modes
    .filter((m) => m.triggered)
    .map((m) => m.mode.replace(/_/g, " "));
  return `Discipline audit: ${report.triggeredCount}/${report.modes.length} modes triggered (score ${report.score.toFixed(2)}, ${report.headlineSeverity}) — ${triggered.join("; ")}.`;
}
