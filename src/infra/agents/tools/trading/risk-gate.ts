/**
 * Risk Gate
 *
 * Wrapper and Mastra tool that routes every order through the Risk Kernel
 * before it reaches the exchange. Exports a programmatic helper
 * (`evaluateOrderRisk`) for internal use and a `checkRiskTool` that agents
 * can call explicitly to pre-check proposed orders.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { riskKernel } from "../../../../core/risk-kernel/index.ts";
import { PortfolioContextBuilder } from "../../../../core/risk-kernel/portfolio-context.ts";
import type {
  OpenPosition,
  PortfolioContext,
} from "../../../../core/risk-kernel/portfolio-context.ts";
import { loadConfigFromEnv } from "../../../../core/risk-kernel/config.ts";
import {
  concentrationCapFromRiskConfig,
  limitsFromRiskConfig,
  projectAction,
} from "../../../../core/risk-kernel/safety-projection.ts";
import type {
  LegState,
  ProjectionTelemetry,
  SafetyState,
} from "../../../../core/risk-kernel/safety-projection.ts";
import { checkOrderAdmissibility } from "../../../../core/orders/economic-floor.ts";
import type { EconomicFloorPolicy, FeeSchedule } from "../../../../core/orders/economic-floor.ts";
import type { OrderRequest } from "../../../../core/risk-kernel/audit.ts";
import { StrategyRuntime } from "../../../../core/runtime/engine.ts";
import { resolveFlag } from "../../../config/flagResolver.ts";
import { getGordonContext, type MastraExecutionContext } from "../types.ts";
import type { GordonContext } from "../types.ts";
import { createModuleLogger } from "../../../logger/index.ts";
import { evaluateBaselineCircuitBreakers } from "../../../../gateway/circuit-breakers/index.ts";
import { computeCircuitBreakerLiveData } from "../../../../gateway/circuit-breakers/data-provider.ts";
import { evaluateConsensus } from "../../../../core/consensus/protocol.ts";
import type {
  TradeProposal,
  ConsensusResult,
  AgentVote,
} from "../../../../core/consensus/protocol.ts";

const logger = createModuleLogger("risk-gate");

// ============================================================================
// Safety projection and economic floor inputs
// ============================================================================

export const FEE_FIXED_PER_TRANCHE_ENV = "GORDON_FEE_FIXED_PER_TRANCHE_USD";
export const FEE_TRANCHE_SIZE_ENV = "GORDON_FEE_TRANCHE_SIZE_USD";
export const FEE_MIN_PER_ORDER_ENV = "GORDON_FEE_MIN_PER_ORDER_USD";
export const FEE_TOLERANCE_BPS_ENV = "GORDON_FEE_TOLERANCE_BPS";

const DEFAULT_FEE_TOLERANCE_BPS = 100;

function parseUsdMinor(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value * 100);
}

/**
 * The economic floor is only meaningful against a real fee schedule, and Gordon
 * carries no venue commission feed. The operator states the schedule; nothing
 * configured means no floor is asserted rather than a guessed one, since a
 * guessed floor would refuse perfectly good orders.
 */
function resolveFeePolicy(): { schedule: FeeSchedule; policy: EconomicFloorPolicy } | null {
  const fixedPerTrancheMinor = parseUsdMinor(process.env[FEE_FIXED_PER_TRANCHE_ENV]);
  const trancheSizeMinor = parseUsdMinor(process.env[FEE_TRANCHE_SIZE_ENV]);
  if (!fixedPerTrancheMinor || !trancheSizeMinor) return null;

  const toleranceRaw = Number(process.env[FEE_TOLERANCE_BPS_ENV] ?? "");
  const feeToleranceBps =
    Number.isFinite(toleranceRaw) && toleranceRaw > 0 ? toleranceRaw : DEFAULT_FEE_TOLERANCE_BPS;

  return {
    schedule: {
      fixedPerTrancheMinor,
      trancheSizeMinor,
      minimumPerOrderMinor: parseUsdMinor(process.env[FEE_MIN_PER_ORDER_ENV]),
    },
    policy: { feeToleranceBps },
  };
}

function signedNotionalOf(position: OpenPosition): number {
  const magnitude = Math.abs(position.size * position.currentPrice);
  return position.side === "short" ? -magnitude : magnitude;
}

/**
 * Map the live portfolio onto the projection's leg vector. Every open position
 * becomes a leg so the leverage barrier sees real gross exposure, but only the
 * traded symbol is allowed to move.
 */
function buildSafetyState(
  symbol: string,
  side: "buy" | "sell",
  proposedNotionalUsd: number,
  portfolio: PortfolioContext,
  concentrationCapUsd: number,
  drawdownBaseUsd: number,
  nowMs: number,
): SafetyState {
  const bySymbol = new Map<string, number>();
  for (const position of portfolio.openPositions) {
    bySymbol.set(
      position.symbol,
      (bySymbol.get(position.symbol) ?? 0) + signedNotionalOf(position),
    );
  }

  const currentNotionalUsd = bySymbol.get(symbol) ?? 0;
  bySymbol.delete(symbol);

  const legs: LegState[] = [
    {
      symbol,
      currentNotionalUsd,
      // Cash bounds a buy. A sell is bounded by the position and by venue rules,
      // and Gordon has no short-capacity feed, so the sell side is left to the
      // concentration and leverage barriers instead of a fabricated cash bound.
      availableLiquidityUsd:
        side === "sell" ? proposedNotionalUsd : Math.max(0, portfolio.availableBalance),
      // A cap already breached before this order would empty the feasible set and
      // refuse even a de-risking trade. Relaxing to the standing exposure keeps
      // the barrier honest: this order may not enlarge the breach.
      concentrationCapUsd: Math.max(concentrationCapUsd, Math.abs(currentNotionalUsd)),
      rateLimitUsd: Number.POSITIVE_INFINITY,
      riskPerUsd: 0,
      signals: [],
      costWeight: 1,
    },
  ];

  for (const [otherSymbol, notional] of bySymbol) {
    legs.push({
      symbol: otherSymbol,
      currentNotionalUsd: notional,
      // Untraded legs are pinned at zero delta: this order is not the place to
      // resize somebody else's position.
      availableLiquidityUsd: 0,
      concentrationCapUsd: Math.max(concentrationCapUsd, Math.abs(notional)),
      rateLimitUsd: Number.POSITIVE_INFINITY,
      riskPerUsd: 0,
      signals: [],
      costWeight: 1,
    });
  }

  return {
    nowMs,
    equityUsd: portfolio.totalEquity,
    currentDrawdownUsd: Math.max(0, (portfolio.currentDrawdown / 100) * drawdownBaseUsd),
    legs,
    recentActions: [],
  };
}

/** The audit value of the projection is the geometry, so it is reported verbatim. */
function describeProjection(telemetry: ProjectionTelemetry): string {
  const active = telemetry.activeConstraints.join(", ") || "none";
  return (
    `Safety projection: tightest constraint ${telemetry.tightestConstraint ?? "none"}, ` +
    `deviation $${telemetry.deviation.toFixed(2)}, ` +
    `rate limit utilisation ${(telemetry.rateLimitUtilisation * 100).toFixed(1)}%, ` +
    `active constraints [${active}].`
  );
}

// ============================================================================
// Helper
// ============================================================================

/**
 * Evaluate an order against the Risk Kernel.
 *
 * Builds a PortfolioContext from the live exchange adapter when available.
 * Fail-closed policy: if context cannot be built, order is rejected.
 */
export async function evaluateOrderRisk(
  order: { symbol: string; side: string; type: string; quantity: number; price?: number },
  ctx: GordonContext,
  agentId?: string,
): Promise<{ approved: boolean; quantity: number; reason: string; warnings: string[] }> {
  const warnings: string[] = [];

  // -- Build PortfolioContext --------------------------------------------
  const builder = new PortfolioContextBuilder();
  let portfolioContext: PortfolioContext | undefined;

  if (ctx.exchange) {
    try {
      portfolioContext = await builder.buildFromExchange(ctx.exchange);
    } catch (err) {
      logger.warn("Could not build portfolio context from exchange", {
        error: (err as Error).message,
      });
    }
  }

  if (!portfolioContext && ctx.broker) {
    try {
      portfolioContext = await builder.buildFromBroker(ctx.broker);
    } catch (err) {
      logger.warn("Could not build portfolio context from broker", {
        error: (err as Error).message,
      });
    }
  }

  if (!portfolioContext) {
    return {
      approved: false,
      quantity: order.quantity,
      reason: "Rejected: portfolio context unavailable, risk checks could not be completed.",
      warnings: ["No exchange or broker adapter available. Risk kernel evaluation blocked."],
    };
  }

  // A market order still has a dollar size. The kernel and the safety
  // projection cannot evaluate it from quantity alone when the symbol is not
  // already held, so resolve a conservative executable-side quote here at the
  // common gate rather than relying on every dispatch site to remember one.
  let referencePrice = order.price;
  if (
    !(typeof referencePrice === "number" && Number.isFinite(referencePrice) && referencePrice > 0)
  ) {
    try {
      if (ctx.exchange) {
        referencePrice = await ctx.exchange.getPrice(order.symbol);
      } else if (ctx.broker) {
        const quote = await ctx.broker.getLatestQuote(order.symbol);
        referencePrice = order.side.toLowerCase() === "sell" ? quote.bidPrice : quote.askPrice;
      }
    } catch (err) {
      logger.warn("Could not resolve a market-order reference price", {
        symbol: order.symbol,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (
    !(typeof referencePrice === "number" && Number.isFinite(referencePrice) && referencePrice > 0)
  ) {
    return {
      approved: false,
      quantity: order.quantity,
      reason: `Rejected: no positive reference price is available for ${order.symbol}.`,
      warnings: [
        "Market-order risk and notional checks cannot run without an executable-side price.",
      ],
    };
  }

  // -- Build OrderRequest ------------------------------------------------
  const orderRequest: OrderRequest = {
    symbol: order.symbol,
    side: order.side.toLowerCase() as "buy" | "sell",
    type: order.type.toLowerCase().replace("-", "_") as "market" | "limit" | "stop_limit",
    quantity: order.quantity,
    price: referencePrice,
    exchangeId: ctx.exchange?.exchangeId ?? ctx.broker?.brokerId ?? "unknown",
    agentId: agentId ?? "executor",
  };

  // Baseline circuit breakers (Phase 0 fail-safe controls)
  const runtime = StrategyRuntime.getInstance();
  const portfolioState = runtime.getPortfolioState();

  // Compute live circuit breaker data from exchange
  let correlationShockPercent = 0;
  let liquidityGapBps = 0;

  if (ctx.exchange && portfolioContext) {
    try {
      const liveData = await computeCircuitBreakerLiveData(
        ctx.exchange,
        portfolioContext.openPositions,
      );
      correlationShockPercent = liveData.correlationShockPercent;
      liquidityGapBps = liveData.liquidityGapBps;
    } catch (err) {
      logger.warn("Could not compute live circuit breaker data, using defaults", {
        error: (err as Error).message,
      });
    }
  }

  const breaker = evaluateBaselineCircuitBreakers({
    portfolioDrawdownPercent: portfolioState.portfolio_drawdown_percent,
    maxPortfolioDrawdownPercent: ctx.config?.riskManagement?.maxDrawdownPercent ?? 15,
    correlationShockPercent,
    maxCorrelationShockPercent: 15,
    liquidityGapBps,
    maxLiquidityGapBps: 250,
  });

  if (breaker.open) {
    return {
      approved: false,
      quantity: order.quantity,
      reason: `Rejected by circuit breaker: ${breaker.triggers.map((t) => t.name).join(", ")}`,
      warnings: breaker.triggers.map((t) => t.message),
    };
  }

  const sandboxActive =
    (ctx.exchange as { isSandbox?: boolean } | null)?.isSandbox ?? ctx.broker?.isPaper ?? false;
  const envRiskMode = resolveFlag("GORDON_RISK_MODE");
  // A paper-mode override is only meaningful where fills are simulated. The
  // condition used to be negated, so the override fired EXCLUSIVELY on live
  // venues — exactly where the kernel must not be short-circuited.
  const modeOverride = envRiskMode === "paper" && sandboxActive ? ("paper" as const) : undefined;

  // -- Evaluate ----------------------------------------------------------
  const decision = await riskKernel.evaluate(orderRequest, portfolioContext, {
    modeOverride,
    sandboxActive,
  });

  // Collect warning-level checks
  for (const check of decision.checks) {
    if (check.severity === "warning" && !check.passed) {
      warnings.push(check.details);
    }
  }

  // Determine final quantity
  const finalQty =
    decision.action === "modify" && decision.modifiedOrder
      ? decision.modifiedOrder.quantity
      : order.quantity;

  let approved = decision.approved;
  let reason = decision.reason ?? (decision.approved ? "Approved." : "Rejected.");
  let quantity = finalQty;

  // -- Safety projection --------------------------------------------------
  // Runs on the kernel's own output, so the projection can only move the order
  // further inside the feasible set, never back out of it.
  const drawdownBaseUsd =
    portfolioContext.peakEquity > 0 ? portfolioContext.peakEquity : portfolioContext.totalEquity;

  if (
    !referencePrice ||
    referencePrice <= 0 ||
    portfolioContext.totalEquity <= 0 ||
    quantity <= 0
  ) {
    warnings.push(
      "Safety projection skipped: no reference price or equity available for this order. Risk kernel result left unchanged.",
    );
  } else {
    const riskConfig = loadConfigFromEnv();
    const limits = limitsFromRiskConfig(riskConfig, drawdownBaseUsd);
    const concentrationCapUsd = concentrationCapFromRiskConfig(
      riskConfig,
      portfolioContext.totalEquity,
    );
    const proposedNotionalUsd = quantity * referencePrice;
    const signedNotionalUsd =
      orderRequest.side === "sell" ? -proposedNotionalUsd : proposedNotionalUsd;

    const state = buildSafetyState(
      order.symbol,
      orderRequest.side,
      proposedNotionalUsd,
      portfolioContext,
      concentrationCapUsd,
      drawdownBaseUsd,
      Date.now(),
    );

    const projection = projectAction(
      [{ symbol: order.symbol, notionalDelta: signedNotionalUsd }],
      state,
      limits,
    );

    if (projection.verdict !== "pass") {
      warnings.push(describeProjection(projection.telemetry));
    }

    if (projection.verdict === "soft_intercept" && projection.action) {
      const projectedLeg = projection.action.find((leg) => leg.symbol === order.symbol);
      const projectedQty = projectedLeg
        ? Math.floor((Math.abs(projectedLeg.notionalDelta) / referencePrice) * 1e8) / 1e8
        : 0;

      if (projectedQty <= 0) {
        approved = false;
        reason = `Rejected by safety projection: no feasible size remains for ${order.symbol} (binding constraint: ${projection.telemetry.tightestConstraint ?? "unknown"}).`;
      } else if (projectedQty < quantity) {
        warnings.push(
          `Size reduced from ${quantity} to ${projectedQty} by the ${projection.telemetry.tightestConstraint ?? "safety"} constraint.`,
        );
        quantity = projectedQty;
      }
    } else if (
      projection.verdict === "hard_intercept" ||
      projection.verdict === "infeasible" ||
      projection.verdict === "refused"
    ) {
      approved = false;
      reason = `Rejected by safety projection (${projection.verdict}): ${order.symbol} cannot be placed within the feasible set (binding constraint: ${projection.telemetry.tightestConstraint ?? "unknown"}).`;
    }
  }

  // -- Economic order floor ----------------------------------------------
  // The venue minimum is not the economic minimum: an order can clear the
  // exchange and still hand the commission a larger share than the operator's
  // fee tolerance allows.
  const feePolicy = resolveFeePolicy();
  if (!feePolicy) {
    warnings.push(
      `Economic order floor not evaluated: no fee schedule configured (set ${FEE_FIXED_PER_TRANCHE_ENV} and ${FEE_TRANCHE_SIZE_ENV}).`,
    );
  } else if (referencePrice && referencePrice > 0 && quantity > 0) {
    const notionalMinor = Math.round(quantity * referencePrice * 100);
    const admissibility = checkOrderAdmissibility({
      orders: [{ symbol: order.symbol, notionalMinor }],
      schedule: feePolicy.schedule,
      policy: feePolicy.policy,
    });

    const belowFloor = admissibility.violations.find((v) => v.kind === "below-economic-floor");
    if (belowFloor && belowFloor.kind === "below-economic-floor") {
      const notionalUsd = (belowFloor.notionalMinor / 100).toFixed(2);
      const floorUsd = (belowFloor.floorMinor / 100).toFixed(2);
      const shortfallUsd = (belowFloor.shortfallMinor / 100).toFixed(2);
      approved = false;
      reason = `Rejected below economic floor: ${order.symbol} notional $${notionalUsd} is $${shortfallUsd} short of the $${floorUsd} floor implied by the fee schedule at ${feePolicy.policy.feeToleranceBps} bps fee tolerance.`;
      warnings.push(
        `Economic floor $${floorUsd}, order notional $${notionalUsd}, shortfall $${shortfallUsd}. Below this size the fixed commission takes more than the configured tolerance.`,
      );
    }
  }

  return {
    approved,
    quantity,
    reason,
    warnings,
  };
}

// ============================================================================
// Mastra Tool
// ============================================================================

/**
 * Pre-check a proposed order against the Risk Kernel.
 * Agents can call this tool before placing an order to surface sizing
 * adjustments, warnings, or outright rejections.
 */
export const checkRiskTool = createTool({
  id: "check_risk",
  description:
    "Pre-check a proposed order against the risk kernel. Returns approval status, any size adjustments, and warnings. Call this before placing orders.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair symbol, e.g. BTCUSDT"),
    side: z.enum(["BUY", "SELL"]).describe("Order side: BUY or SELL"),
    type: z
      .enum(["MARKET", "LIMIT", "STOP_LIMIT"])
      .describe("type: order type — MARKET, LIMIT, or STOP_LIMIT"),
    quantity: z.number().describe("Order quantity in base asset"),
    price: z.number().optional().describe("Limit price (required for LIMIT/STOP_LIMIT)"),
    slotId: z.string().optional().describe("Strategy slot ID for consensus evaluation"),
    playbookName: z.string().optional().describe("Playbook name for consensus evaluation"),
    stopLoss: z.number().optional().describe("Stop loss price for consensus evaluation"),
    takeProfit: z
      .array(z.number())
      .optional()
      .describe("Take profit prices for consensus evaluation"),
  }),
  execute: async (input, execContext?: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx) {
      return { error: "Context not available." };
    }

    try {
      const result = await evaluateOrderRisk(
        {
          symbol: input.symbol,
          side: input.side,
          type: input.type,
          quantity: input.quantity,
          price: input.price,
        },
        ctx,
        "check_risk",
      );

      // Run consensus evaluation if we have enough context for a proposal
      let consensus: ConsensusResult | undefined;
      if (input.price && input.slotId) {
        try {
          const proposal: TradeProposal = {
            symbol: input.symbol,
            side: input.side === "BUY" ? "long" : "short",
            size_usd: input.quantity * (input.price ?? 0),
            playbook_name: input.playbookName ?? "unknown",
            slot_id: input.slotId,
            entry_price: input.price,
            stop_loss: input.stopLoss ?? input.price * 0.95,
            take_profit: input.takeProfit ?? [],
          };
          const riskVote: AgentVote = {
            agent: "risk",
            decision: result.approved ? "APPROVE" : "REJECT",
            confidence: result.approved ? 0.8 : 0.9,
            weight: 0.3,
            reason: result.reason,
          };
          consensus = await evaluateConsensus(proposal, { riskVote });
        } catch (consensusErr) {
          logger.debug("Consensus evaluation skipped", {
            error: (consensusErr as Error).message,
          });
        }
      }

      // If consensus was run and rejected, override approval
      const finalApproved = consensus
        ? result.approved && consensus.decision === "APPROVED"
        : result.approved;

      return {
        approved: finalApproved,
        originalQuantity: input.quantity,
        adjustedQuantity: result.quantity,
        sizeAdjusted: result.quantity !== input.quantity,
        reason:
          consensus && consensus.decision === "REJECTED"
            ? `Consensus rejected (score: ${consensus.score.toFixed(2)}): ${consensus.dissenting_agents.join(", ")}`
            : result.reason,
        warnings: result.warnings,
        consensus: consensus
          ? {
              decision: consensus.decision,
              score: consensus.score,
              quorumMet: consensus.quorum_met,
              dissenting: consensus.dissenting_agents,
            }
          : undefined,
      };
    } catch (err) {
      logger.error("check_risk tool failed", err as Error);
      return { error: `Risk check failed: ${(err as Error).message}` };
    }
  },
});
