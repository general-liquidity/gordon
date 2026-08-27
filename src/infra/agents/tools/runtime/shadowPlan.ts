/**
 * Shadow plan tool — exposed via /shadow slash command.
 *
 * Wraps `runShadowChain` from infra/trading/ops/shadowChain.ts as a
 * Mastra tool. Captures the most recent invocation for /rate to bind
 * its rating to a specific plan and for retry-detection to identify
 * "user issued shadow then immediately re-issued similar shadow" as
 * an implicit dissatisfaction signal (Langfuse user-feedback pattern).
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { runShadowChain } from "../../../trading/ops/shadowChain.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

interface RecentShadowState {
  planId: string;
  symbol: string;
  direction: "long" | "short";
  entry: number;
  invokedAtMs: number;
}

let lastShadow: RecentShadowState | null = null;

export function getLastShadowPlanForTesting(): RecentShadowState | null {
  return lastShadow;
}

export function _resetLastShadowForTesting(): void {
  lastShadow = null;
}

const RETRY_WINDOW_MS = 60_000;
const RETRY_ENTRY_TOLERANCE_FRACTION = 0.02;

function detectImplicitRetry(current: {
  symbol: string;
  direction: "long" | "short";
  entry: number;
  invokedAtMs: number;
}): boolean {
  if (!lastShadow) return false;
  if (current.invokedAtMs - lastShadow.invokedAtMs > RETRY_WINDOW_MS) return false;
  if (lastShadow.symbol !== current.symbol) return false;
  if (lastShadow.direction !== current.direction) return false;
  const entryDelta = Math.abs(lastShadow.entry - current.entry) / Math.max(lastShadow.entry, 1);
  return entryDelta <= RETRY_ENTRY_TOLERANCE_FRACTION;
}

export const shadowPlanTool = createTool({
  id: "shadow_plan",
  description:
    "Run a synthetic plan through Gordon's full pre-trade Wright chain (marginal-participant, edge-attribution, risk-bundle, sizer, barriers, kill-list, liquidity-map, streak, give-back) WITHOUT placing a trade. " +
    "Returns a markdown verdict + structured payload. Use when the user says `/shadow` or wants Gordon to evaluate a hypothetical trade as a second opinion. " +
    "This is Gordon's operator-shadow product surface — no real orders are routed.",
  inputSchema: z.object({
    direction: z.enum(["long", "short"]).describe("Trade direction"),
    symbol: z.string().min(1).describe("Symbol (e.g. BTCUSDT, AAPL, CL)"),
    entry: z.number().positive().describe("Entry price"),
    stop: z.number().positive().describe("Stop-loss price"),
    targets: z.array(z.number().positive()).min(1).default([]).describe("Take-profit ladder"),
    strategy: z.string().optional().describe("Strategy label (e.g. breakout, mean_reversion)"),
    edgeArticulation: z
      .string()
      .optional()
      .describe(
        "Operator's edge articulation. Should pass Lebron's 5-min test (>=15 words) to score valid_edge.",
      ),
    drivers: z
      .array(z.string())
      .default([])
      .describe(
        "Marginal-participant drivers — e.g. ['margin_call_cascade','vix_spike']. See marginalParticipantClassifier.ts.",
      ),
    tier: z.enum(["I", "II", "III"]).default("I").describe("Trade tier (defaults to I)"),
    edgeType: z
      .enum(["behavioral", "analytical", "informational", "structural"])
      .default("structural"),
  }),
  outputSchema: z.object({
    planId: z.string(),
    verdict: z.string(),
    blockerCount: z.number(),
    summary: z.string(),
    implicitRetry: z.boolean(),
  }),
  execute: async (input) => {
    const invokedAtMs = Date.now();
    const result = runShadowChain({
      direction: input.direction,
      symbol: input.symbol,
      entry: input.entry,
      stop: input.stop,
      targets: input.targets,
      strategy: input.strategy,
      edgeArticulation: input.edgeArticulation,
      drivers: input.drivers as never,
      tier: input.tier,
      edgeType: input.edgeType,
    });

    const implicitRetry = detectImplicitRetry({
      symbol: input.symbol,
      direction: input.direction,
      entry: input.entry,
      invokedAtMs,
    });

    lastShadow = {
      planId: result.planId,
      symbol: input.symbol,
      direction: input.direction,
      entry: input.entry,
      invokedAtMs,
    };

    if (implicitRetry) {
      recordStructuredObservation({
        eventType: "shadow_chain.implicit_retry",
        workflow: "execution",
        source: "agent_tool",
        component: "shadow_plan",
        toolName: "shadow_plan",
        outcome: "info",
        symbol: input.symbol,
        details: {
          planId: result.planId,
          windowMs: RETRY_WINDOW_MS,
          entryToleranceFraction: RETRY_ENTRY_TOLERANCE_FRACTION,
        },
      });
    }

    return {
      planId: result.planId,
      verdict: result.overallVerdict,
      blockerCount: result.blockers.length,
      summary: result.summary,
      implicitRetry,
    };
  },
});

export const shadowPlanTools = {
  shadow_plan: shadowPlanTool,
};
