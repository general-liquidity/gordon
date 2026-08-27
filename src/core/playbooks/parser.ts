/**
 * Playbook Markdown Parser
 *
 * Parses Markdown files with YAML frontmatter into structured Playbook objects.
 * Tolerant of formatting variations (extra whitespace, different bullet styles).
 *
 * Format:
 *   - YAML frontmatter between `---` fences for metadata
 *   - `## Trigger` section with bullet-point conditions
 *   - `## Analysis` section with validation/invalidation criteria
 *   - `## Execution` section with entry/stop/target/sizing rules
 *   - `## Management` section with numbered management rules
 *   - `## Review` section with evaluation criteria and scoring factors
 */

import { readFile } from "node:fs/promises";
import { createModuleLogger } from "../../infra/logger/logger.ts";
import { playbookToProtocol } from "./converter.ts";
import type { PlaybookProtocol } from "./protocol.ts";
import type {
  Playbook,
  PlaybookTrigger,
  PlaybookAnalysis,
  PlaybookExecution,
  PlaybookManagement,
  PlaybookReview,
  TriggerCondition,
  ManagementRule,
  StopLossRule,
  TakeProfitRule,
  PositionSizingRule,
  ValidationResult,
} from "./types.ts";

const _log = createModuleLogger("playbook-parser");

// ============================================================================
// Frontmatter Parser (lightweight, no external YAML dependency)
// ============================================================================

/**
 * Parse YAML-like frontmatter from a Markdown string.
 * Handles simple key-value pairs and inline arrays.
 * Does NOT handle nested objects or multi-line values.
 */
function parseFrontmatter(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    let value: string | number | string[] = trimmed.slice(colonIdx + 1).trim();

    // Inline array: [a, b, c]
    if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1);
      result[key] = inner
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      continue;
    }

    // Number
    if (/^-?\d+(\.\d+)?$/.test(value)) {
      result[key] = parseFloat(value);
      continue;
    }

    // Boolean
    if (value === "true") {
      result[key] = true;
      continue;
    }
    if (value === "false") {
      result[key] = false;
      continue;
    }

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

// ============================================================================
// Section Extraction
// ============================================================================

interface MarkdownSection {
  title: string;
  body: string;
}

/**
 * Split a Markdown body (after frontmatter) into sections keyed by `## Heading`.
 */
function extractSections(markdown: string): Map<string, MarkdownSection> {
  const sections = new Map<string, MarkdownSection>();
  const pattern = /^##\s+(.+)$/gm;
  const headings: { title: string; start: number }[] = [];

  for (const match of markdown.matchAll(pattern)) {
    headings.push({ title: match[1]!.trim(), start: match.index + match[0].length });
  }

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i]!;
    const _nextStart = headings[i + 1]?.start ?? markdown.length;
    // Go back to find the start of the next heading line
    const nextHeadingLineStart = headings[i + 1]
      ? markdown.lastIndexOf("\n", headings[i + 1]!.start - headings[i + 1]!.title.length - 4)
      : markdown.length;
    const body = markdown.slice(heading.start, nextHeadingLineStart).trim();
    const key = heading.title.toLowerCase();
    sections.set(key, { title: heading.title, body });
  }

  return sections;
}

/**
 * Extract bullet points (lines starting with `-` or `*`) from a section body.
 */
function extractBullets(body: string): string[] {
  return body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[-*]\s+/.test(l))
    .map((l) => l.replace(/^[-*]\s+/, "").trim());
}

/**
 * Extract numbered list items from a section body.
 */
function extractNumberedItems(body: string): string[] {
  return body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\d+[.)]\s+/.test(l))
    .map((l) => l.replace(/^\d+[.)]\s+/, "").trim());
}

/**
 * Extract bold-prefixed key-value items (e.g., `- **Entry**: description`).
 */
function extractBoldKeyItems(body: string): Map<string, string> {
  const items = new Map<string, string>();
  const bullets = extractBullets(body);

  for (const bullet of bullets) {
    const boldMatch = bullet.match(/^\*\*(.+?)\*\*[:\s]+(.+)$/);
    if (boldMatch) {
      items.set(boldMatch[1]!.toLowerCase().trim(), boldMatch[2]!.trim());
    }
  }

  return items;
}

// ============================================================================
// Description Extraction
// ============================================================================

/**
 * Extract the top-level description: everything between `# Title` and the first `##`.
 */
function extractDescription(markdown: string): string {
  // Find the first H1
  const h1Match = markdown.match(/^#\s+.+$/m);
  if (!h1Match) return "";

  const afterH1 = markdown.slice(h1Match.index! + h1Match[0].length);
  const nextSection = afterH1.indexOf("\n##");
  const descBlock = nextSection === -1 ? afterH1 : afterH1.slice(0, nextSection);

  return descBlock.trim();
}

// ============================================================================
// Trigger Parsing
// ============================================================================

/** Known indicator keywords for condition extraction */
const INDICATOR_KEYWORDS = [
  "rsi",
  "ema",
  "sma",
  "macd",
  "volume",
  "atr",
  "vwap",
  "adx",
  "bollinger",
  "stochastic",
  "mfi",
  "obv",
  "supertrend",
  "ichimoku",
  "fibonacci",
  "fib",
  "price",
  "funding rate",
] as const;

/**
 * Attempt to parse a trigger condition from a natural language bullet.
 */
function parseTriggerCondition(text: string): TriggerCondition {
  const lower = text.toLowerCase();
  const condition: TriggerCondition = { comparison: "above", description: text };

  // Detect indicator
  for (const kw of INDICATOR_KEYWORDS) {
    if (lower.includes(kw)) {
      condition.indicator = kw.toUpperCase();
      break;
    }
  }

  // Detect comparison type
  if (lower.includes("crosses above") || lower.includes("cross above")) {
    condition.comparison = "crosses_above";
  } else if (lower.includes("crosses below") || lower.includes("cross below")) {
    condition.comparison = "crosses_below";
  } else if (lower.includes("between")) {
    condition.comparison = "between";
    // Try to extract range: "between X and Y"
    const rangeMatch = lower.match(/between\s+(\d+(?:\.\d+)?)\s+and\s+(\d+(?:\.\d+)?)/);
    if (rangeMatch) {
      condition.value = [parseFloat(rangeMatch[1]!), parseFloat(rangeMatch[2]!)];
    }
  } else if (lower.includes("spike") || lower.includes("surge")) {
    condition.comparison = "spike";
    // Extract multiplier: ">2x" or "greater than 2x"
    const multiMatch = lower.match(/(?:>|greater than)\s*(\d+(?:\.\d+)?)x/);
    if (multiMatch) {
      condition.value = parseFloat(multiMatch[1]!);
    }
  } else if (lower.includes("divergence")) {
    condition.comparison = "divergence";
  } else if (
    lower.includes("below") ||
    lower.includes("less than") ||
    lower.includes("under") ||
    lower.includes("< ")
  ) {
    condition.comparison = "below";
    const numMatch = lower.match(/(?:below|less than|under|<)\s*(\d+(?:\.\d+)?)/);
    if (numMatch) condition.value = parseFloat(numMatch[1]!);
  } else if (
    lower.includes("above") ||
    lower.includes("greater than") ||
    lower.includes("over") ||
    lower.includes("> ")
  ) {
    condition.comparison = "above";
    const numMatch = lower.match(/(?:above|greater than|over|>)\s*(\d+(?:\.\d+)?)/);
    if (numMatch) condition.value = parseFloat(numMatch[1]!);
  }

  // Detect timeframe mentions
  const tfMatch = lower.match(/\b(\d+[mhd]|1w)\b/);
  if (tfMatch) {
    condition.timeframe = tfMatch[1];
  }

  return condition;
}

/**
 * Parse the Trigger section.
 */
function parseTriggerSection(body: string): PlaybookTrigger {
  const bullets = extractBullets(body);
  const conditions = bullets.map(parseTriggerCondition);

  // Detect agent subscription from description text
  const lower = body.toLowerCase();
  let agentSubscription = "scanner";
  if (lower.includes("monitor")) agentSubscription = "monitor";
  if (lower.includes("analyst")) agentSubscription = "analyst";

  return {
    description:
      body
        .split("\n")
        .filter((l) => !l.trim().startsWith("-") && !l.trim().startsWith("*"))
        .join(" ")
        .trim() || "Trigger conditions",
    conditions,
    agentSubscription,
  };
}

// ============================================================================
// Analysis Parsing
// ============================================================================

/**
 * Parse the Analysis section.
 * Splits bullets into validation vs. invalidation criteria based on
 * the presence of "invalidated" or "invalid" sub-headings/context.
 */
function parseAnalysisSection(body: string): PlaybookAnalysis {
  const validationCriteria: string[] = [];
  const invalidationCriteria: string[] = [];
  const requiredIndicators: string[] = [];

  // Split on "invalid" keyword boundary
  const invalidIdx = body.toLowerCase().indexOf("invalid");
  let validBlock: string;
  let invalidBlock: string;

  if (invalidIdx !== -1) {
    // Walk back to the nearest newline before "invalid"
    const splitPoint = body.lastIndexOf("\n", invalidIdx);
    validBlock = splitPoint === -1 ? "" : body.slice(0, splitPoint);
    invalidBlock = body.slice(splitPoint === -1 ? invalidIdx : splitPoint);
  } else {
    validBlock = body;
    invalidBlock = "";
  }

  for (const bullet of extractBullets(validBlock)) {
    validationCriteria.push(bullet);
    // Extract indicator references
    for (const kw of INDICATOR_KEYWORDS) {
      if (bullet.toLowerCase().includes(kw) && !requiredIndicators.includes(kw.toUpperCase())) {
        requiredIndicators.push(kw.toUpperCase());
      }
    }
  }

  for (const bullet of extractBullets(invalidBlock)) {
    invalidationCriteria.push(bullet);
  }

  const descLines = body.split("\n").filter((l) => {
    const t = l.trim();
    return (
      t &&
      !t.startsWith("-") &&
      !t.startsWith("*") &&
      !t.toLowerCase().startsWith("trade is invalid")
    );
  });

  return {
    description: descLines.join(" ").trim() || "Analysis criteria",
    validationCriteria,
    requiredIndicators,
    invalidationCriteria,
  };
}

// ============================================================================
// Execution Parsing
// ============================================================================

/**
 * Parse the Execution section.
 * Extracts entry type, stop-loss, take-profit, and position sizing from
 * bold-prefixed bullet items or plain bullets.
 */
function parseExecutionSection(body: string): PlaybookExecution {
  const boldItems = extractBoldKeyItems(body);
  const bullets = extractBullets(body);
  const lower = body.toLowerCase();

  // Entry type
  let entryType: "market" | "limit" | "stop_limit" = "market";
  const entryDesc =
    boldItems.get("entry") ?? bullets.find((b) => b.toLowerCase().includes("entry")) ?? "";
  if (lower.includes("limit order")) entryType = "limit";
  if (lower.includes("stop limit") || lower.includes("stop-limit")) entryType = "stop_limit";
  if (lower.includes("market order")) entryType = "market";

  // Stop-loss
  const stopDesc =
    boldItems.get("stop loss") ??
    boldItems.get("stop") ??
    bullets.find((b) => b.toLowerCase().includes("stop")) ??
    "";
  const stopLoss = parseStopLossRule(stopDesc);

  // Take-profit
  const tpDesc =
    boldItems.get("take profit") ??
    boldItems.get("target") ??
    bullets.find(
      (b) => b.toLowerCase().includes("take profit") || b.toLowerCase().includes("target"),
    ) ??
    "";
  const takeProfit = parseTakeProfitRule(tpDesc);

  // Position sizing
  const sizeDesc =
    boldItems.get("position size") ??
    boldItems.get("size") ??
    boldItems.get("sizing") ??
    bullets.find((b) => b.toLowerCase().includes("position") || b.toLowerCase().includes("risk")) ??
    "";
  const positionSizing = parsePositionSizingRule(sizeDesc);

  return {
    entryType,
    entryDescription: entryDesc,
    stopLoss,
    takeProfit,
    positionSizing,
  };
}

export function parseStopLossRule(text: string): StopLossRule {
  const lower = text.toLowerCase();
  const rule: StopLossRule = { description: text, type: "custom" };

  if (lower.includes("atr")) {
    rule.type = "atr";
    // "1.5 ATR below the swing low", "2x ATR", "ATR × 2", "ATR(14) x 1.5".
    const atrMatch =
      lower.match(/(\d+(?:\.\d+)?)\s*(?:x|\*|×)?\s*atr/) ??
      lower.match(/atr(?:\s*\(\s*\d+\s*\))?\s*(?:x|\*|×)\s*(\d+(?:\.\d+)?)/);
    if (atrMatch) rule.atrMultiple = parseFloat(atrMatch[1]!);
  } else if (lower.includes("%") || lower.match(/\d+-\d+%/)) {
    rule.type = "fixed_percent";
    const pctMatch = lower.match(/(\d+(?:\.\d+)?)\s*%/);
    if (pctMatch) rule.percentValue = parseFloat(pctMatch[1]!);
  } else if (
    lower.includes("support") ||
    lower.includes("swing low") ||
    lower.includes("candle low") ||
    lower.includes("structure")
  ) {
    rule.type = "structure";
  }

  // A percent mentioned alongside a structure or custom stop is a secondary
  // bound and belongs in the percent field. It is NOT harvested for an ATR
  // stop: "1.5 ATR below the swing low, max 2% of equity" would otherwise
  // leave 2 in the field an ATR consumer reads as a multiple.
  if (rule.percentValue === undefined && rule.type !== "atr") {
    const pctMatch = lower.match(/(\d+(?:\.\d+)?)\s*%/);
    if (pctMatch) rule.percentValue = parseFloat(pctMatch[1]!);
  }

  return rule;
}

function parseTakeProfitRule(text: string): TakeProfitRule {
  const rule: TakeProfitRule = { description: text };

  // Extract R:R ratio (e.g., "2.5:1", "2.5x the risk", "R:R minimum 2.5:1")
  const rrMatch = text.match(/(\d+(?:\.\d+)?)\s*(?::|x)\s*(?:1|the risk)/i);
  if (rrMatch) {
    rule.riskRewardRatio = parseFloat(rrMatch[1]!);
  }
  // Also check for "R:R minimum X:1" or "R:R X:1" pattern
  const rrAlt = text.match(/R:R\s*(?:minimum\s+)?(\d+(?:\.\d+)?)\s*:\s*1/i);
  if (rrAlt) {
    rule.riskRewardRatio = parseFloat(rrAlt[1]!);
  }

  return rule;
}

export function parsePositionSizingRule(text: string): PositionSizingRule {
  const rule: PositionSizingRule = { description: text };

  // Risk-per-trade only when the text actually says risk: "Risk 1% of
  // portfolio", "1% risk per trade", "risk per trade: 1%". The optional
  // `(?:risk\s+)?` prefix that used to guard this matched every percentage in
  // the bullet, so "Position size: 5% of portfolio" was recorded as a 5%
  // risk budget.
  const riskMatch =
    text.match(/risk[^.\n]{0,30}?(\d+(?:\.\d+)?)\s*%/i) ??
    text.match(/(\d+(?:\.\d+)?)\s*%[^.\n]{0,20}?risk/i);
  if (riskMatch) {
    rule.riskPercent = parseFloat(riskMatch[1]!);
  }

  // Any other percentage in a sizing bullet is an allocation, not a risk
  // budget. Recorded separately so a consumer must choose which it wants.
  const sizeMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (sizeMatch) {
    const value = parseFloat(sizeMatch[1]!);
    if (value !== rule.riskPercent) rule.positionPercent = value;
  }

  return rule;
}

// ============================================================================
// Management Parsing
// ============================================================================

/**
 * Parse the Management section.
 * Extracts numbered rules and splits each on the arrow separator.
 */
function parseManagementSection(body: string): PlaybookManagement {
  const numbered = extractNumberedItems(body);
  const rules: ManagementRule[] = [];

  for (const item of numbered) {
    // Try splitting on arrow: "At 1.5R profit -> Move stop to breakeven"
    const arrowParts = item.split(/\s*(?:→|->|—)\s*/);
    if (arrowParts.length >= 2) {
      rules.push({
        condition: arrowParts[0]!.trim(),
        action: arrowParts.slice(1).join(" ").trim(),
        description: item,
      });
    } else {
      // No arrow; the whole item is the rule description
      // Try to split on ":" as an alternative
      const colonParts = item.split(/:\s+/);
      if (colonParts.length >= 2) {
        rules.push({
          condition: colonParts[0]!.trim(),
          action: colonParts.slice(1).join(": ").trim(),
          description: item,
        });
      } else {
        rules.push({
          condition: item,
          action: item,
          description: item,
        });
      }
    }
  }

  // Also pick up bullet-style management rules if no numbered items
  if (rules.length === 0) {
    for (const bullet of extractBullets(body)) {
      rules.push({
        condition: bullet,
        action: bullet,
        description: bullet,
      });
    }
  }

  return {
    description:
      body
        .split("\n")
        .filter((l) => {
          const t = l.trim();
          return t && !t.match(/^[\d\-*]/) && !t.match(/^\d+[.)]/);
        })
        .join(" ")
        .trim() || "Trade management rules",
    rules,
  };
}

// ============================================================================
// Review Parsing
// ============================================================================

/**
 * Parse the Review section.
 * Splits criteria (evaluation) from scoring factors using keyword boundaries.
 */
function parseReviewSection(body: string): PlaybookReview {
  const criteria: string[] = [];
  const scoringFactors: string[] = [];

  // Split on "score" keyword boundary
  const scoreIdx = body.toLowerCase().indexOf("score");
  let evalBlock: string;
  let scoreBlock: string;

  if (scoreIdx !== -1) {
    const splitPoint = body.lastIndexOf("\n", scoreIdx);
    evalBlock = splitPoint === -1 ? "" : body.slice(0, splitPoint);
    scoreBlock = body.slice(splitPoint === -1 ? scoreIdx : splitPoint);
  } else {
    evalBlock = body;
    scoreBlock = "";
  }

  for (const bullet of extractBullets(evalBlock)) {
    criteria.push(bullet);
  }

  for (const bullet of extractBullets(scoreBlock)) {
    scoringFactors.push(bullet);
  }

  return { criteria, scoringFactors };
}

// ============================================================================
// PlaybookParser Class
// ============================================================================

/**
 * Parser that converts Markdown files into structured Playbook objects.
 */
export class PlaybookParser {
  /**
   * Parse a Markdown string into a Playbook.
   *
   * @param markdown - Raw Markdown content with YAML frontmatter
   * @param source - Where this playbook came from
   * @returns Parsed Playbook
   */
  parse(markdown: string, source: "builtin" | "workspace" | "hub" = "builtin"): Playbook {
    // ---- Extract frontmatter ----
    const fmMatch = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const frontmatter = fmMatch ? parseFrontmatter(fmMatch[1]!) : {};
    const bodyStart = fmMatch ? fmMatch.index! + fmMatch[0].length : 0;
    const body = markdown.slice(bodyStart).trim();

    // ---- Extract sections ----
    const sections = extractSections(body);
    const description = extractDescription(body) || (frontmatter.description as string) || "";

    // ---- Parse each section ----
    const triggerSection = sections.get("trigger");
    const analysisSection = sections.get("analysis");
    const executionSection = sections.get("execution");
    const managementSection = sections.get("management");
    const reviewSection = sections.get("review");

    const trigger = triggerSection
      ? parseTriggerSection(triggerSection.body)
      : { description: "", conditions: [], agentSubscription: "scanner" };

    const analysis = analysisSection
      ? parseAnalysisSection(analysisSection.body)
      : {
          description: "",
          validationCriteria: [],
          requiredIndicators: [],
          invalidationCriteria: [],
        };

    const execution = executionSection
      ? parseExecutionSection(executionSection.body)
      : {
          entryType: "market" as const,
          entryDescription: "",
          stopLoss: { description: "", type: "custom" as const },
          takeProfit: { description: "" },
          positionSizing: { description: "" },
        };

    const management = managementSection
      ? parseManagementSection(managementSection.body)
      : { description: "", rules: [] };

    const review = reviewSection
      ? parseReviewSection(reviewSection.body)
      : { criteria: [], scoringFactors: [] };

    // ---- Assemble the Playbook ----
    const now = new Date().toISOString();

    const tier = typeof frontmatter.tier === "number" ? (frontmatter.tier as 1 | 2 | 3) : 1;

    const riskLevel = (frontmatter.risk as string) ?? (frontmatter.riskLevel as string) ?? "medium";

    return {
      id: (frontmatter.id as string) ?? "unknown",
      name: (frontmatter.name as string) ?? "Untitled Playbook",
      version: (frontmatter.version as string) ?? "1.0.0",
      author: (frontmatter.author as string) ?? "Unknown",
      description,
      tier: tier as 1 | 2 | 3,
      riskLevel: riskLevel as "low" | "medium" | "high",
      markets: (frontmatter.markets as string[]) ?? ["crypto"],
      symbols: (frontmatter.symbols as string[]) ?? undefined,
      timeframes: (frontmatter.timeframes as string[]) ?? ["1h"],
      trigger,
      analysis,
      execution,
      management,
      review,
      tags: (frontmatter.tags as string[]) ?? [],
      createdAt: now,
      updatedAt: now,
      source,
    };
  }

  /**
   * Parse a playbook from a file path.
   *
   * @param filePath - Absolute or relative path to a .md file
   * @param source - Where this playbook came from
   * @returns Parsed Playbook with filePath set
   */
  async parseFile(
    filePath: string,
    source: "builtin" | "workspace" | "hub" = "builtin",
  ): Promise<Playbook> {
    const content = await readFile(filePath, "utf-8");
    const playbook = this.parse(content, source);
    playbook.filePath = filePath;
    return playbook;
  }

  /**
   * Validate a parsed playbook for completeness and correctness.
   *
   * @param playbook - Playbook to validate
   * @returns Validation result with errors and warnings
   */
  validate(playbook: Playbook): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required fields
    if (!playbook.id || playbook.id === "unknown") {
      errors.push("Playbook must have an 'id' in frontmatter");
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(playbook.id)) {
      errors.push(`Playbook ID "${playbook.id}" must be kebab-case (lowercase, hyphens only)`);
    }
    if (!playbook.name || playbook.name === "Untitled Playbook") {
      errors.push("Playbook must have a 'name' in frontmatter");
    }
    if (![1, 2, 3].includes(playbook.tier)) {
      errors.push(`Invalid tier: ${playbook.tier}. Must be 1, 2, or 3`);
    }
    if (!["low", "medium", "high"].includes(playbook.riskLevel)) {
      errors.push(`Invalid riskLevel: ${playbook.riskLevel}`);
    }
    if (!playbook.timeframes.length) {
      errors.push("Playbook must specify at least one timeframe");
    }

    // Section checks
    if (playbook.trigger.conditions.length === 0) {
      warnings.push("Trigger section has no parsed conditions");
    }
    if (playbook.analysis.validationCriteria.length === 0) {
      warnings.push("Analysis section has no validation criteria");
    }
    if (!playbook.execution.entryDescription) {
      warnings.push("Execution section has no entry description");
    }
    if (playbook.management.rules.length === 0) {
      warnings.push("Management section has no rules");
    }
    if (playbook.review.criteria.length === 0) {
      warnings.push("Review section has no evaluation criteria");
    }

    // Description
    if (!playbook.description) {
      warnings.push("Playbook has no description");
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Parse a Markdown string into a PlaybookProtocol object.
   * First parses to the internal Playbook type, then converts to the formal protocol.
   *
   * @param markdown - Raw Markdown content with YAML frontmatter
   * @param source - Where this playbook came from
   * @returns PlaybookProtocol object
   */
  parseToProtocol(
    markdown: string,
    source: "builtin" | "workspace" | "hub" = "builtin",
  ): PlaybookProtocol {
    const playbook = this.parse(markdown, source);
    return playbookToProtocol(playbook);
  }

  /**
   * Parse a playbook file into a PlaybookProtocol object.
   *
   * @param filePath - Absolute or relative path to a .md file
   * @param source - Where this playbook came from
   * @returns PlaybookProtocol object
   */
  async parseFileToProtocol(
    filePath: string,
    source: "builtin" | "workspace" | "hub" = "builtin",
  ): Promise<PlaybookProtocol> {
    const content = await readFile(filePath, "utf-8");
    return this.parseToProtocol(content, source);
  }
}
