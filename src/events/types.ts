/**
 * Event Types
 * Defines all events that can be emitted in Gordon
 */

import type { Plan, Trade } from "../types/index.ts";

/**
 * Base event interface
 */
export interface BaseEvent {
  type: string;
  timestamp: string;
}

/**
 * System events
 */
export interface SystemStartedEvent extends BaseEvent {
  type: "system:started";
  mode: "SAFE" | "ARMED";
}

export interface SystemArmedEvent extends BaseEvent {
  type: "system:armed";
  duration: number; // hours
  expiresAt: string;
}

export interface SystemDisarmedEvent extends BaseEvent {
  type: "system:disarmed";
}

export interface SystemErrorEvent extends BaseEvent {
  type: "system:error";
  error: {
    name: string;
    message: string;
    code?: string;
  };
}

/**
 * Connection events
 */
export interface BinanceConnectedEvent extends BaseEvent {
  type: "binance:connected";
}

export interface BinanceDisconnectedEvent extends BaseEvent {
  type: "binance:disconnected";
  reason?: string;
}

export interface BinanceRateLimitEvent extends BaseEvent {
  type: "binance:rate_limit";
  weight: number;
  limit: number;
}

/**
 * Plan events
 */
export interface PlanCreatedEvent extends BaseEvent {
  type: "plan:created";
  plan: Plan;
}

export interface PlanApprovedEvent extends BaseEvent {
  type: "plan:approved";
  planId: string;
}

export interface PlanRejectedEvent extends BaseEvent {
  type: "plan:rejected";
  planId: string;
  reason?: string;
}

export interface PlanCancelledEvent extends BaseEvent {
  type: "plan:cancelled";
  planId: string;
  reason?: string;
}

/**
 * Trade events
 */
export interface TradeOpenedEvent extends BaseEvent {
  type: "trade:opened";
  trade: Trade;
  planId: string;
}

export interface TradeUpdatedEvent extends BaseEvent {
  type: "trade:updated";
  tradeId: string;
  updates: Partial<Trade>;
}

export interface TradeClosedEvent extends BaseEvent {
  type: "trade:closed";
  trade: Trade;
  reason: "MANUAL" | "STOP" | "TP1" | "TP2" | "TP3";
  pnl: number;
  pnlPercent: number;
}

/**
 * Alert events
 */
export interface PriceAlertEvent extends BaseEvent {
  type: "alert:price";
  symbol: string;
  price: number;
  condition: "above" | "below";
  threshold: number;
}

export interface StopLossApproachingEvent extends BaseEvent {
  type: "alert:stop_approaching";
  tradeId: string;
  symbol: string;
  currentPrice: number;
  stopPrice: number;
  distance: number; // percentage
}

export interface TakeProfitHitEvent extends BaseEvent {
  type: "alert:tp_hit";
  tradeId: string;
  symbol: string;
  level: 1 | 2 | 3;
  price: number;
}

/**
 * Scan events
 */
export interface ScanStartedEvent extends BaseEvent {
  type: "scan:started";
  universe: string;
  timeframes: string[];
}

export interface ScanCompletedEvent extends BaseEvent {
  type: "scan:completed";
  coinsScanned: number;
  opportunitiesFound: number;
  duration: number; // milliseconds
}

export interface OpportunityFoundEvent extends BaseEvent {
  type: "scan:opportunity";
  symbol: string;
  confidence: number;
  bias: string;
}

/**
 * Agent lifecycle events
 */
export interface AgentStartedEvent extends BaseEvent {
  type: "agent:started";
  agent: string;
  parent?: string;
}

export interface AgentCompletedEvent extends BaseEvent {
  type: "agent:completed";
  agent: string;
  outputLength: number;
}

export interface AgentHandoffEvent extends BaseEvent {
  type: "agent:handoff";
  from: string;
  to: string;
}

export interface AgentMessageProcessedEvent extends BaseEvent {
  type: "agent:message_processed";
  userMessage: string;
  responseLength: number;
  historyLength: number;
}

export interface AgentStreamCompletedEvent extends BaseEvent {
  type: "agent:stream_completed";
  responseLength: number;
}

/**
 * Tool lifecycle events
 */
export interface ToolStartedEvent extends BaseEvent {
  type: "tool:started";
  tool: string;
  agent: string;
}

export interface ToolCompletedEvent extends BaseEvent {
  type: "tool:completed";
  tool: string;
  agent: string;
}

/**
 * Guardrail events
 */
export interface GuardrailBlockedEvent extends BaseEvent {
  type: "guardrail:blocked";
  guardrailType: "input" | "output";
  reason: string;
  pattern?: string;
  length?: number;
}

/**
 * Union type of all events
 */
export type GordonEvent =
  | SystemStartedEvent
  | SystemArmedEvent
  | SystemDisarmedEvent
  | SystemErrorEvent
  | BinanceConnectedEvent
  | BinanceDisconnectedEvent
  | BinanceRateLimitEvent
  | PlanCreatedEvent
  | PlanApprovedEvent
  | PlanRejectedEvent
  | PlanCancelledEvent
  | TradeOpenedEvent
  | TradeUpdatedEvent
  | TradeClosedEvent
  | PriceAlertEvent
  | StopLossApproachingEvent
  | TakeProfitHitEvent
  | ScanStartedEvent
  | ScanCompletedEvent
  | OpportunityFoundEvent
  | AgentStartedEvent
  | AgentCompletedEvent
  | AgentHandoffEvent
  | AgentMessageProcessedEvent
  | AgentStreamCompletedEvent
  | ToolStartedEvent
  | ToolCompletedEvent
  | GuardrailBlockedEvent;

/**
 * Extract event type string
 */
export type EventType = GordonEvent["type"];

/**
 * Get event data type by event type string
 */
export type EventData<T extends EventType> = Extract<GordonEvent, { type: T }>;
