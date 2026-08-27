/**
 * V4 Plan + Execution Tools — 6 typed tools.
 *
 *   - create_plan   → Plan (typed entry/exit/stop/size + rationale)
 *   - verify_plan   → VerifyResult (risk classifier + permission)
 *   - approve_plan  → ApprovalResult (rationale-required override path)
 *   - execute_plan  → ExecutionResult (dispatches Executor)
 *   - cancel        → CancelResult (orders or positions)
 *   - backtest      → BacktestResult
 *
 * Each tool is regulatory-critical state mutation — per-tool permission
 * scoping + audit specificity outweighs schema-cost savings.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getGordonContext, type MastraExecutionContext } from "../types.ts";
import {
  createPlan as dbCreatePlan,
  getPlan as dbGetPlan,
} from "../../../storage/entities/plans.ts";
import {
  approvePlanTool as implApprovePlan,
  executePlanTool as implExecutePlan,
  closeTradeTool as implCloseTrade,
  closePartialPositionTool as implClosePartial,
} from "../trading/trading.ts";
import { checkRiskTool as implCheckRisk } from "../trading/risk-gate.ts";
import { triageExecution } from "../../../trading/execution/executionTriage.ts";
import { runBacktestTool as implRunBacktest } from "../strategy/backtest/backtest.ts";
import type { BacktestResult } from "../../../../backtest/types.ts";
import { analyzeBacktestResult } from "../../../../backtest/analysis/analysis.ts";
import { computeVerdict } from "../../../../backtest/analysis/verdict.ts";
import { recordBacktestRun, getBacktestRun, detectDrift } from "../../../data/backtestSnapshots.ts";
import { auditLog } from "../../../platform/audit/index.ts";
import { getMemoryManager } from "../../../../core/memory/index.ts";
import { hasRecentSymbolObservation } from "../../observation/symbolObservationTracker.ts";
import { buildSynthesisManifest, summarizeManifest } from "../../observation/synthesisManifest.ts";
import { withPortfolioOverride } from "./portfolioOverride.ts";
import { recordStructuredObservation } from "../../../platform/observability/index.ts";
import { scoreConfluences, scoreToPayload } from "../../../trading/ops/confluenceScorer.ts";
import {
  selectPlaybookForStrategy,
  attachExecution,
  planToPayload,
} from "../../../trading/ops/executionPlaybook.ts";
import {
  assessBacktestValidity,
  computeSignalHalfLife,
  monthsUntilBelowCostFloor,
  PAPER_CALIBRATION_2026,
} from "../../../../core/alpha/signal-half-life.ts";
import { requireLiveConsent } from "../../../safety/consent.ts";

// ============================================================================
// signal decay (shared by backtest + verify_plan)
// ============================================================================

/**
 * The named calibration is a MODEL OUTPUT with one empirically calibrated input, not a
 * measured decay curve. Every surface that prints a number derived from it repeats that,
 * so an operator never reads 18 months as a fact about their own strategy.
 */
const DEFAULT_CALIBRATION_LABEL = "PAPER_CALIBRATION_2026 (model output, not measured)";
const OPERATOR_CALIBRATION_LABEL = "operator-supplied half-life";

const DEFAULT_HALF_LIFE_MONTHS = computeSignalHalfLife(PAPER_CALIBRATION_2026).halfLifeMonths;

/** Plan horizons are authored in hours, so a nominal 30-day month keeps the conversion legible. */
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

export interface BacktestDecayReport {
  readonly halfLifeMonths: number;
  readonly calibration: string;
  readonly backtestWindowMonths: number;
  readonly halfLivesInWindow: number;
  readonly measuresDecayedAverage: boolean;
  readonly overstatementFactor: number;
  readonly windowAverageEdgeFraction: number;
  readonly edgeAtWindowEnd: number;
  readonly warnings: readonly string[];
  /** Non-null only when the window outlived the half-life, so callers can lead with it. */
  readonly headline: string | null;
}

/**
 * A window longer than the edge's own half-life means the reported metrics average a period
 * in which the signal half-died. That is a validity error about the measurement, not a note
 * about the future, so it is reported on every backtest rather than gated behind an opt-in.
 */
export function assessBacktestWindowDecay(input: {
  readonly backtestWindowMonths: number;
  readonly liveHorizonMonths?: number;
  readonly halfLifeMonths?: number;
}): BacktestDecayReport {
  const operatorSupplied = typeof input.halfLifeMonths === "number" && input.halfLifeMonths > 0;
  const halfLifeMonths = operatorSupplied
    ? (input.halfLifeMonths as number)
    : DEFAULT_HALF_LIFE_MONTHS;
  const calibration = operatorSupplied ? OPERATOR_CALIBRATION_LABEL : DEFAULT_CALIBRATION_LABEL;
  const windowMonths = Math.max(0, input.backtestWindowMonths);
  const liveHorizonMonths = Math.max(0, input.liveHorizonMonths ?? 0);

  const validity = assessBacktestValidity({
    backtestWindowMonths: windowMonths,
    liveHorizonMonths,
    halfLifeMonths,
  });

  return {
    halfLifeMonths,
    calibration,
    backtestWindowMonths: windowMonths,
    halfLivesInWindow: validity.halfLivesInWindow,
    measuresDecayedAverage: validity.measuresDecayedAverage,
    overstatementFactor: validity.overstatementFactor,
    windowAverageEdgeFraction: validity.windowAverageEdgeFraction,
    edgeAtWindowEnd: validity.edgeAtWindowEnd,
    warnings: validity.warnings,
    headline: validity.measuresDecayedAverage
      ? `DECAY_VALIDITY: the ${windowMonths.toFixed(1)}-month window spans ${validity.halfLivesInWindow.toFixed(2)} half-lives ` +
        `at a ${halfLifeMonths.toFixed(1)}-month half-life, so these metrics overstate the edge available now by about ` +
        `${validity.overstatementFactor.toFixed(2)}x. Half-life source: ${calibration}.`
      : null,
  };
}

export interface PlanDecayAssessment {
  readonly ran: boolean;
  /** Named inputs the check needed and did not get. Empty when `ran` is true. */
  readonly missingInputs: readonly string[];
  readonly halfLifeMonths: number;
  readonly calibration: string;
  readonly horizonMonths: number | null;
  readonly monthsUntilBelowCostFloor: number | null;
  readonly alreadyBelowCostFloor: boolean;
  readonly belowFloorWithinHorizon: boolean;
  /** Reasons fit for the verdict. Empty whenever the check could not run. */
  readonly warnings: readonly string[];
  readonly note: string;
}

/**
 * Absent data is not evidence of decay, so a missing edge or horizon degrades to an
 * annotation with the missing field named. It never produces a warning and so never moves
 * a verdict.
 */
export function assessPlanDecay(input: {
  readonly backtestedEdge?: number;
  readonly costFloorEdge?: number;
  readonly horizonMonths?: number;
  readonly halfLifeMonths?: number;
}): PlanDecayAssessment {
  const operatorSupplied = typeof input.halfLifeMonths === "number" && input.halfLifeMonths > 0;
  const halfLifeMonths = operatorSupplied
    ? (input.halfLifeMonths as number)
    : DEFAULT_HALF_LIFE_MONTHS;
  const calibration = operatorSupplied ? OPERATOR_CALIBRATION_LABEL : DEFAULT_CALIBRATION_LABEL;

  const missingInputs: string[] = [];
  // A non-positive edge is treated as absent rather than as an error: the half-life module
  // throws on it, and a verify call must not fail on a malformed annotation input.
  if (!(typeof input.backtestedEdge === "number" && input.backtestedEdge > 0)) {
    missingInputs.push("backtestedEdge");
  }
  if (!(typeof input.costFloorEdge === "number" && input.costFloorEdge >= 0)) {
    missingInputs.push("costFloorEdge");
  }
  if (!(typeof input.horizonMonths === "number" && input.horizonMonths > 0)) {
    missingInputs.push("horizonMonths");
  }

  if (missingInputs.length > 0) {
    return {
      ran: false,
      missingInputs,
      halfLifeMonths,
      calibration,
      horizonMonths: typeof input.horizonMonths === "number" ? input.horizonMonths : null,
      monthsUntilBelowCostFloor: null,
      alreadyBelowCostFloor: false,
      belowFloorWithinHorizon: false,
      warnings: [],
      note:
        `Signal-decay check did not run: missing ${missingInputs.join(", ")}. ` +
        "This is an absence of inputs, not a finding about the plan.",
    };
  }

  const horizonMonths = input.horizonMonths as number;
  const horizon = monthsUntilBelowCostFloor({
    backtestedEdge: input.backtestedEdge as number,
    costFloorEdge: input.costFloorEdge as number,
    halfLifeMonths,
  });
  const belowFloorWithinHorizon =
    !horizon.alreadyBelowFloor && horizon.monthsUntilBelowFloor <= horizonMonths;

  const warnings: string[] = [];
  if (horizon.alreadyBelowFloor) {
    warnings.push(
      `EDGE_BELOW_COST_FLOOR: the supporting edge of ${horizon.backtestedEdge} is already at or below the ` +
        `${horizon.costFloorEdge} cost floor before any decay is applied, so the plan does not pay for its own execution.`,
    );
  } else if (belowFloorWithinHorizon) {
    warnings.push(
      `EDGE_DECAY: the supporting edge falls below its ${horizon.costFloorEdge} cost floor after ` +
        `${horizon.monthsUntilBelowFloor.toFixed(1)} months, inside the ${horizonMonths.toFixed(2)}-month intended horizon. ` +
        `Half-life source: ${calibration}.`,
    );
  }

  return {
    ran: true,
    missingInputs: [],
    halfLifeMonths,
    calibration,
    horizonMonths,
    monthsUntilBelowCostFloor: Number.isFinite(horizon.monthsUntilBelowFloor)
      ? horizon.monthsUntilBelowFloor
      : null,
    alreadyBelowCostFloor: horizon.alreadyBelowFloor,
    belowFloorWithinHorizon,
    warnings,
    note: `${horizon.summary} Half-life source: ${calibration}.`,
  };
}

/**
 * Extracted from verify_plan unchanged so the monotonicity property (more reasons never
 * yields a better verdict) can be asserted directly against the live decision rule.
 */
export function resolveVerifyVerdict(input: {
  readonly hasError: boolean;
  readonly approved: boolean;
  readonly reasonCount: number;
}): {
  verdict: "approve" | "conditional" | "reject";
  riskTier: "low" | "medium" | "high" | "critical";
} {
  if (input.hasError) {
    return { verdict: "reject", riskTier: "critical" };
  }
  if (!input.approved) {
    return { verdict: "reject", riskTier: "high" };
  }
  return input.reasonCount > 0
    ? { verdict: "conditional", riskTier: "medium" }
    : { verdict: "approve", riskTier: "low" };
}

// ============================================================================
// create_plan
// ============================================================================

export const createPlanTool = createTool({
  id: "create_plan",
  description: [
    "Create a trading Plan: structured spec for an intended trade with",
    "entry, exit, stop, size, rationale. Plans go through verify → approve",
    "→ execute lifecycle. A Plan is the unit of intent — not an order yet.",
    "",
    "After create_plan, call verify_plan to run risk + constitution gates.",
    "Only Plans that pass verify_plan should be approved + executed.",
  ].join("\n"),
  inputSchema: z.object({
    symbol: z.string(),
    side: z.enum(["buy", "sell"]),
    entryPrice: z.number().positive().optional().describe("Limit entry; omit for market."),
    stopLossPrice: z.number().positive(),
    takeProfitPrice: z.number().positive().optional(),
    sizeUsd: z.number().positive(),
    venue: z.string().optional(),
    rationale: z.string().min(10).describe("Why this trade — min 10 chars for audit."),
    strategySlot: z.string().optional().describe("Strategy slot ID if part of an active strategy."),
    strategy: z
      .enum([
        "support_bounce",
        "bollinger_bounce",
        "sma_crossover",
        "volume_surge",
        "vwap_bounce",
        "consolidation_pop",
        "adx_trend",
        "ema_rsi_crossover",
        "relative_strength",
        "engulfing_pattern",
        "grid_entry",
      ])
      .optional()
      .describe(
        "Strategy taxonomy for audit + adherence. Defaults to 'support_bounce' when unset; pick the closest match.",
      ),
    timeHorizonHours: z.number().positive().optional(),
    routingPolicy: z
      .enum(["maker_first", "any"])
      .optional()
      .describe(
        "Order routing. 'maker_first' (default) waits for a passive fill — captures the +1.12% maker edge and avoids the −1.12% taker tax (Becker 72.1M-trade study). 'any' allows market orders without further confirmation. With maker_first + market entry, verify_plan flags it; operator must approve_plan with overrideVerifyVerdict=true to proceed.",
      ),
    mentalState: z
      .object({
        confidence: z
          .number()
          .min(1)
          .max(10)
          .optional()
          .describe("Subjective confidence in the setup. 1=hopeful, 10=screaming-edge."),
        focus: z.number().min(1).max(10).optional().describe("Operator's current focus level."),
        mood: z.enum(["calm", "anxious", "frustrated", "neutral", "overconfident"]).optional(),
        note: z
          .string()
          .optional()
          .describe("Free-form context — recent loss, fatigue, external pressure."),
      })
      .optional()
      .describe(
        "Optional operator mental-state snapshot at plan time. Persists on the plan record AND mirrors into the trade journal so /journal surfaces it. After 30+ plans the discipline audit can correlate emotional state with realized outcomes. Skip unless the operator volunteered this information; never fabricate values.",
      ),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    planId: z.string().optional(),
    plan: z.unknown().optional(),
    error: z.string().optional(),
  }),
  execute: async (
    args: {
      symbol: string;
      side: "buy" | "sell";
      entryPrice?: number;
      stopLossPrice: number;
      takeProfitPrice?: number;
      sizeUsd: number;
      venue?: string;
      rationale: string;
      strategySlot?: string;
      strategy?:
        | "support_bounce"
        | "bollinger_bounce"
        | "sma_crossover"
        | "volume_surge"
        | "vwap_bounce"
        | "consolidation_pop"
        | "adx_trend"
        | "ema_rsi_crossover"
        | "relative_strength"
        | "engulfing_pattern"
        | "grid_entry";
      timeHorizonHours?: number;
      routingPolicy?: "maker_first" | "any";
      mentalState?: {
        confidence?: number;
        focus?: number;
        mood?: "calm" | "anxious" | "frustrated" | "neutral" | "overconfident";
        note?: string;
      };
    },
    execContext?: MastraExecutionContext,
  ) => {
    try {
      const ctx = getGordonContext(execContext);
      const portfolioValue = Math.max(ctx?.portfolioValue ?? args.sizeUsd, args.sizeUsd);
      const allocationPercent = args.sizeUsd / portfolioValue;
      // Snapshot the synthesis inputs present right NOW for this symbol —
      // active regime, in-cache news, observation count, matched ACE
      // lessons, plus a pointer into the local OHLCV cache so /replay-
      // decision can reconstruct the exact analyst view later. Cheap,
      // no I/O.
      const venue = ctx?.exchange?.exchangeId;
      const synthesisManifest = buildSynthesisManifest(args.symbol, { venue });
      // Map surface explicit spec to the Plan shape stored in SQLite.
      // Direction collapses sell→short with inverted stop semantics handled
      // downstream; strategy defaults to support_bounce since these plans are
      // operator-spec'd not strategy-driven (the strategy slot is metadata,
      // not generator).
      const plan = dbCreatePlan({
        symbol: args.symbol,
        direction: args.side === "buy" ? "long" : "short",
        strategy: args.strategy ?? "support_bounce",
        allocation: {
          currency: "USDT",
          amount: args.sizeUsd,
          percentOfPortfolio: allocationPercent,
        },
        entry: {
          type: args.entryPrice ? "limit" : "market",
          price: args.entryPrice ?? null,
        },
        dca: null,
        grid: null,
        stopLoss: { price: args.stopLossPrice },
        takeProfit: args.takeProfitPrice ? [{ price: args.takeProfitPrice, percentToSell: 1 }] : [],
        reasoning: args.rationale,
        // Default maker_first so operators get the +1.12% maker edge by
        // default. Explicit "any" lets the LLM signal that the operator
        // wants taker behavior without further gating.
        routingPolicy: args.routingPolicy ?? "maker_first",
        ...(args.mentalState && { mentalState: args.mentalState }),
        synthesisManifest,
        status: "DRAFT",
        expiresAt: args.timeHorizonHours
          ? new Date(Date.now() + args.timeHorizonHours * 60 * 60 * 1000).toISOString()
          : undefined,
      });

      auditLog.record(
        "operator",
        "CREATE_PLAN" as Parameters<typeof auditLog.record>[1],
        { ...args },
        "SUCCESS",
        { resultDetails: args.rationale, planId: plan.id },
      );

      // Mirror mental-state + synthesis manifest into the trade journal so
      // /journal surfaces both inline alongside other observations. Fire-
      // and-forget — a journal failure must not break plan creation. The
      // manifest line is the "void replay": which inputs converged on this
      // decision (regime, news, observation count, lessons matched).
      const observationLines: string[] = [];
      if (args.mentalState) {
        const m = args.mentalState;
        const mentalParts = [
          m.mood ? `mood: ${m.mood}` : null,
          typeof m.confidence === "number" ? `confidence: ${m.confidence}/10` : null,
          typeof m.focus === "number" ? `focus: ${m.focus}/10` : null,
          m.note ? `note: ${m.note}` : null,
        ].filter(Boolean);
        if (mentalParts.length > 0) {
          observationLines.push(`Mental state at plan ${plan.id}: ${mentalParts.join("; ")}`);
        }
      }
      const manifestSummary = summarizeManifest(synthesisManifest);
      if (manifestSummary) {
        observationLines.push(`Synthesis at plan ${plan.id}: ${manifestSummary}`);
      }
      if (observationLines.length > 0) {
        getMemoryManager()
          .then((mgr) =>
            mgr.journal.recordObservation({
              symbol: args.symbol.toUpperCase(),
              observation: observationLines.join("\n"),
              conditions: `${args.side} setup, ${args.entryPrice ? "limit" : "market"} entry, $${args.sizeUsd} size`,
            }),
          )
          .catch(() => {
            // Journal mirroring is best-effort; never propagate.
          });
      }

      {
        const confluence = scoreConfluences({
          observations: [
            { kind: "regime_fit", present: true, evidence: plan.strategy },
            { kind: "key_level_proximity", present: plan.stopLoss.price > 0 },
            { kind: "volume_confirmation", present: plan.takeProfit.length > 0 },
            { kind: "thesis_coherence", present: (plan.reasoning?.length ?? 0) > 20 },
          ],
        });
        recordStructuredObservation({
          eventType: "plan.confluence_scored",
          workflow: "planning",
          source: "agent_tool",
          component: "create_plan",
          toolName: "create_plan",
          outcome: "info",
          planId: plan.id,
          symbol: plan.symbol,
          details: scoreToPayload(confluence),
        });
      }

      {
        const playbook = selectPlaybookForStrategy(plan.strategy);
        const entryPrice = plan.entry.price ?? args.entryPrice ?? 0;
        if (entryPrice > 0) {
          const executionPlan = attachExecution({
            planId: plan.id,
            playbookId: playbook.id,
            entryPrice,
            stopPrice: plan.stopLoss.price,
            direction: plan.direction,
          });
          recordStructuredObservation({
            eventType: "plan.execution_playbook_attached",
            workflow: "planning",
            source: "agent_tool",
            component: "create_plan",
            toolName: "create_plan",
            outcome: "info",
            planId: plan.id,
            symbol: plan.symbol,
            details: planToPayload(executionPlan),
          });
        }
      }

      return { success: true, planId: plan.id, plan };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});

// ============================================================================
// verify_plan
// ============================================================================

export const verifyPlanTool = createTool({
  id: "verify_plan",
  description: [
    "Run the safety stack on a Plan: 15-dim risk classifier (8 base + 7 optional) + permission",
    "engine + venue/account feasibility. Returns approve / conditional /",
    "reject + structured reasons.",
    "",
    "MANDATORY before approve_plan + execute_plan. Plans that haven't been",
    "verified should never reach execution.",
    "",
    "Pass expectedEdge + costFloorEdge to also check whether the supporting edge",
    "decays under its cost floor inside the holding horizon. Omitting them",
    "annotates that the check did not run; it never counts against the plan.",
  ].join("\n"),
  inputSchema: z.object({
    planId: z.string(),
    portfolioOverrideUsd: z
      .number()
      .positive()
      .optional()
      .describe(
        "If set, evaluate risk against this hypothetical portfolio value instead of the live exchange balance. Use for 'verify the plan on a $X account' reasoning without switching modes.",
      ),
    expectedEdge: z
      .number()
      .optional()
      .describe(
        "Backtested edge supporting this plan, in the same unit as costFloorEdge (Sharpe is the usual one). Required, with costFloorEdge, for the signal-decay check. Omit rather than guess: a missing value annotates, it never counts against the plan.",
      ),
    costFloorEdge: z
      .number()
      .optional()
      .describe("Edge level below which the strategy no longer covers its own execution costs."),
    horizonMonths: z
      .number()
      .positive()
      .optional()
      .describe("Intended holding horizon in months. Defaults to the plan's own expiry window."),
    signalHalfLifeMonths: z
      .number()
      .positive()
      .optional()
      .describe(
        "Override the default signal half-life. The default is a model calibration, not a measurement of this strategy.",
      ),
  }),
  outputSchema: z.object({
    planId: z.string(),
    verdict: z.enum(["approve", "conditional", "reject"]),
    riskTier: z.enum(["low", "medium", "high", "critical"]),
    constitutionViolations: z.array(z.unknown()),
    recommendation: z.string(),
    summary: z.string(),
    decay: z
      .object({
        ran: z.boolean(),
        missingInputs: z.array(z.string()),
        halfLifeMonths: z.number(),
        calibration: z.string(),
        horizonMonths: z.number().nullable(),
        monthsUntilBelowCostFloor: z.number().nullable(),
        alreadyBelowCostFloor: z.boolean(),
        belowFloorWithinHorizon: z.boolean(),
        note: z.string(),
      })
      .optional(),
  }),
  execute: async (
    args: {
      planId: string;
      portfolioOverrideUsd?: number;
      expectedEdge?: number;
      costFloorEdge?: number;
      horizonMonths?: number;
      signalHalfLifeMonths?: number;
    },
    execContext?: MastraExecutionContext,
  ) => {
    const plan = dbGetPlan(args.planId);
    if (!plan) {
      return {
        planId: args.planId,
        verdict: "reject" as const,
        riskTier: "critical" as const,
        constitutionViolations: [],
        recommendation: "block",
        summary: `Plan not found: ${args.planId}`,
      };
    }
    const ctx = getGordonContext(execContext);
    const quantity =
      plan.allocation.amount /
      Math.max(
        plan.entry.price ?? (await ctx?.exchange?.getPrice(plan.symbol).catch(() => 1)) ?? 1,
        1e-9,
      );
    // When the operator asked for a hypothetical-portfolio evaluation,
    // shadow the live ctx.portfolioValue / availableCash via the same
    // proxy compute_risk uses.
    const proxiedExecContext = args.portfolioOverrideUsd
      ? withPortfolioOverride(execContext, args.portfolioOverrideUsd)
      : execContext;
    const result = (await (implCheckRisk.execute as any)(
      {
        symbol: plan.symbol,
        side: plan.direction === "long" ? "BUY" : "SELL",
        type: plan.entry.type === "limit" ? "LIMIT" : "MARKET",
        quantity,
        price: plan.entry.price,
        stopLoss: plan.stopLoss.price,
        takeProfit: plan.takeProfit.map((tp: { price: number }) => tp.price),
      },
      proxiedExecContext,
    )) as {
      approved?: boolean;
      reason?: string;
      warnings?: string[];
      error?: string;
    };

    const approved = result.approved === true;
    const warnings = [...(result.warnings ?? [])];

    // Maker-first routing check: surface a violation when policy is
    // maker_first AND entry.type is market. Operator must approve_plan
    // with overrideVerifyVerdict=true to accept the taker tax.
    const planRoutingPolicy =
      (plan as { routingPolicy?: "maker_first" | "any" }).routingPolicy ?? "maker_first";
    const routingConflict = planRoutingPolicy === "maker_first" && plan.entry.type === "market";
    if (routingConflict) {
      warnings.push(
        "ROUTING_VIOLATION: plan has routingPolicy='maker_first' but entry.type='market' — crossing the spread surrenders the +1.12% maker edge (Becker 2026, 72.1M trades). Convert to a limit entry, or approve with overrideVerifyVerdict=true to accept the taker tax.",
      );
    }

    // Source-chain check: did this session actually fetch data for the
    // plan's symbol in the last 4h? Soft warning, not a block — the
    // operator may have looked at the data in a different way (chart on
    // another screen, prior session, etc.). Flag so they can confirm
    // they're not building a plan on a stale memory of prices.
    if (!hasRecentSymbolObservation(plan.symbol)) {
      warnings.push(
        `SOURCE_UNVERIFIED: no data tools have observed ${plan.symbol} in this session's last 4 hours. The plan's rationale may be working from stale prices. Run get_market_data, compute_indicator, or compute_regime on ${plan.symbol} to refresh and re-verify.`,
      );
    }

    // Signal-decay check. The plan's expiry window is the only holding horizon a Plan
    // carries, so it stands in when the caller does not name one.
    const planExpiryMonths =
      plan.expiresAt && plan.createdAt
        ? (new Date(plan.expiresAt).getTime() - new Date(plan.createdAt).getTime()) / MONTH_MS
        : undefined;
    const decay = assessPlanDecay({
      backtestedEdge: args.expectedEdge,
      costFloorEdge: args.costFloorEdge,
      horizonMonths: args.horizonMonths ?? planExpiryMonths,
      halfLifeMonths: args.signalHalfLifeMonths,
    });
    // Decay findings DO influence the verdict, but only ever as an extra reason, which can
    // downgrade approve to conditional and never the reverse. The justification for letting
    // it count at all: it only ever fires on edge numbers the caller supplied, and "this
    // trade does not cover its own execution cost over the horizon it is held for" is a
    // substantive objection, not a stylistic note. It cannot fire on the default
    // calibration alone, so a modelled half-life never gates a plan by itself.
    warnings.push(...decay.warnings);

    const { verdict, riskTier } = resolveVerifyVerdict({
      hasError: Boolean(result.error),
      approved,
      reasonCount: warnings.length,
    });

    const baseSummary =
      result.reason ??
      result.error ??
      (routingConflict ? "Routing-policy conflict — see warnings." : "Verify complete.");

    return {
      planId: args.planId,
      verdict,
      riskTier,
      constitutionViolations: warnings as unknown[],
      recommendation:
        verdict === "approve"
          ? "auto_approve"
          : verdict === "conditional"
            ? "prompt_user"
            : "block",
      summary: decay.ran ? baseSummary : `${baseSummary} ${decay.note}`,
      decay: {
        ran: decay.ran,
        missingInputs: [...decay.missingInputs],
        halfLifeMonths: decay.halfLifeMonths,
        calibration: decay.calibration,
        horizonMonths: decay.horizonMonths,
        monthsUntilBelowCostFloor: decay.monthsUntilBelowCostFloor,
        alreadyBelowCostFloor: decay.alreadyBelowCostFloor,
        belowFloorWithinHorizon: decay.belowFloorWithinHorizon,
        note: decay.note,
      },
    };
  },
});

// ============================================================================
// approve_plan
// ============================================================================

export const approvePlanTool = createTool({
  id: "approve_plan",
  description: [
    "Approve a Plan for execution. Transitions Plan state DRAFT → APPROVED.",
    "Required: rationale (≥10 chars) explaining WHY the operator approved",
    "this particular Plan, especially when verify_plan returned conditional",
    "or reject (override path — operator takes responsibility).",
    "",
    "When approving despite a non-auto-approve verify_plan verdict, this",
    "tool ALSO writes a RULE_OVERRIDE audit event for adherence reporting.",
  ].join("\n"),
  inputSchema: z.object({
    planId: z.string(),
    rationale: z.string().min(10),
    overrideVerifyVerdict: z
      .boolean()
      .optional()
      .describe("Set true when approving despite verify_plan returning conditional/reject."),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    planId: z.string(),
    auditId: z.string().optional(),
    overrideRecorded: z.boolean().optional(),
    error: z.string().optional(),
  }),
  execute: async (
    args: { planId: string; rationale: string; overrideVerifyVerdict?: boolean },
    execContext?: MastraExecutionContext,
  ) => {
    try {
      const result = (await (implApprovePlan.execute as any)(
        { planId: args.planId },
        execContext,
      )) as { success?: boolean; error?: string };

      if (args.overrideVerifyVerdict) {
        auditLog.record(
          "operator",
          "RULE_OVERRIDE" as Parameters<typeof auditLog.record>[1],
          { planId: args.planId, scope: "verify_plan", rationale: args.rationale },
          "SUCCESS",
          { resultDetails: `Override approve_plan: ${args.rationale}`, planId: args.planId },
        );
      }

      return {
        success: Boolean(result.success ?? !result.error),
        planId: args.planId,
        overrideRecorded: args.overrideVerifyVerdict ?? false,
        error: result.error,
      };
    } catch (err) {
      return {
        success: false,
        planId: args.planId,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});

// ============================================================================
// execute_plan
// ============================================================================

export const executePlanTool = createTool({
  id: "execute_plan",
  description: [
    "Execute an APPROVED Plan: dispatch Executor which places the actual",
    "venue-specific orders (place_market_order, place_limit_order,",
    "place_bracket_order, etc.).",
    "",
    "Audit log captures the full Plan → Verify → Approve → Execute chain",
    "for provenance.",
    "",
    "Plan must be in APPROVED state. Calling on a DRAFT plan returns an error.",
  ].join("\n"),
  inputSchema: z.object({
    planId: z.string(),
    rationale: z
      .string()
      .min(10)
      .describe(
        "One-sentence reason this execution is correct right now (e.g. 'User confirmed plan, BTC broke entry trigger at 100050').",
      ),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    planId: z.string(),
    orders: z.array(z.unknown()).optional(),
    // Write-back triage: categorizes the placed orders so the model is handed
    // "here's what changed, and here's the part you probably got wrong."
    triage: z
      .object({
        summary: z.string(),
        clean: z.array(z.unknown()),
        needsReview: z.array(z.unknown()),
        mustFix: z.array(z.unknown()),
      })
      .optional(),
    executionResult: z.unknown().optional(),
    error: z.string().optional(),
  }),
  execute: async (
    args: { planId: string; rationale: string },
    execContext?: MastraExecutionContext,
  ) => {
    try {
      const result = (await (implExecutePlan.execute as any)(
        { planId: args.planId, rationale: args.rationale },
        execContext,
      )) as {
        success?: boolean;
        error?: string;
        orders?: unknown[];
      };
      const orders = result.orders ?? [];
      return {
        success: Boolean(result.success ?? !result.error),
        planId: args.planId,
        orders,
        triage: triageExecution(orders),
        executionResult: result,
        error: result.error,
      };
    } catch (err) {
      return {
        success: false,
        planId: args.planId,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});

// ============================================================================
// cancel
// ============================================================================

export const cancelTool = createTool({
  id: "cancel",
  description: [
    "Cancel orders or close positions. One tool for both — pick via target.",
    "",
    "target values:",
    "  - 'order'        — cancel a specific open order by ID (requires id + symbol)",
    "  - 'all_orders'   — cancel ALL open orders for symbol (emergency)",
    "  - 'position'     — close a specific trade/position (market exit, requires tradeId in id)",
    "  - 'partial'      — partial position close (specify percentPct + tradeId in id)",
    "",
    "Required: reason (≥10 chars) for audit trail.",
  ].join("\n"),
  inputSchema: z
    .object({
      target: z.enum(["order", "all_orders", "position", "partial"]),
      id: z.string().optional().describe("Order or trade ID for single-target operations."),
      symbol: z.string().optional().describe("Required for 'order' and 'all_orders' targets."),
      percentPct: z
        .number()
        .min(1)
        .max(99)
        .optional()
        .describe("Percent to close for 'partial' target."),
      reason: z.string().min(10),
    })
    .refine((v) => v.target !== "all_orders" || typeof v.symbol === "string", {
      message: "`symbol` is required when target='all_orders'.",
      path: ["symbol"],
    })
    .refine(
      (v) => v.target !== "order" || (typeof v.id === "string" && typeof v.symbol === "string"),
      { message: "`id` and `symbol` are both required when target='order'.", path: ["id"] },
    )
    .refine(
      (v) => (v.target !== "position" && v.target !== "partial") || typeof v.id === "string",
      { message: "`id` (tradeId) is required when target='position' or 'partial'.", path: ["id"] },
    )
    .refine((v) => v.target !== "partial" || typeof v.percentPct === "number", {
      message: "`percentPct` is required when target='partial'.",
      path: ["percentPct"],
    }),
  outputSchema: z.object({
    success: z.boolean(),
    target: z.string(),
    cancelled: z.array(z.unknown()).optional(),
    error: z.string().optional(),
  }),
  execute: async (
    args: {
      target: "order" | "all_orders" | "position" | "partial";
      id?: string;
      symbol?: string;
      percentPct?: number;
      reason: string;
    },
    execContext?: MastraExecutionContext,
  ) => {
    const ctx = getGordonContext(execContext);
    try {
      switch (args.target) {
        case "order": {
          if (!ctx?.exchange)
            return { success: false, target: args.target, error: "No exchange connected." };
          if (!args.id || !args.symbol) {
            return {
              success: false,
              target: args.target,
              error: "Both `id` and `symbol` are required for target='order'.",
            };
          }
          const consent = requireLiveConsent({ sandboxActive: ctx.exchange.isSandbox ?? false });
          if (!consent.ok) {
            return { success: false, target: args.target, error: consent.reason };
          }
          await ctx.exchange.cancelOrder(args.symbol, args.id);
          auditLog.record(
            "operator",
            "CANCEL_ORDER" as Parameters<typeof auditLog.record>[1],
            { orderId: args.id, symbol: args.symbol, reason: args.reason },
            "SUCCESS",
            { resultDetails: args.reason },
          );
          return {
            success: true,
            target: "order",
            cancelled: [{ orderId: args.id, symbol: args.symbol }],
          };
        }
        case "all_orders": {
          if (!ctx?.exchange)
            return { success: false, target: args.target, error: "No exchange connected." };
          if (!args.symbol) {
            return {
              success: false,
              target: args.target,
              error: "`symbol` is required for target='all_orders'.",
            };
          }
          const consent = requireLiveConsent({ sandboxActive: ctx.exchange.isSandbox ?? false });
          if (!consent.ok) {
            return { success: false, target: args.target, error: consent.reason };
          }
          const cancelled = await ctx.exchange.cancelAllOrders(args.symbol);
          auditLog.record(
            "operator",
            "CANCEL_ALL_ORDERS" as Parameters<typeof auditLog.record>[1],
            { symbol: args.symbol, reason: args.reason, count: cancelled.length },
            "SUCCESS",
            { resultDetails: args.reason },
          );
          return { success: true, target: "all_orders", cancelled };
        }
        case "position": {
          if (!args.id)
            return { success: false, target: args.target, error: "`id` (tradeId) required." };
          const r = (await (implCloseTrade.execute as any)(
            { tradeId: args.id, reason: "MANUAL" },
            execContext,
          )) as { success?: boolean; error?: string; pnl?: number };
          return {
            success: Boolean(r.success),
            target: "position",
            cancelled: r.success ? [{ tradeId: args.id, pnl: r.pnl }] : [],
            error: r.error,
          };
        }
        case "partial": {
          if (!args.id)
            return { success: false, target: args.target, error: "`id` (tradeId) required." };
          if (!args.percentPct)
            return {
              success: false,
              target: args.target,
              error: "`percentPct` required for partial close.",
            };
          const r = (await (implClosePartial.execute as any)(
            { tradeId: args.id, percentage: args.percentPct / 100, reason: "MANUAL" },
            execContext,
          )) as { success?: boolean; error?: string };
          return {
            success: Boolean(r.success),
            target: "partial",
            cancelled: r.success ? [{ tradeId: args.id, percent: args.percentPct }] : [],
            error: r.error,
          };
        }
      }
    } catch (err) {
      return {
        success: false,
        target: args.target,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});

// ============================================================================
// backtest
// ============================================================================

export const backtestTool = createTool({
  id: "backtest",
  description: [
    "Run a backtest on a strategy spec. Returns key metrics (Sharpe, Sortino,",
    "max drawdown, win rate, profit factor).",
    "",
    "Two ways to bound the window — pick one:",
    "  - Calendar: pass startDate + endDate as ISO strings (e.g. '2024-01-01').",
    "    Preserves exact calendar alignment, useful for regime-specific or",
    "    walk-forward windows tied to real dates.",
    "  - Day-count: pass `days` (default 90). Simpler, but loses calendar",
    "    fidelity (e.g. can't isolate Q1-2024 cleanly).",
    "",
    "Calendar args take precedence when both are present.",
    "",
    "This is the ATOMIC backtest primitive — for comparison across strategies,",
    "parameter optimization, regime-conditional analysis, use the",
    "`backtest-validate` skill which composes multiple backtest calls.",
    "",
    "Reproducibility (ArcticDB-inspired snapshots):",
    "",
    "Every run is recorded as a snapshot with the inputs (strategy,",
    "symbol, timeframe, window, params) + result + an inputs hash. The",
    "returned `runId` is the durable handle.",
    "",
    "  - `replayRunId`: re-run with the SAME inputs as a prior snapshot",
    "    and compare against the stored result. Drift in Sharpe / win",
    "    rate / trade count surfaces either a venue restatement (data",
    "    changed under us) or a strategy-code regression. Output adds a",
    "    `drift` block when this is set.",
    "  - `comparedToRunId`: take the prior run's inputs AS-IS but apply",
    "    CURRENT params on top. Use to isolate parameter-tuning effects",
    "    from data effects.",
    "",
    "Signal decay: every run returns a `decay` block comparing the window length",
    "against the signal's half-life. When the window is longer than the half-life,",
    "the metrics average a period in which the edge half-died and the summary leads",
    "with the overstatement factor. The default half-life is a model calibration,",
    "not a measurement of this strategy. Override with `signalHalfLifeMonths`.",
  ].join("\n"),
  inputSchema: z.object({
    strategyId: z.string().describe("Strategy slot ID or playbook name (e.g. 'support_bounce')."),
    symbol: z.string(),
    timeframe: z.enum(["15m", "30m", "1h", "4h", "1d"]).optional(),
    startDate: z.string().optional().describe("ISO date — supersedes `days` when provided."),
    endDate: z.string().optional(),
    days: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Lookback days when start/end omitted. Default 90."),
    initialCapitalUsd: z.number().positive().optional().describe("Default 10000."),
    market: z.enum(["auto", "crypto", "stocks"]).optional().describe("Default 'auto'."),
    replayRunId: z
      .string()
      .optional()
      .describe(
        "Re-run an earlier snapshot. All other input fields are overridden by the stored snapshot's inputs; only the result is recomputed. Drift detection runs automatically.",
      ),
    comparedToRunId: z
      .string()
      .optional()
      .describe(
        "Inherit window + strategyId + symbol from this snapshot, but use the CURRENT params from this call. Use to A/B parameter changes against a frozen data window.",
      ),
    signalHalfLifeMonths: z
      .number()
      .positive()
      .optional()
      .describe(
        "Override the signal half-life used for the decay-validity check. The default is a model calibration, not a measurement of this strategy.",
      ),
    liveHorizonMonths: z
      .number()
      .positive()
      .optional()
      .describe(
        "How long the strategy is intended to be traded live, for the decay-validity check. Default 0.",
      ),
  }),
  outputSchema: z.object({
    runId: z.string(),
    inputsHash: z.string(),
    metrics: z.unknown(),
    analysis: z.unknown().optional(),
    verdict: z.unknown().optional(),
    equityCurve: z.array(z.number()).optional(),
    trades: z.array(z.unknown()).optional(),
    summary: z.string(),
    drift: z
      .object({
        hasDrift: z.boolean(),
        deltas: z.record(z.string(), z.union([z.number(), z.null()])),
        interpretation: z.string(),
      })
      .optional(),
    decay: z
      .object({
        halfLifeMonths: z.number(),
        calibration: z.string(),
        backtestWindowMonths: z.number(),
        halfLivesInWindow: z.number(),
        measuresDecayedAverage: z.boolean(),
        overstatementFactor: z.number().nullable(),
        windowAverageEdgeFraction: z.number(),
        edgeAtWindowEnd: z.number(),
        warnings: z.array(z.string()),
      })
      .optional(),
  }),
  execute: async (
    args: {
      strategyId: string;
      symbol: string;
      timeframe?: string;
      startDate?: string;
      endDate?: string;
      days?: number;
      initialCapitalUsd?: number;
      market?: "auto" | "crypto" | "stocks";
      replayRunId?: string;
      comparedToRunId?: string;
      signalHalfLifeMonths?: number;
      liveHorizonMonths?: number;
    },
    execContext?: MastraExecutionContext,
  ) => {
    // If a prior runId is referenced, pull its frozen inputs. replayRunId
    // overrides the whole input bundle; comparedToRunId only inherits
    // window + strategy + symbol (params come from THIS call).
    let strategyId = args.strategyId;
    let symbol = args.symbol;
    let timeframe = args.timeframe ?? "4h";
    let startDate = args.startDate;
    let endDate = args.endDate;
    let days = args.days;
    let storedSnapshotResult: unknown | null = null;

    if (args.replayRunId) {
      const prior = getBacktestRun(args.replayRunId);
      if (!prior) {
        return {
          runId: args.replayRunId,
          inputsHash: "",
          metrics: { error: `replayRunId not found: ${args.replayRunId}` },
          summary: `replayRunId not found: ${args.replayRunId}`,
        };
      }
      strategyId = prior.strategyId;
      symbol = prior.symbol;
      timeframe = prior.timeframe;
      startDate = new Date(prior.fromTs).toISOString();
      endDate = new Date(prior.toTs).toISOString();
      days = undefined;
      storedSnapshotResult = prior.result;
    } else if (args.comparedToRunId) {
      const prior = getBacktestRun(args.comparedToRunId);
      if (!prior) {
        return {
          runId: args.comparedToRunId,
          inputsHash: "",
          metrics: { error: `comparedToRunId not found: ${args.comparedToRunId}` },
          summary: `comparedToRunId not found: ${args.comparedToRunId}`,
        };
      }
      symbol = prior.symbol;
      timeframe = prior.timeframe;
      startDate = new Date(prior.fromTs).toISOString();
      endDate = new Date(prior.toTs).toISOString();
      days = undefined;
      storedSnapshotResult = prior.result;
    }

    // Calendar dates take precedence over day count when both could resolve.
    const hasCalendarRange = Boolean(startDate && endDate);
    const initialCapital = args.initialCapitalUsd ?? 10000;
    const commission = 0.001;
    const result = (await (implRunBacktest.execute as any)(
      {
        symbol,
        strategyId,
        market: args.market ?? "auto",
        timeframe,
        days: hasCalendarRange ? undefined : (days ?? 90),
        ...(hasCalendarRange && {
          startTime: new Date(startDate as string).getTime(),
          endTime: new Date(endDate as string).getTime(),
        }),
        initialCapital,
        commission,
      },
      execContext,
    )) as {
      result?: unknown;
      summary?: string;
      formattedSummary?: string;
      error?: string;
    };
    const backtestResult = isBacktestResult(result.result) ? result.result : null;

    // Resolve the actual ms-epoch window used for the snapshot.
    const fromTs = hasCalendarRange
      ? new Date(startDate as string).getTime()
      : Date.now() - (days ?? 90) * 24 * 60 * 60 * 1000;
    const toTs = hasCalendarRange ? new Date(endDate as string).getTime() : Date.now();

    // Record the snapshot before returning. Even error results are
    // recorded — surfaces "this strategy errors on this data" as part
    // of audit trail. Failures here don't surface to caller.
    let runId = "";
    let inputsHash = "";
    try {
      const snap = recordBacktestRun({
        strategyId,
        symbol,
        timeframe,
        fromTs,
        toTs,
        params: { initialCapital, commission, market: args.market ?? "auto" },
        result: result.result ?? { error: result.error },
      });
      runId = snap.runId;
      inputsHash = snap.inputsHash;
    } catch {
      // Snapshot write failure is non-fatal — return the result.
    }

    // Decay validity of the window that was actually measured. A window longer than the
    // edge's half-life makes the reported metrics an average over a period in which the
    // signal half-died, so it leads the summary rather than trailing it.
    const decayReport = assessBacktestWindowDecay({
      backtestWindowMonths: Math.max(0, toTs - fromTs) / MONTH_MS,
      liveHorizonMonths: args.liveHorizonMonths,
      halfLifeMonths: args.signalHalfLifeMonths,
    });
    const baseSummary =
      result.summary ?? result.formattedSummary ?? result.error ?? "Backtest complete.";

    const out: {
      runId: string;
      inputsHash: string;
      metrics: unknown;
      analysis?: unknown;
      verdict?: unknown;
      summary: string;
      drift?: {
        hasDrift: boolean;
        deltas: Record<string, number | null>;
        interpretation: string;
      };
      decay?: {
        halfLifeMonths: number;
        calibration: string;
        backtestWindowMonths: number;
        halfLivesInWindow: number;
        measuresDecayedAverage: boolean;
        overstatementFactor: number | null;
        windowAverageEdgeFraction: number;
        edgeAtWindowEnd: number;
        warnings: string[];
      };
    } = {
      runId,
      inputsHash,
      metrics: result.result ?? {},
      summary: decayReport.headline ? `${decayReport.headline}\n\n${baseSummary}` : baseSummary,
      decay: {
        halfLifeMonths: decayReport.halfLifeMonths,
        calibration: decayReport.calibration,
        backtestWindowMonths: decayReport.backtestWindowMonths,
        halfLivesInWindow: decayReport.halfLivesInWindow,
        measuresDecayedAverage: decayReport.measuresDecayedAverage,
        overstatementFactor: Number.isFinite(decayReport.overstatementFactor)
          ? decayReport.overstatementFactor
          : null,
        windowAverageEdgeFraction: decayReport.windowAverageEdgeFraction,
        edgeAtWindowEnd: decayReport.edgeAtWindowEnd,
        warnings: [...decayReport.warnings],
      },
    };

    if (backtestResult) {
      out.analysis = analyzeBacktestResult(backtestResult);
      out.verdict = computeVerdict(
        backtestResult.metrics,
        undefined,
        hasCalendarRange ? undefined : (days ?? 90),
      );
    }

    if (storedSnapshotResult !== null) {
      const drift = detectDrift(storedSnapshotResult, result.result ?? {});
      out.drift = {
        hasDrift: drift.hasDrift,
        deltas: Object.fromEntries(Object.entries(drift.deltas).map(([k, v]) => [k, v ?? null])),
        interpretation: drift.interpretation,
      };
    }

    return out;
  },
});

function isBacktestResult(value: unknown): value is BacktestResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BacktestResult>;
  return Boolean(
    candidate.metrics && typeof candidate.metrics === "object" && Array.isArray(candidate.trades),
  );
}

export const planTools = {
  create_plan: createPlanTool,
  verify_plan: verifyPlanTool,
  approve_plan: approvePlanTool,
  execute_plan: executePlanTool,
  cancel: cancelTool,
  backtest: backtestTool,
};
