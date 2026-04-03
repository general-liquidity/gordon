/**
 * Event Subscriptions — Phase 4 (Complete)
 * Maps ALL 50+ EventBus events to TUI dispatch actions.
 * Fully event-driven — no polling.
 */

import { getEventBus } from "../../events/index.ts";
import type { EventType, EventData } from "../../events/index.ts";
import type { Dispatch, TuiNotification } from "../state/types.ts";

// ============================================================================
// Helpers
// ============================================================================

function makeId(): string {
  return `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeNotification(
  type: string,
  variant: TuiNotification["variant"],
  message: string,
): TuiNotification {
  return {
    id: makeId(),
    type,
    variant,
    message,
    timestamp: new Date().toISOString(),
  };
}

function notify(
  dispatch: Dispatch,
  type: string,
  variant: TuiNotification["variant"],
  message: string,
): void {
  dispatch({
    type: "INJECT_NOTIFICATION",
    notification: makeNotification(type, variant, message),
  });
}

// ============================================================================
// Subscribe to ALL 50+ events
// ============================================================================

export function subscribeToEvents(dispatch: Dispatch): () => void {
  const bus = getEventBus();
  const unsubs: Array<() => void> = [];

  // ────────────────────────────────────────────────────────────────────────
  // Position Lifecycle (7 events)
  // ────────────────────────────────────────────────────────────────────────

  // 1. position:created
  unsubs.push(
    bus.on("position:created", (event: EventData<"position:created">) => {
      notify(dispatch, "position:created", "fill",
        `\u25C8 Position created: ${event.symbol} ${event.side} [${event.positionId}]`,
      );
    }),
  );

  // 2. position:opened
  unsubs.push(
    bus.on("position:opened", (event: EventData<"position:opened">) => {
      notify(dispatch, "position:opened", "fill",
        `\u2713 Position opened: ${event.symbol} @ $${event.entryPrice.toFixed(2)} \u00D7 ${event.quantity}`,
      );
    }),
  );

  // 3. position:closed
  unsubs.push(
    bus.on("position:closed", (event: EventData<"position:closed">) => {
      const sign = event.realizedPnL >= 0 ? "+" : "";
      notify(dispatch, "position:closed", "fill",
        `\u2713 Position closed: ${event.symbol} — P&L ${sign}$${event.realizedPnL.toFixed(2)}`,
      );
      dispatch({ type: "UPDATE_COST", pnl: event.realizedPnL, pnlPercent: 0 });
    }),
  );

  // 4. position:cancelled
  unsubs.push(
    bus.on("position:cancelled", (event: EventData<"position:cancelled">) => {
      notify(dispatch, "position:cancelled", "alert",
        `\u2717 Position cancelled: ${event.symbol} — ${event.reason} (was ${event.fromState})`,
      );
    }),
  );

  // 5. position:rejected
  unsubs.push(
    bus.on("position:rejected", (event: EventData<"position:rejected">) => {
      notify(dispatch, "position:rejected", "alert",
        `\u2717 Position rejected: ${event.symbol} — ${event.reason}`,
      );
    }),
  );

  // 6. position:reviewed
  unsubs.push(
    bus.on("position:reviewed", (event: EventData<"position:reviewed">) => {
      notify(dispatch, "position:reviewed", "info",
        `\u25C8 Position reviewed: ${event.symbol} — grade ${event.review.grade ?? "N/A"}`,
      );
    }),
  );

  // 7. position:updated
  unsubs.push(
    bus.on("position:updated", (event: EventData<"position:updated">) => {
      notify(dispatch, "position:updated", "info",
        `\u25C8 Position updated: ${event.symbol} [${event.positionId}]`,
      );
    }),
  );

  // ────────────────────────────────────────────────────────────────────────
  // Trade Lifecycle (4 events)
  // ────────────────────────────────────────────────────────────────────────

  // 8. trade:opened
  unsubs.push(
    bus.on("trade:opened", (event: EventData<"trade:opened">) => {
      notify(dispatch, "trade:opened", "fill",
        `\u2713 Trade opened: ${event.trade.symbol} ${event.trade.side ?? ""}`.trim(),
      );
    }),
  );

  // 9. trade:closed
  unsubs.push(
    bus.on("trade:closed", (event: EventData<"trade:closed">) => {
      const pnlSign = event.pnl >= 0 ? "+" : "";
      notify(dispatch, "trade:closed", "fill",
        `\u2713 Trade closed: ${event.trade.symbol} — ${event.reason} — P&L ${pnlSign}$${event.pnl.toFixed(2)} (${pnlSign}${event.pnlPercent.toFixed(1)}%)`,
      );
      dispatch({ type: "UPDATE_COST", pnl: event.pnl, pnlPercent: event.pnlPercent });
    }),
  );

  // 10. trade:updated
  unsubs.push(
    bus.on("trade:updated", (event: EventData<"trade:updated">) => {
      notify(dispatch, "trade:updated", "info",
        `\u25C8 Trade updated: ${event.tradeId}`,
      );
    }),
  );

  // 11. trade:partial_close
  unsubs.push(
    bus.on("trade:partial_close", (event: EventData<"trade:partial_close">) => {
      const pnlSign = event.pnl >= 0 ? "+" : "";
      notify(dispatch, "trade:partial_close", "fill",
        `\u25C8 Partial close: ${event.symbol} — closed ${event.closedQuantity}, remaining ${event.remainingQuantity} — P&L ${pnlSign}$${event.pnl.toFixed(2)} (${event.reason})`,
      );
    }),
  );

  // ────────────────────────────────────────────────────────────────────────
  // Alerts (4 events)
  // ────────────────────────────────────────────────────────────────────────

  // 12. alert:price
  unsubs.push(
    bus.on("alert:price", (event: EventData<"alert:price">) => {
      notify(dispatch, "alert:price", "alert",
        `\u26A0 Price alert: ${event.symbol} ${event.condition} $${event.threshold} (now $${event.price.toFixed(2)})`,
      );
    }),
  );

  // 13. alert:stop_approaching
  unsubs.push(
    bus.on("alert:stop_approaching", (event: EventData<"alert:stop_approaching">) => {
      notify(dispatch, "alert:stop_approaching", "alert",
        `\u26A0 Stop approaching: ${event.symbol} — price $${event.currentPrice.toFixed(2)}, stop $${event.stopPrice.toFixed(2)} (${event.distance.toFixed(1)}% away)`,
      );
    }),
  );

  // 14. alert:tp_hit
  unsubs.push(
    bus.on("alert:tp_hit", (event: EventData<"alert:tp_hit">) => {
      notify(dispatch, "alert:tp_hit", "fill",
        `\u2713 Take profit hit: ${event.symbol} TP${event.level} @ $${event.price.toFixed(2)}`,
      );
    }),
  );

  // 15. alert:stop_triggered
  unsubs.push(
    bus.on("alert:stop_triggered", (event: EventData<"alert:stop_triggered">) => {
      const pnlStr = event.pnl != null ? ` — P&L $${event.pnl.toFixed(2)}` : "";
      notify(dispatch, "alert:stop_triggered", "alert",
        `\u2717 Stop triggered: ${event.symbol} @ $${event.stopPrice.toFixed(2)}${pnlStr}`,
      );
    }),
  );

  // ────────────────────────────────────────────────────────────────────────
  // Scan Lifecycle (3 events)
  // ────────────────────────────────────────────────────────────────────────

  // 16. scan:started
  unsubs.push(
    bus.on("scan:started", (event: EventData<"scan:started">) => {
      notify(dispatch, "scan:started", "info",
        `\u25C8 Scan started: ${event.universe} [${event.timeframes.join(", ")}]`,
      );
    }),
  );

  // 17. scan:completed
  unsubs.push(
    bus.on("scan:completed", (event: EventData<"scan:completed">) => {
      notify(dispatch, "scan:completed", "info",
        `\u2713 Scan completed: ${event.coinsScanned} coins, ${event.opportunitiesFound} opportunities (${(event.duration / 1000).toFixed(1)}s)`,
      );
    }),
  );

  // 18. scan:opportunity
  unsubs.push(
    bus.on("scan:opportunity", (event: EventData<"scan:opportunity">) => {
      notify(dispatch, "scan:opportunity", "strategy",
        `\u25C8 Opportunity: ${event.symbol} — ${event.bias} (${(event.confidence * 100).toFixed(0)}% confidence)`,
      );
    }),
  );

  // ────────────────────────────────────────────────────────────────────────
  // Plan Lifecycle (4 events)
  // ────────────────────────────────────────────────────────────────────────

  // 19. plan:created
  unsubs.push(
    bus.on("plan:created", (event: EventData<"plan:created">) => {
      notify(dispatch, "plan:created", "info",
        `Plan created: ${event.plan.symbol ?? event.plan.id ?? "unknown"} — ${event.plan.direction ?? ""}`.trim(),
      );
    }),
  );

  // 20. plan:approved
  unsubs.push(
    bus.on("plan:approved", (event: EventData<"plan:approved">) => {
      notify(dispatch, "plan:approved", "fill",
        `\u2713 Plan approved: ${event.planId}`,
      );
    }),
  );

  // 21. plan:rejected
  unsubs.push(
    bus.on("plan:rejected", (event: EventData<"plan:rejected">) => {
      notify(dispatch, "plan:rejected", "alert",
        `\u2717 Plan rejected: ${event.planId}${event.reason ? ` — ${event.reason}` : ""}`,
      );
    }),
  );

  // 22. plan:cancelled
  unsubs.push(
    bus.on("plan:cancelled", (event: EventData<"plan:cancelled">) => {
      notify(dispatch, "plan:cancelled", "alert",
        `\u2717 Plan cancelled: ${event.planId}${event.reason ? ` — ${event.reason}` : ""}`,
      );
    }),
  );

  // ────────────────────────────────────────────────────────────────────────
  // Risk (2 events)
  // ────────────────────────────────────────────────────────────────────────

  // 23. risk:approved
  unsubs.push(
    bus.on("risk:approved", (event: EventData<"risk:approved">) => {
      notify(dispatch, "risk:approved", "fill",
        `\u2713 Risk approved: ${event.symbol} (${event.action}, ${event.checks} checks)`,
      );
    }),
  );

  // 24. risk:rejected
  unsubs.push(
    bus.on("risk:rejected", (event: EventData<"risk:rejected">) => {
      notify(dispatch, "risk:rejected", "alert",
        `\u2717 Risk rejected: ${event.symbol} — ${event.reason ?? event.checks.join(", ")}`,
      );
    }),
  );

  // ────────────────────────────────────────────────────────────────────────
  // Autonomous (7 events)
  // ────────────────────────────────────────────────────────────────────────

  // 25. autonomous:started
  unsubs.push(
    bus.on("autonomous:started", (event: EventData<"autonomous:started">) => {
      notify(dispatch, "autonomous:started", "strategy",
        `\u25C8 Autonomous loop started: mandate ${event.mandateId}`,
      );
      dispatch({ type: "SET_AUTONOMOUS_ACTIVE", active: true });
    }),
  );

  // 26. autonomous:stopped
  unsubs.push(
    bus.on("autonomous:stopped", (event: EventData<"autonomous:stopped">) => {
      notify(dispatch, "autonomous:stopped", "strategy",
        `\u25C8 Autonomous loop stopped${event.reason ? `: ${event.reason}` : ""} — ${event.totalCycles} cycles, ${event.totalOpportunities} opportunities`,
      );
      dispatch({ type: "SET_AUTONOMOUS_ACTIVE", active: false, strategyCount: 0 });
    }),
  );

  // 27. autonomous:paused
  unsubs.push(
    bus.on("autonomous:paused", (event: EventData<"autonomous:paused">) => {
      notify(dispatch, "autonomous:paused", "strategy",
        `\u25C8 Autonomous loop paused${event.mandateId ? `: ${event.mandateId}` : ""}`,
      );
    }),
  );

  // 28. autonomous:resumed
  unsubs.push(
    bus.on("autonomous:resumed", (event: EventData<"autonomous:resumed">) => {
      notify(dispatch, "autonomous:resumed", "strategy",
        `\u25C8 Autonomous loop resumed${event.mandateId ? `: ${event.mandateId}` : ""}`,
      );
    }),
  );

  // 29. autonomous:cycle_completed
  unsubs.push(
    bus.on("autonomous:cycle_completed", (event: EventData<"autonomous:cycle_completed">) => {
      notify(dispatch, "autonomous:cycle_completed", "strategy",
        `\u25C8 Cycle #${event.cycleNumber} completed: ${event.opportunities} opportunities found`,
      );
    }),
  );

  // 30. autonomous:cycle_failed
  unsubs.push(
    bus.on("autonomous:cycle_failed", (event: EventData<"autonomous:cycle_failed">) => {
      notify(dispatch, "autonomous:cycle_failed", "error",
        `\u2717 Cycle #${event.cycleNumber} failed: ${event.error}`,
      );
    }),
  );

  // 31. autonomous:mandate_breached
  unsubs.push(
    bus.on("autonomous:mandate_breached", (event: EventData<"autonomous:mandate_breached">) => {
      notify(dispatch, "autonomous:mandate_breached", "alert",
        `\u26A0 Mandate breached: ${event.mandateId} — ${event.reason}`,
      );
    }),
  );

  // ────────────────────────────────────────────────────────────────────────
  // Agent (8 events)
  // ────────────────────────────────────────────────────────────────────────

  // 32. agent:started
  unsubs.push(
    bus.on("agent:started", (event: EventData<"agent:started">) => {
      notify(dispatch, "agent:started", "system",
        `Agent started: ${event.agent}${event.parent ? ` (parent: ${event.parent})` : ""}`,
      );
    }),
  );

  // 33. agent:completed
  unsubs.push(
    bus.on("agent:completed", (event: EventData<"agent:completed">) => {
      notify(dispatch, "agent:completed", "system",
        `Agent completed: ${event.agent} (${event.outputLength} chars)`,
      );
    }),
  );

  // 34. agent:handoff
  unsubs.push(
    bus.on("agent:handoff", (event: EventData<"agent:handoff">) => {
      dispatch({ type: "AGENT_SWITCH", from: event.from, to: event.to });
    }),
  );

  // 35. agent:handoff_ack
  unsubs.push(
    bus.on("agent:handoff_ack", (event: EventData<"agent:handoff_ack">) => {
      const status = event.validated ? "\u2713" : "\u2717";
      notify(dispatch, "agent:handoff_ack", "system",
        `${status} Handoff ${event.handoffId}: ${event.fromAgent} \u2192 ${event.toAgent}${event.reason ? ` — ${event.reason}` : ""}`,
      );
    }),
  );

  // 36. agent:fallback
  unsubs.push(
    bus.on("agent:fallback", (event: EventData<"agent:fallback">) => {
      notify(dispatch, "agent:fallback", "system",
        `Agent fallback: ${event.primaryAgent} \u2192 ${event.fallbackTarget} (${event.fallbackType}) — ${event.reason}`,
      );
    }),
  );

  // 37. agent:retry
  unsubs.push(
    bus.on("agent:retry", (event: EventData<"agent:retry">) => {
      notify(dispatch, "agent:retry", "system",
        `Agent retry: ${event.agent} attempt ${event.attempt}/${event.maxAttempts} (${event.errorType}, ${event.delayMs}ms delay)`,
      );
    }),
  );

  // 38. agent:reflection
  unsubs.push(
    bus.on("agent:reflection", (event: EventData<"agent:reflection">) => {
      notify(dispatch, "agent:reflection", "system",
        `Agent reflection: ${event.agent} — ${event.analysis.slice(0, 120)}${event.analysis.length > 120 ? "..." : ""}`,
      );
    }),
  );

  // 39. agent:stream_completed
  unsubs.push(
    bus.on("agent:stream_completed", (event: EventData<"agent:stream_completed">) => {
      notify(dispatch, "agent:stream_completed", "system",
        `Stream completed: ${event.responseLength} chars`,
      );
    }),
  );

  // ────────────────────────────────────────────────────────────────────────
  // System (3 events)
  // ────────────────────────────────────────────────────────────────────────

  // 40. system:started
  unsubs.push(
    bus.on("system:started", (event: EventData<"system:started">) => {
      notify(dispatch, "system:started", "system",
        `System started: mode ${event.mode}`,
      );
    }),
  );

  // 41. system:armed
  unsubs.push(
    bus.on("system:armed", (event: EventData<"system:armed">) => {
      notify(dispatch, "system:armed", "strategy",
        `\u25C8 System ARMED for ${event.duration}h (expires ${event.expiresAt})`,
      );
    }),
  );

  // 42. system:error
  unsubs.push(
    bus.on("system:error", (event: EventData<"system:error">) => {
      notify(dispatch, "system:error", "error",
        `\u2717 System error: ${event.error.message}${event.error.code ? ` [${event.error.code}]` : ""}`,
      );
    }),
  );

  // ────────────────────────────────────────────────────────────────────────
  // Exchange (3 events)
  // ────────────────────────────────────────────────────────────────────────

  // 43. binance:connected
  unsubs.push(
    bus.on("binance:connected", (_event: EventData<"binance:connected">) => {
      notify(dispatch, "binance:connected", "system",
        `\u2713 Binance connected`,
      );
    }),
  );

  // 44. binance:disconnected
  unsubs.push(
    bus.on("binance:disconnected", (event: EventData<"binance:disconnected">) => {
      notify(dispatch, "binance:disconnected", "alert",
        `\u26A0 Binance disconnected${event.reason ? `: ${event.reason}` : ""}`,
      );
    }),
  );

  // 45. binance:rate_limit
  unsubs.push(
    bus.on("binance:rate_limit", (event: EventData<"binance:rate_limit">) => {
      notify(dispatch, "binance:rate_limit", "alert",
        `\u26A0 Binance rate limit: ${event.weight}/${event.limit} weight used`,
      );
    }),
  );

  // ────────────────────────────────────────────────────────────────────────
  // Guardrails (3 events)
  // ────────────────────────────────────────────────────────────────────────

  // 46. guardrail:blocked
  unsubs.push(
    bus.on("guardrail:blocked", (event: EventData<"guardrail:blocked">) => {
      notify(dispatch, "guardrail:blocked", "alert",
        `\u2717 Guardrail blocked (${event.guardrailType}): ${event.reason}`,
      );
    }),
  );

  // 47. guardrail:input_blocked
  unsubs.push(
    bus.on("guardrail:input_blocked", (event: EventData<"guardrail:input_blocked">) => {
      notify(dispatch, "guardrail:input_blocked", "alert",
        `\u2717 Input blocked: ${event.reason}${event.severity ? ` [${event.severity}]` : ""}`,
      );
    }),
  );

  // 48. guardrail:output_sanitized
  unsubs.push(
    bus.on("guardrail:output_sanitized", (event: EventData<"guardrail:output_sanitized">) => {
      notify(dispatch, "guardrail:output_sanitized", "info",
        `\u25C8 Output sanitized: ${event.patterns.length} pattern(s) removed (${event.sanitizedLength} chars)`,
      );
    }),
  );

  // ────────────────────────────────────────────────────────────────────────
  // Access Control (2 events)
  // ────────────────────────────────────────────────────────────────────────

  // 49. access_control:denied
  unsubs.push(
    bus.on("access_control:denied", (event: EventData<"access_control:denied">) => {
      notify(dispatch, "access_control:denied", "alert",
        `\u2717 Access denied: ${event.reason}${event.toolName ?? event.tool ? ` (tool: ${event.toolName ?? event.tool})` : ""}${event.mode ? ` [${event.mode}]` : ""}`,
      );
    }),
  );

  // 50. access_control:warning
  unsubs.push(
    bus.on("access_control:warning", (event: EventData<"access_control:warning">) => {
      notify(dispatch, "access_control:warning", "alert",
        `\u26A0 Access warning: ${event.message}${event.toolName ?? event.tool ? ` (tool: ${event.toolName ?? event.tool})` : ""}`,
      );
    }),
  );

  // ────────────────────────────────────────────────────────────────────────
  // Scheduler (4 events)
  // ────────────────────────────────────────────────────────────────────────

  // 51. scheduler:started
  unsubs.push(
    bus.on("scheduler:started", (event: EventData<"scheduler:started">) => {
      const interval = event.intervalMinutes ?? event.config?.intervalMinutes ?? "?";
      notify(dispatch, "scheduler:started", "strategy",
        `\u25C8 Scheduler started: every ${interval}m`,
      );
    }),
  );

  // 52. scheduler:stopped
  unsubs.push(
    bus.on("scheduler:stopped", (_event: EventData<"scheduler:stopped">) => {
      notify(dispatch, "scheduler:stopped", "strategy",
        `\u25C8 Scheduler stopped`,
      );
    }),
  );

  // 53. scheduler:scan_completed
  unsubs.push(
    bus.on("scheduler:scan_completed", (event: EventData<"scheduler:scan_completed">) => {
      const coins = event.coinsScanned ?? "?";
      const opps = event.opportunitiesFound ?? event.opportunities ?? 0;
      notify(dispatch, "scheduler:scan_completed", "info",
        `\u2713 Scheduled scan #${event.scanNumber ?? "?"}: ${coins} coins, ${opps} opportunities`,
      );
    }),
  );

  // 54. scheduler:scan_failed
  unsubs.push(
    bus.on("scheduler:scan_failed", (event: EventData<"scheduler:scan_failed">) => {
      notify(dispatch, "scheduler:scan_failed", "error",
        `\u2717 Scheduled scan #${event.scanNumber ?? "?"} failed: ${event.error}`,
      );
    }),
  );

  // ────────────────────────────────────────────────────────────────────────
  // Memory (1 event)
  // ────────────────────────────────────────────────────────────────────────

  // 55. memory:summarized
  unsubs.push(
    bus.on("memory:summarized", (event: EventData<"memory:summarized">) => {
      notify(dispatch, "memory:summarized", "info",
        `\u25C8 Memory summarized: ${event.originalCount} \u2192 ${event.newCount} entries (${event.summarizedCount} compacted)`,
      );
    }),
  );

  // ────────────────────────────────────────────────────────────────────────
  // Tools (2 events)
  // ────────────────────────────────────────────────────────────────────────

  // 56. tool:started
  unsubs.push(
    bus.on("tool:started", (event: EventData<"tool:started">) => {
      notify(dispatch, "tool:started", "system",
        `Tool started: ${event.tool} (agent: ${event.agent})`,
      );
    }),
  );

  // 57. tool:completed
  unsubs.push(
    bus.on("tool:completed", (event: EventData<"tool:completed">) => {
      notify(dispatch, "tool:completed", "system",
        `Tool completed: ${event.tool} (agent: ${event.agent})`,
      );
    }),
  );

  // ────────────────────────────────────────────────────────────────────────
  // Return combined unsubscribe function
  // ────────────────────────────────────────────────────────────────────────

  return () => {
    for (const unsub of unsubs) {
      unsub();
    }
  };
}
