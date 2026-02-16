/**
 * Position State Machine — Public API
 *
 * Exports everything needed to track a trade through its full lifecycle:
 *   idea -> analyzed -> planned -> approved -> ordering -> filled
 *     -> monitoring -> closing -> closed -> reviewed
 */

// Types and schemas
export {
  // State enum & schema
  PositionStateSchema,
  type PositionState,

  // Transition map
  VALID_TRANSITIONS,
  TERMINAL_STATES,
  ACTIVE_STATES,

  // Sub-record schemas & types
  SetupSignalSchema,
  type SetupSignal,
  AnalysisResultSchema,
  type AnalysisResult,
  TradePlanSchema,
  type TradePlan,
  RiskDecisionSchema,
  type RiskDecision,
  OrderRecordSchema,
  type OrderRecord,
  TradeReviewSchema,
  type TradeReview,
  TrailingStopSchema,
  type TrailingStop,

  // State transition
  StateTransitionSchema,
  type StateTransition,

  // Position record
  PositionRecordSchema,
  type PositionRecord,

  // Input / query types
  type CreatePositionParams,
  type FillData,
  type LivePositionData,
  type CloseData,
  type HistoryOptions,
  type PositionSummary,
  type PositionStats,

  // Event types
  type PositionStateChangedEvent,
  type PositionCreatedEvent,
  type PositionOpenedEvent,
  type PositionClosedEvent,
  type PositionCancelledEvent,
  type PositionRejectedEvent,
  type PositionReviewedEvent,
  type PositionUpdatedEvent,
} from "./types.ts";

// Store
export { PositionStore, getPositionStore } from "./store.ts";

// State machine
export { PositionStateMachine } from "./state-machine.ts";

// Manager (high-level API for agents)
export {
  PositionManager,
  createPositionManager,
  getPositionManager,
  resetPositionManager,
} from "./manager.ts";
