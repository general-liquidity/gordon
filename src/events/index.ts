/**
 * Events Index
 * Central export point for Gordon's event system including:
 * - Core event types and bus
 * - Extended market event types
 * - Agent event subscriptions
 * - Market data event emitter
 */

// ============================================================================
// Core Event Types (existing)
// ============================================================================

export type {
  GordonEvent,
  EventType,
  EventData,
  BaseEvent,
  SystemStartedEvent,
  SystemArmedEvent,
  SystemDisarmedEvent,
  SystemErrorEvent,
  BinanceConnectedEvent,
  BinanceDisconnectedEvent,
  BinanceRateLimitEvent,
  PlanCreatedEvent,
  PlanApprovedEvent,
  PlanRejectedEvent,
  PlanCancelledEvent,
  TradeOpenedEvent,
  TradeUpdatedEvent,
  TradeClosedEvent,
  PriceAlertEvent,
  StopLossApproachingEvent,
  TakeProfitHitEvent,
  ScanStartedEvent,
  ScanCompletedEvent,
  OpportunityFoundEvent,
  AgentHandoffAckEvent,
  AgentFallbackEvent,
  AgentRetryEvent,
  PositionStateChangedEvent,
  PositionCreatedEvent,
  PositionOpenedEvent as PositionOpenedCoreEvent,
  PositionClosedEventV2,
  PositionCancelledEvent,
  PositionRejectedEvent,
  PositionReviewedEvent,
  PositionUpdatedEvent as PositionUpdatedCoreEvent,
} from "./types.ts";

// ============================================================================
// Event Bus (existing)
// ============================================================================

export {
  EventBus,
  getEventBus,
  setEventBus,
  emitEvent,
  type EventHandler,
  type WildcardHandler,
  type SubscriptionOptions,
} from "./bus.ts";

// ============================================================================
// Market Event Types (new)
// ============================================================================

export {
  MarketEventTypeSchema,
  CandleCloseEventSchema,
  PriceTickEventSchema,
  VolumeSpikeEventSchema,
  SetupDetectedEventSchema,
  AnalysisCompleteEventSchema,
  PlanReadyEventSchema,
  CronTickEventSchema,
  PositionClosedEventSchema,
} from "./market-events.ts";

export type {
  MarketEventType,
  MarketEvent,
  MarketEventData,
  BaseMarketEvent,
  // Market data events
  CandleCloseEvent,
  PriceTickEvent,
  VolumeSpikeEvent,
  FundingRateChangeEvent,
  LiquidationWaveEvent,
  SpreadChangeEvent,
  // Position events
  PositionOpenedEvent,
  PositionUpdatedEvent,
  StopTriggeredMarketEvent,
  TargetReachedEvent,
  PositionClosedEvent,
  // Strategy events
  SetupDetectedEvent,
  AnalysisCompleteEvent,
  PlanReadyEvent,
  RiskApprovedEvent,
  RiskRejectedEvent,
  // System events
  CronTickEvent,
  WebhookReceivedEvent,
  SessionStartEvent,
  SessionEndEvent,
} from "./market-events.ts";

// ============================================================================
// Agent Event Subscriptions (new)
// ============================================================================

export {
  AgentSubscriptionRegistry,
  getSubscriptionRegistry,
  initializeSubscriptions,
  resetSubscriptionRegistry,
  createDefaultSubscriptions,
} from "./agent-subscriptions.ts";

export type {
  AgentId,
  AgentSubscription,
  AgentInvoker,
} from "./agent-subscriptions.ts";

// ============================================================================
// Market Data Event Emitter (new)
// ============================================================================

export {
  MarketEventEmitter,
  getMarketEmitter,
  resetMarketEmitter,
} from "./market-emitter.ts";

export type {
  WatchedSymbol,
  MarketEmitterConfig,
} from "./market-emitter.ts";
