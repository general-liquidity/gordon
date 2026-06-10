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
import type { OrderRequest } from "../../../../core/risk-kernel/audit.ts";
import { StrategyRuntime } from "../../../../core/runtime/engine.ts";
import { getGordonContext, type MastraExecutionContext } from "../types.ts";
import type { GordonContext } from "../types.ts";
import { createModuleLogger } from "../../../logger/index.ts";
import { evaluateBaselineCircuitBreakers } from "../../../../gateway/circuit-breakers/index.ts";
import { computeCircuitBreakerLiveData } from "../../../../gateway/circuit-breakers/data-provider.ts";
import { evaluateConsensus } from "../../../../core/consensus/protocol.ts";
import type { TradeProposal, ConsensusResult, AgentVote } from "../../../../core/consensus/protocol.ts";

const logger = createModuleLogger("risk-gate");

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

  // -- Build OrderRequest ------------------------------------------------
  const orderRequest: OrderRequest = {
    symbol: order.symbol,
    side: order.side.toLowerCase() as "buy" | "sell",
    type: order.type.toLowerCase().replace("-", "_") as "market" | "limit" | "stop_limit",
    quantity: order.quantity,
    price: order.price,
    exchangeId: ctx.exchange?.exchangeId ?? "unknown",
    agentId: agentId ?? "executor",
  };

  // -- Build PortfolioContext --------------------------------------------
  const builder = new PortfolioContextBuilder();
  let portfolioContext;

  if (ctx.exchange) {
    try {
      portfolioContext = await builder.buildFromExchange(ctx.exchange);
    } catch (err) {
      logger.warn("Could not build portfolio context from exchange, rejecting by fail-closed policy", {
        error: (err as Error).message,
      });
    }
  }

  if (!portfolioContext) {
    // Fail-closed: do not allow execution when portfolio context is unavailable
    return {
      approved: false,
      quantity: order.quantity,
      reason: "Rejected: portfolio context unavailable, risk checks could not be completed.",
      warnings: ["No exchange adapter available. Risk kernel evaluation blocked."],
    };
  }

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

  // -- Evaluate ----------------------------------------------------------
  const decision = await riskKernel.evaluate(orderRequest, portfolioContext);

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

  return {
    approved: decision.approved,
    quantity: finalQty,
    reason: decision.reason ?? (decision.approved ? "Approved." : "Rejected."),
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
    type: z.enum(["MARKET", "LIMIT", "STOP_LIMIT"]).describe("type: order type — MARKET, LIMIT, or STOP_LIMIT"),
    quantity: z.number().describe("Order quantity in base asset"),
    price: z.number().optional().describe("Limit price (required for LIMIT/STOP_LIMIT)"),
    slotId: z.string().optional().describe("Strategy slot ID for consensus evaluation"),
    playbookName: z.string().optional().describe("Playbook name for consensus evaluation"),
    stopLoss: z.number().optional().describe("Stop loss price for consensus evaluation"),
    takeProfit: z.array(z.number()).optional().describe("Take profit prices for consensus evaluation"),
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
        reason: consensus && consensus.decision === "REJECTED"
          ? `Consensus rejected (score: ${consensus.score.toFixed(2)}): ${consensus.dissenting_agents.join(", ")}`
          : result.reason,
        warnings: result.warnings,
        consensus: consensus ? {
          decision: consensus.decision,
          score: consensus.score,
          quorumMet: consensus.quorum_met,
          dissenting: consensus.dissenting_agents,
        } : undefined,
      };
    } catch (err) {
      logger.error("check_risk tool failed", err as Error);
      return { error: `Risk check failed: ${(err as Error).message}` };
    }
  },
});
