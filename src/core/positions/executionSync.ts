/**
 * Wire executed plans into the position state machine.
 */

import { getEventBus } from "../../events/index.ts";
import type { Plan } from "../../types/plan.ts";
import type { Trade } from "../../types/trade.ts";
import { getPositionManager } from "./manager.ts";
import { getPositionStore } from "./store.ts";
import { TERMINAL_STATES } from "./types.ts";
import { createModuleLogger } from "../../infra/logger/index.ts";

const logger = createModuleLogger("position-execution-sync");

/**
 * Best-effort terminal-state cleanup for a partially-synced position.
 * Goes straight to the store (no event bus, no FSM) so it cannot fail for
 * the same reason the sync chain did — otherwise the position would be left
 * stranded in a pre-fill state as a phantom row.
 */
async function cancelDebrisPosition(positionId: string, reason: string): Promise<void> {
  try {
    const store = await getPositionStore();
    const existing = await store.get(positionId);
    if (!existing || TERMINAL_STATES.has(existing.state)) return;
    await store.update(positionId, { state: "cancelled", cancelReason: reason });
  } catch {
    // best-effort — the phantom read-filter and reconciliation sweep cover the rest
  }
}

export async function recordExecutedPlanPosition(
  plan: Plan,
  trade: Trade,
  exchangeId: string,
  portfolioIdentity?: string,
): Promise<string | null> {
  let positionId: string | null = null;
  try {
    const bus = getEventBus();
    const pm = await getPositionManager(bus);
    // `||`, not `??`: an unfilled limit entry has averageEntry 0 — fall
    // through to the plan price instead of recording a zero-entry fill.
    const entryPrice = (trade.averageEntry || plan.entry.price) ?? 0;
    const qty =
      trade.entries[0]?.quantity || (entryPrice > 0 ? plan.allocation.amount / entryPrice : 0);

    const position = await pm.reportSetup(
      {
        symbol: plan.symbol,
        strategy: plan.strategy,
        confidence: 0.7,
        setupType: plan.strategy,
        price: entryPrice,
        notes: `Synced from execute_plan ${plan.id}`,
      },
      {
        exchangeId,
        side: plan.direction,
        portfolioIdentity,
        tradeId: trade.id,
      },
    );
    positionId = position.id;

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

    // Phantom guard: without positive entry data there is nothing real to
    // record as a fill — cancel instead of persisting a zero-qty position.
    if (!(entryPrice > 0) || !(qty > 0)) {
      await pm.cancel(position.id, "phantom guard: no usable fill data from execution");
      return null;
    }

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
    if (positionId) {
      await cancelDebrisPosition(
        positionId,
        "position sync failed — auto-cancelled (phantom guard)",
      );
    }
    return null;
  }
}
