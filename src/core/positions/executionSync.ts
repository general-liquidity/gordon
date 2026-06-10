/**
 * Wire executed plans into the position state machine.
 */

import { getEventBus } from "../../events/index.ts";
import type { Plan } from "../../types/plan.ts";
import type { Trade } from "../../types/trade.ts";
import { getPositionManager } from "./manager.ts";
import { createModuleLogger } from "../../infra/logger/index.ts";

const logger = createModuleLogger("position-execution-sync");

export async function recordExecutedPlanPosition(
  plan: Plan,
  trade: Trade,
  exchangeId: string,
): Promise<string | null> {
  try {
    const bus = getEventBus();
    const pm = await getPositionManager(bus);
    const entryPrice = trade.averageEntry ?? plan.entry.price ?? 0;
    const qty = trade.entries[0]?.quantity ?? plan.allocation.amount / (entryPrice || 1);

    const position = await pm.reportSetup({
      symbol: plan.symbol,
      strategy: plan.strategy,
      confidence: 0.7,
      setupType: plan.strategy,
      price: entryPrice,
      notes: `Synced from execute_plan ${plan.id}`,
    });

    await pm.reportAnalysis(position.id, {
      bias: plan.direction === "short" ? "bearish" : "bullish",
      confidence: 0.7,
      notes: plan.reasoning,
    });

    await pm.reportPlan(position.id, {
      planId: plan.id,
      entry: entryPrice,
      entryType: plan.entry.type === "market" ? "market" : "limit",
      stopLoss: plan.stopLoss.price,
      takeProfits: plan.takeProfit.map((tp) => tp.price),
      positionSizePct: plan.allocation.percentOfPortfolio * 100,
      allocationAmount: plan.allocation.amount,
      strategy: plan.strategy,
    });

    await pm.approve(position.id);

    const orderId = trade.entries[0]?.orderId ?? trade.id;
    await pm.reportOrdered(position.id, {
      orderId,
      type: plan.entry.type === "market" ? "market" : "limit",
      side: plan.direction === "short" ? "sell" : "buy",
      price: plan.entry.price ?? undefined,
      quantity: qty,
      status: "filled",
      placedAt: new Date().toISOString(),
      filledAt: new Date().toISOString(),
    });

    await pm.reportFilled(position.id, {
      entryPrice,
      quantity: qty,
      stopLoss: plan.stopLoss.price,
      takeProfit: plan.takeProfit[0]?.price,
    });

    return position.id;
  } catch (err) {
    logger.warn("position FSM sync failed (non-blocking)", {
      planId: plan.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}