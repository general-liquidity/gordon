/**
 * Playbook Format Converters
 *
 * Bidirectional conversion between the existing Markdown playbook format,
 * the formal PlaybookProtocol schema, and canonical JSON.
 *
 * Conversion from Markdown is necessarily lossy — existing playbooks don't
 * carry all protocol fields. We apply sensible defaults for missing data.
 */

import { v4 as uuidv4 } from "uuid";
import { PLAYBOOK_PROTOCOL_VERSION, PlaybookProtocolSchema } from "./protocol.ts";
import type { PlaybookProtocol } from "./protocol.ts";
import type { Playbook } from "./types.ts";

// ============================================================================
// Markdown -> Protocol
// ============================================================================

/**
 * Convert a raw Markdown playbook string into a PlaybookProtocol object.
 *
 * NOTE: To avoid a circular dependency (parser <-> converter), this function
 * dynamically imports the parser. Prefer using PlaybookParser.parseToProtocol()
 * directly when you already have a parser instance.
 *
 * @param markdown - Raw playbook Markdown with YAML frontmatter
 * @returns A PlaybookProtocol object
 */
export async function markdownToProtocol(markdown: string): Promise<PlaybookProtocol> {
  // Dynamic import to break circular dependency with parser.ts
  const { PlaybookParser } = await import("./parser.ts");
  const parser = new PlaybookParser();
  const pb = parser.parse(markdown, "builtin");
  return playbookToProtocol(pb);
}

/**
 * Convert a parsed Playbook (the existing internal type) to PlaybookProtocol.
 *
 * @param pb - Parsed Playbook object
 * @returns A PlaybookProtocol object
 */
export function playbookToProtocol(pb: Playbook): PlaybookProtocol {
  // Map tier number to protocol tier enum
  const tierMap: Record<number, "1-conservative" | "2-moderate" | "3-aggressive"> = {
    1: "1-conservative",
    2: "2-moderate",
    3: "3-aggressive",
  };

  // Infer timeframe category from the playbook's timeframes list
  const timeframeCategory = inferTimeframeCategory(pb.timeframes);

  // Build indicators from trigger conditions
  const indicators = pb.trigger.conditions.map((cond) => {
    const params: Record<string, string | number> = {};
    if (cond.timeframe) {
      params.timeframe = cond.timeframe;
    }
    return {
      name: cond.indicator ?? "custom",
      params,
      condition: formatCondition(cond.comparison, cond.value),
    };
  });

  // Build take profit levels from execution data
  const takeProfitLevels = buildTakeProfitLevels(pb);

  // Infer stop loss type mapping
  const stopLossTypeMap: Record<
    string,
    "fixed_percent" | "atr_multiple" | "support_level" | "trailing"
  > = {
    fixed_percent: "fixed_percent",
    atr: "atr_multiple",
    structure: "support_level",
    custom: "fixed_percent",
  };

  // Infer order type mapping
  const orderTypeMap: Record<string, "market" | "limit" | "bracket"> = {
    market: "market",
    limit: "limit",
    stop_limit: "bracket",
  };

  // Build the protocol object
  const protocol: PlaybookProtocol = {
    protocol_version: PLAYBOOK_PROTOCOL_VERSION,
    id: uuidv4(),
    name: pb.name,
    slug: pb.id,
    version: pb.version,
    author: pb.author !== "Unknown" ? pb.author : undefined,
    license: "unlicensed",

    tier: tierMap[pb.tier] ?? "2-moderate",
    timeframe: timeframeCategory,
    regimes: ["any"],
    assets: pb.symbols && pb.symbols.length > 0 ? pb.symbols : ["*"],
    exchanges: ["*"],

    entry: {
      description: pb.trigger.description,
      indicators,
      confluence_required: Math.max(1, indicators.length),
      filters:
        pb.analysis.invalidationCriteria.length > 0 ? pb.analysis.invalidationCriteria : undefined,
    },

    exit: {
      description: buildExitDescription(pb),
      stop_loss: {
        type: stopLossTypeMap[pb.execution.stopLoss.type] ?? "fixed_percent",
        // An ATR stop's value is a multiple, every other type's is a percent.
        value:
          pb.execution.stopLoss.type === "atr"
            ? (pb.execution.stopLoss.atrMultiple ?? 2)
            : (pb.execution.stopLoss.percentValue ?? 2),
        params: pb.execution.stopLoss.type === "atr" ? { atr_period: 14 } : undefined,
      },
      take_profit: takeProfitLevels,
      trailing_stop: inferTrailingStop(pb),
      time_stop: undefined,
    },

    risk: {
      max_position_size_percent: 10,
      max_risk_per_trade_percent: pb.execution.positionSizing.riskPercent ?? 1,
      max_concurrent_positions: 5,
      max_daily_loss_percent: undefined,
      max_correlation_exposure: undefined,
    },

    execution: {
      order_type: orderTypeMap[pb.execution.entryType] ?? "market",
      entry_method: "immediate",
      slippage_tolerance_percent: undefined,
      min_liquidity: undefined,
    },

    performance: undefined,
    lineage: undefined,
  };

  return protocol;
}

// ============================================================================
// Protocol -> Markdown
// ============================================================================

/**
 * Generate a human-readable Markdown playbook from a PlaybookProtocol.
 *
 * @param protocol - PlaybookProtocol object
 * @returns Markdown string with YAML frontmatter
 */
export function protocolToMarkdown(protocol: PlaybookProtocol): string {
  const lines: string[] = [];

  // Map tier back to number
  const tierNumMap: Record<string, number> = {
    "1-conservative": 1,
    "2-moderate": 2,
    "3-aggressive": 3,
  };

  // Map tier to risk level
  const riskMap: Record<string, string> = {
    "1-conservative": "low",
    "2-moderate": "medium",
    "3-aggressive": "high",
  };

  const tierNum = tierNumMap[protocol.tier] ?? 2;
  const risk = riskMap[protocol.tier] ?? "medium";

  // ---- Frontmatter ----
  lines.push("---");
  lines.push(`id: ${protocol.slug}`);
  lines.push(`name: ${protocol.name}`);
  lines.push(`version: ${protocol.version}`);
  if (protocol.author) lines.push(`author: ${protocol.author}`);
  lines.push(`tier: ${tierNum}`);
  lines.push(`risk: ${risk}`);
  lines.push(`markets: [crypto]`);
  if (protocol.assets.length > 0 && protocol.assets[0] !== "*") {
    lines.push(`symbols: [${protocol.assets.join(", ")}]`);
  }
  lines.push(`timeframes: [${inferTimeframesFromCategory(protocol.timeframe).join(", ")}]`);
  lines.push(`tags: [${protocol.regimes.join(", ")}]`);
  lines.push("---");
  lines.push("");

  // ---- Title & Description ----
  lines.push(`# ${protocol.name}`);
  lines.push("");
  lines.push(protocol.entry.description);
  lines.push("");

  // ---- Trigger ----
  lines.push("## Trigger");
  lines.push("");
  for (const ind of protocol.entry.indicators) {
    const paramStr = Object.entries(ind.params)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    lines.push(`- ${ind.name}${paramStr ? ` (${paramStr})` : ""} ${ind.condition}`);
  }
  lines.push("");

  // ---- Analysis ----
  lines.push("## Analysis");
  lines.push("");
  lines.push("Analyst validates:");
  lines.push(
    `- Confluence required: ${protocol.entry.confluence_required} of ${protocol.entry.indicators.length} indicators`,
  );
  if (protocol.entry.filters && protocol.entry.filters.length > 0) {
    lines.push("");
    lines.push("Trade is invalidated if:");
    for (const filter of protocol.entry.filters) {
      lines.push(`- ${filter}`);
    }
  }
  lines.push("");

  // ---- Execution ----
  lines.push("## Execution");
  lines.push("");
  lines.push(
    `- **Entry**: ${capitalize(protocol.execution.order_type)} order (${protocol.execution.entry_method})`,
  );
  lines.push(
    `- **Stop Loss**: ${capitalize(protocol.exit.stop_loss.type.replace(/_/g, " "))} at ${protocol.exit.stop_loss.value}%`,
  );
  if (protocol.exit.take_profit.length > 0) {
    const tpDesc = protocol.exit.take_profit
      .map((tp) => `${tp.size_percent}% at ${tp.level}R`)
      .join(", ");
    lines.push(`- **Take Profit**: ${tpDesc}`);
  }
  lines.push(
    `- **Position Size**: Risk ${protocol.risk.max_risk_per_trade_percent}% of portfolio per trade`,
  );
  lines.push("");

  // ---- Management ----
  lines.push("## Management");
  lines.push("");
  let ruleNum = 1;
  if (protocol.exit.trailing_stop?.enabled) {
    if (protocol.exit.trailing_stop.activation !== undefined) {
      lines.push(
        `${ruleNum}. At ${protocol.exit.trailing_stop.activation}% profit -> Activate trailing stop at ${protocol.exit.trailing_stop.distance ?? 1}% distance`,
      );
      ruleNum++;
    }
  }
  for (const tp of protocol.exit.take_profit) {
    lines.push(`${ruleNum}. At ${tp.level}R profit -> Scale out ${tp.size_percent}%`);
    ruleNum++;
  }
  if (protocol.exit.time_stop?.enabled && protocol.exit.time_stop.max_duration_hours) {
    lines.push(
      `${ruleNum}. After ${protocol.exit.time_stop.max_duration_hours}h -> Close remaining position (time stop)`,
    );
    ruleNum++;
  }
  if (ruleNum === 1) {
    lines.push("1. Manage according to stop-loss and take-profit rules above");
  }
  lines.push("");

  // ---- Review ----
  lines.push("## Review");
  lines.push("");
  lines.push("After close, evaluate:");
  lines.push("- Was the entry signal valid?");
  lines.push("- Was risk management followed?");
  lines.push("- Was the exit timing appropriate?");
  lines.push("");
  lines.push("Score based on:");
  lines.push("- Entry timing accuracy");
  lines.push("- Risk management discipline");
  lines.push("- Overall trade thesis validity");

  return lines.join("\n");
}

// ============================================================================
// Protocol <-> JSON
// ============================================================================

/**
 * Serialize a PlaybookProtocol to canonical JSON.
 *
 * @param protocol - PlaybookProtocol object
 * @returns Pretty-printed JSON string
 */
export function protocolToJSON(protocol: PlaybookProtocol): string {
  return JSON.stringify(protocol, null, 2);
}

/**
 * Deserialize a JSON string into a validated PlaybookProtocol.
 *
 * @param json - JSON string
 * @returns Parsed and validated PlaybookProtocol
 * @throws Error if JSON is invalid or doesn't match the schema
 */
export function jsonToProtocol(json: string): PlaybookProtocol {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("Invalid JSON: could not parse input");
  }

  const result = PlaybookProtocolSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Protocol validation failed: ${issues}`);
  }

  return result.data;
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Infer a timeframe category from a list of specific timeframes.
 */
function inferTimeframeCategory(timeframes: string[]): "scalp" | "intraday" | "swing" | "position" {
  const joined = timeframes.join(" ").toLowerCase();
  if (joined.includes("1m") || joined.includes("5m")) return "scalp";
  if (joined.includes("15m") || joined.includes("30m") || joined.includes("1h")) return "intraday";
  if (joined.includes("4h") || joined.includes("1d")) return "swing";
  if (joined.includes("1w") || joined.includes("1M")) return "position";
  return "intraday";
}

/**
 * Infer specific timeframe strings from a category.
 */
function inferTimeframesFromCategory(category: string): string[] {
  switch (category) {
    case "scalp":
      return ["1m", "5m"];
    case "intraday":
      return ["15m", "1h"];
    case "swing":
      return ["4h", "1d"];
    case "position":
      return ["1d", "1w"];
    default:
      return ["1h"];
  }
}

/**
 * Format a condition comparison + value into a string expression.
 */
function formatCondition(comparison: string, value: number | [number, number] | undefined): string {
  if (value === undefined) return comparison;
  if (Array.isArray(value)) return `between ${value[0]} and ${value[1]}`;

  switch (comparison) {
    case "above":
      return `> ${value}`;
    case "below":
      return `< ${value}`;
    case "crosses_above":
      return `crosses above ${value}`;
    case "crosses_below":
      return `crosses below ${value}`;
    case "spike":
      return `spike > ${value}x`;
    case "between":
      return `between (see value)`;
    case "divergence":
      return "divergence detected";
    default:
      return `${comparison} ${value}`;
  }
}

/**
 * Build take profit levels from the existing Playbook's management rules.
 */
function buildTakeProfitLevels(pb: Playbook): Array<{ level: number; size_percent: number }> {
  const levels: Array<{ level: number; size_percent: number }> = [];

  // Try to extract from management rules (e.g., "At 2R profit → Scale out 50%")
  for (const rule of pb.management.rules) {
    const rMatch = rule.description.match(/(\d+(?:\.\d+)?)\s*R\s*profit/i);
    const pctMatch = rule.description.match(/(?:scale out|close)\s*(\d+)%/i);
    if (rMatch && pctMatch) {
      levels.push({
        level: parseFloat(rMatch[1]!),
        size_percent: parseFloat(pctMatch[1]!),
      });
    }
  }

  // Fallback: use the R:R ratio from execution if no levels found
  if (levels.length === 0 && pb.execution.takeProfit.riskRewardRatio) {
    levels.push({
      level: pb.execution.takeProfit.riskRewardRatio,
      size_percent: 100,
    });
  }

  // Final fallback: default 2:1 at 100%
  if (levels.length === 0) {
    levels.push({ level: 2, size_percent: 100 });
  }

  return levels;
}

/**
 * Build a combined exit description from the Playbook's execution fields.
 */
function buildExitDescription(pb: Playbook): string {
  const parts: string[] = [];
  if (pb.execution.stopLoss.description) {
    parts.push(`Stop: ${pb.execution.stopLoss.description}`);
  }
  if (pb.execution.takeProfit.description) {
    parts.push(`Target: ${pb.execution.takeProfit.description}`);
  }
  return parts.join(". ") || "Exit per stop-loss and take-profit rules";
}

/**
 * Infer trailing stop configuration from management rules.
 */
function inferTrailingStop(
  pb: Playbook,
): { enabled: boolean; activation?: number; distance?: number } | undefined {
  for (const rule of pb.management.rules) {
    const lower = rule.description.toLowerCase();
    if (lower.includes("trail")) {
      // Try to extract activation level (e.g., "At 1.5R")
      const actMatch = lower.match(/(\d+(?:\.\d+)?)\s*r/);
      return {
        enabled: true,
        activation: actMatch ? parseFloat(actMatch[1]!) * 100 : undefined,
        distance: undefined,
      };
    }
  }
  return undefined;
}

/**
 * Capitalize the first letter of a string.
 */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
