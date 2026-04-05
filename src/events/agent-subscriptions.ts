/**
 * Agent Event Subscriptions
 * Maps market events to agent actions, enabling automatic agent invocation
 * when market conditions change (not just on user messages).
 *
 * Architecture:
 * - Each subscription binds a MarketEventType to an agent handler
 * - Optional filters allow conditional triggering (e.g., only for watched symbols)
 * - Priority controls execution order when multiple agents subscribe to the same event
 * - Handlers invoke agents programmatically via Mastra's generate() method
 */

import { createModuleLogger } from "../infra/logger/index.ts";
import { EventBus, getEventBus } from "./bus.ts";
import type { MarketEventType, MarketEvent } from "./market-events.ts";
import type { EventType } from "./types.ts";

const logger = createModuleLogger("agent-subscriptions");

// ============================================================================
// Types
// ============================================================================

/**
 * Agent identifiers matching the Mastra agent IDs
 */
export type AgentId =
  | "scanner"
  | "analyst"
  | "planner"
  | "executor"
  | "monitor"
  | "teacher"
  | "backtester";

/**
 * Subscription definition linking an event type to an agent handler
 */
export interface AgentSubscription {
  /** The market event type to subscribe to */
  eventType: MarketEventType;
  /** Which agent should handle this event */
  agentId: AgentId;
  /** Handler function invoked when the event fires */
  handler: (event: MarketEvent) => Promise<void>;
  /** Optional filter to conditionally trigger (e.g., only for symbols in watchlist) */
  filter?: (event: MarketEvent) => boolean;
  /** Priority for handler execution order (higher runs first, default 0) */
  priority?: number;
  /** Human-readable description of what this subscription does */
  description?: string;
}

/**
 * Active subscription with its unsubscribe function
 */
interface ActiveSubscription {
  subscription: AgentSubscription;
  unsubscribe: () => void;
}

/**
 * Agent invocation function type
 * Allows injection of the actual agent calling mechanism
 */
export type AgentInvoker = (
  agentId: AgentId,
  prompt: string,
  metadata?: Record<string, unknown>
) => Promise<void>;

// ============================================================================
// Subscription Registry
// ============================================================================

/**
 * Registry that manages agent event subscriptions.
 *
 * Wires MarketEvent types from the EventBus to agent handlers.
 * Supports dynamic subscription/unsubscription and filter-based routing.
 */
export class AgentSubscriptionRegistry {
  private activeSubscriptions: Map<string, ActiveSubscription[]> = new Map();
  private bus: EventBus;
  private invoker: AgentInvoker | null = null;
  private enabled: boolean = false;

  constructor(bus?: EventBus) {
    this.bus = bus ?? getEventBus();
  }

  /**
   * Set the agent invoker function.
   * Must be called before enabling subscriptions.
   *
   * @param invoker - Function that calls an agent with a prompt
   */
  setInvoker(invoker: AgentInvoker): void {
    this.invoker = invoker;
    logger.info("Agent invoker set");
  }

  /**
   * Register a single subscription
   */
  register(subscription: AgentSubscription): () => void {
    const key = `${subscription.eventType}:${subscription.agentId}`;

    // Create the wrapped handler that applies filtering and invokes the agent
    const wrappedHandler = async (event: unknown): Promise<void> => {
      const marketEvent = event as MarketEvent;

      // Apply optional filter
      if (subscription.filter && !subscription.filter(marketEvent)) {
        logger.debug("Event filtered out", {
          eventType: subscription.eventType,
          agentId: subscription.agentId,
        });
        return;
      }

      // Only execute if subscriptions are enabled
      if (!this.enabled) {
        logger.debug("Subscriptions disabled, skipping", {
          eventType: subscription.eventType,
          agentId: subscription.agentId,
        });
        return;
      }

      try {
        logger.info("Invoking agent from event subscription", {
          eventType: subscription.eventType,
          agentId: subscription.agentId,
        });

        await subscription.handler(marketEvent);
      } catch (error) {
        logger.error(
          `Agent subscription handler failed: ${subscription.agentId} on ${subscription.eventType}`,
          error instanceof Error ? error : new Error(String(error))
        );
      }
    };

    // Subscribe to the EventBus using the event type as-is
    // The EventBus accepts any string as EventType, and our MarketEventType strings
    // are compatible because EventBus.on() uses type assertion internally
    const unsubscribe = this.bus.on(
      subscription.eventType as unknown as EventType,
      wrappedHandler as (event: unknown) => Promise<void>,
      { priority: subscription.priority ?? 0 }
    );

    // Track the active subscription
    const existing = this.activeSubscriptions.get(key) ?? [];
    existing.push({ subscription, unsubscribe });
    this.activeSubscriptions.set(key, existing);

    logger.debug("Subscription registered", {
      key,
      eventType: subscription.eventType,
      agentId: subscription.agentId,
      priority: subscription.priority ?? 0,
    });

    // Return unsubscribe function
    return () => {
      unsubscribe();
      const subs = this.activeSubscriptions.get(key) ?? [];
      this.activeSubscriptions.set(
        key,
        subs.filter((s) => s.subscription !== subscription)
      );
      logger.debug("Subscription unregistered", { key });
    };
  }

  /**
   * Register multiple subscriptions at once
   */
  registerAll(subscriptions: AgentSubscription[]): (() => void)[] {
    return subscriptions.map((sub) => this.register(sub));
  }

  /**
   * Enable all subscriptions (start reacting to events)
   */
  enable(): void {
    this.enabled = true;
    logger.info("Agent subscriptions enabled", {
      count: this.getSubscriptionCount(),
    });
  }

  /**
   * Disable all subscriptions (stop reacting to events without removing them)
   */
  disable(): void {
    this.enabled = false;
    logger.info("Agent subscriptions disabled");
  }

  /**
   * Check if subscriptions are enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Remove all subscriptions for a specific agent
   */
  unregisterAgent(agentId: AgentId): void {
    const entries = Array.from(this.activeSubscriptions.entries());
    for (const [key, subs] of entries) {
      if (key.endsWith(`:${agentId}`)) {
        for (const { unsubscribe } of subs) {
          unsubscribe();
        }
        this.activeSubscriptions.delete(key);
      }
    }
    logger.info("Agent unregistered from all events", { agentId });
  }

  /**
   * Remove all subscriptions for a specific event type
   */
  unregisterEvent(eventType: MarketEventType): void {
    const entries = Array.from(this.activeSubscriptions.entries());
    for (const [key, subs] of entries) {
      if (key.startsWith(`${eventType}:`)) {
        for (const { unsubscribe } of subs) {
          unsubscribe();
        }
        this.activeSubscriptions.delete(key);
      }
    }
    logger.info("Event type unregistered from all agents", { eventType });
  }

  /**
   * Remove all subscriptions
   */
  clear(): void {
    const allSubs = Array.from(this.activeSubscriptions.values());
    for (const subs of allSubs) {
      for (const { unsubscribe } of subs) {
        unsubscribe();
      }
    }
    this.activeSubscriptions.clear();
    this.enabled = false;
    logger.info("All agent subscriptions cleared");
  }

  /**
   * Get count of active subscriptions
   */
  getSubscriptionCount(): number {
    let count = 0;
    const allSubs = Array.from(this.activeSubscriptions.values());
    for (const subs of allSubs) {
      count += subs.length;
    }
    return count;
  }

  /**
   * Get a summary of all active subscriptions grouped by agent
   */
  getSummary(): Record<AgentId, { eventType: MarketEventType; priority: number; description?: string }[]> {
    const summary: Record<string, { eventType: MarketEventType; priority: number; description?: string }[]> = {};

    const allSubs = Array.from(this.activeSubscriptions.values());
    for (const subs of allSubs) {
      for (const { subscription } of subs) {
        if (!summary[subscription.agentId]) {
          summary[subscription.agentId] = [];
        }
        summary[subscription.agentId]!.push({
          eventType: subscription.eventType,
          priority: subscription.priority ?? 0,
          description: subscription.description,
        });
      }
    }

    return summary as Record<AgentId, { eventType: MarketEventType; priority: number; description?: string }[]>;
  }

  /**
   * Get the agent invoker (for use in default handlers)
   */
  getInvoker(): AgentInvoker | null {
    return this.invoker;
  }
}

// ============================================================================
// Default Subscription Definitions
// ============================================================================

/**
 * Create the default agent subscriptions.
 *
 * Each handler constructs a natural language prompt from the event data
 * and invokes the appropriate agent via the invoker function.
 *
 * @param registry - The registry to get the invoker from
 * @returns Array of AgentSubscription definitions
 */
export function createDefaultSubscriptions(
  registry: AgentSubscriptionRegistry
): AgentSubscription[] {
  /**
   * Helper to invoke an agent via the registry's invoker
   */
  const invoke = async (
    agentId: AgentId,
    prompt: string,
    metadata?: Record<string, unknown>
  ): Promise<void> => {
    const invoker = registry.getInvoker();
    if (!invoker) {
      logger.warn("No agent invoker set, skipping invocation", { agentId });
      return;
    }
    await invoker(agentId, prompt, metadata);
  };

  return [
    // ====================================================================
    // Scanner subscriptions
    // ====================================================================
    {
      eventType: "market:candle_close",
      agentId: "scanner",
      priority: 10,
      description: "Scan for setups when a candle closes on watched timeframes",
      handler: async (event) => {
        const e = event as Extract<MarketEvent, { type: "market:candle_close" }>;
        await invoke(
          "scanner",
          `A ${e.timeframe} candle just closed on ${e.symbol}. ` +
            `OHLCV: O=${e.open} H=${e.high} L=${e.low} C=${e.close} V=${e.volume}. ` +
            `Check for trading setups on this pair.`,
          { symbol: e.symbol, timeframe: e.timeframe, trigger: "candle_close" }
        );
      },
    },
    {
      eventType: "market:volume_spike",
      agentId: "scanner",
      priority: 15,
      description: "Alert scanner when unusual volume is detected",
      handler: async (event) => {
        const e = event as Extract<MarketEvent, { type: "market:volume_spike" }>;
        await invoke(
          "scanner",
          `Volume spike detected on ${e.symbol}: ${e.spikeMultiple.toFixed(1)}x ` +
            `normal volume on the ${e.timeframe} timeframe. Current price: ${e.price}. ` +
            `Analyze this for potential trading opportunities.`,
          { symbol: e.symbol, spikeMultiple: e.spikeMultiple, trigger: "volume_spike" }
        );
      },
    },
    {
      eventType: "market:funding_rate_change",
      agentId: "scanner",
      priority: 5,
      description: "Scanner checks funding rate shifts for sentiment changes",
      handler: async (event) => {
        const e = event as Extract<MarketEvent, { type: "market:funding_rate_change" }>;
        const direction = e.delta > 0 ? "increased" : "decreased";
        await invoke(
          "scanner",
          `Funding rate on ${e.symbol} ${direction} significantly from ` +
            `${(e.previousRate * 100).toFixed(4)}% to ${(e.currentRate * 100).toFixed(4)}%. ` +
            `Check if this signals a sentiment shift or trading opportunity.`,
          { symbol: e.symbol, delta: e.delta, trigger: "funding_rate_change" }
        );
      },
    },

    // ====================================================================
    // Analyst subscriptions
    // ====================================================================
    {
      eventType: "strategy:setup_detected",
      agentId: "analyst",
      priority: 10,
      description: "Analyst evaluates setups found by Scanner",
      handler: async (event) => {
        const e = event as Extract<MarketEvent, { type: "strategy:setup_detected" }>;
        await invoke(
          "analyst",
          `Setup detected on ${e.symbol}: ${e.strategy} strategy with ` +
            `${Math.round(e.confidence * 100)}% confidence, ${e.bias} bias on ${e.timeframe}. ` +
            `${e.ensembleAgreement ? `Ensemble agreement: ${Math.round(e.ensembleAgreement * 100)}%. ` : ""}` +
            `Run a deep analysis to validate this setup and determine entry/exit levels.`,
          { symbol: e.symbol, strategy: e.strategy, trigger: "setup_detected" }
        );
      },
    },

    // ====================================================================
    // Planner subscriptions
    // ====================================================================
    {
      eventType: "strategy:analysis_complete",
      agentId: "planner",
      priority: 10,
      description: "Planner creates a trade plan when analysis confirms a setup",
      filter: (event) => {
        const e = event as Extract<MarketEvent, { type: "strategy:analysis_complete" }>;
        // Only plan if recommendation is to enter
        return e.recommendation === "enter" && e.confidence >= 0.6;
      },
      handler: async (event) => {
        const e = event as Extract<MarketEvent, { type: "strategy:analysis_complete" }>;
        await invoke(
          "planner",
          `Analysis complete for ${e.symbol}: ${e.overallBias} bias with ` +
            `${Math.round(e.confidence * 100)}% confidence. Recommendation: ${e.recommendation}. ` +
            `Support levels: ${e.supportLevels.join(", ")}. ` +
            `Resistance levels: ${e.resistanceLevels.join(", ")}. ` +
            `Current price: ${e.currentPrice}. ` +
            `Create a trading plan for this opportunity.`,
          { symbol: e.symbol, bias: e.overallBias, trigger: "analysis_complete" }
        );
      },
    },

    // ====================================================================
    // Executor subscriptions
    // ====================================================================
    {
      eventType: "strategy:plan_ready",
      agentId: "executor",
      priority: 10,
      description: "Executor receives new plans for execution consideration",
      handler: async (event) => {
        const e = event as Extract<MarketEvent, { type: "strategy:plan_ready" }>;
        await invoke(
          "executor",
          `New trading plan ready: ${e.direction} ${e.symbol} at ${e.entry}. ` +
            `Stop loss: ${e.stopLoss}, Take profits: ${e.takeProfits.join(", ")}. ` +
            `Risk/reward: ${e.riskRewardRatio.toFixed(2)}, Position size: ${e.positionSizePct}%. ` +
            `Strategy: ${e.strategy}. Plan ID: ${e.planId}. ` +
            `Review and prepare for execution (requires user approval via ApprovalDialog).`,
          { planId: e.planId, symbol: e.symbol, trigger: "plan_ready" }
        );
      },
    },
    {
      eventType: "strategy:risk_approved",
      agentId: "executor",
      priority: 15,
      description: "Executor proceeds when risk kernel approves",
      handler: async (event) => {
        const e = event as Extract<MarketEvent, { type: "strategy:risk_approved" }>;
        await invoke(
          "executor",
          `Risk approved for plan ${e.planId} on ${e.symbol}. ` +
            `Risk score: ${e.riskScore}, Approved size: ${e.approvedSize}. ` +
            `${e.conditions ? `Conditions: ${e.conditions.join(", ")}. ` : ""}` +
            `The plan is cleared for execution pending user confirmation.`,
          { planId: e.planId, symbol: e.symbol, trigger: "risk_approved" }
        );
      },
    },

    // ====================================================================
    // Monitor subscriptions
    // ====================================================================
    {
      eventType: "market:price_tick",
      agentId: "monitor",
      priority: 5,
      description: "Monitor tracks price ticks for open positions",
      // This filter should be overridden at runtime to check against open positions
      filter: (_event) => {
        // Default: let all through. In practice, replace this filter
        // with one that checks getMonitorContext() for open position symbols.
        return true;
      },
      handler: async (event) => {
        const e = event as Extract<MarketEvent, { type: "market:price_tick" }>;
        await invoke(
          "monitor",
          `Price update on ${e.symbol}: ${e.price}. ` +
            `Check if any open positions need attention (stop approaching, target hit, etc.).`,
          { symbol: e.symbol, price: e.price, trigger: "price_tick" }
        );
      },
    },
    {
      eventType: "position:stop_triggered",
      agentId: "monitor",
      priority: 20,
      description: "Monitor handles stop loss triggers immediately",
      handler: async (event) => {
        const e = event as Extract<MarketEvent, { type: "position:stop_triggered" }>;
        await invoke(
          "monitor",
          `STOP LOSS TRIGGERED on ${e.symbol} (${e.side}). ` +
            `Entry: ${e.entryPrice}, Stop: ${e.stopPrice}, Trigger price: ${e.triggerPrice}. ` +
            `PnL: ${e.pnl >= 0 ? "+" : ""}${e.pnl.toFixed(2)} (${e.pnlPercent.toFixed(2)}%). ` +
            `Record this outcome and update portfolio status.`,
          { symbol: e.symbol, pnl: e.pnl, trigger: "stop_triggered" }
        );
      },
    },
    {
      eventType: "position:target_reached",
      agentId: "monitor",
      priority: 20,
      description: "Monitor handles take profit triggers",
      handler: async (event) => {
        const e = event as Extract<MarketEvent, { type: "position:target_reached" }>;
        await invoke(
          "monitor",
          `TAKE PROFIT HIT on ${e.symbol} (${e.side}), level ${e.targetLevel}. ` +
            `Entry: ${e.entryPrice}, Target: ${e.targetPrice}, Trigger: ${e.triggerPrice}. ` +
            `PnL: +${e.pnl.toFixed(2)} (${e.pnlPercent.toFixed(2)}%). ` +
            `Record this outcome and update portfolio status.`,
          { symbol: e.symbol, pnl: e.pnl, trigger: "target_reached" }
        );
      },
    },
    {
      eventType: "market:liquidation_wave",
      agentId: "monitor",
      priority: 18,
      description: "Monitor checks portfolio exposure during liquidation waves",
      handler: async (event) => {
        const e = event as Extract<MarketEvent, { type: "market:liquidation_wave" }>;
        await invoke(
          "monitor",
          `Liquidation wave detected on ${e.symbol}: ${e.count} liquidations ` +
            `totaling $${e.totalLiquidated.toFixed(0)} on the ${e.side} side ` +
            `in ${e.windowSeconds}s. Price impact: ${e.priceImpactPercent.toFixed(2)}%. ` +
            `Check our portfolio exposure and any positions on this pair.`,
          { symbol: e.symbol, side: e.side, trigger: "liquidation_wave" }
        );
      },
    },

    // ====================================================================
    // Teacher subscriptions
    // ====================================================================
    {
      eventType: "position:closed",
      agentId: "teacher",
      priority: 5,
      description: "Teacher performs a post-trade review when positions close",
      handler: async (event) => {
        const e = event as Extract<MarketEvent, { type: "position:closed" }>;
        const outcome = e.realizedPnl >= 0 ? "winning" : "losing";
        await invoke(
          "teacher",
          `Trade closed on ${e.symbol} (${e.side}). This was a ${outcome} trade: ` +
            `Entry ${e.entryPrice} -> Exit ${e.exitPrice}, ` +
            `PnL: ${e.realizedPnl >= 0 ? "+" : ""}${e.realizedPnl.toFixed(2)} ` +
            `(${e.realizedPnlPercent.toFixed(2)}%). Reason: ${e.reason}. ` +
            `${e.strategy ? `Strategy: ${e.strategy}. ` : ""}` +
            `Held for ${(e.holdDurationMs / 3600000).toFixed(1)} hours. ` +
            `Provide a brief post-trade review with lessons learned.`,
          { symbol: e.symbol, pnl: e.realizedPnl, reason: e.reason, trigger: "position_closed" }
        );
      },
    },

    // ====================================================================
    // Backtester subscriptions
    // ====================================================================
    {
      eventType: "system:cron_tick",
      agentId: "backtester",
      priority: 5,
      description: "Backtester runs scheduled backtest jobs",
      filter: (event) => {
        const e = event as Extract<MarketEvent, { type: "system:cron_tick" }>;
        // Only handle cron ticks targeting backtests
        return e.jobName === "scheduled_backtest" || e.jobName === "strategy_validation";
      },
      handler: async (event) => {
        const e = event as Extract<MarketEvent, { type: "system:cron_tick" }>;
        const payload = e.payload ?? {};
        const symbol = (payload.symbol as string) ?? "BTCUSDT";
        const strategy = (payload.strategy as string) ?? "rsi_oversold";
        await invoke(
          "backtester",
          `Scheduled backtest triggered (job: ${e.jobName}). ` +
            `Run a backtest on ${symbol} using ${strategy} strategy. ` +
            `Compare results with previous runs and flag any degradation.`,
          { jobId: e.jobId, jobName: e.jobName, trigger: "cron_tick" }
        );
      },
    },
  ];
}

// ============================================================================
// Singleton Instance
// ============================================================================

let _registry: AgentSubscriptionRegistry | null = null;

/**
 * Get or create the singleton subscription registry.
 * Lazily initializes with default subscriptions.
 */
export function getSubscriptionRegistry(): AgentSubscriptionRegistry {
  if (!_registry) {
    _registry = new AgentSubscriptionRegistry();
  }
  return _registry;
}

/**
 * Initialize the subscription registry with default subscriptions.
 * Call this during app startup after agents are available.
 *
 * @param invoker - Function to invoke agents programmatically
 * @param bus - Optional EventBus instance (defaults to singleton)
 * @returns The initialized registry
 */
export function initializeSubscriptions(
  invoker: AgentInvoker,
  bus?: EventBus
): AgentSubscriptionRegistry {
  const registry = bus
    ? new AgentSubscriptionRegistry(bus)
    : getSubscriptionRegistry();

  // Set the invoker
  registry.setInvoker(invoker);

  // Register default subscriptions
  const defaults = createDefaultSubscriptions(registry);
  registry.registerAll(defaults);

  logger.info("Default agent subscriptions initialized", {
    count: defaults.length,
  });

  // Store as singleton if we created a new one
  if (bus) {
    _registry = registry;
  }

  return registry;
}

/**
 * Reset the subscription registry (for testing or cleanup)
 */
export function resetSubscriptionRegistry(): void {
  if (_registry) {
    _registry.clear();
    _registry = null;
  }
}
