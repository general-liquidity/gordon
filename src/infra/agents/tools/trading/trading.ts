/**
 * Trading Tools (Mastra Format)
 * Tools for creating, managing, and executing trading plans
 *
 * Migrated from OpenAI Agents SDK format to Mastra format.
 * Key changes:
 * - tool() -> createTool()
 * - name -> id
 * - parameters -> inputSchema
 * - Context access via execContext.requestContext.get() using getGordonContext helper
 * - needsApproval removed (handle via guardrails in Mastra)
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { generatePlan } from "../../../../core/pipeline/planner.ts";
import { executePlan, closeTrade, closePartialPosition } from "../../../../core/pipeline/executor.ts";
import { runHooks, registerHook } from "../../../hooks/engine.ts";
import { createPriceDeviationHookDefinition } from "../../../hooks/priceDeviationHook.ts";

// Register the fat-finger / price-deviation guard once at module load. It runs
// on PreOrderPlacement and no-ops unless a LIMIT order carries both a limitPrice
// and a live referencePrice (populated below); a >threshold deviation in the
// dangerous direction (buy above / sell below the mark) blocks the order.
registerHook(createPriceDeviationHookDefinition());
import { analyze } from "../../../../core/pipeline/analyzer.ts";
import { calculateGridLevels } from "../../../../core/orders/grid-calculator.ts";
import {
  getTrailingStopTracker,
  type TrailingStopConfig,
} from "../../../../core/orders/trailing-stop.ts";
import { PlanSchema } from "../../../../types/plan.ts";
import { TradeSchema } from "../../../../types/trade.ts";
import { emitEvent } from "../../../../events/index.ts";
import { recordStructuredObservation } from "../../../platform/observability/index.ts";
import { appendActionLogEntry } from "../../../action-log/index.ts";
import { appendExecutionRecordFresh, isTradeLedgerEnabled, readExecutionRecords, getExecutionRecord, executionRecordToPayload } from "../../../safety/tradeLedger.ts";
import { isExecutionAllowed, isKillSwitchesEnabled, killSwitchesToPayload } from "../../../safety/killSwitches.ts";
import { loadConfigBundle, saveResolvedConfig } from "../../../storage/config/config.ts";
import { listPlans, getPlan, updatePlan, createPlan } from "../../../storage/entities/plans.ts";
import { listTrades, getTrade } from "../../../storage/entities/trades.ts";
import { getGordonContext, normalizeSymbol, validateToolOutput, type MastraExecutionContext } from "../types.ts";
import { checkTradingPermission } from "../runtime/permissionHelpers.ts";
import { setSandboxOverride } from "../../../runtime/sandboxOverride.ts";
import { ExchangeFactory } from "../../../exchange/index.ts";
import { BrokerFactory } from "../../../broker/factory.ts";
import { reflectOnPlan, formatReflectionSummary } from "../../cognition/reflection.ts";
import { getTradingService } from "../../../../services/trading.service.ts";
import {
  recordUserThesis,
  requiresUserThesis,
  getUserThesis,
  computeThesisDivergence,
  verifyAcksFromWarnings,
  checkUniverse,
  gateCoherence,
  gateAgainstMandate,
  inferAssetClass,
} from "../../../safety/index.ts";
import { classifyBlockedStatus } from "../../../observability/blockedClassification.ts";

// ============================================================================
// Error Messages
// ============================================================================

const errors = {
  noExchange: { error: "Exchange client not connected. Please configure an active exchange." },
  noLLM: { error: "LLM client not connected." },
  noContext: { error: "Context not available." },
} as const;

// ============================================================================
// Helper Functions
// ============================================================================

const getActiveTrades = () => listTrades({ status: "OPEN" });

// ============================================================================
// Output Schemas (extracted for validation reuse)
// ============================================================================

const createPlanOutputSchema = z.object({
  success: z.boolean().optional(),
  plan: PlanSchema.optional(),
  summary: z.string().optional(),
  error: z.string().optional(),
  reflection: z.object({
    isValid: z.boolean(),
    issues: z.array(z.string()),
    suggestions: z.array(z.string()),
    confidence: z.number(),
  }).optional(),
  warnings: z.array(z.string()).optional(),
});

const executePlanOutputSchema = z.object({
  success: z.boolean(),
  trade: TradeSchema.optional(),
  orderCount: z.number().optional(),
  error: z.string().optional(),
});

const closeTradeOutputSchema = z.object({
  success: z.boolean(),
  pnl: z.number().optional(),
  error: z.string().optional(),
});

const listPlansOutputSchema = z.object({
  count: z.number(),
  plans: z.array(z.object({
    id: z.string(),
    symbol: z.string(),
    strategy: z.string(),
    status: z.string(),
    allocation: z.number(),
    entry: z.union([z.number(), z.string()]),
    stopLoss: z.number(),
    createdAt: z.string(),
  })),
});

const approvePlanOutputSchema = z.object({
  success: z.boolean(),
  planId: z.string().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
});

const setPermissionModeOutputSchema = z.object({
  success: z.boolean(),
  permissionMode: z.enum(["auto", "ask", "strict", "paper", "observe", "plan"]).optional(),
  previousMode: z.enum(["auto", "ask", "strict", "paper", "observe", "plan"]).optional(),
  message: z.string(),
  error: z.string().optional(),
});

const createGridPlanOutputSchema = z.object({
  success: z.boolean().optional(),
  planPreview: z.object({
    symbol: z.string(),
    strategy: z.string(),
    grid: z.object({
      levels: z.array(z.object({
        price: z.number(),
        percentOfAllocation: z.number(),
      })),
      distribution: z.enum(["pyramid", "equal"]),
      priceRange: z.object({
        high: z.number(),
        low: z.number(),
      }),
    }),
    stopLoss: z.number(),
    takeProfits: z.array(z.number()),
    allocation: z.object({
      amount: z.number(),
      percentOfPortfolio: z.number(),
    }),
    weightedEntry: z.number(),
  }).optional(),
  message: z.string().optional(),
  error: z.string().optional(),
  reflection: z.object({
    isValid: z.boolean(),
    issues: z.array(z.string()),
    suggestions: z.array(z.string()),
    confidence: z.number(),
  }).optional(),
  warnings: z.array(z.string()).optional(),
});

const setTrailingStopOutputSchema = z.object({
  success: z.boolean(),
  trailingStop: z.object({
    id: z.string(),
    tradeId: z.string(),
    symbol: z.string(),
    type: z.enum(["percentage", "atr"]),
    trailDistance: z.number(),
    activationPrice: z.number().optional(),
    isActive: z.boolean(),
    currentStopPrice: z.number(),
    highestPrice: z.number(),
  }).optional(),
  message: z.string().optional(),
  error: z.string().optional(),
});

const updateTrailingStopOutputSchema = z.object({
  success: z.boolean(),
  updated: z.boolean().optional(),
  previousStopPrice: z.number().optional(),
  newStopPrice: z.number().optional(),
  highestPrice: z.number().optional(),
  shouldTrigger: z.boolean().optional(),
  currentPrice: z.number().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
});

const closePartialPositionOutputSchema = z.object({
  success: z.boolean(),
  closedQuantity: z.number().optional(),
  remainingQuantity: z.number().optional(),
  exitPrice: z.number().optional(),
  pnl: z.number().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
});

// ============================================================================
// Plan Generation Tool
// ============================================================================

export const createPlanTool = createTool({
  id: "create_plan",
  description:
    "Create a trading plan for a specific coin based on analysis. " +
    "Use this when the user wants to trade a coin, e.g., 'buy BTC' or 'create plan for ETH'",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair symbol (e.g., 'BTCUSDT')"),
    riskLevel: z
      .enum(["low", "medium", "high"])
      .default("medium")
      .describe("Risk tolerance"),
    allocationPercent: z
      .number()
      .min(0.01)
      .max(0.5)
      .default(0.1)
      .describe("Percent of portfolio to allocate"),
    strategyId: z
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
      ])
      .optional()
      .describe("Specific strategy to use (auto-detected if not specified)"),
  }),
  outputSchema: createPlanOutputSchema,
  execute: async ({ symbol, riskLevel, allocationPercent, strategyId }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange || !ctx?.llm) {
      return validateToolOutput(createPlanOutputSchema, { error: "Exchange or LLM client not connected." }, { toolName: "create_plan" });
    }

    // Normalize symbol
    const normalizedSymbol = normalizeSymbol(symbol);

    // Get detailed analysis first
    const analysis = await analyze(ctx.exchange, normalizedSymbol, {
      timeframes: ["1h", "4h", "1d"],
    });

    // Calculate allocation
    const maxAllocationPercent = allocationPercent ?? ctx.config.preferences.maxAllocationPerTrade;
    const maxAllocation = ctx.portfolioValue * maxAllocationPercent;

    // Generate plan using AI
    const plan = await generatePlan(ctx.llm, {
      analysis,
      preferences: {
        riskLevel: riskLevel ?? "medium",
        maxAllocation,
        cashReservePercent: ctx.config.preferences.cashReservePercent,
      },
      portfolioValue: ctx.portfolioValue,
    });

    let savedPlan = plan;
    try {
      savedPlan = await getTradingService().createPlan(plan);
    } catch {
      savedPlan = createPlan({
        symbol: plan.symbol,
        direction: plan.direction,
        strategy: plan.strategy,
        allocation: plan.allocation,
        entry: plan.entry,
        dca: plan.dca,
        grid: plan.grid,
        stopLoss: plan.stopLoss,
        takeProfit: plan.takeProfit,
        reasoning: plan.reasoning,
        status: plan.status,
        expiresAt: plan.expiresAt,
      });
    }

    // Perform reflection on the generated plan
    const reflectionResult = await reflectOnPlan(savedPlan, ctx, { skipLLM: false });

    // Build result with reflection information
    const baseSummary = `Created ${savedPlan.strategy} plan (${savedPlan.id}) for ${savedPlan.symbol}: Entry at ${savedPlan.entry.price ?? "market"}, Stop at ${savedPlan.stopLoss.price}, ${savedPlan.takeProfit.length} TP levels. Allocation: ${savedPlan.allocation.amount} USDT (${(savedPlan.allocation.percentOfPortfolio * 100).toFixed(1)}%)`;

    const reflectionSummary = formatReflectionSummary(reflectionResult);

    const result = {
      success: reflectionResult.isValid,
      plan: savedPlan,
      summary: reflectionResult.isValid
        ? `${baseSummary}\n\nReflection: ${reflectionSummary}`
        : `${baseSummary}\n\nWARNING - ${reflectionSummary}`,
      reflection: {
        isValid: reflectionResult.isValid,
        issues: reflectionResult.issues,
        suggestions: reflectionResult.suggestions,
        confidence: reflectionResult.confidence,
      },
      warnings: reflectionResult.issues.length > 0 ? reflectionResult.issues : undefined,
    };

    return validateToolOutput(createPlanOutputSchema, result, { toolName: "create_plan" });
  },
});

// ============================================================================
// Plan Execution Tool
// Note: needsApproval removed - handle via guardrails in Mastra
// ============================================================================

export const executePlanTool = createTool({
  id: "execute_plan",
  description:
    "Execute an approved trading plan by placing orders on the active exchange. " +
    "IMPORTANT: This places real orders with real money. Only use after user confirms the plan. " +
    "You MUST provide a one-sentence `rationale` (>=10 chars) stating why this execution is correct right now — " +
    "the rationale is recorded in the audit log for post-hoc review.",
  inputSchema: z.object({
    planId: z.string().describe("The ID of the plan to execute"),
    rationale: z
      .string()
      .min(10, {
        message:
          "rationale must be at least 10 characters. Articulate the SPECIFIC reason this execution is correct right now — not 'user said so' but the concrete trigger (e.g. 'User confirmed plan, BTC broke entry trigger at 100050, no regime conflict'). If you cannot articulate why, do not execute — call report_blocked instead.",
      })
      .describe(
        "One-sentence reason this execution is correct right now (e.g. 'User confirmed plan, BTC broke entry trigger at 100050, no regime conflict')",
      ),
    acknowledgedRisks: z
      .array(z.string())
      .optional()
      .describe(
        "When GORDON_RISK_ACK is enabled and the risk gate raises warnings, provide one substantive (>=20 chars) acknowledgement per warning explaining why each specific risk is acceptable. Anti-rubber-stamp gate.",
      ),
  }),
  outputSchema: executePlanOutputSchema,
  execute: async ({ planId, rationale, acknowledgedRisks }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      recordStructuredObservation({
        eventType: "execution.blocked",
        workflow: "execution",
        source: "agent_tool",
        component: "execute_plan",
        toolName: "execute_plan",
        outcome: "failure",
        status: "exchange_missing",
        controllability: classifyBlockedStatus("exchange_missing"),
        planId,
        reason: errors.noExchange.error,
        details: { rationale },
      });
      return validateToolOutput(executePlanOutputSchema, { ...errors.noExchange, success: false }, { toolName: "execute_plan" });
    }

    const plan = getPlan(planId);
    if (!plan) {
      recordStructuredObservation({
        eventType: "execution.blocked",
        workflow: "execution",
        source: "agent_tool",
        component: "execute_plan",
        toolName: "execute_plan",
        outcome: "failure",
        status: "plan_missing",
        controllability: classifyBlockedStatus("plan_missing"),
        planId,
        reason: `Plan not found: ${planId}`,
        details: { rationale },
      });
      return validateToolOutput(executePlanOutputSchema, { success: false, error: `Plan not found: ${planId}` }, { toolName: "execute_plan" });
    }

    // Plan-state gate: a plan must be APPROVED to execute. This enforces the
    // documented contract (approve_plan first, capturing rationale + audit) AND
    // makes re-execution structurally impossible — a successful execution
    // transitions the plan to EXECUTING, so EXECUTING/CLOSED/CANCELLED are
    // rejected here, preventing a duplicate position from a re-issued call.
    // (A failed attempt leaves the plan APPROVED, so a legitimate retry is
    // still allowed; entry/stop/tp placement is idempotent, see executor.ts.)
    if (plan.status !== "APPROVED") {
      recordStructuredObservation({
        eventType: "execution.blocked",
        workflow: "execution",
        source: "agent_tool",
        component: "execute_plan",
        toolName: "execute_plan",
        outcome: "failure",
        status: "invalid_plan_status",
        controllability: classifyBlockedStatus("invalid_plan_status"),
        planId,
        reason: `Plan ${planId} is ${plan.status}, not APPROVED.`,
        details: { rationale, currentStatus: plan.status },
      });
      const hint = plan.status === "DRAFT"
        ? "Call approve_plan first."
        : "A plan that is already EXECUTING/CLOSED/CANCELLED cannot be re-executed.";
      return validateToolOutput(executePlanOutputSchema, { success: false, error: `Plan ${planId} is in ${plan.status} status, not APPROVED. ${hint}` }, { toolName: "execute_plan" });
    }

    if (isKillSwitchesEnabled()) {
      const killSwitchDecision = isExecutionAllowed({
        strategyId: plan.strategy,
        traderId: ctx.userId,
        instrument: plan.symbol,
        venue: ctx.exchange.exchangeId,
      });
      if (!killSwitchDecision.allowed) {
        recordStructuredObservation({
          eventType: "execution.blocked",
          workflow: "execution",
          source: "agent_tool",
          component: "execute_plan",
          toolName: "execute_plan",
          outcome: "failure",
          status: "kill_switch_tripped",
          controllability: classifyBlockedStatus("kill_switch_tripped"),
          planId,
          symbol: plan.symbol,
          reason: killSwitchDecision.reason,
          details: {
            rationale,
            ...killSwitchesToPayload(killSwitchDecision),
          },
        });
        return validateToolOutput(executePlanOutputSchema, {
          success: false,
          error: `${killSwitchDecision.reason}. Reset the relevant kill switch before executing this plan.`,
        }, { toolName: "execute_plan" });
      }
    }

    recordStructuredObservation({
      eventType: "execution.rationale_recorded",
      workflow: "execution",
      source: "agent_tool",
      component: "execute_plan",
      toolName: "execute_plan",
      outcome: "info",
      planId,
      symbol: plan.symbol,
      details: { rationale },
    });

    // Explain-before-execute gate (GORDON_EXPLAIN_FIRST)
    const thesisReq = requiresUserThesis(planId);
    if (thesisReq.required) {
      recordStructuredObservation({
        eventType: "execution.blocked",
        workflow: "execution",
        source: "agent_tool",
        component: "execute_plan",
        toolName: "execute_plan",
        outcome: "failure",
        status: "explain_first_missing_thesis",
        controllability: classifyBlockedStatus("explain_first_missing_thesis"),
        planId,
        symbol: plan.symbol,
        reason: thesisReq.reason ?? "User thesis required",
      });
      return validateToolOutput(executePlanOutputSchema, {
        success: false,
        error: thesisReq.reason ?? "User thesis required before execution.",
      }, { toolName: "execute_plan" });
    }
    const thesis = getUserThesis(planId);
    if (thesis) {
      recordStructuredObservation({
        eventType: "execution.thesis_observed",
        workflow: "execution",
        source: "agent_tool",
        component: "execute_plan",
        toolName: "execute_plan",
        outcome: "info",
        planId,
        symbol: plan.symbol,
        details: {
          thesis: thesis.thesis,
          divergenceFromRationale: computeThesisDivergence(thesis.thesis, rationale),
        },
      });
    }

    // Anti-rot gates (artifact-rot defenses translated from k10s.dev's
    // "I'm going back to writing code by hand" — universe scope sentinel,
    // thesis coherence, per-strategy mandate). All inert without flags.
    const venue = ctx.exchange?.exchangeId;
    // Symbol-aware: on multi-asset venues (FX/metals/crypto side by side) the
    // symbol disambiguates the class where the venue can't (e.g. XAUUSD, EURUSD).
    const inferredAssetClass = inferAssetClass(venue, plan.symbol);

    // (a) Trading universe scope sentinel
    const universeResult = checkUniverse({
      symbol: plan.symbol,
      assetClass: inferredAssetClass !== "unknown" ? inferredAssetClass : undefined,
      venue,
    });
    if (!universeResult.allowed) {
      recordStructuredObservation({
        eventType: "execution.blocked",
        workflow: "execution",
        source: "agent_tool",
        component: "execute_plan",
        toolName: "execute_plan",
        outcome: "failure",
        status: "outside_trading_universe",
        controllability: classifyBlockedStatus("outside_trading_universe"),
        planId,
        symbol: plan.symbol,
        reason: universeResult.reason,
        details: { violations: universeResult.violations },
      });
      return validateToolOutput(executePlanOutputSchema, {
        success: false,
        error: universeResult.reason ?? "Plan outside declared trading universe.",
      }, { toolName: "execute_plan" });
    }

    // (b) Portfolio coherence with running thesis
    const coherenceResult = gateCoherence({
      direction: plan.direction,
      assetClass: inferredAssetClass !== "unknown" ? inferredAssetClass : undefined,
    });
    if (!coherenceResult.ok) {
      recordStructuredObservation({
        eventType: "execution.blocked",
        workflow: "execution",
        source: "agent_tool",
        component: "execute_plan",
        toolName: "execute_plan",
        outcome: "failure",
        status: "thesis_coherence_insufficient",
        controllability: classifyBlockedStatus("thesis_coherence_insufficient"),
        planId,
        symbol: plan.symbol,
        reason: coherenceResult.reason,
        details: {
          score: coherenceResult.score,
          threshold: coherenceResult.threshold,
          failures: coherenceResult.failures,
        },
      });
      return validateToolOutput(executePlanOutputSchema, {
        success: false,
        error: coherenceResult.reason ?? "Plan coherence below threshold.",
      }, { toolName: "execute_plan" });
    }

    // (c) Per-strategy mandate gate (uses current portfolio state for budget check)
    const mandateResult = gateAgainstMandate(
      {
        assetClass: inferredAssetClass !== "unknown" ? inferredAssetClass : undefined,
        venue,
        strategyTag: plan.strategy,
        proposedPositionPct: plan.allocation.percentOfPortfolio,
      },
      {
        // Budget approximations from live state; refined as positions
        // are tagged to mandates in future iterations.
        currentOpenPositions: getActiveTrades().length,
        currentAllocationPct: 0,
      },
    );
    if (!mandateResult.ok) {
      recordStructuredObservation({
        eventType: "execution.blocked",
        workflow: "execution",
        source: "agent_tool",
        component: "execute_plan",
        toolName: "execute_plan",
        outcome: "failure",
        status: "strategy_mandate_violation",
        controllability: classifyBlockedStatus("strategy_mandate_violation"),
        planId,
        symbol: plan.symbol,
        reason: mandateResult.reason,
        details: {
          mandateId: mandateResult.mandate?.id,
          violations: mandateResult.violations,
        },
      });
      return validateToolOutput(executePlanOutputSchema, {
        success: false,
        error: mandateResult.reason ?? "Plan violates strategy mandate.",
      }, { toolName: "execute_plan" });
    }

    // Permission mode gate: block execution for read-only / non-trading modes
    const mode = ctx.config.permissionMode;
    {
      const check = checkTradingPermission(mode, "execute", { sandboxActive: ctx.exchange?.isSandbox ?? ctx.broker?.isPaper });
      if (!check.allowed) {
        recordStructuredObservation({
          eventType: "execution.blocked",
          workflow: "execution",
          source: "agent_tool",
          component: "execute_plan",
          toolName: "execute_plan",
          outcome: "failure",
          status: `${mode}_permission_mode`,
          controllability: classifyBlockedStatus(`${mode}_permission_mode`),
          mode,
          planId,
          symbol: plan.symbol,
          reason: check.reason ?? `Cannot execute: permissionMode is '${mode}'.`,
        });
        return validateToolOutput(executePlanOutputSchema, {
          success: false,
          error: check.reason ?? `Cannot execute: permissionMode is '${mode}'.`,
        }, { toolName: "execute_plan" });
      }
    }

    // Risk gate: evaluate the plan's order against risk kernel
    try {
      const { evaluateOrderRisk } = await import("./risk-gate.ts");
      const riskResult = await evaluateOrderRisk(
        {
          symbol: plan.symbol,
          side: "BUY", // Plans are typically buy entries
          type: plan.entry.type === "market" ? "MARKET" : "LIMIT",
          quantity: plan.allocation.amount / (plan.entry.price || 1),
          price: plan.entry.price ?? undefined,
        },
        ctx,
        "executor"
      );
      if (!riskResult.approved) {
        recordStructuredObservation({
          eventType: "execution.blocked",
          workflow: "execution",
          source: "agent_tool",
          component: "execute_plan",
          toolName: "execute_plan",
          outcome: "failure",
          status: "risk_rejected",
          controllability: classifyBlockedStatus("risk_rejected"),
          mode: ctx.config.permissionMode,
          planId,
          symbol: plan.symbol,
          reason: riskResult.reason,
          details: {
            warnings: riskResult.warnings,
          },
        });
        return validateToolOutput(executePlanOutputSchema, {
          success: false,
          error: `Risk kernel rejected this trade: ${riskResult.reason}`,
        }, { toolName: "execute_plan" });
      }

      // Risk acknowledgement gate (GORDON_RISK_ACK)
      const ackResult = verifyAcksFromWarnings(
        acknowledgedRisks ?? [],
        riskResult.warnings,
      );
      if (!ackResult.ok) {
        recordStructuredObservation({
          eventType: "execution.blocked",
          workflow: "execution",
          source: "agent_tool",
          component: "execute_plan",
          toolName: "execute_plan",
          outcome: "failure",
          status: "risk_ack_insufficient",
          controllability: classifyBlockedStatus("risk_ack_insufficient"),
          mode: ctx.config.permissionMode,
          planId,
          symbol: plan.symbol,
          reason: ackResult.reason,
          details: {
            warnings: riskResult.warnings,
            providedAcks: acknowledgedRisks ?? [],
            missingAcks: ackResult.missing,
          },
        });
        return validateToolOutput(executePlanOutputSchema, {
          success: false,
          error: ackResult.reason ?? "Risk acknowledgement insufficient.",
        }, { toolName: "execute_plan" });
      }
    } catch (riskErr) {
      const message = riskErr instanceof Error ? riskErr.message : String(riskErr);
      recordStructuredObservation({
        eventType: "execution.blocked",
        workflow: "execution",
        source: "agent_tool",
        component: "execute_plan",
        toolName: "execute_plan",
        outcome: "failure",
        status: "risk_gate_failed",
        controllability: classifyBlockedStatus("risk_gate_failed"),
        mode: ctx.config.permissionMode,
        planId,
        symbol: plan.symbol,
        reason: message,
      });
      return validateToolOutput(
        executePlanOutputSchema,
        {
          success: false,
          error: `Risk gate evaluation failed: ${message}`,
        },
        { toolName: "execute_plan" },
      );
    }

    // Live mark for the fat-finger / price-deviation guard. Best-effort —
    // if it can't be fetched, the guard simply no-ops (allows).
    let referencePrice: number | undefined;
    try {
      referencePrice = await ctx.exchange?.getPrice(plan.symbol);
    } catch {
      referencePrice = undefined;
    }

    // PreOrderPlacement hook — can block or modify the order
    const preOrderHook = await runHooks("PreOrderPlacement", {
      symbol: plan.symbol,
      side: "buy" as const,
      quantity: plan.allocation.amount / (plan.entry.price || 1),
      orderType: plan.entry.type === "market" ? "MARKET" : "LIMIT",
      notionalUsd: plan.allocation.amount,
      exchangeId: ctx.exchange?.exchangeId,
      // Fat-finger guard inputs: only meaningful for LIMIT orders.
      ...(plan.entry.type !== "market" &&
        typeof plan.entry.price === "number" && { limitPrice: plan.entry.price }),
      ...(typeof referencePrice === "number" && { referencePrice }),
    });
    if (preOrderHook.action === "block") {
      return validateToolOutput(executePlanOutputSchema, {
        success: false,
        error: `PreOrderPlacement hook blocked: ${preOrderHook.reason}`,
      }, { toolName: "execute_plan" });
    }

    const result = await executePlan(ctx.exchange, plan, ctx.config, {
      totalValue: ctx.portfolioValue,
      availableCash: ctx.availableCash,
      openPositions: getActiveTrades().length,
    });

    // PostOrderPlacement hook — fires after execution regardless of success
    if (result.success && result.trade) {
      runHooks("PostOrderPlacement", {
        orderId: result.trade.id,
        symbol: result.trade.symbol,
        side: "buy" as const,
        status: "filled",
        filledQty: plan.allocation.amount / (plan.entry.price || 1),
        notionalUsd: plan.allocation.amount,
      }).catch(() => {}); // Fire-and-forget — don't block response
    }

    if (result.success && result.trade) {
      recordStructuredObservation({
        eventType: "execution.completed",
        workflow: "execution",
        source: "agent_tool",
        component: "execute_plan",
        toolName: "execute_plan",
        outcome: "success",
        status: "executed",
        mode: ctx.config.permissionMode,
        planId,
        tradeId: result.trade.id,
        symbol: result.trade.symbol,
        actionCount: result.orders.length,
      });
      // Bridge rationale + approval signal into the action log so ACE
      // Reflector can extract patterns from approved-execution events.
      // Wrapped: action-log writes go through SQLite and shouldn't break
      // execution if storage is misconfigured.
      try {
        appendActionLogEntry({
          entryType: "execution_result",
          title: `${result.trade.symbol} executed`,
          content: `Plan ${planId} executed cleanly on ${result.trade.symbol}. User rationale: ${rationale}`,
          payload: {
            planId,
            tradeId: result.trade.id,
            symbol: result.trade.symbol,
            rationale,
            orderCount: result.orders.length,
          },
        });
      } catch {
        // Non-critical — structured observation already captured this.
      }

      // Trade ledger append (GORDON_TRADE_LEDGER). Projection of successful
      // execute_plan outcomes into ~/.gordon/trade-ledger.jsonl for /history
      // navigation. State snapshots are placeholder-empty for now — a future
      // wire can capture pre/post account state via ctx.exchange.
      if (isTradeLedgerEnabled()) {
        try {
          const trade = result.trade;
          await appendExecutionRecordFresh({
            planId,
            symbol: trade.symbol,
            rationale,
            acknowledgedRisks,
            operations: [{
              action: "place_order" as const,
              symbol: trade.symbol,
              side: plan.direction === "long" ? "buy" as const : "sell" as const,
              qty: plan.entry?.price ? plan.allocation.amount / plan.entry.price : undefined,
              price: plan.entry?.price ?? undefined,
              metadata: { tradeId: trade.id, planId },
            }],
            results: [{
              operationIndex: 0,
              status: "filled" as const,
              brokerOrderId: trade.id,
            }],
          });
        } catch {
          // Non-critical — broker has canonical truth, ledger is local nav.
        }
      }

      return validateToolOutput(executePlanOutputSchema, {
        success: true,
        trade: result.trade,
        orderCount: result.orders.length,
      }, { toolName: "execute_plan" });
    }

    recordStructuredObservation({
      eventType: "execution.blocked",
      workflow: "execution",
      source: "agent_tool",
      component: "execute_plan",
      toolName: "execute_plan",
      outcome: "failure",
      status: "execution_failed",
      mode: ctx.config.permissionMode,
      planId,
      symbol: plan.symbol,
      reason: result.error,
    });
    return validateToolOutput(executePlanOutputSchema, {
      success: false,
      error: result.error,
    }, { toolName: "execute_plan" });
  },
});

// ============================================================================
// Close Trade Tool
// Note: needsApproval removed - handle via guardrails in Mastra
// ============================================================================

export const closeTradeTool = createTool({
  id: "close_trade",
  description:
    "Close an open trade by selling all remaining position. " +
    "Use when user wants to exit a trade early, e.g., 'close my BTC trade'",
  inputSchema: z.object({
    tradeId: z.string().describe("The ID of the trade to close"),
    reason: z
      .enum(["MANUAL", "STOP", "TP1", "TP2", "TP3"])
      .default("MANUAL")
      .describe("Reason for closing"),
  }),
  outputSchema: closeTradeOutputSchema,
  execute: async ({ tradeId, reason }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return validateToolOutput(closeTradeOutputSchema, { ...errors.noExchange, success: false }, { toolName: "close_trade" });
    }

    const trade = getTrade(tradeId);
    if (!trade) {
      return validateToolOutput(closeTradeOutputSchema, { success: false, error: `Trade not found: ${tradeId}` }, { toolName: "close_trade" });
    }

    const result = await closeTrade(ctx.exchange, trade, reason ?? "MANUAL");

    return validateToolOutput(closeTradeOutputSchema, {
      success: result.success,
      pnl: result.pnl,
      error: result.error,
    }, { toolName: "close_trade" });
  },
});

// ============================================================================
// List Plans Tool
// ============================================================================

export const listPlansTool = createTool({
  id: "list_plans",
  description:
    "List all trading plans, optionally filtered by status. " +
    "Use when user asks 'show my plans' or 'what plans do I have?'",
  inputSchema: z.object({
    status: z
      .enum(["DRAFT", "APPROVED", "EXECUTING", "CLOSED", "CANCELLED", "ALL"])
      .default("ALL")
      .describe("Filter by status (ALL for no filter)"),
    limit: z.number().min(1).max(50).default(10).describe("Max plans to return"),
  }),
  outputSchema: listPlansOutputSchema,
  execute: async ({ status, limit }) => {
    let plans = listPlans();

    if (status && status !== "ALL") {
      plans = plans.filter((p) => p.status === status);
    }

    plans.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const result = {
      count: plans.length,
      plans: plans.slice(0, limit ?? 10).map((p) => ({
        id: p.id,
        symbol: p.symbol,
        strategy: p.strategy,
        status: p.status,
        allocation: p.allocation.amount,
        entry: p.entry.price ?? "market",
        stopLoss: p.stopLoss.price,
        createdAt: p.createdAt,
      })),
    };

    return validateToolOutput(listPlansOutputSchema, result, { toolName: "list_plans" });
  },
});

// ============================================================================
// Approve Plan Tool
// ============================================================================

export const approvePlanTool = createTool({
  id: "approve_plan",
  description:
    "Approve a draft plan, marking it ready for execution. " +
    "Use when user says 'approve this plan' or 'looks good, approve it'",
  inputSchema: z.object({
    planId: z.string().describe("The ID of the plan to approve"),
  }),
  outputSchema: approvePlanOutputSchema,
  execute: async ({ planId }) => {
    const plan = getPlan(planId);
    if (!plan) {
      recordStructuredObservation({
        eventType: "plan.approval_failed",
        workflow: "execution",
        source: "agent_tool",
        component: "approve_plan",
        toolName: "approve_plan",
        outcome: "failure",
        status: "plan_missing",
        planId,
        reason: `Plan not found: ${planId}`,
      });
      return validateToolOutput(approvePlanOutputSchema, { success: false, error: `Plan not found: ${planId}` }, { toolName: "approve_plan" });
    }

    if (plan.status !== "DRAFT") {
      recordStructuredObservation({
        eventType: "plan.approval_failed",
        workflow: "execution",
        source: "agent_tool",
        component: "approve_plan",
        toolName: "approve_plan",
        outcome: "failure",
        status: "invalid_status",
        planId,
        symbol: plan.symbol,
        reason: `Plan is not in DRAFT status, current status: ${plan.status}`,
        details: {
          previousStatus: plan.status,
        },
      });
      return validateToolOutput(approvePlanOutputSchema, { success: false, error: `Plan is not in DRAFT status, current status: ${plan.status}` }, { toolName: "approve_plan" });
    }

    updatePlan(planId, { status: "APPROVED" });
    await emitEvent("plan:approved", { planId });
    recordStructuredObservation({
      eventType: "plan.approved",
      workflow: "execution",
      source: "agent_tool",
      component: "approve_plan",
      toolName: "approve_plan",
      outcome: "success",
      status: "approved",
      planId,
      symbol: plan.symbol,
      details: {
        previousStatus: plan.status,
      },
    });

    return validateToolOutput(approvePlanOutputSchema, {
      success: true,
      planId,
      message: "Plan approved. Ready for execution when system is armed.",
    }, { toolName: "approve_plan" });
  },
});

// ============================================================================
// Arm/Disarm System Tool
// Note: needsApproval removed - handle via guardrails in Mastra
// ============================================================================

export const setPermissionModeTool = createTool({
  id: "set_permission_mode",
  description:
    "Set Gordon's permission mode. Prefer the explicit slash commands " +
    "/auto, /ask, /strict, /paper, /observe, /planmode in the terminal UI. " +
    "Use this tool only when the user has clearly requested a mode change.\n" +
    "- auto:    trades execute without per-action approval\n" +
    "- ask:     each trade requires ApprovalDialog confirmation (default)\n" +
    "- strict:  read-only, all trades blocked\n" +
    "- paper:   paper trading only — real orders blocked, simulated fills allowed\n" +
    "- observe: pure observation — no execution of any kind\n" +
    "- plan:    planning only — create plans but cannot execute them",
  inputSchema: z.object({
    mode: z
      .enum(["auto", "ask", "strict", "paper", "observe", "plan"])
      .describe("Permission mode to set"),
  }),
  outputSchema: setPermissionModeOutputSchema,
  execute: async ({ mode }) => {
    const resolved = await loadConfigBundle();
    const config = resolved.config;
    const previous = config.permissionMode;

    await saveResolvedConfig({ ...config, permissionMode: mode }, resolved.layers);
    recordStructuredObservation({
      eventType: "system.permission_mode_changed",
      workflow: "execution",
      source: "agent_tool",
      component: "set_permission_mode",
      toolName: "set_permission_mode",
      outcome: "success",
      status: mode,
      mode,
      details: { previous },
    });

    // Sync sandbox override and bust venue adapter caches so the next
    // request in this session gets a fresh exchange/broker client.
    const newOverride = mode === "paper" ? true : null;
    setSandboxOverride(newOverride);
    ExchangeFactory.clearCache();
    BrokerFactory.clearCache();
    // Invalidate the gateway context resolver cache if it's running.
    try {
      const { getGatewayContextResolver } = await import("../../../../gateway/runtime/context.ts");
      getGatewayContextResolver().invalidate();
    } catch {
      // Not running inside the gateway daemon — safe to ignore.
    }

    const descriptions: Record<"auto" | "ask" | "strict" | "paper" | "observe" | "plan", string> = {
      auto: "Trades now execute without per-action approval.",
      ask: "Each trade now requires approval via dialog (default).",
      strict: "Read-only mode. All trades blocked.",
      paper: "Paper trading mode. Real orders blocked; simulated fills recorded.",
      observe: "Observation mode. No execution of any kind — not even paper trades.",
      plan: "Planning-only mode. Plans can be created but not executed.",
    };

    const sandboxNote = mode === "paper"
      ? " Venue adapters switched to sandbox/testnet endpoints."
      : previous === "paper"
      ? " Venue adapters restored to live endpoints."
      : "";

    return validateToolOutput(setPermissionModeOutputSchema, {
      success: true,
      permissionMode: mode,
      previousMode: previous,
      message: `Permission mode set to '${mode}'. ${descriptions[mode]}${sandboxNote}`,
    }, { toolName: "set_permission_mode" });
  },
});

// ============================================================================
// Create Grid Plan Tool
// ============================================================================

export const createGridPlanTool = createTool({
  id: "create_grid_plan",
  description: `Create a grid entry plan for a symbol. Grid entry places multiple buy orders at descending price levels across support zones.

Use grid entry when:
- Market is ranging or uncertain
- User wants to accumulate over a price range
- Multiple support levels are identified
- User says "grid", "layered entry", "spread buys"

Returns a grid plan for user approval.`,
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair symbol, e.g., ETHUSDT"),
    allocation: z.number().optional().describe("Amount in USDT to allocate (uses default if not specified)"),
    numLevels: z.number().min(3).max(7).optional().describe("Number of grid levels (default: 5)"),
    distribution: z.enum(["pyramid", "equal"]).optional().describe("Allocation distribution (default: pyramid)"),
  }),
  outputSchema: createGridPlanOutputSchema,
  execute: async ({ symbol, allocation, numLevels, distribution }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return validateToolOutput(createGridPlanOutputSchema, { error: "Exchange client not connected. Please configure API keys." }, { toolName: "create_grid_plan" });
    }

    // Normalize symbol
    const normalizedSymbol = normalizeSymbol(symbol);

    // Analyze the symbol to get support/resistance levels
    const analysis = await analyze(ctx.exchange, normalizedSymbol, {
      timeframes: ["1h", "4h"],
    });

    if (analysis.supports.length === 0) {
      return validateToolOutput(createGridPlanOutputSchema, {
        success: false,
        error: `No support levels found for ${normalizedSymbol}. Cannot create grid plan.`,
      }, { toolName: "create_grid_plan" });
    }

    // Calculate allocation amount
    const defaultAllocationPercent = ctx.config.preferences.maxAllocationPerTrade;
    const allocationAmount = allocation ?? ctx.portfolioValue * defaultAllocationPercent;
    const percentOfPortfolio = allocationAmount / ctx.portfolioValue;

    // Calculate grid levels using grid-calculator
    const gridResult = calculateGridLevels({
      supports: analysis.supports,
      currentPrice: analysis.price,
      numLevels: numLevels ?? 5,
      distribution: distribution ?? "pyramid",
      allocation: allocationAmount,
    });

    // Extract take profits from resistance levels (first 2)
    const takeProfits = analysis.resistances
      .slice(0, 2)
      .map(r => r.price);

    // Build take profit levels with percentages
    const takeProfitLevels = takeProfits.map((price, i) => ({
      price,
      percentToSell: i === takeProfits.length - 1
        ? 1 - (takeProfits.length - 1) * 0.5 // Last TP gets remaining
        : 0.5, // First TP gets 50%
    }));

    // Create and persist the plan to the database
    const savedPlan = createPlan({
      symbol: normalizedSymbol,
      direction: "long" as const,
      strategy: "grid_entry" as const,
      allocation: {
        currency: "USDT" as const,
        amount: allocationAmount,
        percentOfPortfolio,
      },
      entry: {
        type: "limit" as const,
        price: gridResult.config.priceRange.high, // Highest grid level
      },
      dca: null,
      grid: gridResult.config,
      stopLoss: {
        price: gridResult.stopLossPrice,
      },
      takeProfit: takeProfitLevels,
      reasoning: `Grid entry plan with ${gridResult.levels.length} levels using ${distribution ?? "pyramid"} distribution. Price range: $${gridResult.config.priceRange.high.toFixed(2)} to $${gridResult.config.priceRange.low.toFixed(2)}. Weighted entry if all fill: $${gridResult.weightedEntryIfAllFill.toFixed(2)}`,
      status: "DRAFT" as const,
    });

    // Build plan preview for response
    const planPreview = {
      symbol: normalizedSymbol,
      strategy: "grid_entry",
      grid: gridResult.config,
      stopLoss: gridResult.stopLossPrice,
      takeProfits,
      allocation: {
        amount: allocationAmount,
        percentOfPortfolio,
      },
      weightedEntry: gridResult.weightedEntryIfAllFill,
    };

    // Perform reflection on the saved plan (rule-based only for grid plans since no LLM context)
    const reflectionResult = await reflectOnPlan(savedPlan, ctx, { skipLLM: true });

    const levelsSummary = gridResult.levels
      .map((l, i) => `L${i + 1}: $${l.price.toFixed(2)} (${(l.percentOfAllocation * 100).toFixed(1)}%)`)
      .join(", ");

    const baseMessage = `Grid plan created (ID: ${savedPlan.id}) for ${normalizedSymbol}: ${gridResult.levels.length} levels from $${gridResult.config.priceRange.high.toFixed(2)} to $${gridResult.config.priceRange.low.toFixed(2)}. ${levelsSummary}. Stop loss at $${gridResult.stopLossPrice.toFixed(2)}. Allocation: $${allocationAmount.toFixed(2)} (${(percentOfPortfolio * 100).toFixed(1)}% of portfolio). Use 'approve_plan' with ID ${savedPlan.id} to approve.`;

    const reflectionSummary = formatReflectionSummary(reflectionResult);

    const result = {
      success: reflectionResult.isValid,
      planPreview,
      message: reflectionResult.isValid
        ? `${baseMessage}\n\nReflection: ${reflectionSummary}`
        : `${baseMessage}\n\nWARNING - ${reflectionSummary}`,
      reflection: {
        isValid: reflectionResult.isValid,
        issues: reflectionResult.issues,
        suggestions: reflectionResult.suggestions,
        confidence: reflectionResult.confidence,
      },
      warnings: reflectionResult.issues.length > 0 ? reflectionResult.issues : undefined,
    };

    return validateToolOutput(createGridPlanOutputSchema, result, { toolName: "create_grid_plan" });
  },
});

// ============================================================================
// Trailing Stop Tools
// ============================================================================

export const setTrailingStopTool = createTool({
  id: "set_trailing_stop",
  description: `Set a trailing stop for an open trade. The trailing stop will adjust upward as price rises, locking in profits.

Use when:
- User wants to protect profits on an open trade
- User says "set trailing stop", "add trailing stop", "protect profits"
- User wants dynamic stop loss that follows price

Supports:
- Percentage-based trailing (e.g., 3% below high)
- ATR-based trailing (e.g., 2x ATR below high)
- Optional activation price (trailing starts after this price)`,
  inputSchema: z.object({
    tradeId: z.string().describe("The ID of the trade to set trailing stop for"),
    type: z.enum(["percentage", "atr"]).default("percentage").describe("Type of trailing: 'percentage' or 'atr'"),
    trailDistance: z.number().describe("Trail distance - percentage (e.g., 0.03 for 3%) or ATR multiplier (e.g., 2.0)"),
    activationPrice: z.number().optional().describe("Price at which trailing stop activates (optional, immediate if not set)"),
  }),
  outputSchema: setTrailingStopOutputSchema,
  execute: async ({ tradeId, type, trailDistance, activationPrice }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return validateToolOutput(setTrailingStopOutputSchema, {
        success: false,
        error: "Exchange client not connected.",
      }, { toolName: "set_trailing_stop" });
    }

    // Get the trade
    const trade = getTrade(tradeId);
    if (!trade) {
      return validateToolOutput(setTrailingStopOutputSchema, {
        success: false,
        error: `Trade not found: ${tradeId}`,
      }, { toolName: "set_trailing_stop" });
    }

    if (trade.status === "CLOSED") {
      return validateToolOutput(setTrailingStopOutputSchema, {
        success: false,
        error: "Cannot set trailing stop on a closed trade.",
      }, { toolName: "set_trailing_stop" });
    }

    // Get current price for initial high
    const currentPrice = await ctx.exchange.getPrice(trade.symbol);

    // Get trailing stop tracker
    const tracker = getTrailingStopTracker();

    // Check if trailing stop already exists
    const existing = tracker.getTrailingStop(tradeId);
    if (existing) {
      return validateToolOutput(setTrailingStopOutputSchema, {
        success: false,
        error: `Trailing stop already exists for trade ${tradeId}. Use update_trailing_stop to modify it.`,
      }, { toolName: "set_trailing_stop" });
    }

    // Add trailing stop
    const trailingStop = tracker.addTrailingStop({
      tradeId,
      symbol: trade.symbol,
      type: type ?? "percentage",
      trailDistance,
      activationPrice,
      initialHighPrice: currentPrice,
    });

    const result = {
      success: true,
      trailingStop: {
        id: trailingStop.id,
        tradeId: trailingStop.tradeId,
        symbol: trailingStop.symbol,
        type: trailingStop.type,
        trailDistance: trailingStop.trailDistance,
        activationPrice: trailingStop.activationPrice,
        isActive: trailingStop.isActive,
        currentStopPrice: trailingStop.currentStopPrice,
        highestPrice: trailingStop.highestPrice,
      },
      message: `Trailing stop set for ${trade.symbol}: ${type === "atr" ? `${trailDistance}x ATR` : `${(trailDistance * 100).toFixed(1)}%`} trail${activationPrice ? ` (activates at $${activationPrice})` : " (active immediately)"}`,
    };

    return validateToolOutput(setTrailingStopOutputSchema, result, { toolName: "set_trailing_stop" });
  },
});

export const updateTrailingStopTool = createTool({
  id: "update_trailing_stop",
  description: `Update and check status of a trailing stop. Returns current stop price, highest price, and whether stop should trigger.

Use when:
- User asks to check trailing stop status
- User wants to modify trailing stop parameters
- Part of monitor cycle to update all trailing stops`,
  inputSchema: z.object({
    tradeId: z.string().describe("The ID of the trade with trailing stop"),
    newTrailDistance: z.number().optional().describe("New trail distance (optional, updates if provided)"),
  }),
  outputSchema: updateTrailingStopOutputSchema,
  execute: async ({ tradeId, newTrailDistance }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return validateToolOutput(updateTrailingStopOutputSchema, {
        success: false,
        error: "Exchange client not connected.",
      }, { toolName: "update_trailing_stop" });
    }

    const tracker = getTrailingStopTracker();
    const trailingStop = tracker.getTrailingStop(tradeId);

    if (!trailingStop) {
      return validateToolOutput(updateTrailingStopOutputSchema, {
        success: false,
        error: `No trailing stop found for trade: ${tradeId}`,
      }, { toolName: "update_trailing_stop" });
    }

    // Update trail distance if provided
    if (newTrailDistance !== undefined) {
      // We need to access the internal state - for now just note this limitation
      // In production, we'd add a method to TrailingStopTracker for this
    }

    // Update the trailing stop with current price
    try {
      const updateResult = await tracker.updateTrailingStop(ctx.exchange, tradeId);

      const result = {
        success: true,
        updated: updateResult.updated,
        previousStopPrice: updateResult.previousStopPrice,
        newStopPrice: updateResult.newStopPrice,
        highestPrice: updateResult.highestPrice,
        shouldTrigger: updateResult.shouldTrigger,
        currentPrice: updateResult.currentPrice,
        message: updateResult.shouldTrigger
          ? `ALERT: Trailing stop triggered! Current price $${updateResult.currentPrice.toFixed(2)} is below stop $${updateResult.newStopPrice.toFixed(2)}`
          : updateResult.updated
            ? `Trailing stop updated: New stop at $${updateResult.newStopPrice.toFixed(2)} (highest: $${updateResult.highestPrice.toFixed(2)})`
            : `Trailing stop unchanged: Stop at $${updateResult.newStopPrice.toFixed(2)}, current price $${updateResult.currentPrice.toFixed(2)}`,
      };

      return validateToolOutput(updateTrailingStopOutputSchema, result, { toolName: "update_trailing_stop" });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return validateToolOutput(updateTrailingStopOutputSchema, {
        success: false,
        error: errorMessage,
      }, { toolName: "update_trailing_stop" });
    }
  },
});

// ============================================================================
// Partial Position Close Tool
// ============================================================================

export const closePartialPositionTool = createTool({
  id: "close_partial_position",
  description: `Close a portion of an open position. Supports tier-based exits like TP1 (50%), TP2 (30%), TP3 (20%).

Use when:
- User wants to take partial profits
- User says "close half", "take some profits", "sell 30%"
- Tier-based take profit execution`,
  inputSchema: z.object({
    tradeId: z.string().describe("The ID of the trade to partially close"),
    percentage: z.number().min(0.01).max(1).describe("Percentage of remaining position to close (0.01 to 1.0)"),
    reason: z.enum(["TP1", "TP2", "TP3", "MANUAL"]).default("MANUAL").describe("Reason for partial close"),
  }),
  outputSchema: closePartialPositionOutputSchema,
  execute: async ({ tradeId, percentage, reason }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return validateToolOutput(closePartialPositionOutputSchema, {
        success: false,
        error: "Exchange client not connected.",
      }, { toolName: "close_partial_position" });
    }

    const closeResult = await closePartialPosition(
      ctx.exchange,
      tradeId,
      percentage,
      reason ?? "MANUAL"
    );

    if (closeResult.success) {
      const result = {
        success: true,
        closedQuantity: closeResult.closedQuantity,
        remainingQuantity: closeResult.remainingQuantity,
        exitPrice: closeResult.exitPrice,
        pnl: closeResult.pnl,
        message: `Closed ${(percentage * 100).toFixed(0)}% of position (${closeResult.closedQuantity.toFixed(6)} units) at $${closeResult.exitPrice.toFixed(2)}. PnL: $${closeResult.pnl.toFixed(2)}. Remaining: ${closeResult.remainingQuantity.toFixed(6)} units.`,
      };
      return validateToolOutput(closePartialPositionOutputSchema, result, { toolName: "close_partial_position" });
    }

    return validateToolOutput(closePartialPositionOutputSchema, {
      success: false,
      error: closeResult.error,
    }, { toolName: "close_partial_position" });
  },
});

// ============================================================================
// Algorithmic Execution Tool
// ============================================================================

import { ExecutionSessionManager } from "../../../../core/execution/session-manager.ts";
import { parseExecutionIntent, describeIntent } from "../../../../core/execution/intent-parser.ts";

const executeWithAlgorithmOutputSchema = z.object({
  success: z.boolean(),
  sessionId: z.string().optional(),
  algorithm: z.string().optional(),
  description: z.string().optional(),
  slicesTotal: z.number().optional(),
  estimatedDuration: z.string().optional(),
  error: z.string().optional(),
});

export const executeWithAlgorithmTool = createTool({
  id: "execute_with_algorithm",
  description:
    "Execute a large order using an algorithmic execution strategy (TWAP, VWAP, Iceberg, or POV). " +
    "Use when the user wants to buy/sell slowly, minimize market impact, hide order size, " +
    "track a target participation rate of the tape, or explicitly requests TWAP/VWAP/Iceberg/POV. " +
    "Examples: 'buy 1 BTC slowly over 4 hours', 'accumulate ETH matching volume', " +
    "'sell without moving the market', 'POV 10% of volume up to 2 BTC'.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair symbol (e.g., 'BTCUSDT')"),
    side: z.enum(["BUY", "SELL"]).describe("Order side"),
    quantity: z.number().describe("Total quantity to execute"),
    algorithm: z.enum(["TWAP", "VWAP", "ICEBERG", "POV"]).optional().describe("Execution algorithm (auto-detected if not specified)"),
    description: z.string().optional().describe("Natural language description for algorithm detection (e.g., 'slowly over 4 hours', '10% of volume')"),
    durationMs: z.number().optional().describe("Duration in milliseconds for TWAP/VWAP, or max duration for POV"),
  }),
  outputSchema: executeWithAlgorithmOutputSchema,
  execute: async ({ symbol, side, quantity, algorithm, description, durationMs }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return validateToolOutput(executeWithAlgorithmOutputSchema, {
        success: false,
        error: "Exchange client not connected.",
      }, { toolName: "execute_with_algorithm" });
    }

    {
      const check = checkTradingPermission(ctx.config?.permissionMode, "execute", { sandboxActive: ctx.exchange?.isSandbox ?? ctx.broker?.isPaper });
      if (!check.allowed) {
        return validateToolOutput(executeWithAlgorithmOutputSchema, {
          success: false,
          error: check.reason ?? "Algorithmic execution not permitted under current mode.",
        }, { toolName: "execute_with_algorithm" });
      }
    }

    // Normalize symbol
    const normalizedSymbol = normalizeSymbol(symbol);

    // Build execution intent
    const intent = parseExecutionIntent(
      description ?? algorithm ?? "slowly",
      normalizedSymbol,
      side,
      quantity,
    );

    // Override algorithm if explicitly specified
    if (algorithm) {
      intent.algorithm = algorithm;
    }

    // Override duration if specified
    if (durationMs && "durationMs" in intent.config) {
      (intent.config as { durationMs: number }).durationMs = durationMs;
    } else if (durationMs && "maxDurationMs" in intent.config) {
      (intent.config as { maxDurationMs: number }).maxDurationMs = durationMs;
    }

    try {
      const manager = ExecutionSessionManager.getInstance();
      const session = await manager.startSession(intent, ctx.exchange);

      const desc = describeIntent(intent);
      const durationHours = "durationMs" in intent.config
        ? ((intent.config as { durationMs: number }).durationMs / (60 * 60 * 1000)).toFixed(1) + "h"
        : "N/A";

      return validateToolOutput(executeWithAlgorithmOutputSchema, {
        success: true,
        sessionId: session.sessionId,
        algorithm: intent.algorithm,
        description: desc,
        slicesTotal: session.slicesTotal,
        estimatedDuration: durationHours,
      }, { toolName: "execute_with_algorithm" });
    } catch (err) {
      return validateToolOutput(executeWithAlgorithmOutputSchema, {
        success: false,
        error: `Algorithmic execution failed: ${(err as Error).message}`,
      }, { toolName: "execute_with_algorithm" });
    }
  },
});

// ============================================================================
// Export as Object (Mastra format)
// ============================================================================

/**
 * Trading tools exported as an object for Mastra Agent
 * This is the format expected by Mastra's Agent class
 */
// ============================================================================
// Trade History (Ledger Navigation Tool)
// ============================================================================

const getTradeHistoryOutputSchema = z.object({
  success: z.boolean(),
  mode: z.enum(["list", "single", "empty"]),
  count: z.number().optional(),
  records: z.array(z.record(z.string(), z.unknown())).optional(),
  record: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
});

export const getTradeHistoryTool = createTool({
  id: "get_trade_history",
  description:
    "Navigate the trade ledger — recent execution records appended by execute_plan. " +
    "Returns a list by default; pass `recordId` to fetch one full record envelope " +
    "(including rationale, operations, results, and any state snapshots). Filter " +
    "by `symbol` and bound with `limit` (default 10).",
  inputSchema: z.object({
    recordId: z.string().optional().describe("Fetch one specific record by id."),
    symbol: z.string().optional().describe("Filter to records for this symbol."),
    limit: z.number().int().positive().max(100).optional().describe("Max records to return (default 10)."),
  }),
  outputSchema: getTradeHistoryOutputSchema,
  execute: async ({ recordId, symbol, limit }) => {
    try {
      if (recordId) {
        const rec = await getExecutionRecord(recordId);
        if (!rec) {
          return validateToolOutput(getTradeHistoryOutputSchema, {
            success: true,
            mode: "empty" as const,
            error: `No record with id ${recordId}`,
          }, { toolName: "get_trade_history" });
        }
        return validateToolOutput(getTradeHistoryOutputSchema, {
          success: true,
          mode: "single" as const,
          record: executionRecordToPayload(rec),
        }, { toolName: "get_trade_history" });
      }
      const records = await readExecutionRecords({
        symbol,
        limit: limit ?? 10,
      });
      return validateToolOutput(getTradeHistoryOutputSchema, {
        success: true,
        mode: records.length === 0 ? "empty" as const : "list" as const,
        count: records.length,
        records: records.map(executionRecordToPayload),
      }, { toolName: "get_trade_history" });
    } catch (error) {
      return validateToolOutput(getTradeHistoryOutputSchema, {
        success: false,
        mode: "empty" as const,
        error: (error as Error).message,
      }, { toolName: "get_trade_history" });
    }
  },
});

export const tradingTools = {
  create_plan: createPlanTool,
  execute_plan: executePlanTool,
  close_trade: closeTradeTool,
  list_plans: listPlansTool,
  approve_plan: approvePlanTool,
  set_permission_mode: setPermissionModeTool,
  create_grid_plan: createGridPlanTool,
  set_trailing_stop: setTrailingStopTool,
  update_trailing_stop: updateTrailingStopTool,
  close_partial_position: closePartialPositionTool,
  execute_with_algorithm: executeWithAlgorithmTool,
  get_trade_history: getTradeHistoryTool,
};
