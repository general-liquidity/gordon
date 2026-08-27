/**
 * Resting-stop liveness watchdog.
 *
 * Broker-resting protective stops are frequently DAY orders: they die at session
 * close, and a cancel/reject/expiry silently leaves an open position naked until
 * someone re-places the stop. This scan flags any open position whose protective
 * stop is not in a working status (cancelled / expired / rejected / already
 * filled / absent) so the caller can re-arm it.
 *
 * Advisory detection ONLY. It sends no orders and mutates nothing; it is a pure
 * function over injected order + position state, so it is trivially testable and
 * safe to run inside a monitor tick. Never throws.
 */

import type { OrderStatus } from "../../infra/exchange/types.ts";

export type StopLiveness =
  | "working"
  | "cancelled"
  | "expired"
  | "rejected"
  | "filled"
  | "pending_cancel"
  | "absent"
  | "dead";

/** An open position that should be sitting behind a protective stop. */
export interface WatchedPosition {
  positionId: string;
  symbol: string;
  side: "long" | "short";
  /** Signed or unsigned size; positions with |quantity| <= 0 are treated as flat and skipped. */
  quantity: number;
  /** Client/broker id of the protective stop guarding this position. Absent => no stop on file. */
  stopOrderId?: string;
}

/** A resting order as reported by the broker/exchange. */
export interface WatchedOrder {
  orderId: string;
  status: OrderStatus;
  /** Explicit liveness flag if the venue provides one; overrides status when present. */
  isWorking?: boolean;
}

export interface StopWatchAlert {
  positionId: string;
  symbol: string;
  side: "long" | "short";
  quantity: number;
  stopOrderId: string | null;
  liveness: StopLiveness;
  /** re-arm = place a fresh protective stop; reconcile = stop filled, verify the position is actually flat. */
  action: "re-arm" | "reconcile";
  severity: "critical" | "warning" | "info";
  message: string;
}

export interface RestingStopWatchInput {
  positions: WatchedPosition[];
  orders: WatchedOrder[];
  /** Statuses considered live/working. Default: NEW + PARTIALLY_FILLED. */
  workingStatuses?: OrderStatus[];
}

export interface RestingStopWatchResult {
  alerts: StopWatchAlert[];
  /** True if any alert requires re-arming a protective stop. */
  reArmRequired: boolean;
  scanned: number;
  protectedCount: number;
  summary: string;
}

const DEFAULT_WORKING: OrderStatus[] = ["NEW", "PARTIALLY_FILLED"];

function livenessFromStatus(status: OrderStatus): StopLiveness {
  switch (status) {
    case "CANCELED":
      return "cancelled";
    case "EXPIRED":
      return "expired";
    case "REJECTED":
      return "rejected";
    case "FILLED":
      return "filled";
    case "PENDING_CANCEL":
      return "pending_cancel";
    default:
      return "dead";
  }
}

function describe(liveness: StopLiveness): {
  action: "re-arm" | "reconcile";
  severity: StopWatchAlert["severity"];
  text: string;
} {
  switch (liveness) {
    case "absent":
      return { action: "re-arm", severity: "critical", text: "no protective stop on file" };
    case "cancelled":
      return { action: "re-arm", severity: "critical", text: "protective stop was cancelled" };
    case "expired":
      return {
        action: "re-arm",
        severity: "critical",
        text: "protective stop expired (day-order rollover)",
      };
    case "rejected":
      return { action: "re-arm", severity: "critical", text: "protective stop was rejected" };
    case "pending_cancel":
      return {
        action: "re-arm",
        severity: "warning",
        text: "protective stop is pending cancel and will die",
      };
    case "dead":
      return {
        action: "re-arm",
        severity: "critical",
        text: "protective stop is in a non-working status",
      };
    case "filled":
      return {
        action: "reconcile",
        severity: "warning",
        text: "protective stop already filled; verify the position is flat",
      };
    case "working":
      return { action: "reconcile", severity: "info", text: "protective stop is working" };
  }
}

export function scanRestingStops(input: RestingStopWatchInput): RestingStopWatchResult {
  const working = new Set<OrderStatus>(input.workingStatuses ?? DEFAULT_WORKING);
  const orderById = new Map<string, WatchedOrder>();
  for (const o of input.orders) orderById.set(o.orderId, o);

  const alerts: StopWatchAlert[] = [];
  let scanned = 0;
  let protectedCount = 0;

  for (const pos of input.positions) {
    if (!(Math.abs(pos.quantity) > 0)) continue;
    scanned++;

    let liveness: StopLiveness;
    if (!pos.stopOrderId) {
      liveness = "absent";
    } else {
      const order = orderById.get(pos.stopOrderId);
      if (!order) {
        liveness = "absent";
      } else if (
        order.isWorking === true ||
        (order.isWorking === undefined && working.has(order.status))
      ) {
        liveness = "working";
      } else {
        liveness = livenessFromStatus(order.status);
      }
    }

    if (liveness === "working") {
      protectedCount++;
      continue;
    }

    const d = describe(liveness);
    alerts.push({
      positionId: pos.positionId,
      symbol: pos.symbol,
      side: pos.side,
      quantity: pos.quantity,
      stopOrderId: pos.stopOrderId ?? null,
      liveness,
      action: d.action,
      severity: d.severity,
      message: `${pos.symbol} ${pos.side} (${pos.positionId}): ${d.text} -> ${d.action}`,
    });
  }

  const reArmRequired = alerts.some((a) => a.action === "re-arm");
  const reArmCount = alerts.filter((a) => a.action === "re-arm").length;
  const summary =
    scanned === 0
      ? "no open positions to scan"
      : `${protectedCount}/${scanned} positions protected; ${reArmCount} need re-arm`;

  return { alerts, reArmRequired, scanned, protectedCount, summary };
}
