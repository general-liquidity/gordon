/**
 * Playbook Engine Types
 *
 * Core interfaces for the Markdown-based Playbook format.
 * Playbooks are simultaneously human-readable, agent-parseable,
 * backtestable, and publishable trading strategy definitions.
 */

import type { BacktestSummary } from "../../backtest/storage.ts";

// ============================================================================
// Core Playbook Interface
// ============================================================================

/**
 * A complete, parsed Playbook.
 * Represents a trading strategy in a structured format derived from Markdown.
 */
export interface Playbook {
  /** Unique identifier (kebab-case, URL-safe) */
  id: string;

  /** Human-readable name */
  name: string;

  /** Semantic version string */
  version: string;

  /** Author name or identifier */
  author: string;

  /** Brief description of the strategy */
  description: string;

  /** Skill tier: 1=beginner, 2=intermediate, 3=advanced */
  tier: 1 | 2 | 3;

  /** Risk classification */
  riskLevel: "low" | "medium" | "high";

  /** Target markets (e.g., ['crypto', 'forex', 'stocks']) */
  markets: string[];

  /** Specific symbols this works best on (optional) */
  symbols?: string[];

  /** Recommended timeframes (e.g., ['5m', '15m', '1h', '4h']) */
  timeframes: string[];

  // ------ Structured Sections (extracted from Markdown) ------

  /** When the strategy triggers */
  trigger: PlaybookTrigger;

  /** How to validate the setup */
  analysis: PlaybookAnalysis;

  /** How to enter and size the trade */
  execution: PlaybookExecution;

  /** How to manage the live trade */
  management: PlaybookManagement;

  /** How to evaluate after close */
  review: PlaybookReview;

  // ------ Metadata ------

  /** Categorization tags */
  tags: string[];

  /** Attached backtest results (optional) */
  backtestResults?: BacktestSummary;

  /** ISO timestamp of creation */
  createdAt: string;

  /** ISO timestamp of last update */
  updatedAt: string;

  /** Where this playbook came from */
  source: "builtin" | "workspace" | "hub";

  /** Path to the source .md file (if loaded from disk) */
  filePath?: string;
}

// ============================================================================
// Trigger Section
// ============================================================================

/**
 * Defines when the strategy fires.
 * Maps to the `## Trigger` section of the Markdown.
 */
export interface PlaybookTrigger {
  /** Natural language description of trigger logic */
  description: string;

  /** Structured conditions extracted from bullet points */
  conditions: TriggerCondition[];

  /** Which agent event stream to subscribe to (e.g., 'scanner') */
  agentSubscription: string;
}

/**
 * A single trigger condition extracted from a Markdown bullet point.
 */
export interface TriggerCondition {
  /** Indicator name (e.g., 'RSI', 'EMA', 'Volume') */
  indicator?: string;

  /** Type of comparison */
  comparison:
    | "above"
    | "below"
    | "crosses_above"
    | "crosses_below"
    | "between"
    | "spike"
    | "divergence";

  /** Threshold value or [min, max] range */
  value?: number | [number, number];

  /** Timeframe context (e.g., '15m', '4h') */
  timeframe?: string;

  /** The original natural language description */
  description: string;
}

// ============================================================================
// Analysis Section
// ============================================================================

/**
 * Defines how the Analyst agent validates a triggered setup.
 * Maps to the `## Analysis` section of the Markdown.
 */
export interface PlaybookAnalysis {
  /** Natural language overview */
  description: string;

  /** Criteria the Analyst must confirm (from "validates" bullets) */
  validationCriteria: string[];

  /** Indicators the Analyst needs access to */
  requiredIndicators: string[];

  /** Conditions that kill the trade (from "invalidated" bullets) */
  invalidationCriteria: string[];
}

// ============================================================================
// Execution Section
// ============================================================================

/**
 * Defines how to enter the trade.
 * Maps to the `## Execution` section of the Markdown.
 */
export interface PlaybookExecution {
  /** Order type for entry */
  entryType: "market" | "limit" | "stop_limit";

  /** Natural language entry description */
  entryDescription: string;

  /** Stop-loss rule */
  stopLoss: StopLossRule;

  /** Take-profit rule */
  takeProfit: TakeProfitRule;

  /** Position sizing rule */
  positionSizing: PositionSizingRule;
}

/**
 * Stop-loss configuration extracted from Markdown.
 */
export interface StopLossRule {
  /** Natural language description */
  description: string;

  /** Type of stop-loss calculation */
  type: "fixed_percent" | "atr" | "structure" | "custom";

  /** Percentage value (if applicable) */
  value?: number;
}

/**
 * Take-profit configuration extracted from Markdown.
 */
export interface TakeProfitRule {
  /** Natural language description */
  description: string;

  /** Risk-to-reward ratio (e.g., 2.5 means 2.5:1) */
  riskRewardRatio?: number;

  /** Multiple TP levels described */
  levels?: string[];
}

/**
 * Position sizing rule extracted from Markdown.
 */
export interface PositionSizingRule {
  /** Natural language description */
  description: string;

  /** Risk percentage per trade (e.g., 1 means 1%) */
  riskPercent?: number;
}

// ============================================================================
// Management Section
// ============================================================================

/**
 * Defines how to manage the trade while it is open.
 * Maps to the `## Management` section of the Markdown.
 */
export interface PlaybookManagement {
  /** Natural language overview */
  description: string;

  /** Ordered list of management rules */
  rules: ManagementRule[];
}

/**
 * A single trade management rule extracted from a numbered list item.
 */
export interface ManagementRule {
  /** Trigger condition (e.g., "Price reaches 1.5R profit") */
  condition: string;

  /** Action to take (e.g., "Move stop to breakeven") */
  action: string;

  /** Full description of the rule */
  description: string;
}

// ============================================================================
// Review Section
// ============================================================================

/**
 * Defines how the Teacher agent evaluates the trade after close.
 * Maps to the `## Review` section of the Markdown.
 */
export interface PlaybookReview {
  /** What the Teacher evaluates */
  criteria: string[];

  /** How to score/rate the trade */
  scoringFactors: string[];
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Result of validating a parsed playbook.
 */
export interface ValidationResult {
  /** Whether the playbook is valid */
  valid: boolean;

  /** Validation errors (empty if valid) */
  errors: string[];

  /** Non-fatal warnings */
  warnings: string[];
}

// ============================================================================
// Formatted Display
// ============================================================================

/**
 * Playbook data formatted for terminal display.
 */
export interface FormattedPlaybook {
  id: string;
  name: string;
  tier: string;
  risk: string;
  markets: string;
  timeframes: string;
  tags: string;
  description: string;
}

/**
 * Grouped playbook listing for display.
 */
export interface FormattedPlaybookList {
  tiers: {
    label: string;
    playbooks: FormattedPlaybook[];
  }[];
  total: number;
}
