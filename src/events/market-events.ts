/**
 * Market Event Types
 * Extended event types for real-time market data, position tracking,
 * strategy lifecycle, and system scheduling events.
 *
 * These extend the existing EventType system without modifying it.
 * All new events are properly typed with Zod schemas and data interfaces.
 */

import { z } from "zod";

// ============================================================================
// Market Event Type Enum
// ============================================================================

/**
 * Extended market event types
 * These supplement the existing EventType enum from types.ts
 */
export const MarketEventTypeSchema = z.enum([
  // ---- Market data events ----
  "market:candle_close",
  "market:price_tick",
  "market:volume_spike",
  "market:funding_rate_change",
  "market:liquidation_wave",
  "market:spread_change",

  // ---- Position events ----
  "position:opened",
  "position:updated",
  "position:stop_triggered",
  "position:target_reached",
  "position:closed",

  // ---- Strategy events ----
  "strategy:setup_detected",
  "strategy:analysis_complete",
  "strategy:plan_ready",
  "strategy:risk_approved",
  "strategy:risk_rejected",

  // ---- System scheduling events ----
  "system:cron_tick",
  "system:webhook_received",
  "system:session_start",
  "system:session_end",
]);

export type MarketEventType = z.infer<typeof MarketEventTypeSchema>;

// ============================================================================
// Market Data Event Interfaces
// ============================================================================

/** Base interface for all market events */
export interface BaseMarketEvent {
  type: MarketEventType;
  timestamp: string;
  source?: string;
}

/** A candle just closed on a timeframe */
export interface CandleCloseEvent extends BaseMarketEvent {
  type: "market:candle_close";
  symbol: string;
  timeframe: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  /** Number of trades in the candle */
  tradeCount?: number;
}

/** Real-time price update */
export interface PriceTickEvent extends BaseMarketEvent {
  type: "market:price_tick";
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  volume24h: number;
  priceChange24h?: number;
  priceChangePercent24h?: number;
}

/** Unusual volume detected */
export interface VolumeSpikeEvent extends BaseMarketEvent {
  type: "market:volume_spike";
  symbol: string;
  currentVolume: number;
  averageVolume: number;
  /** Multiple of average (e.g. 3.5 = 3.5x normal volume) */
  spikeMultiple: number;
  timeframe: string;
  price: number;
}

/** Funding rate shifted significantly */
export interface FundingRateChangeEvent extends BaseMarketEvent {
  type: "market:funding_rate_change";
  symbol: string;
  currentRate: number;
  previousRate: number;
  /** Absolute change in rate */
  delta: number;
  /** Annualized rate */
  annualizedRate?: number;
}

/** Large liquidations detected */
export interface LiquidationWaveEvent extends BaseMarketEvent {
  type: "market:liquidation_wave";
  symbol: string;
  side: "long" | "short" | "both";
  totalLiquidated: number;
  /** Number of individual liquidation events */
  count: number;
  /** Time window in seconds */
  windowSeconds: number;
  priceImpactPercent: number;
}

/** Significant spread widening/narrowing */
export interface SpreadChangeEvent extends BaseMarketEvent {
  type: "market:spread_change";
  symbol: string;
  currentSpread: number;
  previousSpread: number;
  /** Percentage change in spread */
  changePercent: number;
  bidPrice: number;
  askPrice: number;
}

// ============================================================================
// Position Event Interfaces
// ============================================================================

/** New position entered */
export interface PositionOpenedEvent extends BaseMarketEvent {
  type: "position:opened";
  symbol: string;
  side: "long" | "short";
  entryPrice: number;
  quantity: number;
  stopLoss?: number;
  takeProfit?: number[];
  planId?: string;
  strategy?: string;
}

/** Position P&L or state changed */
export interface PositionUpdatedEvent extends BaseMarketEvent {
  type: "position:updated";
  symbol: string;
  side: "long" | "short";
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  /** Whether this update was from real-time data vs polling */
  realtime?: boolean;
}

/** Stop loss level hit */
export interface StopTriggeredMarketEvent extends BaseMarketEvent {
  type: "position:stop_triggered";
  symbol: string;
  side: "long" | "short";
  stopPrice: number;
  triggerPrice: number;
  entryPrice: number;
  quantity: number;
  pnl: number;
  pnlPercent: number;
  tradeId?: string;
}

/** Take profit level hit */
export interface TargetReachedEvent extends BaseMarketEvent {
  type: "position:target_reached";
  symbol: string;
  side: "long" | "short";
  targetLevel: number;
  targetPrice: number;
  triggerPrice: number;
  entryPrice: number;
  quantity: number;
  pnl: number;
  pnlPercent: number;
  tradeId?: string;
}

/** Position fully closed */
export interface PositionClosedEvent extends BaseMarketEvent {
  type: "position:closed";
  symbol: string;
  side: "long" | "short";
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  realizedPnl: number;
  realizedPnlPercent: number;
  holdDurationMs: number;
  reason: "manual" | "stop_loss" | "take_profit" | "trailing_stop" | "liquidation" | "timeout";
  strategy?: string;
  tradeId?: string;
  portfolioIdentity?: string;
}

// ============================================================================
// Strategy Event Interfaces
// ============================================================================

/** Scanner found a potential setup */
export interface SetupDetectedEvent extends BaseMarketEvent {
  type: "strategy:setup_detected";
  symbol: string;
  strategy: string;
  confidence: number;
  bias: "bullish" | "bearish" | "neutral";
  timeframe: string;
  signals: Record<string, unknown>;
  /** Whether this came from an ensemble scan */
  ensembleAgreement?: number;
}

/** Analyst finished evaluating a setup */
export interface AnalysisCompleteEvent extends BaseMarketEvent {
  type: "strategy:analysis_complete";
  symbol: string;
  overallBias: "bullish" | "bearish" | "neutral";
  confidence: number;
  supportLevels: number[];
  resistanceLevels: number[];
  currentPrice: number;
  recommendation: "enter" | "wait" | "avoid";
  technicalSummary: string;
}

/** Planner created an execution plan */
export interface PlanReadyEvent extends BaseMarketEvent {
  type: "strategy:plan_ready";
  planId: string;
  symbol: string;
  direction: "long" | "short";
  entry: number;
  stopLoss: number;
  takeProfits: number[];
  riskRewardRatio: number;
  positionSizePct: number;
  strategy: string;
}

/** Risk kernel approved an action */
export interface RiskApprovedEvent extends BaseMarketEvent {
  type: "strategy:risk_approved";
  planId: string;
  symbol: string;
  riskScore: number;
  maxDrawdownAllowed: number;
  approvedSize: number;
  conditions?: string[];
}

/** Risk kernel rejected an action */
export interface RiskRejectedEvent extends BaseMarketEvent {
  type: "strategy:risk_rejected";
  planId: string;
  symbol: string;
  riskScore: number;
  reason: string;
  violations: string[];
}

// ============================================================================
// System Scheduling Event Interfaces
// ============================================================================

/** Scheduled job triggered */
export interface CronTickEvent extends BaseMarketEvent {
  type: "system:cron_tick";
  jobId: string;
  jobName: string;
  /** Cron expression or interval description */
  schedule: string;
  /** Payload data for the cron job */
  payload?: Record<string, unknown>;
}

/** External webhook received */
export interface WebhookReceivedEvent extends BaseMarketEvent {
  type: "system:webhook_received";
  webhookId: string;
  source: string;
  payload: Record<string, unknown>;
}

/** New trading session started */
export interface SessionStartEvent extends BaseMarketEvent {
  type: "system:session_start";
  sessionId: string;
  userId?: string;
  config?: Record<string, unknown>;
}

/** Trading session ended */
export interface SessionEndEvent extends BaseMarketEvent {
  type: "system:session_end";
  sessionId: string;
  duration: number;
  tradesExecuted: number;
  totalPnl: number;
}

// ============================================================================
// Union Type
// ============================================================================

/** Union of all market events */
export type MarketEvent =
  | CandleCloseEvent
  | PriceTickEvent
  | VolumeSpikeEvent
  | FundingRateChangeEvent
  | LiquidationWaveEvent
  | SpreadChangeEvent
  | PositionOpenedEvent
  | PositionUpdatedEvent
  | StopTriggeredMarketEvent
  | TargetReachedEvent
  | PositionClosedEvent
  | SetupDetectedEvent
  | AnalysisCompleteEvent
  | PlanReadyEvent
  | RiskApprovedEvent
  | RiskRejectedEvent
  | CronTickEvent
  | WebhookReceivedEvent
  | SessionStartEvent
  | SessionEndEvent;

/**
 * Get typed event data from a MarketEventType
 */
export type MarketEventData<T extends MarketEventType> = Extract<MarketEvent, { type: T }>;

// ============================================================================
// Zod Schemas for Runtime Validation
// ============================================================================

export const CandleCloseEventSchema = z.object({
  type: z.literal("market:candle_close"),
  timestamp: z.string(),
  source: z.string().optional(),
  symbol: z.string(),
  timeframe: z.string(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
  quoteVolume: z.number(),
  tradeCount: z.number().optional(),
});

export const PriceTickEventSchema = z.object({
  type: z.literal("market:price_tick"),
  timestamp: z.string(),
  source: z.string().optional(),
  symbol: z.string(),
  price: z.number(),
  bid: z.number(),
  ask: z.number(),
  volume24h: z.number(),
  priceChange24h: z.number().optional(),
  priceChangePercent24h: z.number().optional(),
});

export const VolumeSpikeEventSchema = z.object({
  type: z.literal("market:volume_spike"),
  timestamp: z.string(),
  source: z.string().optional(),
  symbol: z.string(),
  currentVolume: z.number(),
  averageVolume: z.number(),
  spikeMultiple: z.number(),
  timeframe: z.string(),
  price: z.number(),
});

export const SetupDetectedEventSchema = z.object({
  type: z.literal("strategy:setup_detected"),
  timestamp: z.string(),
  source: z.string().optional(),
  symbol: z.string(),
  strategy: z.string(),
  confidence: z.number(),
  bias: z.enum(["bullish", "bearish", "neutral"]),
  timeframe: z.string(),
  signals: z.record(z.string(), z.any()),
  ensembleAgreement: z.number().optional(),
});

export const AnalysisCompleteEventSchema = z.object({
  type: z.literal("strategy:analysis_complete"),
  timestamp: z.string(),
  source: z.string().optional(),
  symbol: z.string(),
  overallBias: z.enum(["bullish", "bearish", "neutral"]),
  confidence: z.number(),
  supportLevels: z.array(z.number()),
  resistanceLevels: z.array(z.number()),
  currentPrice: z.number(),
  recommendation: z.enum(["enter", "wait", "avoid"]),
  technicalSummary: z.string(),
});

export const PlanReadyEventSchema = z.object({
  type: z.literal("strategy:plan_ready"),
  timestamp: z.string(),
  source: z.string().optional(),
  planId: z.string(),
  symbol: z.string(),
  direction: z.enum(["long", "short"]),
  entry: z.number(),
  stopLoss: z.number(),
  takeProfits: z.array(z.number()),
  riskRewardRatio: z.number(),
  positionSizePct: z.number(),
  strategy: z.string(),
});

export const CronTickEventSchema = z.object({
  type: z.literal("system:cron_tick"),
  timestamp: z.string(),
  source: z.string().optional(),
  jobId: z.string(),
  jobName: z.string(),
  schedule: z.string(),
  payload: z.record(z.string(), z.any()).optional(),
});

export const PositionClosedEventSchema = z.object({
  type: z.literal("position:closed"),
  timestamp: z.string(),
  source: z.string().optional(),
  symbol: z.string(),
  side: z.enum(["long", "short"]),
  entryPrice: z.number(),
  exitPrice: z.number(),
  quantity: z.number(),
  realizedPnl: z.number(),
  realizedPnlPercent: z.number(),
  holdDurationMs: z.number(),
  reason: z.enum(["manual", "stop_loss", "take_profit", "trailing_stop", "liquidation", "timeout"]),
  strategy: z.string().optional(),
  tradeId: z.string().optional(),
  portfolioIdentity: z.string().optional(),
});
