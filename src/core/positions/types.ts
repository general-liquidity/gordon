/**
 * Position State Machine Types
 * Defines the canonical position lifecycle states, transitions, and data shapes.
 */

import { z } from "zod";

// ============================================================================
// Position States
// ============================================================================

/**
 * All possible states a position can be in during its lifecycle.
 *
 *   idea -> analyzed -> planned -> approved -> ordering -> filled
 *     -> monitoring -> closing -> closed -> reviewed
 *
 * At any pre-fill state the position can be cancelled.
 * At the planned state the risk kernel can reject.
 * Terminal states: reviewed, cancelled, rejected.
 */
export const PositionStateSchema = z.enum([
  "idea",        // Scanner detected a potential setup
  "analyzed",    // Analyst evaluated the setup
  "planned",     // Planner created execution plan with sizing
  "approved",    // User approved the trade (human-in-the-loop)
  "ordering",    // Order is being placed on exchange
  "filled",      // Order filled, position is live
  "monitoring",  // Position is being actively tracked
  "closing",     // Close order is being placed
  "closed",      // Position fully closed
  "reviewed",    // Teacher completed post-trade review
  "cancelled",   // Trade cancelled at any pre-fill stage
  "rejected",    // Risk kernel rejected the trade
]);

export type PositionState = z.infer<typeof PositionStateSchema>;

// ============================================================================
// Valid Transitions
// ============================================================================

/**
 * Legal state transitions. Each key maps to the set of states reachable from it.
 */
export const VALID_TRANSITIONS: Record<PositionState, PositionState[]> = {
  idea:       ["analyzed", "cancelled"],
  analyzed:   ["planned", "cancelled"],
  planned:    ["approved", "rejected", "cancelled"],
  approved:   ["ordering", "cancelled"],
  ordering:   ["filled", "cancelled"],        // cancelled if order rejected by exchange
  filled:     ["monitoring"],
  monitoring: ["closing", "closed"],           // closed for instant market close
  closing:    ["closed"],
  closed:     ["reviewed"],
  reviewed:   [],                              // terminal state
  cancelled:  [],                              // terminal state
  rejected:   [],                              // terminal state
};

/**
 * Terminal states — no transitions out of these.
 */
export const TERMINAL_STATES: ReadonlySet<PositionState> = new Set([
  "reviewed",
  "cancelled",
  "rejected",
]);

/**
 * Active (non-terminal) states.
 */
export const ACTIVE_STATES: readonly PositionState[] = [
  "idea",
  "analyzed",
  "planned",
  "approved",
  "ordering",
  "filled",
  "monitoring",
  "closing",
  "closed",
];

// ============================================================================
// Sub-record Schemas
// ============================================================================

export const SetupSignalSchema = z.object({
  symbol: z.string(),
  strategy: z.string(),
  confidence: z.number().min(0).max(1),
  setupType: z.string(),
  timeframe: z.string().optional(),
  price: z.number().optional(),
  notes: z.string().optional(),
});
export type SetupSignal = z.infer<typeof SetupSignalSchema>;

export const AnalysisResultSchema = z.object({
  bias: z.enum(["bullish", "bearish", "neutral"]),
  confidence: z.number().min(0).max(1),
  riskLevel: z.enum(["low", "medium", "high"]).optional(),
  technicalSummary: z.string().optional(),
  supportLevels: z.array(z.number()).optional(),
  resistanceLevels: z.array(z.number()).optional(),
  notes: z.string().optional(),
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

export const TradePlanSchema = z.object({
  planId: z.string().optional(),
  entry: z.number(),
  entryType: z.enum(["limit", "market"]),
  stopLoss: z.number(),
  takeProfits: z.array(z.number()),
  positionSizePct: z.number(),
  allocationAmount: z.number(),
  riskRewardRatio: z.number().optional(),
  strategy: z.string().optional(),
  notes: z.string().optional(),
});
export type TradePlan = z.infer<typeof TradePlanSchema>;

export const RiskDecisionSchema = z.object({
  approved: z.boolean(),
  reason: z.string(),
  riskScore: z.number().optional(),
  maxPositionSize: z.number().optional(),
  timestamp: z.string(),
});
export type RiskDecision = z.infer<typeof RiskDecisionSchema>;

export const OrderRecordSchema = z.object({
  orderId: z.string(),
  exchangeOrderId: z.string().optional(),
  type: z.enum(["limit", "market", "stop_market", "stop_limit"]),
  side: z.enum(["buy", "sell"]),
  price: z.number().optional(),
  quantity: z.number(),
  status: z.enum(["pending", "placed", "partially_filled", "filled", "cancelled", "rejected"]),
  placedAt: z.string(),
  filledAt: z.string().optional(),
});
export type OrderRecord = z.infer<typeof OrderRecordSchema>;

export const TradeReviewSchema = z.object({
  grade: z.enum(["A", "B", "C", "D", "F"]).optional(),
  lessonsLearned: z.string().optional(),
  followedPlan: z.boolean().optional(),
  entryQuality: z.number().min(1).max(10).optional(),
  exitQuality: z.number().min(1).max(10).optional(),
  emotionalState: z.string().optional(),
  notes: z.string().optional(),
  reviewedAt: z.string(),
});
export type TradeReview = z.infer<typeof TradeReviewSchema>;

export const TrailingStopSchema = z.object({
  activated: z.boolean(),
  level: z.number(),
});
export type TrailingStop = z.infer<typeof TrailingStopSchema>;

// ============================================================================
// State Transition Record
// ============================================================================

export const StateTransitionSchema = z.object({
  fromState: PositionStateSchema,
  toState: PositionStateSchema,
  timestamp: z.string(),
  reason: z.string().optional(),
  agent: z.string().optional(),
});
export type StateTransition = z.infer<typeof StateTransitionSchema>;

// ============================================================================
// Position Record
// ============================================================================

export const PositionRecordSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  exchangeId: z.string(),
  side: z.enum(["long", "short"]),
  state: PositionStateSchema,
  stateHistory: z.array(StateTransitionSchema),

  // Setup phase
  setupSignal: SetupSignalSchema.optional(),
  analysis: AnalysisResultSchema.optional(),
  plan: TradePlanSchema.optional(),
  riskDecision: RiskDecisionSchema.optional(),

  // Execution phase
  entryOrder: OrderRecordSchema.optional(),
  entryPrice: z.number().optional(),
  quantity: z.number().optional(),

  // Management phase
  stopLoss: z.number().optional(),
  takeProfit: z.number().optional(),
  trailingStop: TrailingStopSchema.optional(),
  currentPrice: z.number().optional(),
  unrealizedPnL: z.number().optional(),
  highWaterMark: z.number().optional(),

  // Close phase
  exitOrder: OrderRecordSchema.optional(),
  exitPrice: z.number().optional(),
  realizedPnL: z.number().optional(),

  // Review phase
  review: TradeReviewSchema.optional(),

  // Metadata
  strategyId: z.string().optional(),
  playbookId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  cancelReason: z.string().optional(),
  rejectReason: z.string().optional(),
  closeReason: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  closedAt: z.string().optional(),
});

export type PositionRecord = z.infer<typeof PositionRecordSchema>;

// ============================================================================
// Input / Query Types
// ============================================================================

export interface CreatePositionParams {
  symbol: string;
  exchangeId: string;
  side: "long" | "short";
  setupSignal?: SetupSignal;
  strategyId?: string;
  playbookId?: string;
  tags?: string[];
}

export interface FillData {
  entryPrice: number;
  quantity: number;
  entryOrder?: OrderRecord;
  stopLoss?: number;
  takeProfit?: number;
}

export interface LivePositionData {
  currentPrice: number;
  unrealizedPnL: number;
  highWaterMark?: number;
  trailingStop?: TrailingStop;
  stopLoss?: number;
  takeProfit?: number;
}

export interface CloseData {
  exitPrice: number;
  realizedPnL: number;
  exitOrder?: OrderRecord;
}

export interface HistoryOptions {
  limit?: number;
  since?: string;
  symbol?: string;
  state?: PositionState;
}

export interface PositionSummary {
  total: number;
  active: number;
  byState: Record<PositionState, number>;
  openPnL: number;
  closedPnL: number;
  winRate: number;
  totalClosed: number;
  totalWins: number;
  totalLosses: number;
}

export interface PositionStats {
  totalPositions: number;
  activePositions: number;
  closedPositions: number;
  cancelledPositions: number;
  rejectedPositions: number;
  winRate: number;
  totalPnL: number;
  averagePnL: number;
  bestTrade: number;
  worstTrade: number;
}

// ============================================================================
// Position Event Types (for the EventBus)
// ============================================================================

export interface PositionStateChangedEvent {
  type: "position:state_changed";
  timestamp: string;
  positionId: string;
  symbol: string;
  fromState: PositionState;
  toState: PositionState;
  position: PositionRecord;
}

export interface PositionCreatedEvent {
  type: "position:created";
  timestamp: string;
  positionId: string;
  symbol: string;
  side: "long" | "short";
  position: PositionRecord;
}

export interface PositionOpenedEvent {
  type: "position:opened";
  timestamp: string;
  positionId: string;
  symbol: string;
  entryPrice: number;
  quantity: number;
  position: PositionRecord;
}

export interface PositionClosedEvent {
  type: "position:closed";
  timestamp: string;
  positionId: string;
  symbol: string;
  realizedPnL: number;
  position: PositionRecord;
}

export interface PositionCancelledEvent {
  type: "position:cancelled";
  timestamp: string;
  positionId: string;
  symbol: string;
  reason: string;
  fromState: PositionState;
  position: PositionRecord;
}

export interface PositionRejectedEvent {
  type: "position:rejected";
  timestamp: string;
  positionId: string;
  symbol: string;
  reason: string;
  position: PositionRecord;
}

export interface PositionReviewedEvent {
  type: "position:reviewed";
  timestamp: string;
  positionId: string;
  symbol: string;
  review: TradeReview;
  position: PositionRecord;
}

export interface PositionUpdatedEvent {
  type: "position:updated";
  timestamp: string;
  positionId: string;
  symbol: string;
  updates: Partial<PositionRecord>;
}
