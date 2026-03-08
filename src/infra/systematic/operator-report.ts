import { z } from "zod";

export const operatorSeveritySchema = z.enum(["info", "success", "warning", "error"]);
export type OperatorSeverity = z.infer<typeof operatorSeveritySchema>;

export const operatorMetricSchema = z.object({
  label: z.string(),
  value: z.string(),
  tone: operatorSeveritySchema.optional(),
});
export type OperatorMetric = z.infer<typeof operatorMetricSchema>;

export const operatorTableColumnSchema = z.object({
  key: z.string(),
  header: z.string(),
  align: z.enum(["left", "right"]).default("left"),
});
export interface OperatorTableColumnInput {
  key: string;
  header: string;
  align?: "left" | "right";
}
export type OperatorTableColumn = z.infer<typeof operatorTableColumnSchema>;

export const operatorTableRowSchema = z.record(z.string(), z.string());
export type OperatorTableRow = Record<string, string>;

export const operatorTableSchema = z.object({
  title: z.string(),
  columns: z.array(operatorTableColumnSchema),
  rows: z.array(operatorTableRowSchema),
});
export interface OperatorTableInput {
  title: string;
  columns: OperatorTableColumnInput[];
  rows: OperatorTableRow[];
}
export type OperatorTable = z.infer<typeof operatorTableSchema>;

export const operatorGateSchema = z.object({
  name: z.string(),
  status: z.enum(["pass", "warn", "fail"]),
  score: z.number().optional(),
  detail: z.string(),
  blocker: z.boolean().default(false),
});
export interface OperatorGateInput {
  name: string;
  status: "pass" | "warn" | "fail";
  score?: number;
  detail: string;
  blocker?: boolean;
}
export type OperatorGate = z.infer<typeof operatorGateSchema>;

export const operatorDiffSchema = z.object({
  label: z.string(),
  baseline: z.string(),
  current: z.string(),
  delta: z.string().optional(),
  status: z.enum(["better", "worse", "same", "mixed", "n/a"]).default("n/a"),
});
export interface OperatorDiffInput {
  label: string;
  baseline: string;
  current: string;
  delta?: string;
  status?: "better" | "worse" | "same" | "mixed" | "n/a";
}
export type OperatorDiff = z.infer<typeof operatorDiffSchema>;

export const operatorActionSchema = z.object({
  label: z.string(),
  command: z.string(),
  priority: z.enum(["now", "next", "later"]).default("next"),
  rationale: z.string().optional(),
});
export interface OperatorActionInput {
  label: string;
  command: string;
  priority?: "now" | "next" | "later";
  rationale?: string;
}
export type OperatorAction = z.infer<typeof operatorActionSchema>;

export const operatorReportSchema = z.object({
  title: z.string(),
  status: operatorSeveritySchema.default("info"),
  summary: z.string(),
  metrics: z.array(operatorMetricSchema).default([]),
  tables: z.array(operatorTableSchema).default([]),
  gates: z.array(operatorGateSchema).default([]),
  diffs: z.array(operatorDiffSchema).default([]),
  warnings: z.array(z.string()).default([]),
  actions: z.array(operatorActionSchema).default([]),
});
export type OperatorReport = z.infer<typeof operatorReportSchema>;

export interface OperatorReportInput {
  title: string;
  status: OperatorSeverity;
  summary: string;
  metrics?: OperatorMetric[];
  tables?: OperatorTableInput[];
  gates?: OperatorGateInput[];
  diffs?: OperatorDiffInput[];
  warnings?: string[];
  actions?: OperatorActionInput[];
}

export function normalizeOperatorReport(report: OperatorReportInput): OperatorReport {
  return {
    title: report.title,
    status: report.status,
    summary: report.summary,
    metrics: report.metrics ?? [],
    tables: (report.tables ?? []).map((table) => ({
      title: table.title,
      columns: table.columns.map((column) => ({
        key: column.key,
        header: column.header,
        align: column.align ?? "left",
      })),
      rows: table.rows,
    })),
    gates: (report.gates ?? []).map((gate) => ({
      name: gate.name,
      status: gate.status,
      score: gate.score,
      detail: gate.detail,
      blocker: gate.blocker ?? false,
    })),
    diffs: (report.diffs ?? []).map((diff) => ({
      label: diff.label,
      baseline: diff.baseline,
      current: diff.current,
      delta: diff.delta,
      status: diff.status ?? "n/a",
    })),
    warnings: report.warnings ?? [],
    actions: (report.actions ?? []).map((action) => ({
      label: action.label,
      command: action.command,
      priority: action.priority ?? "next",
      rationale: action.rationale,
    })),
  };
}

function pad(value: string, width: number, align: "left" | "right"): string {
  if (value.length >= width) return value;
  return align === "right"
    ? value.padStart(width, " ")
    : value.padEnd(width, " ");
}

function truncate(value: string, width: number): string {
  if (value.length <= width) return value;
  if (width <= 1) return value.slice(0, width);
  return `${value.slice(0, width - 1)}…`;
}

function statusGlyph(status: OperatorSeverity | OperatorGate["status"] | OperatorDiff["status"]): string {
  switch (status) {
    case "success":
    case "pass":
    case "better":
      return "[OK]";
    case "warning":
    case "warn":
    case "mixed":
      return "[!]";
    case "error":
    case "fail":
    case "worse":
      return "[X]";
    default:
      return "[ ]";
  }
}

function renderTable(table: OperatorTable): string[] {
  const widths = table.columns.map((column) => {
    const headerWidth = column.header.length;
    const maxCellWidth = table.rows.reduce((max, row) => {
      const value = row[column.key] ?? "-";
      return Math.max(max, value.length);
    }, 0);
    return Math.min(Math.max(headerWidth, maxCellWidth, 4), 36);
  });

  const header = table.columns
    .map((column, index) => pad(column.header, widths[index] ?? column.header.length, column.align ?? "left"))
    .join(" | ");
  const divider = table.columns
    .map((_, index) => "-".repeat(widths[index] ?? 4))
    .join("-|-");

  const lines = [table.title, header, divider];
  for (const row of table.rows) {
    const line = table.columns
      .map((column, index) => {
        const rawValue = row[column.key] ?? "-";
        return pad(
          truncate(rawValue, widths[index] ?? rawValue.length),
          widths[index] ?? rawValue.length,
          column.align ?? "left",
        );
      })
      .join(" | ");
    lines.push(line);
  }
  return lines;
}

export function formatOperatorReport(report: OperatorReportInput): string {
  const normalized = normalizeOperatorReport(report);
  const metrics = normalized.metrics;
  const tables = normalized.tables;
  const gates = normalized.gates;
  const diffs = normalized.diffs;
  const warnings = normalized.warnings;
  const actions = normalized.actions;
  const lines: string[] = [];

  lines.push(`=== ${normalized.title.toUpperCase()} === ${statusGlyph(normalized.status)}`);
  lines.push(normalized.summary);

  if (metrics.length > 0) {
    lines.push("");
    lines.push("Metrics");
    for (const metric of metrics) {
      lines.push(`- ${metric.label}: ${metric.value}`);
    }
  }

  for (const table of tables) {
    lines.push("");
    lines.push(...renderTable(table));
  }

  if (gates.length > 0) {
    lines.push("");
    lines.push("Validation Gates");
    lines.push("Gate | Status | Score | Detail");
    lines.push("---- | ------ | ----- | ------");
    for (const gate of gates) {
      lines.push(
        `${gate.name} | ${statusGlyph(gate.status)} | ${gate.score !== undefined ? gate.score.toFixed(1) : "-"} | ${gate.detail}`,
      );
    }
  }

  if (diffs.length > 0) {
    lines.push("");
    lines.push("Diffs");
    lines.push("Metric | Baseline | Current | Delta | Status");
    lines.push("------ | -------- | ------- | ----- | ------");
    for (const diff of diffs) {
      lines.push(
        `${diff.label} | ${diff.baseline} | ${diff.current} | ${diff.delta ?? "-"} | ${statusGlyph(diff.status ?? "n/a")}`,
      );
    }
  }

  if (warnings.length > 0) {
    lines.push("");
    lines.push("Warnings");
    for (const warning of warnings) {
      lines.push(`- ${warning}`);
    }
  }

  if (actions.length > 0) {
    lines.push("");
    lines.push("Next Actions");
    actions.forEach((action, index) => {
      const rationale = action.rationale ? ` - ${action.rationale}` : "";
      lines.push(`${index + 1}. ${action.command} (${action.label})${rationale}`);
    });
  }

  return lines.join("\n");
}
