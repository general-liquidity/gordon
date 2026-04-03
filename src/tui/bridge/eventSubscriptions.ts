/**
 * Event Subscriptions — Phase 4
 * Maps 15 EventBus events to TUI dispatch actions.
 * Replaces the 5s polling in startBackgroundMonitoring().
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

// ============================================================================
// Subscribe to all 15 events
// ============================================================================

export function subscribeToEvents(dispatch: Dispatch): () => void {
  const bus = getEventBus();
  const unsubs: Array<() => void> = [];

  // ── 1. trade:opened ──
  unsubs.push(
    bus.on("trade:opened", (event: EventData<"trade:opened">) => {
      dispatch({
        type: "INJECT_NOTIFICATION",
        notification: makeNotification(
          "trade:opened",
          "fill",
          `\u2713 Trade opened: ${event.trade.symbol} ${event.trade.side ?? ""}`.trim(),
        ),
      });
    }),
  );

  // ── 2. trade:closed ──
  unsubs.push(
    bus.on("trade:closed", (event: EventData<"trade:closed">) => {
      const pnlSign = event.pnl >= 0 ? "+" : "";
      dispatch({
        type: "INJECT_NOTIFICATION",
        notification: makeNotification(
          "trade:closed",
          "fill",
          `\u2713 Trade closed: ${event.trade.symbol} — ${event.reason} — P&L ${pnlSign}$${event.pnl.toFixed(2)} (${pnlSign}${event.pnlPercent.toFixed(1)}%)`,
        ),
      });
      dispatch({
        type: "UPDATE_COST",
        pnl: event.pnl,
        pnlPercent: event.pnlPercent,
      });
    }),
  );

  // ── 3. position:state_changed ──
  unsubs.push(
    bus.on("position:state_changed", (event: EventData<"position:state_changed">) => {
      dispatch({
        type: "INJECT_NOTIFICATION",
        notification: makeNotification(
          "position:state_changed",
          "alert",
          `\u26A0 Position ${event.symbol}: ${event.fromState} \u2192 ${event.toState}`,
        ),
      });
    }),
  );

  // ── 4. alert:price ──
  unsubs.push(
    bus.on("alert:price", (event: EventData<"alert:price">) => {
      dispatch({
        type: "INJECT_NOTIFICATION",
        notification: makeNotification(
          "alert:price",
          "alert",
          `\u26A0 Price alert: ${event.symbol} ${event.condition} $${event.threshold} (now $${event.price.toFixed(2)})`,
        ),
      });
    }),
  );

  // ── 5. scan:opportunity ──
  unsubs.push(
    bus.on("scan:opportunity", (event: EventData<"scan:opportunity">) => {
      dispatch({
        type: "INJECT_NOTIFICATION",
        notification: makeNotification(
          "scan:opportunity",
          "strategy",
          `\u25C8 Opportunity: ${event.symbol} — ${event.bias} (${(event.confidence * 100).toFixed(0)}% confidence)`,
        ),
      });
    }),
  );

  // ── 6. plan:created ──
  unsubs.push(
    bus.on("plan:created", (event: EventData<"plan:created">) => {
      dispatch({
        type: "INJECT_NOTIFICATION",
        notification: makeNotification(
          "plan:created",
          "info",
          `Plan created: ${event.plan.symbol ?? event.plan.id ?? "unknown"} — ${event.plan.direction ?? ""}`.trim(),
        ),
      });
    }),
  );

  // ── 7. plan:approved ──
  unsubs.push(
    bus.on("plan:approved", (event: EventData<"plan:approved">) => {
      dispatch({
        type: "INJECT_NOTIFICATION",
        notification: makeNotification(
          "plan:approved",
          "fill",
          `\u2713 Plan approved: ${event.planId}`,
        ),
      });
    }),
  );

  // ── 8. plan:rejected ──
  unsubs.push(
    bus.on("plan:rejected", (event: EventData<"plan:rejected">) => {
      dispatch({
        type: "INJECT_NOTIFICATION",
        notification: makeNotification(
          "plan:rejected",
          "alert",
          `\u2717 Plan rejected: ${event.planId}${event.reason ? ` — ${event.reason}` : ""}`,
        ),
      });
    }),
  );

  // ── 9. risk:approved ──
  unsubs.push(
    bus.on("risk:approved", (event: EventData<"risk:approved">) => {
      dispatch({
        type: "INJECT_NOTIFICATION",
        notification: makeNotification(
          "risk:approved",
          "fill",
          `\u2713 Risk approved: ${event.symbol} (${event.action}, ${event.checks} checks)`,
        ),
      });
    }),
  );

  // ── 10. risk:rejected ──
  unsubs.push(
    bus.on("risk:rejected", (event: EventData<"risk:rejected">) => {
      dispatch({
        type: "INJECT_NOTIFICATION",
        notification: makeNotification(
          "risk:rejected",
          "alert",
          `\u2717 Risk rejected: ${event.symbol} — ${event.reason ?? event.checks.join(", ")}`,
        ),
      });
    }),
  );

  // ── 11. autonomous:started ──
  unsubs.push(
    bus.on("autonomous:started", (event: EventData<"autonomous:started">) => {
      dispatch({
        type: "INJECT_NOTIFICATION",
        notification: makeNotification(
          "autonomous:started",
          "strategy",
          `\u25C8 Autonomous loop started: mandate ${event.mandateId}`,
        ),
      });
    }),
  );

  // ── 12. autonomous:stopped ──
  unsubs.push(
    bus.on("autonomous:stopped", (event: EventData<"autonomous:stopped">) => {
      dispatch({
        type: "INJECT_NOTIFICATION",
        notification: makeNotification(
          "autonomous:stopped",
          "strategy",
          `\u25C8 Autonomous loop stopped${event.reason ? `: ${event.reason}` : ""} — ${event.totalCycles} cycles, ${event.totalOpportunities} opportunities`,
        ),
      });
    }),
  );

  // ── 13. system:error ──
  unsubs.push(
    bus.on("system:error", (event: EventData<"system:error">) => {
      dispatch({
        type: "INJECT_NOTIFICATION",
        notification: makeNotification(
          "system:error",
          "error",
          `\u2717 System error: ${event.error.message}${event.error.code ? ` [${event.error.code}]` : ""}`,
        ),
      });
    }),
  );

  // ── 14. agent:handoff ──
  unsubs.push(
    bus.on("agent:handoff", (event: EventData<"agent:handoff">) => {
      dispatch({
        type: "AGENT_SWITCH",
        from: event.from,
        to: event.to,
      });
    }),
  );

  // ── 15. agent:fallback ──
  unsubs.push(
    bus.on("agent:fallback", (event: EventData<"agent:fallback">) => {
      dispatch({
        type: "INJECT_NOTIFICATION",
        notification: makeNotification(
          "agent:fallback",
          "system",
          `Agent fallback: ${event.primaryAgent} \u2192 ${event.fallbackTarget} (${event.fallbackType}) — ${event.reason}`,
        ),
      });
    }),
  );

  // Return combined unsubscribe function
  return () => {
    for (const unsub of unsubs) {
      unsub();
    }
  };
}
