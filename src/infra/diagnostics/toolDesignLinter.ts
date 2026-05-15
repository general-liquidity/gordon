/**
 * Tool Design Linter (GORDON_TOOL_DESIGN_LINTER).
 *
 * Static analysis on Gordon's tool registry. Encodes the anti-patterns
 * Anthropic names in "Writing Tools for Agents" (2026):
 *
 *   - tool proliferation (lots of overlapping wrappers around one API)
 *   - generic parameter names (`id`, `user`, `data`)
 *   - missing namespacing (no shared prefix)
 *   - short / unclear descriptions
 *   - missing `response_format` enum on tools with potentially large output
 *   - low-level identifiers in output (uuid, mime_type, ...)
 *
 * The linter is intentionally pure-functional — caller supplies a
 * list of `ToolDescriptor` objects (extracted from Mastra tool defs
 * or wherever) and gets back a list of `LintFinding`s. No I/O.
 *
 * Pair with `boundaries.ts` (architectural import rules) — both are
 * static analyses; both feed into Gordon's diagnostics surface.
 */

export const TOOL_DESIGN_LINTER_FLAG_ENV = "GORDON_TOOL_DESIGN_LINTER";

export type Severity = "info" | "warn" | "error";

export interface ToolParameter {
  name: string;
  /** Type as a string (e.g. "string", "number", "object"). */
  type?: string;
  description?: string;
}

export interface ToolDescriptor {
  /** Unique tool name (e.g. "get_candles"). */
  name: string;
  description?: string;
  parameters?: ToolParameter[];
  /** Optional namespace inferred or supplied (e.g. "broker", "exchange"). */
  namespace?: string;
}

export interface LintFinding {
  ruleId: string;
  severity: Severity;
  toolName: string;
  message: string;
  fixInstruction: string;
}

export interface LintReport {
  totalTools: number;
  findings: LintFinding[];
  countsBySeverity: Record<Severity, number>;
  /** True when zero error-severity findings. */
  passes: boolean;
}

export function isToolDesignLinterEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env[TOOL_DESIGN_LINTER_FLAG_ENV] === "1" ||
    env[TOOL_DESIGN_LINTER_FLAG_ENV] === "true"
  );
}

// ============================================================================
// Rules
// ============================================================================

const GENERIC_PARAM_NAMES = new Set(["id", "user", "data", "input", "value", "item", "thing"]);
const MIN_DESCRIPTION_CHARS = 20;
const LOW_LEVEL_NAME_TOKENS = ["uuid", "mime_type", "256px_image_url"];

function rule_namespace(tool: ToolDescriptor): LintFinding | null {
  if (!tool.namespace && !tool.name.includes("_") && !tool.name.includes(".")) {
    return {
      ruleId: "namespacing",
      severity: "warn",
      toolName: tool.name,
      message: `tool name "${tool.name}" lacks namespacing (no prefix or namespace property)`,
      fixInstruction:
        "Add a namespace prefix (e.g. 'broker_', 'market_', 'risk_') or set the namespace property. Anthropic: 'namespacing helps delineate boundaries between lots of tools.'",
    };
  }
  return null;
}

function rule_generic_params(tool: ToolDescriptor): LintFinding[] {
  if (!tool.parameters) return [];
  const out: LintFinding[] = [];
  for (const p of tool.parameters) {
    if (GENERIC_PARAM_NAMES.has(p.name.toLowerCase())) {
      out.push({
        ruleId: "generic_param_name",
        severity: "warn",
        toolName: tool.name,
        message: `parameter "${p.name}" is too generic`,
        fixInstruction: `Rename "${p.name}" to something disambiguating. Anthropic recommends "user_id" over "user", "order_id" over "id", etc.`,
      });
    }
  }
  return out;
}

function rule_description_length(tool: ToolDescriptor): LintFinding | null {
  const desc = (tool.description ?? "").trim();
  if (desc.length < MIN_DESCRIPTION_CHARS) {
    return {
      ruleId: "description_too_short",
      severity: "warn",
      toolName: tool.name,
      message: `description is ${desc.length} chars (min ${MIN_DESCRIPTION_CHARS})`,
      fixInstruction:
        "Describe the tool as you would to a new hire. Include what it does, when to use it, and how it differs from related tools.",
    };
  }
  return null;
}

function rule_low_level_identifiers(tool: ToolDescriptor): LintFinding[] {
  if (!tool.parameters) return [];
  const out: LintFinding[] = [];
  for (const p of tool.parameters) {
    const name = p.name.toLowerCase();
    for (const token of LOW_LEVEL_NAME_TOKENS) {
      if (name.includes(token)) {
        out.push({
          ruleId: "low_level_identifier",
          severity: "info",
          toolName: tool.name,
          message: `parameter "${p.name}" exposes low-level identifier "${token}"`,
          fixInstruction:
            "Agents tend to grapple with cryptic identifiers. Prefer semantic names (e.g. 'symbol' over 'asset_uuid', 'tool_name' over 'tool_id').",
        });
      }
    }
  }
  return out;
}

function rule_missing_response_format(tool: ToolDescriptor): LintFinding | null {
  // Heuristic: if name suggests potentially-large output AND no `response_format` parameter present.
  const looksLarge = /^(list|search|query|fetch|get_(?:all|candles|orderbook|trades|news|history))/i.test(
    tool.name,
  );
  if (!looksLarge) return null;
  const hasFormat = (tool.parameters ?? []).some(
    (p) => p.name.toLowerCase() === "response_format" || p.name.toLowerCase() === "format",
  );
  if (!hasFormat) {
    return {
      ruleId: "missing_response_format",
      severity: "info",
      toolName: tool.name,
      message: "tool may return large output but exposes no response_format / format parameter",
      fixInstruction:
        "Add an optional response_format: 'concise' | 'detailed' parameter so agents can request a smaller payload. Anthropic recommends this for any tool with potentially large output.",
    };
  }
  return null;
}

function rule_no_description(tool: ToolDescriptor): LintFinding | null {
  if (!tool.description || tool.description.trim().length === 0) {
    return {
      ruleId: "no_description",
      severity: "error",
      toolName: tool.name,
      message: "tool has no description",
      fixInstruction: "Every tool must have a description. Without one, agents cannot decide when to call it.",
    };
  }
  return null;
}

// ============================================================================
// Linter
// ============================================================================

export function lintTool(tool: ToolDescriptor): LintFinding[] {
  const findings: LintFinding[] = [];
  const noDesc = rule_no_description(tool);
  if (noDesc) findings.push(noDesc);
  const ns = rule_namespace(tool);
  if (ns) findings.push(ns);
  findings.push(...rule_generic_params(tool));
  const descLen = rule_description_length(tool);
  if (descLen) findings.push(descLen);
  findings.push(...rule_low_level_identifiers(tool));
  const rf = rule_missing_response_format(tool);
  if (rf) findings.push(rf);
  return findings;
}

export function lintToolRegistry(tools: readonly ToolDescriptor[]): LintReport {
  const findings: LintFinding[] = [];
  for (const tool of tools) findings.push(...lintTool(tool));
  const counts: Record<Severity, number> = { info: 0, warn: 0, error: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return {
    totalTools: tools.length,
    findings,
    countsBySeverity: counts,
    passes: counts.error === 0,
  };
}

export function formatLintReport(report: LintReport): string {
  const lines: string[] = [];
  lines.push(
    `Tool design lint — ${report.passes ? "PASS" : "FAIL"} (${report.totalTools} tools, ${report.countsBySeverity.error} error, ${report.countsBySeverity.warn} warn, ${report.countsBySeverity.info} info)`,
  );
  for (const f of report.findings) {
    lines.push(`  [${f.severity.toUpperCase()}] ${f.toolName} — ${f.ruleId}: ${f.message}`);
    lines.push(`    fix: ${f.fixInstruction}`);
  }
  return lines.join("\n");
}

export function reportToPayload(report: LintReport): Record<string, unknown> {
  return {
    kind: "tool_design_lint.report_recorded",
    passes: report.passes,
    totalTools: report.totalTools,
    counts: report.countsBySeverity,
    findingCount: report.findings.length,
  };
}
