/**
 * Strategy Edge-Thesis Diagnostic Tool — ET1 wrapper.
 *
 * Agent-callable. Before deploying or backtesting a strategy, the
 * operator articulates the economic mechanism through four required
 * fields. The tool validates length thresholds, scans for known
 * data-mining anti-pattern phrases, and returns a structured record
 * with a stable hash that downstream consumers (backtest pipeline,
 * strategy registry, ACE Reflector) can stamp onto results.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  captureEdgeThesis,
  edgeThesisToPayload,
} from "../../../safety/anti-trap/strategyEdgeThesis.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const strategyEdgeThesisDiagnosticTool = createTool({
  id: "capture_strategy_edge_thesis",
  description:
    "Capture the four-field economic thesis for a strategy: what mispricing it exploits, who is on the other " +
    "side, why they consistently act that way, and why the inefficiency isn't arbitraged away. " +
    "Detects data-mining anti-pattern phrases (e.g., 'backtest showed', 'worked historically', " +
    "'trial and error') and returns warnings (informational mode, default) or rejects the thesis " +
    "(active mode). Returns a SHA-256 hash that downstream consumers can stamp onto backtest " +
    "results and ACE-distilled lessons.",
  inputSchema: z.object({
    strategyId: z.string().min(1).describe("Stable identifier for this strategy."),
    inefficiencyDescription: z
      .string()
      .min(30)
      .describe(
        "What mispricing or dislocation this strategy exploits, in plain language (≥30 chars).",
      ),
    counterpartyIdentification: z
      .string()
      .min(20)
      .describe(
        "Who is on the other side of these trades (e.g., 'passive index funds rebalancing at month-end'). ≥20 chars.",
      ),
    counterpartyConstraint: z
      .string()
      .min(20)
      .describe(
        "Why they consistently act this way — institutional mandate, behavioral bias, regulatory friction. ≥20 chars.",
      ),
    persistenceRationale: z
      .string()
      .min(20)
      .describe(
        "Why this inefficiency isn't arbitraged away — capacity limits, complexity, infra cost. ≥20 chars.",
      ),
    mode: z
      .enum(["informational", "active"])
      .optional()
      .describe(
        "informational (default) → anti-patterns produce warnings; active → anti-patterns block the thesis.",
      ),
  }),
  outputSchema: z.object({
    status: z.enum(["valid", "advisory_warning", "invalid"]),
    mode: z.enum(["informational", "active"]),
    record: z
      .object({
        strategyId: z.string(),
        inefficiencyDescription: z.string(),
        counterpartyIdentification: z.string(),
        counterpartyConstraint: z.string(),
        persistenceRationale: z.string(),
        recordedAt: z.string(),
        thesisHash: z.string(),
      })
      .nullable(),
    warnings: z.array(
      z.object({
        field: z.string(),
        pattern: z.string(),
        matchedText: z.string(),
      }),
    ),
    warningCount: z.number(),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = captureEdgeThesis({
      strategyId: input.strategyId,
      inefficiencyDescription: input.inefficiencyDescription,
      counterpartyIdentification: input.counterpartyIdentification,
      counterpartyConstraint: input.counterpartyConstraint,
      persistenceRationale: input.persistenceRationale,
      mode: input.mode,
    });
    recordStructuredObservation({
      eventType: "strategy_edge_thesis.captured",
      workflow: "strategy_authoring",
      source: "agent_tool",
      component: "capture_strategy_edge_thesis",
      toolName: "capture_strategy_edge_thesis",
      outcome: "info",
      details: { ...(edgeThesisToPayload(result) as Record<string, unknown>) },
    });
    return {
      status: result.status,
      mode: result.mode,
      record: result.record,
      warnings: result.warnings.map((w) => ({
        field: String(w.field),
        pattern: w.pattern,
        matchedText: w.matchedText,
      })),
      warningCount: result.warnings.length,
      reasoning: result.reasoning,
      summary: result.reasoning,
    };
  },
});

export const strategyEdgeThesisTools = {
  capture_strategy_edge_thesis: strategyEdgeThesisDiagnosticTool,
};
