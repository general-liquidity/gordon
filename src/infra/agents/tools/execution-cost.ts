/**
 * Execution-cost comparison tool.
 *
 * Estimates the effective fill cost of a market order BEFORE placing
 * it. Walks the live order book of one or more venues, applies the
 * taker fee, computes slippage, and returns either a single-venue
 * breakdown OR a multi-venue ranking with savings-vs-best.
 *
 * Default venue list: Binance, Coinbase, Kraken, OKX (all public
 * read-only — no credentials required). USD conversion for non-USD-
 * quoted pairs is handled via the configured exchange's price oracle.
 *
 * Inspired by the public algorithm in Binance's crypto-trade-analyzer.
 * Implementation is clean-room (the math is public exchange-
 * microstructure knowledge) and license-clean for commercial use.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  computeCost,
  compareVenues,
  type CostInput,
} from "../../exchange/orderBookCost.ts";
import {
  PUBLIC_VENUES,
  fetchPublicBooks,
  isUsdQuote,
  splitSymbol,
  type PublicVenue,
} from "../../exchange/publicOrderBooks.ts";
import { getGordonContext, type MastraExecutionContext } from "./types.ts";

const VENUE_ENUM = ["binance", "coinbase", "kraken", "okx"] as const;
const ALL_VENUES: PublicVenue[] = [...VENUE_ENUM];

export const compareExecutionCostTool = createTool({
  id: "compare_execution_cost",
  description:
    "Estimate the effective fill cost of a market order BEFORE placing " +
    "it. Walks live order books across one or more venues (Binance, " +
    "Coinbase, Kraken, OKX by default — all public, no auth needed) and " +
    "ranks them by all-in cost. Use to validate a trade size against " +
    "current depth and to surface the cheapest venue for the user. " +
    "Output includes effective price, slippage in bps, fee, and " +
    "savings-vs-best so callers can show a 'Binance vs Coinbase vs " +
    "Kraken' comparison row.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair, e.g. BTCUSDT or BTC-USD"),
    side: z.enum(["buy", "sell"]),
    sizeBase: z.number().positive().describe("Trade size in base asset units (e.g. 0.5 BTC)"),
    venues: z
      .array(z.enum(VENUE_ENUM))
      .optional()
      .describe(
        "Venues to compare. Default: all four (Binance, Coinbase, " +
        "Kraken, OKX). Pass a single venue to skip cross-venue fetches.",
      ),
    referenceBasis: z
      .enum(["best", "mid"])
      .optional()
      .describe("Slippage reference: 'best' (top of book) or 'mid' (midpoint). Default 'best'."),
    bookLevels: z.number().int().positive().max(5000).optional(),
    /** Optional fee override applied to ALL venues — usually leave unset
     *  so per-venue baselines (Binance 10 bps, Coinbase 60, Kraken 26,
     *  OKX 10) drive the math. */
    feeBpsOverride: z.number().nonnegative().optional(),
  }),
  outputSchema: z.object({
    symbol: z.string(),
    side: z.string(),
    sizeBase: z.number(),
    quoteAsset: z.string().optional(),
    usdPerQuote: z.number().optional(),
    /** Sorted best-to-worst on the all-in metric. */
    ranked: z.array(
      z.object({
        venue: z.string(),
        effectivePrice: z.number(),
        referencePrice: z.number(),
        slippageBps: z.number(),
        slippageQuote: z.number(),
        feeQuote: z.number(),
        feeBps: z.number(),
        notionalQuote: z.number(),
        allInQuote: z.number(),
        allInUsd: z.number().optional(),
        savingsVsBestQuote: z.number(),
        savingsVsBestUsd: z.number().optional(),
        levelsConsumed: z.number(),
      }),
    ),
    errors: z.array(z.object({ venue: z.string(), error: z.string() })),
    /** Human-readable single-line summary the LLM can drop straight into
     *  a markdown response. */
    summary: z.string(),
  }),
  execute: async (
    {
      symbol,
      side,
      sizeBase,
      venues,
      referenceBasis,
      bookLevels,
      feeBpsOverride,
    }: {
      symbol: string;
      side: "buy" | "sell";
      sizeBase: number;
      venues?: PublicVenue[];
      referenceBasis?: "best" | "mid";
      bookLevels?: number;
      feeBpsOverride?: number;
    },
    execContext: MastraExecutionContext,
  ) => {
    const requested = (venues && venues.length > 0 ? venues : ALL_VENUES) as PublicVenue[];
    const split = splitSymbol(symbol);
    const quoteAsset = split?.quote;

    // USD conversion. Stables are 1:1; non-stable quotes get converted
    // via the connected exchange's price oracle when possible.
    let usdPerQuote: number | undefined = quoteAsset && isUsdQuote(quoteAsset) ? 1 : undefined;
    if (!usdPerQuote && quoteAsset) {
      try {
        const ctx = getGordonContext(execContext);
        if (ctx?.exchange) {
          // Try fetching the live price of the quote asset against USDT.
          const ex = ctx.exchange as { getPrice?: (sym: string) => Promise<number> };
          if (typeof ex.getPrice === "function") {
            usdPerQuote = await ex.getPrice(`${quoteAsset}USDT`).catch(() => undefined);
          }
        }
      } catch {
        // Non-fatal — leave undefined so the output skips USD figures
        // rather than surfacing a misleading number.
      }
    }

    const fetched = await fetchPublicBooks(symbol, requested, bookLevels ?? 100);

    const errors: Array<{ venue: string; error: string }> = [];
    const inputs: CostInput[] = [];

    for (const r of fetched) {
      if (!r.book) {
        errors.push({ venue: r.label, error: r.error ?? "Symbol not listed" });
        continue;
      }
      const fee = (feeBpsOverride ?? r.takerBps) / 10_000;
      inputs.push({
        venue: r.label,
        book: r.book,
        side,
        sizeBase,
        fee: { taker: fee },
        referenceBasis,
      });
    }

    if (inputs.length === 0) {
      return {
        symbol,
        side,
        sizeBase,
        quoteAsset,
        usdPerQuote,
        ranked: [],
        errors,
        summary: `No venue could price ${side.toUpperCase()} ${sizeBase} ${symbol}.`,
      };
    }

    // Single-venue path bypasses compareVenues so we don't pay the sort
    // overhead for one item — but the structure stays the same for
    // callers.
    let ranked = inputs.length === 1
      ? [computeCost(inputs[0]!)]
      : compareVenues(inputs).ranked;
    const buyMode = side === "buy";
    const best = ranked[0]!.allInQuote;

    const venueFeeBps: Record<string, number> = {};
    for (const inp of inputs) venueFeeBps[inp.venue] = inp.fee.taker * 10_000;

    const enriched = ranked.map((b) => {
      const savings = buyMode ? b.allInQuote - best : best - b.allInQuote;
      const allInUsd = usdPerQuote ? b.allInQuote * usdPerQuote : undefined;
      const savingsUsd = usdPerQuote ? savings * usdPerQuote : undefined;
      return {
        venue: b.venue,
        effectivePrice: b.effectivePrice,
        referencePrice: b.referencePrice,
        slippageBps: Math.round(b.slippageRate * 10_000),
        slippageQuote: b.slippageQuote,
        feeQuote: b.feeQuote,
        feeBps: Math.round(venueFeeBps[b.venue] ?? 0),
        notionalQuote: b.notionalQuote,
        allInQuote: b.allInQuote,
        allInUsd,
        savingsVsBestQuote: savings,
        savingsVsBestUsd: savingsUsd,
        levelsConsumed: b.levelsConsumed,
      };
    });

    const top = enriched[0]!;
    const ladder = enriched.map((r) => `${r.venue} ${r.allInQuote.toFixed(4)}${quoteAsset ?? ""}`).join(" · ");
    const summary =
      `${side.toUpperCase()} ${sizeBase} ${symbol} → cheapest: ${top.venue} ` +
      `(eff ${top.effectivePrice.toFixed(4)}, slip ${top.slippageBps} bps, ` +
      `fee ${top.feeBps} bps). All-in: ${ladder}.`;

    return {
      symbol,
      side,
      sizeBase,
      quoteAsset,
      usdPerQuote,
      ranked: enriched,
      errors,
      summary,
    };
  },
});

export const executionCostTools = {
  compare_execution_cost: compareExecutionCostTool,
} as const;

export { compareVenues, computeCost } from "../../exchange/orderBookCost.ts";
export type { CostInput };
