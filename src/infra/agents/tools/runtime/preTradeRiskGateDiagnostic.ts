/**
 * Pre-Trade Risk Layer Gate Diagnostic Tool — agent-callable wrapper.
 *
 * Wraps `checkPreTradeRiskGate` from core/alpha/pre-trade-risk-gate.ts.
 * Institutional 4-layer composite enforced BEFORE every trade:
 * position-size / correlation-cluster / sector-aggregate / multi-window
 * drawdown. Returns layered pass/fail + composite verdict.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { checkPreTradeRiskGate } from "../../../../core/alpha/pre-trade-risk-gate.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

const positionSchema = z.object({
  symbol: z.string(),
  sector: z.string(),
  exposurePct: z.number().min(0),
  side: z.enum(["LONG", "SHORT"]),
  returnSeries: z.array(z.number()).optional(),
});

export const preTradeRiskGateDiagnosticTool = createTool({
  id: "check_pre_trade_risk_gate",
  description:
    "Institutional 4-layer pre-trade risk gate. Checks the proposed trade against (1) per-trade " +
    "exposure cap (default 0.5%), (2) correlated-cluster cap (default 0.75%), (3) sector aggregate " +
    "cap (default 4%), and (4) multi-window drawdown cap (daily 1% / weekly 2%). Returns layered " +
    "pass/fail + composite verdict (allow / block_position_size / block_correlation / block_sector / " +
    "block_drawdown_window / data_gap). Missing inputs trigger data_gap rather than silent allow — " +
    "by design. Use as final gate after riskClassifier 15-dim audit (8 base + 7 optional).",
  inputSchema: z.object({
    proposal: positionSchema.describe("Proposed trade with sector + exposure %."),
    existingPositions: z
      .array(positionSchema)
      .default([])
      .describe("Open positions for correlation + sector aggregation."),
    recentDailyPnl: z
      .array(z.number())
      .default([])
      .describe(
        "Recent daily PnL (oldest → newest, fractions of AUM). Last entry treated as 'today'.",
      ),
    maxPerTradeRiskPct: z.number().min(0).optional().describe("Default 0.005 (0.5%)."),
    maxCorrelatedClusterPct: z.number().min(0).optional().describe("Default 0.0075 (0.75%)."),
    correlationThreshold: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("|corr| to count as 'correlated'. Default 0.5."),
    maxSectorExposurePct: z.number().min(0).optional().describe("Default 0.04 (4%)."),
    dailyDrawdownLimitPct: z.number().min(0).optional().describe("Default 0.01 (1%)."),
    weeklyDrawdownLimitPct: z.number().min(0).optional().describe("Default 0.02 (2%)."),
    weeklyWindowDays: z.number().int().min(1).optional().describe("Default 5."),
    minReturnSeriesForCorrelation: z
      .number()
      .int()
      .min(2)
      .optional()
      .describe("Default 10."),
  }),
  outputSchema: z.object({
    proposedSymbol: z.string(),
    proposedSector: z.string(),
    proposedExposurePct: z.number(),
    layers: z.array(
      z.object({
        layer: z.enum(["position_size", "correlation", "sector", "drawdown_window"]),
        status: z.enum(["passed", "blocked", "data_gap"]),
        observed: z.number(),
        threshold: z.number(),
        description: z.string(),
        detail: z.record(z.string(), z.unknown()).optional(),
      }),
    ),
    blockingLayer: z
      .enum(["position_size", "correlation", "sector", "drawdown_window"])
      .nullable(),
    verdict: z.enum([
      "allow",
      "block_position_size",
      "block_correlation",
      "block_sector",
      "block_drawdown_window",
      "data_gap",
    ]),
    allowed: z.boolean(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = checkPreTradeRiskGate(
      input.proposal,
      input.existingPositions,
      input.recentDailyPnl,
      {
        maxPerTradeRiskPct: input.maxPerTradeRiskPct,
        maxCorrelatedClusterPct: input.maxCorrelatedClusterPct,
        correlationThreshold: input.correlationThreshold,
        maxSectorExposurePct: input.maxSectorExposurePct,
        dailyDrawdownLimitPct: input.dailyDrawdownLimitPct,
        weeklyDrawdownLimitPct: input.weeklyDrawdownLimitPct,
        weeklyWindowDays: input.weeklyWindowDays,
        minReturnSeriesForCorrelation: input.minReturnSeriesForCorrelation,
      },
    );
    recordStructuredObservation({
      eventType: "pre_trade_risk_gate.checked",
      workflow: "audit",
      source: "agent_tool",
      component: "check_pre_trade_risk_gate",
      toolName: "check_pre_trade_risk_gate",
      outcome: result.allowed ? "info" : "failure",
      details: {
        verdict: result.verdict,
        blockingLayer: result.blockingLayer,
        proposedSymbol: result.proposedSymbol,
        proposedSector: result.proposedSector,
        proposedExposurePct: result.proposedExposurePct,
      },
    });
    return result;
  },
});

export const preTradeRiskGateTools = {
  check_pre_trade_risk_gate: preTradeRiskGateDiagnosticTool,
};
