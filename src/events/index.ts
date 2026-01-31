/**
 * Events Index
 */

// Event types
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
} from "./types.ts";

// Event bus
export {
  EventBus,
  getEventBus,
  setEventBus,
  emitEvent,
  type EventHandler,
  type WildcardHandler,
  type SubscriptionOptions,
} from "./bus.ts";
