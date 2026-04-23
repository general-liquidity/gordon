/**
 * Venue Routing Tool
 *
 * Wraps `venueRouter.routeOrder` + `publicFactory.createAllPublicExchanges`
 * as an agent-callable tool. Lets Planner / Executor agents compare
 * execution prices across every accessible venue before placing an order.
 *
 * "Accessible" = the currently active exchange (authenticated) plus the
 * set of public-only adapters that support unauth'd quote endpoints
 * (Binance, Binance US, Coinbase, Kraken, Bitfinex).
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { getGordonContext, type MastraExecutionContext } from "./types.ts";
import {
  routeOrder,
  formatRecommendation,
  type OrderIntent,
} from "../../execution/venueRouter.ts";
import { createAllPublicExchanges } from "../../exchange/publicFactory.ts";
import type { Exchange } from "../../exchange/types.ts";

export const compareVenuesTool = createTool({
  id: "compare_venues",
  description:
    "Compare execution prices across connected + public venues before placing a crypto order. " +
    "Returns a ranked list by effective price (price + fee) plus estimated savings vs worst-ranked venue. " +
    "Use this before any buy/sell when the user has expressed agnostic intent about venue.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g. 'BTCUSDT', 'ETHUSDT')"),
    side: z.enum(["buy", "sell"]),
    quantity: z.number().positive().describe("Order size in base asset"),
  }),
  outputSchema: z.object({
    recommendation: z.string().optional(),
    bestVenue: z.string().optional(),
    bestEffectivePrice: z.number().optional(),
    estimatedSavings: z.number().optional(),
    venueCount: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, side, quantity }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);

    // Assemble venues: active authenticated exchange (if any) + public adapters.
    // Dedup by exchangeId — if user is authenticated to Binance, don't double-count
    // with the public Binance adapter.
    const seen = new Set<string>();
    const venues: Exchange[] = [];
    if (ctx?.exchange) {
      venues.push(ctx.exchange);
      seen.add(ctx.exchange.exchangeId);
    }
    for (const publicVenue of createAllPublicExchanges()) {
      if (!seen.has(publicVenue.exchangeId)) {
        venues.push(publicVenue);
        seen.add(publicVenue.exchangeId);
      }
    }

    if (venues.length === 0) {
      return { error: "No venues available. Connect an exchange or check public-adapter support." };
    }

    try {
      const intent: OrderIntent = { symbol, side, quantity };
      const rec = await routeOrder(intent, venues);
      const best = rec.ranked[0];
      return {
        recommendation: formatRecommendation(rec),
        bestVenue: best?.venueId,
        bestEffectivePrice: best?.effectivePrice,
        estimatedSavings: rec.estimatedSavings,
        venueCount: rec.ranked.length,
      };
    } catch (error) {
      return { error: `Venue comparison failed: ${(error as Error).message}` };
    }
  },
});

export const venueRoutingTools = {
  compare_venues: compareVenuesTool,
};
