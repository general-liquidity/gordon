/**
 * Multi-Leg Atomic Execution — All-or-Nothing Order Groups
 *
 * Trading equivalent of Claude Code's multi-edit atomic transactions.
 * Submit a group of related orders (bracket, spread, pairs trade) that
 * must either ALL succeed or ALL be rolled back.
 *
 * Rollback strategy:
 *   - If leg N fails, cancel all legs 0..N-1 that were placed
 *   - If cancel fails, mark as "orphaned" for manual review
 *   - Emit events at each step for audit trail
 */

import { emitAgentEvent } from "../../agents/streaming/coordinator.ts";
import { createEvent } from "../../agents/streaming/events.ts";

// ============================================================================
// Types
// ============================================================================

export interface OrderLeg {
  /** Unique ID for this leg within the group. */
  legId: string;
  /** Display name (e.g., "Entry", "Stop Loss", "Take Profit"). */
  label: string;
  /** Symbol to trade. */
  symbol: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT";
  quantity: number;
  price?: number;
  stopPrice?: number;
  /** Which venue to execute on. */
  venue: string;
  /** Whether this leg depends on a previous leg filling first. */
  dependsOn?: string;
}

export type LegStatus = "pending" | "submitted" | "filled" | "cancelled" | "failed" | "orphaned";

export interface LegResult {
  legId: string;
  label: string;
  status: LegStatus;
  orderId?: string;
  fillPrice?: number;
  fillQuantity?: number;
  error?: string;
  submittedAt?: string;
  completedAt?: string;
}

export interface AtomicGroup {
  groupId: string;
  label: string;
  legs: OrderLeg[];
  results: LegResult[];
  status: "pending" | "executing" | "completed" | "rolled_back" | "partial_orphan" | "rejected";
  createdAt: string;
  completedAt?: string;
}

export type OrderSubmitter = (leg: OrderLeg) => Promise<{ orderId: string; fillPrice?: number; fillQuantity?: number }>;
export type OrderCanceller = (orderId: string, venue: string) => Promise<boolean>;

// ============================================================================
// Leg validation — bounds-check before any capital is touched
// ============================================================================

export function validateOrderLeg(leg: OrderLeg): string[] {
  const errors: string[] = [];
  if (!leg.legId || leg.legId.trim() === "") errors.push("legId is empty");
  if (!leg.symbol || leg.symbol.trim() === "") errors.push("symbol is empty");
  if (!leg.venue || leg.venue.trim() === "") errors.push("venue is empty");
  if (!Number.isFinite(leg.quantity) || leg.quantity <= 0) {
    errors.push(`quantity must be a finite positive number (got ${leg.quantity})`);
  }
  const needsPrice = leg.type === "LIMIT" || leg.type === "STOP_LIMIT";
  if (needsPrice && leg.price === undefined) {
    errors.push(`${leg.type} order requires a price`);
  }
  if (leg.price !== undefined && (!Number.isFinite(leg.price) || leg.price <= 0)) {
    errors.push(`price must be a finite positive number (got ${leg.price})`);
  }
  const needsStopPrice = leg.type === "STOP" || leg.type === "STOP_LIMIT";
  if (needsStopPrice && leg.stopPrice === undefined) {
    errors.push(`${leg.type} order requires a stopPrice`);
  }
  if (leg.stopPrice !== undefined && (!Number.isFinite(leg.stopPrice) || leg.stopPrice <= 0)) {
    errors.push(`stopPrice must be a finite positive number (got ${leg.stopPrice})`);
  }
  return errors;
}

// ============================================================================
// Execution Engine
// ============================================================================

/**
 * Execute a group of order legs atomically. If any leg fails,
 * roll back all previously submitted legs.
 *
 * @param legs - Order legs to execute (in order)
 * @param submit - Function that submits a single order
 * @param cancel - Function that cancels a single order
 * @param label - Human-readable group label
 * @returns The completed atomic group
 */
export async function executeAtomicGroup(
  legs: OrderLeg[],
  submit: OrderSubmitter,
  cancel: OrderCanceller,
  label: string = "Atomic Order Group",
): Promise<AtomicGroup> {
  const group: AtomicGroup = {
    groupId: `ag_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    label,
    legs,
    results: legs.map((leg) => ({
      legId: leg.legId,
      label: leg.label,
      status: "pending" as LegStatus,
    })),
    status: "executing",
    createdAt: new Date().toISOString(),
  };

  // Validate ALL legs before submitting ANY — an atomic group with one
  // malformed leg must be rejected whole, not fail mid-way and roll back.
  const legErrors = new Map<number, string[]>();
  for (let i = 0; i < legs.length; i++) {
    const errors = validateOrderLeg(legs[i]!);
    if (errors.length > 0) legErrors.set(i, errors);
  }
  if (legErrors.size > 0) {
    for (let i = 0; i < group.results.length; i++) {
      const result = group.results[i]!;
      const errors = legErrors.get(i);
      if (errors) {
        result.status = "failed";
        result.error = `Validation failed: ${errors.join("; ")}`;
      } else {
        result.status = "cancelled";
        result.error = "Group rejected: invalid sibling leg";
      }
      result.completedAt = new Date().toISOString();
    }
    group.status = "rejected";
    group.completedAt = new Date().toISOString();
    emitAgentEvent(createEvent("error", 0, {
      message: `Atomic group rejected before submission: ${legErrors.size} invalid leg(s)`,
      recoverable: true,
    }));
    return group;
  }

  const submittedOrderIds: Array<{ orderId: string; venue: string; legId: string }> = [];

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]!;
    const result = group.results[i]!;

    // Check if this leg depends on a previous leg
    if (leg.dependsOn) {
      const depResult = group.results.find((r) => r.legId === leg.dependsOn);
      if (!depResult || depResult.status !== "filled") {
        result.status = "cancelled";
        result.error = `Dependency ${leg.dependsOn} not filled`;
        continue;
      }
    }

    try {
      result.submittedAt = new Date().toISOString();
      result.status = "submitted";

      emitAgentEvent(createEvent("tool_start", 0, {
        toolName: `atomic_leg_${leg.label}`,
        toolCallId: leg.legId,
        args: { symbol: leg.symbol, side: leg.side, type: leg.type, quantity: leg.quantity },
      }));

      const { orderId, fillPrice, fillQuantity } = await submit(leg);

      result.orderId = orderId;
      result.fillPrice = fillPrice;
      result.fillQuantity = fillQuantity;
      result.status = "filled";
      result.completedAt = new Date().toISOString();
      submittedOrderIds.push({ orderId, venue: leg.venue, legId: leg.legId });

      emitAgentEvent(createEvent("tool_end", 0, {
        toolName: `atomic_leg_${leg.label}`,
        toolCallId: leg.legId,
        success: true,
        durationMs: Date.now() - new Date(result.submittedAt).getTime(),
        resultPreview: `Filled: ${fillQuantity ?? leg.quantity} @ ${fillPrice ?? "market"}`,
      }));

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      result.status = "failed";
      result.error = errorMsg;
      result.completedAt = new Date().toISOString();

      emitAgentEvent(createEvent("error", 0, {
        message: `Leg ${leg.label} failed: ${errorMsg}. Rolling back ${submittedOrderIds.length} legs.`,
        recoverable: true,
      }));

      // ── ROLLBACK ──
      await rollback(submittedOrderIds, cancel, group);
      break;
    }
  }

  // Determine final status
  const allFilled = group.results.every((r) => r.status === "filled" || r.status === "cancelled");
  const anyOrphaned = group.results.some((r) => r.status === "orphaned");

  if (allFilled) {
    group.status = "completed";
  } else if (anyOrphaned) {
    group.status = "partial_orphan";
  } else {
    group.status = "rolled_back";
  }

  group.completedAt = new Date().toISOString();
  return group;
}

async function rollback(
  submitted: Array<{ orderId: string; venue: string; legId: string }>,
  cancel: OrderCanceller,
  group: AtomicGroup,
): Promise<void> {
  // Cancel in reverse order
  for (let i = submitted.length - 1; i >= 0; i--) {
    const { orderId, venue, legId } = submitted[i]!;
    const result = group.results.find((r) => r.legId === legId);
    if (!result) continue;

    try {
      const cancelled = await cancel(orderId, venue);
      if (cancelled) {
        result.status = "cancelled";
      } else {
        result.status = "orphaned";
        result.error = "Cancel request returned false — manual review needed";
      }
    } catch (err) {
      result.status = "orphaned";
      result.error = `Cancel failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // Mark remaining pending legs as cancelled
  for (const result of group.results) {
    if (result.status === "pending") {
      result.status = "cancelled";
      result.error = "Cancelled due to rollback";
    }
  }
}

/**
 * Format an atomic group for terminal display.
 */
export function formatAtomicGroup(group: AtomicGroup): string {
  const lines: string[] = [];
  const statusIcon = group.status === "completed" ? "✓" : group.status === "rolled_back" ? "✗" : "⚠";
  lines.push(`${statusIcon} ${group.label} [${group.status}]`);

  for (const result of group.results) {
    const icon = result.status === "filled" ? "✓" :
      result.status === "cancelled" ? "○" :
      result.status === "orphaned" ? "⚠" :
      result.status === "failed" ? "✗" : "·";
    const fill = result.fillPrice ? ` @ $${result.fillPrice}` : "";
    const err = result.error ? ` — ${result.error}` : "";
    lines.push(`  ${icon} ${result.label}: ${result.status}${fill}${err}`);
  }

  return lines.join("\n");
}
