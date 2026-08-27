/**
 * Playbook Protocol Tools (Mastra Format)
 *
 * Agent tools for working with the formal Playbook Protocol.
 * Provides validation, export, import, and comparison capabilities
 * so agents can programmatically manipulate playbook definitions.
 *
 * All operations are wrapped in try/catch — protocol failures
 * should never crash agent execution.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { playbookRegistry } from "./registry.ts";
import { playbookToProtocol, protocolToJSON, jsonToProtocol } from "./converter.ts";
import { validatePlaybook } from "./validator.ts";
import { PLAYBOOK_PROTOCOL_VERSION } from "./protocol.ts";
import { createModuleLogger } from "../../infra/logger/index.ts";

const logger = createModuleLogger("protocol-tools");

// ============================================================================
// Validate Playbook Tool
// ============================================================================

export const validatePlaybookTool = createTool({
  id: "validate_playbook",
  description:
    "Validate a playbook against the formal Playbook Protocol v" +
    PLAYBOOK_PROTOCOL_VERSION +
    ". Checks schema compliance, logical consistency, and warns on risky configurations. " +
    "Use when user asks to 'validate', 'check', or 'lint' a playbook.",
  inputSchema: z.object({
    playbook_id: z
      .string()
      .describe(
        "Playbook ID (kebab-case, e.g., 'momentum-breakout') to validate from the registry",
      ),
  }),
  outputSchema: z.object({
    playbook_id: z.string().optional(),
    protocol_version: z.string().optional(),
    valid: z.boolean().optional(),
    errors: z.array(z.string()).optional(),
    warnings: z.array(z.string()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ playbook_id }) => {
    try {
      const pb = playbookRegistry.getOrThrow(playbook_id);
      const protocol = playbookToProtocol(pb);
      const result = validatePlaybook(protocol);

      return {
        playbook_id: pb.id,
        protocol_version: PLAYBOOK_PROTOCOL_VERSION,
        valid: result.valid,
        errors: result.errors,
        warnings: result.warnings,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("validate_playbook failed", {
        error: message,
        playbookId: playbook_id,
      });
      return { error: message };
    }
  },
});

// ============================================================================
// Export Playbook Tool
// ============================================================================

export const exportPlaybookTool = createTool({
  id: "export_playbook",
  description:
    "Export a playbook as a formal Protocol JSON document. " +
    "The output is a canonical, machine-readable representation of the strategy " +
    "that can be imported into other systems. " +
    "Use when user asks to 'export', 'serialize', or 'share' a playbook.",
  inputSchema: z.object({
    playbook_id: z
      .string()
      .describe("Playbook ID (kebab-case, e.g., 'momentum-breakout') to export"),
  }),
  outputSchema: z.object({
    playbook_id: z.string().optional(),
    protocol_version: z.string().optional(),
    json: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ playbook_id }) => {
    try {
      const pb = playbookRegistry.getOrThrow(playbook_id);
      const protocol = playbookToProtocol(pb);
      const json = protocolToJSON(protocol);

      return {
        playbook_id: pb.id,
        protocol_version: PLAYBOOK_PROTOCOL_VERSION,
        json,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("export_playbook failed", {
        error: message,
        playbookId: playbook_id,
      });
      return { error: message };
    }
  },
});

// ============================================================================
// Import Playbook Tool
// ============================================================================

export const importPlaybookTool = createTool({
  id: "import_playbook",
  description:
    "Import a playbook from a Protocol JSON document. " +
    "Validates the JSON against the protocol schema and reports any issues. " +
    "Use when user provides a JSON playbook to 'import' or 'load'.",
  inputSchema: z.object({
    json: z.string().describe("Protocol JSON string to import"),
  }),
  outputSchema: z.object({
    success: z.boolean().optional(),
    playbook_name: z.string().optional(),
    playbook_slug: z.string().optional(),
    protocol_version: z.string().optional(),
    validation: z
      .object({
        valid: z.boolean(),
        errors: z.array(z.string()),
        warnings: z.array(z.string()),
      })
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ json }) => {
    try {
      const protocol = jsonToProtocol(json);
      const result = validatePlaybook(protocol);

      return {
        success: result.valid,
        playbook_name: protocol.name,
        playbook_slug: protocol.slug,
        protocol_version: protocol.protocol_version,
        validation: {
          valid: result.valid,
          errors: result.errors,
          warnings: result.warnings,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("import_playbook failed", { error: message });
      return { error: message };
    }
  },
});

// ============================================================================
// Compare Playbooks Tool
// ============================================================================

export const comparePlaybooksTool = createTool({
  id: "compare_playbooks",
  description:
    "Compare two playbooks' parameters side-by-side in protocol format. " +
    "Shows differences in entry conditions, exit rules, risk management, and execution. " +
    "Use when user asks to 'compare', 'diff', or 'contrast' two strategies.",
  inputSchema: z.object({
    playbook_id_a: z.string().describe("First playbook ID (kebab-case)"),
    playbook_id_b: z.string().describe("Second playbook ID (kebab-case)"),
  }),
  outputSchema: z.object({
    comparison: z
      .object({
        playbook_a: z.string(),
        playbook_b: z.string(),
        differences: z.array(
          z.object({
            field: z.string(),
            value_a: z.string(),
            value_b: z.string(),
          }),
        ),
        summary: z.string(),
      })
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ playbook_id_a, playbook_id_b }) => {
    try {
      const pbA = playbookRegistry.getOrThrow(playbook_id_a);
      const pbB = playbookRegistry.getOrThrow(playbook_id_b);
      const protoA = playbookToProtocol(pbA);
      const protoB = playbookToProtocol(pbB);

      const differences = compareProtocols(protoA, protoB);

      return {
        comparison: {
          playbook_a: protoA.name,
          playbook_b: protoB.name,
          differences,
          summary: `Found ${differences.length} difference${differences.length === 1 ? "" : "s"} between "${protoA.name}" and "${protoB.name}"`,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("compare_playbooks failed", {
        error: message,
        playbookIdA: playbook_id_a,
        playbookIdB: playbook_id_b,
      });
      return { error: message };
    }
  },
});

// ============================================================================
// Comparison Helper
// ============================================================================

interface FieldDifference {
  field: string;
  value_a: string;
  value_b: string;
}

/**
 * Compare two PlaybookProtocol objects and return a list of differences.
 */
function compareProtocols(
  a: { [key: string]: unknown } & Record<string, unknown>,
  b: { [key: string]: unknown } & Record<string, unknown>,
): FieldDifference[] {
  const diffs: FieldDifference[] = [];

  const fieldsToCompare: Array<{
    label: string;
    path: (obj: Record<string, unknown>) => unknown;
  }> = [
    { label: "Tier", path: (o) => o.tier },
    { label: "Timeframe", path: (o) => o.timeframe },
    { label: "Regimes", path: (o) => JSON.stringify(o.regimes) },
    { label: "Assets", path: (o) => JSON.stringify(o.assets) },
    {
      label: "Entry — Indicators Count",
      path: (o) => {
        const entry = o.entry as Record<string, unknown> | undefined;
        const indicators = entry?.indicators as unknown[] | undefined;
        return indicators?.length ?? 0;
      },
    },
    {
      label: "Entry — Confluence Required",
      path: (o) => {
        const entry = o.entry as Record<string, unknown> | undefined;
        return entry?.confluence_required ?? 0;
      },
    },
    {
      label: "Stop Loss Type",
      path: (o) => {
        const exit = o.exit as Record<string, unknown> | undefined;
        const sl = exit?.stop_loss as Record<string, unknown> | undefined;
        return sl?.type ?? "unknown";
      },
    },
    {
      label: "Stop Loss Value",
      path: (o) => {
        const exit = o.exit as Record<string, unknown> | undefined;
        const sl = exit?.stop_loss as Record<string, unknown> | undefined;
        return sl?.value ?? 0;
      },
    },
    {
      label: "Take Profit Levels",
      path: (o) => {
        const exit = o.exit as Record<string, unknown> | undefined;
        const tp = exit?.take_profit as unknown[] | undefined;
        return JSON.stringify(tp ?? []);
      },
    },
    {
      label: "Max Risk Per Trade %",
      path: (o) => {
        const risk = o.risk as Record<string, unknown> | undefined;
        return risk?.max_risk_per_trade_percent ?? 0;
      },
    },
    {
      label: "Max Position Size %",
      path: (o) => {
        const risk = o.risk as Record<string, unknown> | undefined;
        return risk?.max_position_size_percent ?? 0;
      },
    },
    {
      label: "Max Concurrent Positions",
      path: (o) => {
        const risk = o.risk as Record<string, unknown> | undefined;
        return risk?.max_concurrent_positions ?? 0;
      },
    },
    {
      label: "Order Type",
      path: (o) => {
        const exec = o.execution as Record<string, unknown> | undefined;
        return exec?.order_type ?? "unknown";
      },
    },
    {
      label: "Entry Method",
      path: (o) => {
        const exec = o.execution as Record<string, unknown> | undefined;
        return exec?.entry_method ?? "unknown";
      },
    },
  ];

  for (const { label, path } of fieldsToCompare) {
    const valA = String(path(a));
    const valB = String(path(b));
    if (valA !== valB) {
      diffs.push({ field: label, value_a: valA, value_b: valB });
    }
  }

  return diffs;
}

// ============================================================================
// Export as Object (Mastra format)
// ============================================================================

/**
 * Protocol tools exported as an object for Mastra Agent.
 * This is the format expected by Mastra's Agent class.
 */
export const protocolTools = {
  validate_playbook: validatePlaybookTool,
  export_playbook: exportPlaybookTool,
  import_playbook: importPlaybookTool,
  compare_playbooks: comparePlaybooksTool,
};
