/**
 * Execution Discipline Tools — operator-facing Mastra tools that
 * wrap the Budish-derived primitives:
 *
 *   cross_internal_batch    — runs computeInternalBatch over a set
 *                             of pending orders, returns crossings +
 *                             residuals
 *   check_auction_window    — runs suggestAuctionDeferral for a
 *                             venue, returns shouldDefer + reason +
 *                             estimated savings
 *
 * These tools are operator-callable + agent-callable. The agent's
 * system prompt should reach for them during basket-trade or
 * non-urgent-order planning. The operator can invoke directly via
 * /cross-batch and /auction-check slash commands.
 *
 * Both tools are READ-ONLY (planning, not execution) — they don't
 * place orders. The operator/agent decides whether to act on the
 * suggested netting or deferral. The full auto-wire into execute_plan
 * is deferred (S29) until concrete operator usage signals it's worth
 * the execution-semantics change.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  computeInternalBatch,
  type BatchOrderInput,
} from "../../../../trading/execution/internalBatch.ts";
import {
  suggestAuctionDeferral,
  getAuctionWindowsForVenue,
} from "../../../../trading/execution/auctionWindow.ts";

// ============================================================================
// cross_internal_batch tool
// ============================================================================

export const crossInternalBatchTool = createTool({
  id: "cross_internal_batch",
  description:
    "Given a set of pending orders across one or more symbols, find offsetting " +
    "same-symbol opposite-side pairs and net them at midpoint price BEFORE routing " +
    "externally. Returns the internal crossings + external residuals + per-symbol " +
    "summary. Pure planning — does NOT place orders. Use during basket-trade or " +
    "portfolio-rebalance planning to avoid paying the sniping/MEV tax twice on " +
    "offsetting positions.",
  inputSchema: z.object({
    orders: z
      .array(
        z.object({
          orderId: z.string(),
          symbol: z.string(),
          side: z.enum(["buy", "sell"]),
          qty: z.number().positive(),
          referencePrice: z.number().positive(),
          strategyTag: z.string().optional(),
        }),
      )
      .min(1),
    minCrossQty: z
      .number()
      .nonnegative()
      .optional()
      .describe("Skip crossings below this quantity. Default 0 (always cross)."),
    requireDifferentStrategy: z
      .boolean()
      .default(false)
      .describe(
        "When true, only cross between different strategyTag values. Useful when " +
          "operator runs multi-strategy bucketing and wants single-strategy buy+sell " +
          "pairs to execute externally.",
      ),
  }),
  outputSchema: z.object({
    internalCrossings: z.array(
      z.object({
        symbol: z.string(),
        qty: z.number(),
        clearingPrice: z.number(),
        buyOrderId: z.string(),
        sellOrderId: z.string(),
      }),
    ),
    externalOrders: z.array(
      z.object({
        orderId: z.string(),
        symbol: z.string(),
        side: z.enum(["buy", "sell"]),
        originalQty: z.number(),
        residualQty: z.number(),
        referencePrice: z.number(),
      }),
    ),
    totalCrossedQty: z.number(),
    totalExternalQty: z.number(),
    symbolSummary: z.array(z.unknown()),
    summary: z.string(),
  }),
  execute: async ({ orders, minCrossQty, requireDifferentStrategy }) => {
    const result = computeInternalBatch(orders as BatchOrderInput[], {
      minCrossQty,
      requireDifferentStrategy,
    });
    return {
      internalCrossings: result.internalCrossings.map((c) => ({
        symbol: c.symbol,
        qty: c.qty,
        clearingPrice: c.clearingPrice,
        buyOrderId: c.buyOrderId,
        sellOrderId: c.sellOrderId,
      })),
      externalOrders: result.externalOrders.map((o) => ({
        orderId: o.orderId,
        symbol: o.symbol,
        side: o.side,
        originalQty: o.originalQty,
        residualQty: o.residualQty,
        referencePrice: o.referencePrice,
      })),
      totalCrossedQty: result.totalCrossedQty,
      totalExternalQty: result.totalExternalQty,
      symbolSummary: result.symbolSummary,
      summary: result.summary,
    };
  },
});

// ============================================================================
// check_auction_window tool
// ============================================================================

export const checkAuctionWindowTool = createTool({
  id: "check_auction_window",
  description:
    "For a venue + urgency level, suggest whether to defer a non-urgent order to " +
    "the next auction window (opening cross, closing cross, or continuous batch). " +
    "Returns shouldDefer + reason + secondsUntilNextAuction + estimated bps saved. " +
    "Currently knows: nasdaq, nyse (open/close auctions), cow_swap (30s batches). " +
    "Use BEFORE submitting a non-urgent order to see if auction routing saves cost.",
  inputSchema: z.object({
    venue: z.string().describe("Venue id — 'nasdaq', 'nyse', 'cow_swap', or other."),
    forceImmediate: z
      .boolean()
      .default(false)
      .describe(
        "When true, returns shouldDefer=false regardless of schedule. Use when the " +
          "trade is genuinely urgent (news event, stop-out, etc.).",
      ),
    maxDeferralSeconds: z
      .number()
      .positive()
      .default(1800)
      .describe("Max seconds the operator is willing to wait. Default 1800 (30 min)."),
    estimatedSavingsBps: z
      .number()
      .nonnegative()
      .default(1)
      .describe("Estimated bps saved by deferring. Default 1bp."),
  }),
  outputSchema: z.object({
    shouldDefer: z.boolean(),
    reason: z.string(),
    nextAuctionAt: z.string().nullable(),
    secondsUntilNextAuction: z.number().nullable(),
    estimatedSavingsBps: z.number().optional(),
    knownAuctionWindows: z.array(
      z.object({
        kind: z.string(),
        utcTime: z.string().optional(),
        cadenceSeconds: z.number().optional(),
        description: z.string(),
      }),
    ),
  }),
  execute: async ({ venue, forceImmediate, maxDeferralSeconds, estimatedSavingsBps }) => {
    const suggestion = suggestAuctionDeferral(venue, {
      forceImmediate,
      maxDeferralSeconds,
      estimatedSavingsBps,
    });
    const windows = getAuctionWindowsForVenue(venue);
    return {
      shouldDefer: suggestion.shouldDefer,
      reason: suggestion.reason,
      nextAuctionAt: suggestion.nextAuctionAt,
      secondsUntilNextAuction: suggestion.secondsUntilNextAuction,
      estimatedSavingsBps: suggestion.estimatedSavingsBps,
      knownAuctionWindows: windows.map((w) => ({
        kind: w.kind,
        utcTime: w.utcTime,
        cadenceSeconds: w.cadenceSeconds,
        description: w.description,
      })),
    };
  },
});

export const executionDisciplineTools = {
  cross_internal_batch: crossInternalBatchTool,
  check_auction_window: checkAuctionWindowTool,
};
