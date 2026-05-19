/**
 * Kalman Beta Diagnostic Tool — exposed via /kalman-beta slash command.
 *
 * Estimates a time-varying regression coefficient between an asset's
 * returns and a market index's returns using a Kalman filter. The
 * hedge-fund-grade alternative to OLS-over-fixed-window beta.
 *
 * Operator-callable on any pair of return series. Returns the current
 * beta + uncertainty band + range observed over the input. Composes with
 * downstream sizing primitives that need a live beta rather than a
 * lagged historical average.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  kalmanBeta,
  kalmanBetaToPayload,
} from "../../../trading/quant/kalmanBeta.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const kalmanBetaDiagnosticTool = createTool({
  id: "compute_kalman_beta",
  description:
    "Estimate a time-varying beta (regression coefficient) between an asset's returns and a market index's returns using a Kalman filter. " +
    "Use when the operator asks `/kalman-beta`, or when a hedge ratio / factor decomposition / dynamic exposure adjustment requires a live current-state beta instead of a lagged window average. " +
    "Returns latest beta + one-sigma uncertainty + min/max range observed over the input.",
  inputSchema: z.object({
    assetReturns: z
      .array(z.number())
      .min(1)
      .describe("Per-period returns of the asset (e.g. AAPL daily returns)."),
    marketReturns: z
      .array(z.number())
      .min(1)
      .describe("Per-period returns of the market index (e.g. SPY daily returns). Must align with assetReturns."),
    q: z
      .number()
      .positive()
      .default(1e-5)
      .describe("Process noise variance. Smaller = smoother estimate. Default 1e-5."),
    r: z
      .number()
      .positive()
      .default(1e-3)
      .describe("Measurement noise variance. Smaller = trust observations more. Default 1e-3."),
    beta0: z
      .number()
      .default(1.0)
      .describe("Initial beta prior. Default 1.0."),
  }),
  outputSchema: z.object({
    currentBeta: z.number(),
    currentStdDev: z.number(),
    minBeta: z.number(),
    maxBeta: z.number(),
    meanBeta: z.number(),
    sampleSize: z.number(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = kalmanBeta({
      assetReturns: input.assetReturns,
      marketReturns: input.marketReturns,
      q: input.q,
      r: input.r,
      beta0: input.beta0,
    });

    const summary =
      `Dynamic beta: ${result.currentBeta.toFixed(3)} (±${result.currentStdDev.toFixed(3)} 1σ). ` +
      `Range over ${result.sampleSize} observations: [${result.minBeta.toFixed(3)}, ${result.maxBeta.toFixed(3)}], mean ${result.meanBeta.toFixed(3)}.`;

    recordStructuredObservation({
      eventType: "kalman_beta.requested",
      workflow: "execution",
      source: "agent_tool",
      component: "compute_kalman_beta",
      toolName: "compute_kalman_beta",
      outcome: "info",
      details: { ...(kalmanBetaToPayload(result) as Record<string, unknown>) },
    });

    return {
      currentBeta: Number(result.currentBeta.toFixed(4)),
      currentStdDev: Number(result.currentStdDev.toFixed(4)),
      minBeta: Number(result.minBeta.toFixed(4)),
      maxBeta: Number(result.maxBeta.toFixed(4)),
      meanBeta: Number(result.meanBeta.toFixed(4)),
      sampleSize: result.sampleSize,
      summary,
    };
  },
});

export const kalmanBetaTools = {
  compute_kalman_beta: kalmanBetaDiagnosticTool,
};
