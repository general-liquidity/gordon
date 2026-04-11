/**
 * Event Types
 * Defines all events that can be emitted in Gordon
 */

import type { Plan, Trade } from "../types/index.ts";
import type {
  PositionRecord,
  PositionState,
  TradeReview,
} from "../core/positions/types.ts";

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
  permissionMode: "auto" | "ask" | "strict";
}

export interface SystemPermissionModeChangedEvent extends BaseEvent {
  type: "system:permission_mode_changed";
  permissionMode: "auto" | "ask" | "strict";
  previous?: "auto" | "ask" | "strict";
  reason?: string;
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
  reason: "MANUAL" | "STOP" | "TP1" | "TP2" | "TP3" | "TRAILING_STOP";
  pnl: number;
  pnlPercent: number;
}

export interface TradePartialCloseEvent extends BaseEvent {
  type: "trade:partial_close";
  tradeId: string;
  trade?: Trade;
  symbol: string;
  closedQuantity: number;
  remainingQuantity: number;
  pnl: number;
  reason: string;
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
  realtime?: boolean;
}

export interface TakeProfitHitEvent extends BaseEvent {
  type: "alert:tp_hit";
  tradeId: string;
  symbol: string;
  level: 1 | 2 | 3;
  price: number;
}

export interface StopTriggeredEvent extends BaseEvent {
  type: "alert:stop_triggered";
  tradeId: string;
  symbol: string;
  currentPrice?: number;
  stopPrice: number;
  exitPrice?: number;
  pnl?: number;
  realtime?: boolean;
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

export interface AgentStreamChunkEvent extends BaseEvent {
  type: "agent:stream_chunk";
  content: string;
  chunkIndex: number;
}

export interface AgentNetworkRoutedEvent extends BaseEvent {
  type: "agent:network_routed";
  fromAgent: string;
  toAgent: string;
  reason?: string;
}

export interface AgentReflectionEvent extends BaseEvent {
  type: "agent:reflection";
  agent: string;
  analysis: string;
  adjustments?: string[];
}

export interface AgentHandoffAckEvent extends BaseEvent {
  type: "agent:handoff_ack";
  fromAgent: string;
  toAgent: string;
  validated: boolean;
  reason?: string;
  handoffId: string;
}

export interface AgentFallbackEvent extends BaseEvent {
  type: "agent:fallback";
  primaryAgent: string;
  fallbackTarget: string;
  fallbackType: "agent" | "tool" | "cache";
  reason: string;
  attempt: number;
}

export interface AgentRetryEvent extends BaseEvent {
  type: "agent:retry";
  agent: string;
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  errorType: string;
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

export interface GuardrailInputBlockedEvent extends BaseEvent {
  type: "guardrail:input_blocked";
  reason: string;
  pattern?: string;
  description?: string;
  length?: number;
  severity?: "low" | "medium" | "high" | "critical";
}

export interface GuardrailOutputSanitizedEvent extends BaseEvent {
  type: "guardrail:output_sanitized";
  patterns: string[];
  sanitizedLength: number;
  reason?: string;
  patternType?: string;
}

/**
 * Access control events
 */
export interface AccessControlDeniedEvent extends BaseEvent {
  type: "access_control:denied";
  reason: string;
  tool?: string;
  toolName?: string;
  userId?: string;
  permissionMode?: "auto" | "ask" | "strict";
}

export interface AccessControlWarningEvent extends BaseEvent {
  type: "access_control:warning";
  message: string;
  tool?: string;
  toolName?: string;
  warning?: string;
}

/**
 * Scheduler events
 */
export interface SchedulerStartedEvent extends BaseEvent {
  type: "scheduler:started";
  intervalMinutes?: number;
  intervalMs?: number;
  config?: {
    intervalMinutes?: number;
    universeFilter?: string;
  };
}

export interface SchedulerStoppedEvent extends BaseEvent {
  type: "scheduler:stopped";
}

export interface SchedulerScanCompletedEvent extends BaseEvent {
  type: "scheduler:scan_completed";
  coinsScanned?: number;
  opportunitiesFound?: number;
  scanNumber?: number;
  opportunities?: number;
}

export interface SchedulerScanFailedEvent extends BaseEvent {
  type: "scheduler:scan_failed";
  error: string;
  scanNumber?: number;
}

/**
 * Memory events
 */
export interface MemorySummarizedEvent extends BaseEvent {
  type: "memory:summarized";
  originalCount: number;
  newCount: number;
  summarizedCount: number;
}

/**
 * Autonomous loop events
 */
export interface AutonomousStartedEvent extends BaseEvent {
  type: "autonomous:started";
  mandateId: string;
  intervalMs: number;
}

export interface AutonomousStoppedEvent extends BaseEvent {
  type: "autonomous:stopped";
  reason?: string;
  totalCycles: number;
  totalOpportunities: number;
}

export interface AutonomousPausedEvent extends BaseEvent {
  type: "autonomous:paused";
  mandateId?: string;
}

export interface AutonomousResumedEvent extends BaseEvent {
  type: "autonomous:resumed";
  mandateId?: string;
}

export interface AutonomousCycleCompletedEvent extends BaseEvent {
  type: "autonomous:cycle_completed";
  cycleNumber: number;
  opportunities: number;
  mandateId: string;
}

export interface AutonomousCycleFailedEvent extends BaseEvent {
  type: "autonomous:cycle_failed";
  cycleNumber: number;
  error: string;
}

export interface AutonomousMandateBreachedEvent extends BaseEvent {
  type: "autonomous:mandate_breached";
  reason: string;
  mandateId: string;
}

/**
 * Risk Kernel events
 */
export interface RiskApprovedEvent extends BaseEvent {
  type: "risk:approved";
  symbol: string;
  action: "approve" | "modify";
  agentId: string;
  checks: number;
  reason?: string;
}

export interface RiskRejectedEvent extends BaseEvent {
  type: "risk:rejected";
  symbol: string;
  agentId: string;
  checks: string[];
  reason?: string;
}

/**
 * Position lifecycle events
 */
export interface PositionStateChangedEvent extends BaseEvent {
  type: "position:state_changed";
  positionId: string;
  symbol: string;
  fromState: PositionState;
  toState: PositionState;
  position: PositionRecord;
}

export interface PositionCreatedEvent extends BaseEvent {
  type: "position:created";
  positionId: string;
  symbol: string;
  side: "long" | "short";
  position: PositionRecord;
}

export interface PositionOpenedEvent extends BaseEvent {
  type: "position:opened";
  positionId: string;
  symbol: string;
  entryPrice: number;
  quantity: number;
  position: PositionRecord;
}

export interface PositionClosedEventV2 extends BaseEvent {
  type: "position:closed";
  positionId: string;
  symbol: string;
  realizedPnL: number;
  position: PositionRecord;
}

export interface PositionCancelledEvent extends BaseEvent {
  type: "position:cancelled";
  positionId: string;
  symbol: string;
  reason: string;
  fromState: PositionState;
  position: PositionRecord;
}

export interface PositionRejectedEvent extends BaseEvent {
  type: "position:rejected";
  positionId: string;
  symbol: string;
  reason: string;
  position: PositionRecord;
}

export interface PositionReviewedEvent extends BaseEvent {
  type: "position:reviewed";
  positionId: string;
  symbol: string;
  review: TradeReview;
  position: PositionRecord;
}

export interface PositionUpdatedEvent extends BaseEvent {
  type: "position:updated";
  positionId: string;
  symbol: string;
  updates: Partial<PositionRecord>;
}

/**
 * Proactive mode events
 */
export interface ProactiveSuggestionFiredEvent extends BaseEvent {
  type: "proactive:suggestion_fired";
  suggestionId: string;
  category: string;
  title: string;
  body: string;
  confidence: number;
  action?: string;
  operation?: {
    tool: string;
    args: Record<string, unknown>;
    readOnly: boolean;
    description: string;
  };
  triggers?: Record<string, unknown>;
}

export interface ProactiveSuggestionResolvedEvent extends BaseEvent {
  type: "proactive:suggestion_resolved";
  suggestionId: string;
  category: string;
  status: "accepted" | "dismissed" | "suppressed" | "expired";
}

/**
 * Union type of all events
 */
export type GordonEvent =
  | SystemStartedEvent
  | SystemPermissionModeChangedEvent
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
  | TradePartialCloseEvent
  | PriceAlertEvent
  | StopLossApproachingEvent
  | StopTriggeredEvent
  | TakeProfitHitEvent
  | ScanStartedEvent
  | ScanCompletedEvent
  | OpportunityFoundEvent
  | AgentStartedEvent
  | AgentCompletedEvent
  | AgentHandoffEvent
  | AgentHandoffAckEvent
  | AgentFallbackEvent
  | AgentRetryEvent
  | AgentMessageProcessedEvent
  | AgentStreamCompletedEvent
  | AgentStreamChunkEvent
  | AgentNetworkRoutedEvent
  | AgentReflectionEvent
  | ToolStartedEvent
  | ToolCompletedEvent
  | GuardrailBlockedEvent
  | GuardrailInputBlockedEvent
  | GuardrailOutputSanitizedEvent
  | AccessControlDeniedEvent
  | AccessControlWarningEvent
  | SchedulerStartedEvent
  | SchedulerStoppedEvent
  | SchedulerScanCompletedEvent
  | SchedulerScanFailedEvent
  | MemorySummarizedEvent
  | AutonomousStartedEvent
  | AutonomousStoppedEvent
  | AutonomousPausedEvent
  | AutonomousResumedEvent
  | AutonomousCycleCompletedEvent
  | AutonomousCycleFailedEvent
  | AutonomousMandateBreachedEvent
  | RiskApprovedEvent
  | RiskRejectedEvent
  | PositionStateChangedEvent
  | PositionCreatedEvent
  | PositionOpenedEvent
  | PositionClosedEventV2
  | PositionCancelledEvent
  | PositionRejectedEvent
  | PositionReviewedEvent
  | PositionUpdatedEvent
  | ProactiveSuggestionFiredEvent
  | ProactiveSuggestionResolvedEvent;

/**
 * Extract event type string
 */
export type EventType = GordonEvent["type"];

/**
 * Get event data type by event type string
 */
export type EventData<T extends EventType> = Extract<GordonEvent, { type: T }>;
