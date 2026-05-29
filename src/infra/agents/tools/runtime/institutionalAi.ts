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
import { computeDisciplineTrajectory } from "../../../platform/audit/disciplineTrajectory.ts";
import { interpretRiskRatioTriple } from "../../../../core/alpha/risk-ratio-triple.ts";
import { computeOrchestrationLoad } from "../../../../core/runtime/orchestrationLoad.ts";
import { classifySurvivorshipRisk } from "../../../../core/alpha/survivorshipRisk.ts";
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
// get_discipline_trajectory
// ============================================================================

export const getDisciplineTrajectoryTool = createTool({
  id: "get_discipline_trajectory",
  description: [
    "Longitudinal projection of operator discipline over N rolling windows —",
    "the 'Hockey Stick Growth Curve' read. Runs the discipline audit across",
    "consecutive windows (oldest → newest), then classifies the operator's",
    "stage on the four-stage curve:",
    "",
    "  1 Tinkering      — chaos; many modes firing; low score",
    "  2 Blade Years    — internal alignment; score improving; not ready to scale",
    "  3 Inflection     — clean repeatable execution; high stable score",
    "  4 Surging Growth — elite; multi-window low variance; scalable",
    "",
    "Returns the discipline-score slope, which failure modes resolved vs",
    "regressed vs persisted across the span, the stage estimate + confidence,",
    "and the article's 'what moves you forward' guidance for that stage.",
    "",
    "Stage is a TREND read, not a snapshot — higher stages require more than a",
    "clean window. Stage 4 specifically requires multi-window low return",
    "dispersion, so pass `consistencyScores` and `returnDispersions` (one value",
    "per window, oldest first) for a high-confidence classification. Without",
    "them the stage is inferred from discipline alone at lower confidence.",
    "",
    "Used by the /trader-stage skill. Default: 4 windows of 7 days each.",
  ].join("\n"),
  inputSchema: z.object({
    windowCount: z
      .number()
      .int()
      .min(1)
      .max(52)
      .optional()
      .describe("Number of consecutive windows to audit. Default 4."),
    windowDays: z
      .number()
      .positive()
      .optional()
      .describe("Length of each window in days. Default 7."),
    endTime: z
      .string()
      .optional()
      .describe("ISO timestamp for the end of the most recent window. Default: now."),
    userId: z.string().optional().describe("Filter to one operator. Default: all."),
    maxTradesPerDay: z.number().int().positive().optional(),
    maxDistinctSlots: z.number().int().positive().optional(),
    emotionalProximityMs: z.number().positive().optional(),
    consistencyScores: z
      .array(z.number())
      .optional()
      .describe("Trade-consistency composite per window ([0..1]), oldest first."),
    returnDispersions: z
      .array(z.number())
      .optional()
      .describe("Return dispersion per window (e.g. stddev of daily returns), oldest first."),
  }),
  outputSchema: z.object({
    summary: z.string(),
    stage: z.number(),
    stageName: z.string(),
    stageConfidence: z.number(),
    whatMovesYouForward: z.string(),
    disciplineSlope: z.number(),
    disciplineDirection: z.string(),
    latestScore: z.number(),
    disciplineScores: z.array(z.number()),
    resolvedModes: z.array(z.string()),
    regressedModes: z.array(z.string()),
    persistentModes: z.array(z.string()),
    windowCount: z.number(),
    interpretation: z.string(),
  }),
  execute: async (input: {
    windowCount?: number;
    windowDays?: number;
    endTime?: string;
    userId?: string;
    maxTradesPerDay?: number;
    maxDistinctSlots?: number;
    emotionalProximityMs?: number;
    consistencyScores?: number[];
    returnDispersions?: number[];
  }) => {
    const windowCount = input.windowCount ?? 4;
    const windowDays = input.windowDays ?? 7;
    const windowMs = windowDays * 86_400_000;
    const endMs = input.endTime ? Date.parse(input.endTime) : Date.now();

    // Build windows oldest → newest. Window i ends `(windowCount-1-i)`
    // windows before the most recent endTime.
    const reports = [];
    for (let i = 0; i < windowCount; i++) {
      const wEnd = endMs - (windowCount - 1 - i) * windowMs;
      const wStart = wEnd - windowMs;
      reports.push(
        getDisciplineAudit({
          startTime: new Date(wStart).toISOString(),
          endTime: new Date(wEnd).toISOString(),
          ...(input.userId !== undefined && { userId: input.userId }),
          ...(input.maxTradesPerDay !== undefined && { maxTradesPerDay: input.maxTradesPerDay }),
          ...(input.maxDistinctSlots !== undefined && { maxDistinctSlots: input.maxDistinctSlots }),
          ...(input.emotionalProximityMs !== undefined && { emotionalProximityMs: input.emotionalProximityMs }),
        }),
      );
    }

    const trajectory = computeDisciplineTrajectory({
      reports,
      ...(input.consistencyScores !== undefined && { consistencyScores: input.consistencyScores }),
      ...(input.returnDispersions !== undefined && { returnDispersions: input.returnDispersions }),
    });

    return {
      summary: trajectory.interpretation,
      stage: trajectory.stage,
      stageName: trajectory.stageName,
      stageConfidence: trajectory.stageConfidence,
      whatMovesYouForward: trajectory.whatMovesYouForward,
      disciplineSlope: trajectory.disciplineSlope,
      disciplineDirection: trajectory.disciplineDirection,
      latestScore: trajectory.latestScore,
      disciplineScores: trajectory.disciplineScores,
      resolvedModes: trajectory.resolvedModes,
      regressedModes: trajectory.regressedModes,
      persistentModes: trajectory.persistentModes,
      windowCount: trajectory.windowCount,
      interpretation: trajectory.interpretation,
    };
  },
});

// ============================================================================
// interpret_risk_ratio_triple
// ============================================================================

export const interpretRiskRatioTripleTool = createTool({
  id: "interpret_risk_ratio_triple",
  description: [
    "Skew read from the Sharpe / Sortino / Calmar triple ('Is Your Sharpe",
    "Lying?'). For a symmetric return distribution Sortino ≈ √2 × Sharpe; the",
    "divergence from that identity classifies the skew using the ratios ALONE",
    "(no return series needed):",
    "",
    "  Sortino > √2×Sharpe → positive skew (Sharpe UNDERRATES the strategy)",
    "  Sortino ≈ √2×Sharpe → symmetric",
    "  Sortino < √2×Sharpe → negative skew (tail risk NOT priced into the",
    "                         ratios — vol-selling / short-gamma signature)",
    "",
    "Also checks allocator floors (default Calmar > 1.0, Sortino > 2.0).",
    "",
    "This is the ratios-only path — use it when reading a tearsheet that lists",
    "only the ratios. When you HAVE the return series, prefer skew from the",
    "third moment via the strategy-claim-verifier diagnostic, which is exact.",
  ].join("\n"),
  inputSchema: z.object({
    sharpe: z.number().describe("Sharpe ratio (excess return / total volatility)."),
    sortino: z.number().describe("Sortino ratio (excess return / downside deviation)."),
    calmar: z.number().optional().describe("Calmar ratio (return / max drawdown). Optional."),
    symmetricTolerance: z
      .number()
      .positive()
      .optional()
      .describe("Fractional band around √2×Sharpe called symmetric. Default 0.10."),
    calmarFloor: z.number().optional().describe("Allocator floor on Calmar. Default 1.0."),
    sortinoFloor: z.number().optional().describe("Allocator floor on Sortino. Default 2.0."),
  }),
  outputSchema: z.object({
    skew: z.enum(["positive", "symmetric", "negative", "indeterminate"]),
    expectedSortino: z.number(),
    divergenceRatio: z.number().nullable(),
    tailRiskUnpriced: z.boolean(),
    underratedBySharpe: z.boolean(),
    calmarPassesFloor: z.boolean().nullable(),
    sortinoPassesFloor: z.boolean(),
    interpretation: z.string(),
  }),
  execute: async (input: {
    sharpe: number;
    sortino: number;
    calmar?: number;
    symmetricTolerance?: number;
    calmarFloor?: number;
    sortinoFloor?: number;
  }) => {
    const r = interpretRiskRatioTriple(input);
    return {
      skew: r.skew,
      expectedSortino: r.expectedSortino,
      divergenceRatio: r.divergenceRatio,
      tailRiskUnpriced: r.tailRiskUnpriced,
      underratedBySharpe: r.underratedBySharpe,
      calmarPassesFloor: r.calmarPassesFloor,
      sortinoPassesFloor: r.sortinoPassesFloor,
      interpretation: r.interpretation,
    };
  },
});

// ============================================================================
// compute_orchestration_load
// ============================================================================

export const computeOrchestrationLoadTool = createTool({
  id: "compute_orchestration_load",
  description: [
    "Quantify the operator's serial-review bottleneck — 'The Orchestration",
    "Tax'. The operator is the single-threaded reviewer (the GIL); producing",
    "proposals is cheap but reviewing them acquires one lock held by one",
    "person. Given items pending the operator's review and their sustainable",
    "review throughput, returns the backlog in hours, a load tier (slack /",
    "saturated / overloaded), and a backpressure recommendation.",
    "",
    "Use when the operator asks 'am I overloaded?', before spawning more",
    "autonomous work, or to decide whether to defer non-critical proactive",
    "cards. Read-only diagnostic. Used by /orchestration-load.",
  ].join("\n"),
  inputSchema: z.object({
    pendingReviewItems: z
      .number()
      .min(0)
      .describe("Items awaiting the operator's review (pending approvals + unacked cards)."),
    reviewCapacityPerHour: z
      .number()
      .positive()
      .describe("Operator's sustainable review throughput, items per hour."),
    producedLastHour: z
      .number()
      .min(0)
      .optional()
      .describe("Items produced in the last hour — surfaces producer-outpacing-consumer."),
    saturatedThreshold: z.number().positive().optional().describe("Backlog hours → saturated. Default 0.75."),
    overloadedThreshold: z.number().positive().optional().describe("Backlog hours → overloaded. Default 1.0."),
  }),
  outputSchema: z.object({
    backlogHours: z.number(),
    tier: z.enum(["slack", "saturated", "overloaded"]),
    producerOutpacingConsumer: z.boolean().nullable(),
    shouldApplyBackpressure: z.boolean(),
    deferNonCritical: z.boolean(),
    interpretation: z.string(),
  }),
  execute: async (input: {
    pendingReviewItems: number;
    reviewCapacityPerHour: number;
    producedLastHour?: number;
    saturatedThreshold?: number;
    overloadedThreshold?: number;
  }) => {
    const r = computeOrchestrationLoad(input);
    return {
      backlogHours: r.backlogHours,
      tier: r.tier,
      producerOutpacingConsumer: r.producerOutpacingConsumer,
      shouldApplyBackpressure: r.shouldApplyBackpressure,
      deferNonCritical: r.deferNonCritical,
      interpretation: r.interpretation,
    };
  },
});

// ============================================================================
// classify_survivorship_risk
// ============================================================================

export const classifySurvivorshipRiskTool = createTool({
  id: "classify_survivorship_risk",
  description: [
    "Classify a backtest's survivorship-bias risk from how its universe was",
    "constructed. A strategy that selects instruments from TODAY's universe",
    "across a historical window is tilted toward winners — failed/delisted",
    "names are silently excluded. Returns a risk tier + a suggested return",
    "haircut + the confirm-before-trusting checklist.",
    "",
    "Immune: single-instrument, broad-liquid (SPY/QQQ), point-in-time universes.",
    "Biased: cross-sectional selection from a current snapshot — risk grows with",
    "window length, universe breadth, and delisting intensity (crypto > equity).",
    "",
    "This is a RISK FLAG, not a correction — Gordon has no delisting feed, so the",
    "true survivorship-free result requires re-running on a point-in-time universe.",
    "Use before trusting any cross-sectional momentum / trend backtest.",
  ].join("\n"),
  inputSchema: z.object({
    crossSectional: z.boolean().describe("Does the strategy select among multiple instruments?"),
    universeConstruction: z
      .enum(["single_symbol", "liquid_broad", "current_snapshot", "point_in_time"])
      .describe("How the backtest universe was assembled."),
    universeSize: z.number().int().min(1).optional().describe("Number of instruments selected among. Default 1."),
    windowDays: z.number().min(0).optional().describe("Backtest window length in days. Default 0."),
    assetClass: z.enum(["crypto", "equity", "other"]).optional().describe("Default 'other'."),
  }),
  outputSchema: z.object({
    tier: z.enum(["none", "low", "medium", "high"]),
    returnHaircut: z.number(),
    reasons: z.array(z.string()),
    checklist: z.array(z.string()),
    interpretation: z.string(),
  }),
  execute: async (input: {
    crossSectional: boolean;
    universeConstruction: "single_symbol" | "liquid_broad" | "current_snapshot" | "point_in_time";
    universeSize?: number;
    windowDays?: number;
    assetClass?: "crypto" | "equity" | "other";
  }) => {
    const r = classifySurvivorshipRisk(input);
    return {
      tier: r.tier,
      returnHaircut: r.returnHaircut,
      reasons: r.reasons,
      checklist: r.checklist,
      interpretation: r.interpretation,
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
