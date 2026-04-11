/**
 * Producer Health Tool
 *
 * Exposes the ProducerHealthTracker so agents can answer "which proactive
 * producers are actually alive right now?" independent of the suggestion
 * store. Useful for diagnosing silent radar mode (producers registered but
 * not firing) and for detecting data source outages (Finnhub down, Binance
 * public API rate-limited, etc.).
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { getProducerHealthTracker } from "../../proactive/producerHealth.ts";

export const getProducerHealthTool = createTool({
  id: "get_producer_health",
  description:
    "Report the health of proactive mode producers. For each producer, " +
    "shows last-seen time, age, status (active / stale / silent / errored / " +
    "never_run), total runs, total candidates fired, and any recent errors. " +
    "Use for diagnosing silent radar mode or spotting producers that are " +
    "degraded due to upstream outages.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    overall: z.enum(["healthy", "degraded", "down"]),
    staleCount: z.number(),
    erroredCount: z.number(),
    totalCandidatesFired: z.number(),
    producers: z.array(
      z.object({
        name: z.string(),
        lastSeenAt: z.string().nullable(),
        ageSeconds: z.number().nullable(),
        status: z.string(),
        totalRuns: z.number(),
        totalCandidatesFired: z.number(),
        totalErrors: z.number(),
        lastError: z.string().optional(),
      }),
    ),
  }),
  execute: async () => {
    return getProducerHealthTracker().report();
  },
});

export const producerHealthTools = {
  get_producer_health: getProducerHealthTool,
};
