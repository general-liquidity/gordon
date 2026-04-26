/**
 * Execution-cost comparison tool.
 *
 * Estimates the effective fill cost of a market order before placing it
 * — walks the live order book to compute slippage, applies the taker
 * fee, and returns a breakdown with all the numbers a trader needs to
 * decide.
 *
 * Output is structured so a future multi-venue extension (fetching
 * public order books from Coinbase / Kraken / OKX without requiring
 * credentials per venue) can plug straight into compareVenues() —
 * the algorithm doesn't change, only how many books we feed it.
 *
 * Inspired by the public-knowledge approach in Binance's
 * crypto-trade-analyzer; this is a clean-room TS implementation
 * compatible with our commercial license.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { computeCost, compareVenues, type CostInput } from "../../exchange/orderBookCost.ts";
import { getGordonContext, type MastraExecutionContext } from "./types.ts";

/** Conservative spot-trading taker fee that covers 90% of users (Binance
 *  base 0.1%, Coinbase 0.6%, Kraken 0.4%). Each venue can override this
 *  via `feeBps` input. We don't try to look up VIP tiers — that's data
 *  we don't reliably have, and surfacing a tier-aware estimate when we
 *  don't actually know the user's tier would be misleading. */
const DEFAULT_TAKER_BPS = 10;

export const compareExecutionCostTool = createTool({
  id: "compare_execution_cost",
  description:
    "Estimate the effective fill cost of a market order on the connected " +
    "exchange BEFORE placing it. Walks the live order book to surface " +
    "slippage, fee, effective price, and all-in cost. Use this to " +
    "validate that a trade size makes sense given current depth — " +
    "an order that crosses 5+ levels is a sign the venue may be too " +
    "thin for the requested size.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair, e.g. BTCUSDT"),
    side: z.enum(["buy", "sell"]),
    sizeBase: z.number().positive().describe("Trade size in base asset units (e.g. 0.5 BTC)"),
    feeBps: z
      .number()
      .nonnegative()
      .optional()
      .describe(
        "Taker fee in basis points. Defaults to 10 bps (0.1%) which matches " +
        "Binance spot. Override for venues with different fees (e.g. 60 for " +
        "Coinbase advanced taker).",
      ),
    referenceBasis: z
      .enum(["best", "mid"])
      .optional()
      .describe(
        "Where the reference price comes from for slippage calculation. " +
        "'best' = top of the relevant book side (default); 'mid' = midpoint " +
        "of best bid/ask. Mid is fairer for tight books, best for wide ones.",
      ),
    /** Order-book depth to fetch — more levels = more accurate for large
     *  trades, but the venue may cap the response. */
    bookLevels: z.number().int().positive().max(5000).optional(),
  }),
  outputSchema: z.object({
    venue: z.string(),
    symbol: z.string(),
    side: z.string(),
    sizeBase: z.number(),
    effectivePrice: z.number(),
    referencePrice: z.number(),
    slippageBps: z.number(),
    slippageQuote: z.number(),
    feeQuote: z.number(),
    notionalQuote: z.number(),
    allInQuote: z.number(),
    levelsConsumed: z.number(),
    /** Human-readable summary line ready to drop into a markdown response. */
    summary: z.string(),
    error: z.string().optional(),
  }),
  execute: async (
    {
      symbol,
      side,
      sizeBase,
      feeBps,
      referenceBasis,
      bookLevels,
    }: {
      symbol: string;
      side: "buy" | "sell";
      sizeBase: number;
      feeBps?: number;
      referenceBasis?: "best" | "mid";
      bookLevels?: number;
    },
    execContext: MastraExecutionContext,
  ) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return {
        venue: "exchange",
        symbol,
        side,
        sizeBase,
        effectivePrice: 0,
        referencePrice: 0,
        slippageBps: 0,
        slippageQuote: 0,
        feeQuote: 0,
        notionalQuote: 0,
        allInQuote: 0,
        levelsConsumed: 0,
        summary: "",
        error: "No exchange connected. Configure a venue with /configure exchange.",
      };
    }
    const venue =
      (execContext?.requestContext?.get("exchangeId") as string | undefined) ?? "exchange";
    try {
      const book = await ctx.exchange.getOrderBook(symbol, bookLevels ?? 100);
      const taker = (feeBps ?? DEFAULT_TAKER_BPS) / 10_000;
      const breakdown = computeCost({
        venue,
        book,
        side,
        sizeBase,
        fee: { taker },
        referenceBasis,
      });
      const slippageBps = Math.round(breakdown.slippageRate * 10_000);
      const summary =
        `${venue} · ${side.toUpperCase()} ${sizeBase} ${symbol} → ` +
        `effective ${breakdown.effectivePrice.toFixed(4)} ` +
        `(ref ${breakdown.referencePrice.toFixed(4)}, slip ${slippageBps} bps), ` +
        `fee ${breakdown.feeQuote.toFixed(4)}, ` +
        `${side === "buy" ? "all-in cost" : "net proceeds"} ${breakdown.allInQuote.toFixed(4)} ` +
        `(${breakdown.levelsConsumed} level${breakdown.levelsConsumed !== 1 ? "s" : ""} consumed)`;
      return {
        venue,
        symbol,
        side,
        sizeBase,
        effectivePrice: breakdown.effectivePrice,
        referencePrice: breakdown.referencePrice,
        slippageBps,
        slippageQuote: breakdown.slippageQuote,
        feeQuote: breakdown.feeQuote,
        notionalQuote: breakdown.notionalQuote,
        allInQuote: breakdown.allInQuote,
        levelsConsumed: breakdown.levelsConsumed,
        summary,
      };
    } catch (e) {
      return {
        venue,
        symbol,
        side,
        sizeBase,
        effectivePrice: 0,
        referencePrice: 0,
        slippageBps: 0,
        slippageQuote: 0,
        feeQuote: 0,
        notionalQuote: 0,
        allInQuote: 0,
        levelsConsumed: 0,
        summary: "",
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
});

export const executionCostTools = {
  compare_execution_cost: compareExecutionCostTool,
} as const;

// Re-export the comparison helper so other tools (e.g. a future
// multi-venue scanner) can reuse the shared algorithm without an extra
// indirection.
export { compareVenues, computeCost } from "../../exchange/orderBookCost.ts";
export type { CostInput };
