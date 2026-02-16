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

import { riskKernel } from "../../../core/risk-kernel/index.ts";
import { PortfolioContextBuilder } from "../../../core/risk-kernel/portfolio-context.ts";
import type { OrderRequest } from "../../../core/risk-kernel/audit.ts";
import { getGordonContext, type MastraExecutionContext } from "./types.ts";
import type { GordonContext } from "./types.ts";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("risk-gate");

// ============================================================================
// Helper
// ============================================================================

/**
 * Evaluate an order against the Risk Kernel.
 *
 * Builds a PortfolioContext from the live exchange adapter when available.
 * If the adapter is missing (paper mode, no keys configured) the order is
 * approved with a warning so we never silently block trades just because
 * context could not be built.
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
      logger.warn("Could not build portfolio context from exchange, approving with warning", {
        error: (err as Error).message,
      });
      warnings.push("Portfolio context unavailable — risk checks ran with defaults.");
    }
  }

  if (!portfolioContext) {
    // Fallback: approve without full context rather than blocking
    return {
      approved: true,
      quantity: order.quantity,
      reason: "Approved (portfolio context unavailable — risk checks skipped).",
      warnings: ["No exchange adapter available. Risk kernel evaluation skipped."],
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
    symbol: z.string(),
    side: z.enum(["BUY", "SELL"]),
    type: z.enum(["MARKET", "LIMIT", "STOP_LIMIT"]),
    quantity: z.number(),
    price: z.number().optional(),
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

      return {
        approved: result.approved,
        originalQuantity: input.quantity,
        adjustedQuantity: result.quantity,
        sizeAdjusted: result.quantity !== input.quantity,
        reason: result.reason,
        warnings: result.warnings,
      };
    } catch (err) {
      logger.error("check_risk tool failed", err as Error);
      return { error: `Risk check failed: ${(err as Error).message}` };
    }
  },
});
