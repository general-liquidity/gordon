/**
 * Institutional-AI Pattern Tools.
 *
 * Three tools surfaced from the Roan + Andrew + Shapiro content drops:
 *
 *   - `validate_earnings_signal` — agent extracts a structured earnings
 *     signal via LLM reasoning, then calls this tool to validate the
 *     schema, cross-check quoted risk factors against the source
 *     transcript, and produce a composite conviction score.
 *
 *   - `get_discipline_audit` — scores operator behavior against the
 *     7 prop-trading failure modes (race / no plan / over-risk /
 *     overtrade / no journal / strategy-switch / emotional). For
 *     /weekend-review embedding.
 *
 *   - `compute_crowd_positioning_verdict` — Shapiro positioning frame.
 *     Caller supplies funding rate / OI change / sentiment /
 *     liquidation imbalance; tool returns a structured verdict
 *     identifying long/short concentration and the expected exit
 *     direction.
 *
 * All three are pure READ tools. None place trades or mutate state.
 * Surfaced to Gordon (orchestrator) and Researcher (read-only research
 * agent).
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  crossCheckRiskFactorQuotes,
  EarningsSignalSchema,
  scoreEarningsSignal,
  summarizeEarningsSignal,
  validateEarningsSignal,
  type EarningsSignal,
} from "../../../trading/analytics/earningsSignal.ts";
import {
  getDisciplineAudit,
  summarizeDisciplineAudit,
} from "../../../platform/audit/disciplineAudit.ts";
import {
  computeCrowdPositioningVerdict,
  summarizeCrowdPositioning,
  type CrowdPositioningInputs,
} from "../../../../core/alpha/crowdPositioning.ts";

// ============================================================================
// validate_earnings_signal
// ============================================================================

export const validateEarningsSignalTool = createTool({
  id: "validate_earnings_signal",
  description: [
    "Validate a structured earnings-call signal extracted from a transcript.",
    "The CALLER (agent) does the LLM extraction itself; this tool then:",
    "  1. Schema-validates the structured fields.",
    "  2. Optionally cross-checks each quoted risk factor against the source",
    "     transcript using verbatim substring matching (catches hallucinated quotes).",
    "  3. Returns a composite conviction score that downstream sizing logic can",
    "     consume as a single number instead of reasoning over 4-5 fields.",
    "",
    "Expected workflow:",
    "  - Agent calls get_earnings_transcript to fetch the source text.",
    "  - Agent runs an extraction prompt producing the candidate signal.",
    "  - Agent calls validate_earnings_signal with both the candidate and",
    "    (optionally) the transcript text for quote verification.",
    "",
    "Schema fields: { ticker, sentimentScore (-1..1), managementConfidence (0..1),",
    "guidanceRevision: raised|maintained|lowered|none, keyRiskFactors (up to 3",
    "verbatim quotes), tradingBias: strong_long..strong_short }.",
  ].join("\n"),
  inputSchema: z.object({
    candidate: EarningsSignalSchema.describe("The structured signal candidate the agent produced."),
    transcript: z
      .string()
      .optional()
      .describe(
        "Optional. When supplied, each keyRiskFactors quote is cross-checked against this text. Strongly recommended — un-verified quotes are how hallucinated 'evidence' lands in production.",
      ),
  }),
  outputSchema: z.object({
    valid: z.boolean(),
    summary: z.string(),
    signal: EarningsSignalSchema.optional(),
    issues: z.array(
      z.object({
        severity: z.enum(["error", "warning"]),
        field: z.string(),
        message: z.string(),
      }),
    ),
    quoteCheck: z
      .object({
        outcomes: z.array(
          z.object({
            quote: z.string(),
            verified: z.boolean(),
          }),
        ),
        hallucinatedCount: z.number(),
        verifiedRate: z.number(),
      })
      .optional(),
    score: z
      .object({
        composite: z.number(),
        components: z.object({
          sentiment: z.number(),
          confidence: z.number(),
          guidance: z.number(),
          bias: z.number(),
        }),
        conviction: z.number(),
      })
      .optional(),
  }),
  execute: async ({
    candidate,
    transcript,
  }: {
    candidate: EarningsSignal;
    transcript?: string;
  }) => {
    const validation = validateEarningsSignal(candidate);
    if (!validation.ok || !validation.signal) {
      return {
        valid: false,
        summary: `Earnings signal rejected: ${validation.issues.map((i) => `${i.field}: ${i.message}`).join("; ")}`,
        issues: validation.issues,
      };
    }
    const signal = validation.signal;
    const quoteCheck = transcript
      ? crossCheckRiskFactorQuotes(signal, transcript)
      : undefined;
    const score = scoreEarningsSignal(signal, quoteCheck);
    return {
      valid: true,
      summary: summarizeEarningsSignal(signal, score, quoteCheck),
      signal,
      issues: validation.issues,
      ...(quoteCheck && { quoteCheck }),
      score,
    };
  },
});

// ============================================================================
// get_discipline_audit
// ============================================================================

export const getDisciplineAuditTool = createTool({
  id: "get_discipline_audit",
  description: [
    "Score operator behavior against the 7 prop-trading failure modes over a",
    "given window. Returns per-mode results (triggered / severity / evidence)",
    "plus an overall discipline score in [0..1].",
    "",
    "Failure modes detected:",
    "  - racing_the_target — intra-day trade frequency spikes",
    "  - trading_without_plan — EXECUTE_PLAN without matching APPROVE_PLAN",
    "  - risk_per_trade_too_high — high/critical-tier RULE_OVERRIDEs",
    "  - overtrading — days exceeding maxTradesPerDay",
    "  - not_journaling — trades without decisionTrace or rationale",
    "  - strategy_switching — many distinct strategy slots in window",
    "  - emotional_trading — RULE_OVERRIDEs clustered after losses/overrides",
    "",
    "Use during /weekend-review or whenever the operator wants a structured",
    "discipline check. Default window is the last 7 days.",
  ].join("\n"),
  inputSchema: z.object({
    startTime: z.string().optional().describe("ISO timestamp. Default: 7 days ago."),
    endTime: z.string().optional().describe("ISO timestamp. Default: now."),
    userId: z.string().optional().describe("Filter to one operator. Default: all."),
    maxTradesPerDay: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Cap before flagging overtrading. Default 3."),
    maxDistinctSlots: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Cap before flagging strategy switching. Default 3."),
    emotionalProximityMs: z
      .number()
      .positive()
      .optional()
      .describe("Window (ms) within which a clustered override fires emotional_trading. Default 2h."),
  }),
  outputSchema: z.object({
    summary: z.string(),
    score: z.number(),
    triggeredCount: z.number(),
    headlineSeverity: z.enum(["info", "warning", "alert"]),
    windowStart: z.string(),
    windowEnd: z.string(),
    modes: z.array(
      z.object({
        mode: z.string(),
        triggered: z.boolean(),
        severity: z.enum(["info", "warning", "alert"]),
        description: z.string(),
        evidence: z.record(z.string(), z.unknown()),
      }),
    ),
  }),
  execute: async (input: {
    startTime?: string;
    endTime?: string;
    userId?: string;
    maxTradesPerDay?: number;
    maxDistinctSlots?: number;
    emotionalProximityMs?: number;
  }) => {
    const report = getDisciplineAudit(input);
    return {
      summary: summarizeDisciplineAudit(report),
      score: report.score,
      triggeredCount: report.triggeredCount,
      headlineSeverity: report.headlineSeverity,
      windowStart: report.windowStart,
      windowEnd: report.windowEnd,
      modes: report.modes,
    };
  },
});

// ============================================================================
// compute_crowd_positioning_verdict
// ============================================================================

export const computeCrowdPositioningVerdictTool = createTool({
  id: "compute_crowd_positioning_verdict",
  description: [
    "Synthesize crowd-positioning signals into a structured verdict (Shapiro",
    "framing). Caller supplies funding rate / OI change / sentiment /",
    "recent-liquidation-imbalance; tool returns the side of concentration,",
    "severity, contributing-signal breakdown, and the expected exit direction.",
    "",
    "Reading the output:",
    "  - side='long' + concentration='extreme' → crowd is trapped long. Expected",
    "    exit is downward (longs liquidating). Shapiro trade = short.",
    "  - side='short' + 'extreme' → trapped short. Expected exit upward",
    "    (shorts covering). Shapiro trade = long.",
    "  - side='balanced' → no Shapiro setup.",
    "",
    "This is a SETUP detector, not a trade trigger. The operator still needs to",
    "time the exit move; the verdict flags concentration so the operator knows",
    "to watch for the unwind.",
    "",
    "Pure synthesizer — the tool does not fetch any data. Caller is responsible",
    "for supplying fresh, accurate inputs.",
  ].join("\n"),
  inputSchema: z.object({
    fundingRateAnnualized: z
      .number()
      .optional()
      .describe(
        "Annualized funding rate as decimal (e.g. 0.20 for 20% annualized). Positive = longs paying shorts.",
      ),
    fundingRateZ: z
      .number()
      .optional()
      .describe(
        "Z-score of funding rate vs baseline. Preferred over raw rate when available — context-aware.",
      ),
    openInterestChange: z
      .number()
      .optional()
      .describe(
        "Recent OI change as fraction of baseline (e.g. 0.15 = +15%). Positive = accumulation.",
      ),
    sentimentScore: z
      .number()
      .min(-1)
      .max(1)
      .optional()
      .describe("Aggregate sentiment in [-1, +1]. Positive = bullish."),
    recentLiquidationImbalance: z
      .number()
      .optional()
      .describe(
        "Liquidation imbalance: positive = more longs liquidated. Reduces concentration on the hit side.",
      ),
  }),
  outputSchema: z.object({
    summary: z.string(),
    side: z.enum(["long", "short", "balanced"]),
    concentration: z.enum(["low", "elevated", "extreme"]),
    netScore: z.number(),
    expectedExitDirection: z.enum(["down", "up"]).nullable(),
    signalCount: z.number(),
    contributingSignals: z.array(
      z.object({
        signal: z.string(),
        contribution: z.number(),
        note: z.string(),
      }),
    ),
  }),
  execute: async (input: CrowdPositioningInputs) => {
    const verdict = computeCrowdPositioningVerdict(input);
    return {
      summary: summarizeCrowdPositioning(verdict),
      side: verdict.side,
      concentration: verdict.concentration,
      netScore: verdict.netScore,
      expectedExitDirection: verdict.expectedExitDirection,
      signalCount: verdict.signalCount,
      contributingSignals: verdict.contributingSignals,
    };
  },
});

// ============================================================================
// Export
// ============================================================================

export const institutionalAiTools = {
  validate_earnings_signal: validateEarningsSignalTool,
  get_discipline_audit: getDisciplineAuditTool,
  compute_crowd_positioning_verdict: computeCrowdPositioningVerdictTool,
};
