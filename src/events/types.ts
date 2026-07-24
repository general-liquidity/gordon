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
 * Exchange connection events
 */
export interface ExchangeConnectedEvent extends BaseEvent {
  type: "exchange:connected";
  exchangeId: string;
}

export interface ExchangeDisconnectedEvent extends BaseEvent {
  type: "exchange:disconnected";
  exchangeId: string;
  reason?: string;
}

export interface ExchangeRateLimitEvent extends BaseEvent {
  type: "exchange:rate_limit";
  exchangeId: string;
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
/**
 * Fires before compaction begins so subscribers (TUI, audit log) can
 * show progress UI during the LLM call. Pairs with `memory:summarized`
 * which fires on success — together they bracket a compaction lifecycle.
 */
export interface MemorySummarizingEvent extends BaseEvent {
  type: "memory:summarizing";
  /** Why compaction is firing — set by the caller. */
  reason: "manual" | "threshold" | "overflow";
  /** Pre-compaction message count. */
  messageCount: number;
  /** Stage the trigger expects to run (informational). */
  expectedStage?: string;
}

export interface MemorySummarizedEvent extends BaseEvent {
  type: "memory:summarized";
  originalCount: number;
  newCount: number;
  summarizedCount: number;
}

/**
 * Per-call cost delta. Emitted by CostTracker.record() each time an API
 * call's usage is folded into the session ledger. Subscribers (TUI,
 * audit log) can show running spend per response without polling the
 * snapshot. Inspired by Aider's live token/cost display during a turn.
 */
export interface CostTurnDeltaEvent extends BaseEvent {
  type: "cost:turn_delta";
  /** Canonical model ID the call hit. */
  modelId: string;
  /** Friendly model name for display, falls back to modelId. */
  displayName: string;
  /** USD cost of just this single call. */
  callCostUsd: number;
  /** USD running total across all models for this session after the call. */
  sessionTotalUsd: number;
  /** Token counts for THIS call only (not session totals). */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Session ID — useful when a process tracks multiple sessions. */
  sessionId: string;
}

/**
 * Fires alongside `memory:summarized` when the compaction produced
 * structured metadata (venues/strategies/indicators/etc). Separate event so
 * subscribers that only care about metadata don't have to parse the base
 * summarization event.
 */
/**
 * Operator-facing alert. Fires when a passive metric crosses a meaningful
 * threshold or a subsystem needs operator attention. Subscribers decide how
 * to route (console/webhook/Slack/email) — the bus is transport-agnostic.
 */
export interface AlertFiredEvent extends BaseEvent {
  type: "alert:fired";
  level: "info" | "warning" | "critical";
  /** Category for filtering ("cost", "venue", "mandate", "error", …). */
  category: string;
  /** Short human-readable message. */
  message: string;
  /** Optional structured context for the subscriber to render. */
  context?: Record<string, unknown>;
  /** Deduplication key — emitters can use this to throttle. */
  dedupeKey?: string;
}

export interface MemoryCompactedDetailsEvent extends BaseEvent {
  type: "memory:compacted_details";
  stage: string;
  iterative: boolean;
  messagesFolded: number;
  symbols: string[];
  venues: string[];
  strategies: string[];
  indicators: string[];
  chartPatterns: string[];
  timeframes: string[];
  researchArtifacts: string[];
  mandates: string[];
  approvals: string[];
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
 * Agent elicitation events — mid-task request for user clarification.
 * Agent emits `agent:elicitation_requested`; TUI answers with `agent:elicitation_answered`
 * carrying the same `requestId`.
 */
export interface AgentElicitationRequestedEvent extends BaseEvent {
  type: "agent:elicitation_requested";
  requestId: string;
  prompt: string;
  options?: Array<{ value: string; label: string }>;
  kind: "choice" | "text" | "confirm";
}

export interface AgentElicitationAnsweredEvent extends BaseEvent {
  type: "agent:elicitation_answered";
  requestId: string;
  answer: string;
}

/**
 * Debate events — fired by runDebate() when adversarial reasoning runs.
 */
export interface DebateStartedEvent extends BaseEvent {
  type: "debate:started";
  debateId: string;
  topic: string;
  participants: string[];
}

export interface DebateResolvedEvent extends BaseEvent {
  type: "debate:resolved";
  debateId: string;
  topic: string;
  transcript: Array<{ speaker: string; argument: string }>;
  conclusion: string;
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
  | ExchangeConnectedEvent
  | ExchangeDisconnectedEvent
  | ExchangeRateLimitEvent
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
  | MemorySummarizingEvent
  | MemorySummarizedEvent
  | MemoryCompactedDetailsEvent
  | CostTurnDeltaEvent
  | AlertFiredEvent
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
  | ProactiveSuggestionResolvedEvent
  | AgentElicitationRequestedEvent
  | AgentElicitationAnsweredEvent
  | DebateStartedEvent
  | DebateResolvedEvent;

/**
 * Extract event type string
 */
export type EventType = GordonEvent["type"];

/**
 * Get event data type by event type string
 */
export type EventData<T extends EventType> = Extract<GordonEvent, { type: T }>;
