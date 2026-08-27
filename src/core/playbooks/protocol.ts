/**
 * Playbook Protocol Specification v1.0
 *
 * Formal, versioned schema for Gordon CLI's Playbook system.
 * Think of this as OpenAPI but for trading strategies — a machine-readable,
 * validatable, importable/exportable format that sits alongside the existing
 * human-readable Markdown playbooks.
 *
 * Uses Zod for runtime validation so every field is both typed and checked.
 */

import { z } from "zod";

// ============================================================================
// Protocol Version
// ============================================================================

export const PLAYBOOK_PROTOCOL_VERSION = "1.0";

// ============================================================================
// Shared Enums & Primitives
// ============================================================================

export const TierEnum = z.enum(["1-conservative", "2-moderate", "3-aggressive"]);
export const TimeframeEnum = z.enum(["scalp", "intraday", "swing", "position"]);
export const RegimeEnum = z.enum(["trending", "ranging", "volatile", "quiet", "any"]);
export const StopLossTypeEnum = z.enum([
  "fixed_percent",
  "atr_multiple",
  "support_level",
  "trailing",
]);
export const OrderTypeEnum = z.enum(["market", "limit", "bracket"]);
export const EntryMethodEnum = z.enum(["immediate", "scaled", "dca"]);
export const LicenseEnum = z.enum(["MIT", "proprietary", "CC-BY-4.0", "unlicensed"]);

// ============================================================================
// Sub-schemas
// ============================================================================

export const IndicatorSchema = z.object({
  /** Indicator name (e.g., "RSI", "EMA", "MACD", "volume") */
  name: z.string(),
  /** Parameters for the indicator (e.g., { period: 14 }) */
  params: z.record(z.string(), z.union([z.number(), z.string()])),
  /** Condition expression (e.g., "< 30", "> ema_200", "crossover(ema_9, ema_21)") */
  condition: z.string(),
});

export const EntrySchema = z.object({
  /** Human-readable description of entry conditions */
  description: z.string(),
  /** Structured indicator conditions */
  indicators: z.array(IndicatorSchema),
  /** How many indicators must agree to trigger entry */
  confluence_required: z.number().min(1),
  /** Additional filters (e.g., "not during FOMC", "daily volume > 1B") */
  filters: z.array(z.string()).optional(),
});

export const TakeProfitLevelSchema = z.object({
  /** R:R level (e.g., 1.5 for 1.5:1 R:R) */
  level: z.number(),
  /** What % of position to close at this level */
  size_percent: z.number(),
});

export const TrailingStopSchema = z.object({
  enabled: z.boolean(),
  /** Activate trailing after X% profit */
  activation: z.number().optional(),
  /** Trail by X% */
  distance: z.number().optional(),
});

export const TimeStopSchema = z.object({
  enabled: z.boolean(),
  /** Max duration in hours before forced exit */
  max_duration_hours: z.number().optional(),
});

export const ExitSchema = z.object({
  /** Human-readable description of exit rules */
  description: z.string(),
  /** Stop-loss configuration */
  stop_loss: z.object({
    type: StopLossTypeEnum,
    value: z.number(),
    /** Additional params, e.g., { atr_period: 14 } for ATR */
    params: z.record(z.string(), z.number()).optional(),
  }),
  /** Multiple take-profit levels */
  take_profit: z.array(TakeProfitLevelSchema),
  /** Optional trailing stop */
  trailing_stop: TrailingStopSchema.optional(),
  /** Optional time-based stop */
  time_stop: TimeStopSchema.optional(),
});

export const RiskSchema = z.object({
  /** Max position size as % of portfolio */
  max_position_size_percent: z.number().min(0.1).max(100),
  /** Max risk per trade as % of portfolio */
  max_risk_per_trade_percent: z.number().min(0.1).max(10),
  /** Max number of concurrent positions */
  max_concurrent_positions: z.number().min(1).max(50),
  /** Max daily loss as % of portfolio */
  max_daily_loss_percent: z.number().optional(),
  /** Max correlation exposure (0-1) */
  max_correlation_exposure: z.number().optional(),
});

export const ExecutionSchema = z.object({
  /** Order type for entry */
  order_type: OrderTypeEnum,
  /** Entry method */
  entry_method: EntryMethodEnum,
  /** Slippage tolerance in % */
  slippage_tolerance_percent: z.number().optional(),
  /** Minimum 24h volume in USD */
  min_liquidity: z.number().optional(),
});

export const PerformanceSchema = z.object({
  total_trades: z.number(),
  win_rate: z.number(),
  profit_factor: z.number(),
  sharpe_ratio: z.number(),
  max_drawdown_percent: z.number(),
  avg_hold_duration_hours: z.number(),
  last_updated: z.string().datetime(),
  paper_trades: z.number(),
  live_trades: z.number(),
});

export const MutationSchema = z.object({
  field: z.string(),
  from: z.unknown(),
  to: z.unknown(),
  reason: z.string(),
  date: z.string().datetime(),
});

export const LineageSchema = z.object({
  /** UUID of parent playbook (if forked) */
  parent_id: z.string().uuid().optional(),
  /** Generation number (0 = original) */
  generation: z.number().default(0),
  /** History of mutations from parent */
  mutations: z.array(MutationSchema).optional(),
});

// ============================================================================
// Top-level Protocol Schema
// ============================================================================

export const PlaybookProtocolSchema = z.object({
  // ---- Protocol metadata ----
  /** Protocol version (e.g., "1.0") */
  protocol_version: z.string(),

  // ---- Strategy identity ----
  /** Unique identifier (UUID v4) */
  id: z.string().uuid(),
  /** Human-readable name */
  name: z.string().min(1).max(100),
  /** URL-safe slug (lowercase, hyphens) */
  slug: z.string().regex(/^[a-z0-9-]+$/),
  /** Semantic version (semver) */
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  /** Author name */
  author: z.string().optional(),
  /** License */
  license: LicenseEnum.default("unlicensed"),

  // ---- Classification ----
  /** Risk tier */
  tier: TierEnum,
  /** Trading timeframe category */
  timeframe: TimeframeEnum,
  /** Market regimes this strategy works in */
  regimes: z.array(RegimeEnum),
  /** Target trading pairs (e.g., ["BTC/USDT"] or ["*"]) */
  assets: z.array(z.string()),
  /** Target exchanges (e.g., ["binance"] or ["*"]) */
  exchanges: z.array(z.string()),

  // ---- Entry conditions ----
  entry: EntrySchema,

  // ---- Exit rules ----
  exit: ExitSchema,

  // ---- Risk management ----
  risk: RiskSchema,

  // ---- Execution preferences ----
  execution: ExecutionSchema,

  // ---- Performance record (filled by system) ----
  performance: PerformanceSchema.optional(),

  // ---- Lineage (for Strategy Genome) ----
  lineage: LineageSchema.optional(),
});

// ============================================================================
// Inferred TypeScript Type
// ============================================================================

export type PlaybookProtocol = z.infer<typeof PlaybookProtocolSchema>;
