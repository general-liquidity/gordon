/**
 * Composability Audit Tool — operator-facing Mastra tool that wraps
 * captureComposabilityReport.
 *
 * Surface: /components slash command + composability_audit tool id.
 *
 * Returns either the structured report (for the agent to reason
 * about) or the formatted text rendering (for direct CLI output).
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  captureComposabilityReport,
  formatComposabilityReport,
} from "../../../composability/report.ts";

export const composabilityAuditTool = createTool({
  id: "composability_audit",
  description:
    "Audit Gordon's pluggability axes — LLM providers, exchanges, brokers, skills, " +
    "MCP servers, peer agents, strategy recipes, risk dimensions, alpha diagnostics, " +
    "audit layers. Returns active + available counts per axis. Use when operator asks " +
    "what's swappable, what alternatives exist, or wants to demonstrate Gordon's open-" +
    "harness composability vs vertically-integrated frontier-lab agentic services.",
  inputSchema: z.object({
    format: z
      .enum(["structured", "text"])
      .default("structured")
      .describe(
        "structured: return JSON report. text: return operator-readable rendering with ✓/○ markers + per-axis description + sample components.",
      ),
  }),
  outputSchema: z.object({
    capturedAt: z.string(),
    totalAxes: z.number(),
    totalActive: z.number(),
    totalAvailable: z.number(),
    slots: z.array(z.unknown()).optional(),
    summary: z.string(),
    text: z.string().optional(),
  }),
  execute: async ({ format }) => {
    const report = captureComposabilityReport();
    if (format === "text") {
      return {
        capturedAt: report.capturedAt,
        totalAxes: report.totalAxes,
        totalActive: report.totalActive,
        totalAvailable: report.totalAvailable,
        summary: report.summary,
        text: formatComposabilityReport(report),
      };
    }
    return {
      capturedAt: report.capturedAt,
      totalAxes: report.totalAxes,
      totalActive: report.totalActive,
      totalAvailable: report.totalAvailable,
      slots: report.slots,
      summary: report.summary,
    };
  },
});

export const composabilityTools = {
  composability_audit: composabilityAuditTool,
};
