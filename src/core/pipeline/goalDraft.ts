/**
 * Goal Drafter — GE1.
 *
 * Helps an operator turn a vague intent ("I want to make money this
 * week") into a measurable goal expressible in `goalMode.ts`'s parser
 * grammar (`/goal <work> until <measurable end> without <constraints>`).
 *
 * The article that surfaced this pattern uses a coding-agent drafting
 * skill that reads the architecture doc + recent goal+rider pairs +
 * recent commits + source at HEAD. The trading-domain port reads
 * (caller-supplied) recent performance stats + active-mandate
 * exclusions + an optional preferred horizon, and proposes a goal
 * grounded in what the operator's actually been doing.
 *
 * Heuristic-only — no LLM call. Intent keywords map to end-state
 * vocabulary; thresholds are derived from recent stats with a
 * conservative improvement factor, or fall back to defensible
 * defaults when stats are absent. Confidence reports how well the
 * proposal could be grounded.
 *
 * The operator reviews and decides whether to set the goal. This
 * primitive does NOT call `parseGoal` or `createGoalState` — it only
 * composes the text. Setting it is a separate, explicit operator
 * action (via the existing `/goal` slash command).
 *
 * Pure compute. No I/O. The Mastra wrapper supplies recent stats
 * from observation history.
 */

import type { EndStateType } from "./goalMode.ts";

export const GOAL_DRAFT_FLAG_ENV = "GORDON_GOAL_DRAFT";

export function isGoalDraftEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[GOAL_DRAFT_FLAG_ENV] === "1" || env[GOAL_DRAFT_FLAG_ENV] === "true";
}

export interface DraftRecentStats {
  /** Recent realized Sharpe ratio. */
  sharpe?: number;
  /** Recent realized win rate (percentage points, 0-100). */
  winRatePct?: number;
  /** Recent realized trade count over the window. */
  tradeCount?: number;
  /** Recent realized max drawdown (percentage points, positive). */
  maxDrawdownPct?: number;
}

export interface ComposeGoalDraftInput {
  /** Operator's free-form intent (e.g., "make money this week"). */
  vagueIntent: string;
  /** Recent performance stats over a caller-defined window. */
  recentStats?: DraftRecentStats;
  /** Constraints from the active mandate (e.g., "no leverage", "BTC only"). */
  activeMandateExclusions?: ReadonlyArray<string>;
  /** Operator's preferred horizon. Default "days". */
  preferredHorizon?: "hours" | "days" | "weeks";
}

export type DraftConfidence = "high" | "medium" | "low";

export interface ProposedEndState {
  type: EndStateType;
  /** Numeric threshold for sharpe/winrate/trades/drawdown_under; string for time/checklist. */
  threshold: number | string;
  rationale: string;
}

export interface ComposeGoalDraftResult {
  /** Composed text in the existing goal-parser grammar. */
  proposedGoalText: string;
  proposedObjective: string;
  proposedEndState: ProposedEndState;
  proposedConstraints: ReadonlyArray<string>;
  confidence: DraftConfidence;
  rationale: { objective: string; endState: string; constraints: string };
  reasoning: string;
}

interface KeywordMatch {
  type: EndStateType;
  keyword: string;
}

const KEYWORD_TABLE: ReadonlyArray<{ regex: RegExp; type: EndStateType; keyword: string }> = [
  { regex: /\b(sharpe|risk[- ]adjusted|consistency)\b/i, type: "sharpe", keyword: "sharpe" },
  { regex: /\b(win[- ]?rate|hit[- ]?rate|accuracy)\b/i, type: "winrate", keyword: "win rate" },
  { regex: /\b(trade[s]?|execution[s]?|fills?)\b/i, type: "trades", keyword: "trades" },
  {
    regex: /\b(drawdown|downside|loss[- ]cap|max[- ]?loss)\b/i,
    type: "drawdown_under",
    keyword: "drawdown",
  },
  {
    regex: /\b(checklist|checkbox|complete every|tick off)\b/i,
    type: "checklist",
    keyword: "checklist",
  },
];

const HORIZON_REGEX = /\b(\d+)\s*(hour|hours|day|days|week|weeks|month|months)\b/i;

function detectIntent(intent: string): KeywordMatch | null {
  for (const entry of KEYWORD_TABLE) {
    if (entry.regex.test(intent)) {
      return { type: entry.type, keyword: entry.keyword };
    }
  }
  return null;
}

function detectHorizon(intent: string, fallback: "hours" | "days" | "weeks"): string {
  const match = intent.match(HORIZON_REGEX);
  if (match) {
    return `${match[1]} ${match[2]!.toLowerCase()}`;
  }
  return `7 ${fallback}`;
}

function proposeSharpe(stats: DraftRecentStats | undefined): {
  threshold: number;
  rationale: string;
} {
  if (typeof stats?.sharpe === "number" && Number.isFinite(stats.sharpe)) {
    const proposed = Math.max(0.5, Math.min(2.0, stats.sharpe * 1.2));
    return {
      threshold: Number(proposed.toFixed(2)),
      rationale: `recent Sharpe ${stats.sharpe.toFixed(2)} × 1.2 (conservative improvement), capped at 2.0`,
    };
  }
  return {
    threshold: 1.0,
    rationale: "no recent Sharpe available — using conventional Sharpe ≥ 1.0 default",
  };
}

function proposeWinRate(stats: DraftRecentStats | undefined): {
  threshold: number;
  rationale: string;
} {
  if (typeof stats?.winRatePct === "number" && Number.isFinite(stats.winRatePct)) {
    const proposed = Math.min(70, stats.winRatePct + 5);
    return {
      threshold: Number(proposed.toFixed(1)),
      rationale: `recent win rate ${stats.winRatePct.toFixed(1)}% + 5pp, capped at 70%`,
    };
  }
  return { threshold: 55, rationale: "no recent win rate available — using 55% default" };
}

function proposeTrades(stats: DraftRecentStats | undefined): {
  threshold: number;
  rationale: string;
} {
  if (typeof stats?.tradeCount === "number" && stats.tradeCount > 0) {
    const proposed = Math.max(5, Math.round(stats.tradeCount * 2));
    return {
      threshold: proposed,
      rationale: `recent trade count ${stats.tradeCount} × 2 (stretch but tractable)`,
    };
  }
  return { threshold: 20, rationale: "no recent trade count available — using 20 default" };
}

function proposeDrawdown(stats: DraftRecentStats | undefined): {
  threshold: number;
  rationale: string;
} {
  if (typeof stats?.maxDrawdownPct === "number" && stats.maxDrawdownPct > 0) {
    const proposed = Math.max(1, stats.maxDrawdownPct * 0.8);
    return {
      threshold: Number(proposed.toFixed(2)),
      rationale: `recent max drawdown ${stats.maxDrawdownPct.toFixed(2)}% × 0.8 (tighter than realized)`,
    };
  }
  return { threshold: 5, rationale: "no recent drawdown available — using 5% default" };
}

function endStateText(type: EndStateType, threshold: number | string): string {
  switch (type) {
    case "sharpe":
      return `Sharpe >= ${threshold}`;
    case "winrate":
      return `win rate >= ${threshold}%`;
    case "trades":
      return `${threshold} trades complete`;
    case "drawdown_under":
      return `max drawdown < ${threshold}%`;
    case "time_horizon":
      return `${threshold} elapsed`;
    case "checklist":
      return `checklist complete`;
    case "custom":
      return `${threshold}`;
  }
}

function defaultObjective(type: EndStateType): string {
  switch (type) {
    case "sharpe":
      return "trade systematic setups";
    case "winrate":
      return "execute high-quality entries";
    case "trades":
      return "build a tradeable sample size";
    case "drawdown_under":
      return "preserve capital while finding edge";
    case "time_horizon":
      return "run the active strategy";
    case "checklist":
      return "complete the prepared checklist";
    case "custom":
      return "trade systematic setups";
  }
}

export function composeGoalDraft(input: ComposeGoalDraftInput): ComposeGoalDraftResult {
  if (!input.vagueIntent || input.vagueIntent.trim().length === 0) {
    throw new Error("vagueIntent must not be empty");
  }
  const horizon = input.preferredHorizon ?? "days";
  const intent = input.vagueIntent.trim();

  const detected = detectIntent(intent);
  const hasStats =
    !!input.recentStats &&
    (typeof input.recentStats.sharpe === "number" ||
      typeof input.recentStats.winRatePct === "number" ||
      typeof input.recentStats.tradeCount === "number" ||
      typeof input.recentStats.maxDrawdownPct === "number");

  // Default to Sharpe when intent doesn't match any keyword — it's the
  // most defensible single-number trading target.
  const endStateType: EndStateType = detected?.type ?? "sharpe";

  let threshold: number | string;
  let endStateRationale: string;
  switch (endStateType) {
    case "sharpe": {
      const r = proposeSharpe(input.recentStats);
      threshold = r.threshold;
      endStateRationale = r.rationale;
      break;
    }
    case "winrate": {
      const r = proposeWinRate(input.recentStats);
      threshold = r.threshold;
      endStateRationale = r.rationale;
      break;
    }
    case "trades": {
      const r = proposeTrades(input.recentStats);
      threshold = r.threshold;
      endStateRationale = r.rationale;
      break;
    }
    case "drawdown_under": {
      const r = proposeDrawdown(input.recentStats);
      threshold = r.threshold;
      endStateRationale = r.rationale;
      break;
    }
    case "time_horizon": {
      threshold = detectHorizon(intent, horizon);
      endStateRationale = `time-bounded — operator framing suggests fixed horizon`;
      break;
    }
    case "checklist": {
      threshold = "all items checked";
      endStateRationale = "checklist target — caller specifies items separately";
      break;
    }
    case "custom": {
      threshold = "operator-specified";
      endStateRationale = "custom — operator scores manually";
      break;
    }
  }

  const proposedObjective = defaultObjective(endStateType);
  const proposedEndStateText = endStateText(endStateType, threshold);

  const proposedConstraints: string[] = [...(input.activeMandateExclusions ?? [])];
  const constraintsClause =
    proposedConstraints.length > 0 ? proposedConstraints.join(", ") : "exceeding daily loss limit";
  if (proposedConstraints.length === 0) {
    proposedConstraints.push("exceeding daily loss limit");
  }

  const proposedGoalText = `${proposedObjective} until ${proposedEndStateText} without ${constraintsClause}`;

  let confidence: DraftConfidence;
  if (detected && hasStats) confidence = "high";
  else if (detected || hasStats) confidence = "medium";
  else confidence = "low";

  const objectiveRationale =
    detected !== null
      ? `intent keyword "${detected.keyword}" → end-state type "${endStateType}"`
      : `no keyword detected — defaulting to Sharpe as the most defensible single-number trading target`;
  const constraintsRationale =
    input.activeMandateExclusions && input.activeMandateExclusions.length > 0
      ? `carried over from active mandate (${input.activeMandateExclusions.length} exclusion(s))`
      : `no mandate exclusions supplied — fell back to "exceeding daily loss limit" as a universal safety constraint`;

  const reasoning =
    `intent="${intent}" → ${proposedGoalText}. ` +
    `Confidence ${confidence} (keyword=${!!detected}, stats=${hasStats}). ` +
    `Objective: ${objectiveRationale}. End-state: ${endStateRationale}. Constraints: ${constraintsRationale}.`;

  return {
    proposedGoalText,
    proposedObjective,
    proposedEndState: {
      type: endStateType,
      threshold,
      rationale: endStateRationale,
    },
    proposedConstraints,
    confidence,
    rationale: {
      objective: objectiveRationale,
      endState: endStateRationale,
      constraints: constraintsRationale,
    },
    reasoning,
  };
}

export function goalDraftToPayload(result: ComposeGoalDraftResult): Record<string, unknown> {
  return {
    kind: "goal_draft.composed",
    proposedGoalText: result.proposedGoalText,
    proposedEndStateType: result.proposedEndState.type,
    proposedEndStateThreshold: result.proposedEndState.threshold,
    constraintCount: result.proposedConstraints.length,
    confidence: result.confidence,
  };
}
