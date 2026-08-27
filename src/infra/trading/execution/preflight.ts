import type { GordonContext } from "../../agents/types.ts";
import type { Order, OrderParams } from "../../exchange/types.ts";
import { recordStructuredObservation } from "../../platform/observability/index.ts";
import { checkKillSwitchForOrder } from "../../safety/killSwitchGate.ts";
import { requireLiveConsent } from "../../safety/consent.ts";
import { checkTradingPermission } from "../../agents/tools/runtime/permissionHelpers.ts";

export interface ExecutionPreflightInput {
  order: OrderParams;
  ctx: GordonContext;
  source: string;
  rationale: string;
  strategyId?: string;
  skipRiskGate?: boolean;
}

export interface ExecutionPreflightSuccess {
  ok: true;
  order: OrderParams;
  preflightId: string;
  warnings: string[];
}

export interface ExecutionPreflightFailure {
  ok: false;
  preflightId: string;
  reason: string;
  status: string;
  warnings: string[];
}

export type ExecutionPreflightResult = ExecutionPreflightSuccess | ExecutionPreflightFailure;

export type SafeOrderSubmitter = (order: OrderParams) => Promise<Order>;

/**
 * Live-consent guard for dispatch paths that hold only a venue handle and no
 * GordonContext (core pipeline, order managers, emergency liquidation). Same
 * gate `runExecutionPreflight` applies, reachable without a context. Throws so
 * the caller's existing failure path reports the refusal; an absent venue is
 * treated as live (fail closed).
 *
 * This is the EXPOSURE-INCREASING half of the consent rule. If the operation
 * reduces an existing position, call `assertConsentForExposure` instead.
 */
export function assertLiveConsent(
  venue: { isSandbox?: boolean; isPaper?: boolean } | undefined,
  source: string,
): void {
  const sandboxActive = venue?.isSandbox ?? venue?.isPaper ?? false;
  const consent = requireLiveConsent({ sandboxActive });
  if (consent.ok) return;
  recordStructuredObservation({
    eventType: "execution.preflight_blocked",
    workflow: "execution",
    source,
    component: "execution_preflight",
    toolName: source,
    outcome: "failure",
    status: "live_consent_required",
    reason: consent.reason,
  });
  throw new Error(consent.reason ?? "Live-trading consent required.");
}

/**
 * A verified claim that an order strictly reduces an existing position.
 *
 * Every field is the value the order will ACTUALLY carry, paired with the
 * position facts it must be consistent with. Callers must read `side` and
 * `quantity` off the order params they are about to submit, not off the
 * intermediate variables they hope those params were built from.
 */
export interface ExposureReduction {
  /** Side the order will be submitted with. */
  side: "BUY" | "SELL";
  /** Quantity the order will be submitted with. */
  quantity: number;
  /** Side that closes this position, derived from the position's direction. */
  exitSide: "BUY" | "SELL";
  /** Quantity still open on the position (filled entries minus filled exits). */
  remainingQuantity: number;
}

/**
 * What an operation does to the operator's market exposure. Consent gates one
 * direction and not the other, so the caller must say which it is.
 */
export type ExposureEffect =
  | { direction: "INCREASES_EXPOSURE" }
  | { direction: "REDUCES_EXPOSURE"; reduction: ExposureReduction };

/**
 * Decide whether a REDUCES_EXPOSURE claim is true. A close that trades the
 * wrong way, or for more than is open, can open or grow a position, so it is
 * not a reduction regardless of what the call site is named.
 */
export function verifyExposureReduction(
  reduction: ExposureReduction,
): { ok: true } | { ok: false; reason: string } {
  if (reduction.side !== reduction.exitSide) {
    return {
      ok: false,
      reason: `order side ${reduction.side} is not the exit side ${reduction.exitSide} for this position`,
    };
  }
  if (!Number.isFinite(reduction.quantity) || reduction.quantity <= 0) {
    return {
      ok: false,
      reason: `reducing quantity must be a finite positive number (got ${reduction.quantity})`,
    };
  }
  if (!Number.isFinite(reduction.remainingQuantity) || reduction.remainingQuantity <= 0) {
    return {
      ok: false,
      reason: `no open quantity remains to reduce (got ${reduction.remainingQuantity})`,
    };
  }
  if (reduction.quantity > reduction.remainingQuantity) {
    return {
      ok: false,
      reason: `quantity ${reduction.quantity} exceeds the remaining open quantity ${reduction.remainingQuantity}`,
    };
  }
  return { ok: true };
}

/**
 * Consent gate keyed on exposure direction. THIS is the entry point new
 * dispatch sites should use; `assertLiveConsent` is the increasing half of it.
 *
 * Live consent exists to gate taking on risk with real capital. An
 * exposure-reducing operation is the remedy for capital ALREADY at risk, so
 * putting it behind the same acknowledgement disarms the safety mechanism
 * exactly when it is needed: consent granted, positions opened, consent
 * expired or revoked, operator now unable to exit.
 *
 * The exemption only has teeth because the reducing claim is verified rather
 * than believed. A "close" that could open or grow a position is an
 * exposure-increasing operation wearing the wrong name, so an unverifiable
 * claim is recorded and then falls through to the gate.
 */
export function assertConsentForExposure(
  venue: { isSandbox?: boolean; isPaper?: boolean } | undefined,
  source: string,
  effect: ExposureEffect,
): void {
  if (effect.direction === "REDUCES_EXPOSURE") {
    const verified = verifyExposureReduction(effect.reduction);
    if (verified.ok) return;
    recordStructuredObservation({
      eventType: "execution.exposure_reduction_unverified",
      workflow: "execution",
      source,
      component: "execution_preflight",
      toolName: source,
      outcome: "failure",
      status: "exposure_reduction_unverified",
      reason: verified.reason,
    });
  }
  assertLiveConsent(venue, source);
}

function makePreflightId(source: string): string {
  return `pf_${source.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function fail(
  input: ExecutionPreflightInput,
  preflightId: string,
  status: string,
  reason: string,
  warnings: string[] = [],
): ExecutionPreflightFailure {
  recordStructuredObservation({
    eventType: "execution.preflight_blocked",
    workflow: "execution",
    source: input.source,
    component: "execution_preflight",
    toolName: input.source,
    outcome: "failure",
    status,
    symbol: input.order.symbol,
    reason,
    details: {
      preflightId,
      rationale: input.rationale,
      orderType: input.order.type,
      side: input.order.side,
      quantity: input.order.quantity,
      quoteOrderQty: input.order.quoteOrderQty,
      price: input.order.price,
      warnings,
    },
  });
  return { ok: false, preflightId, reason, status, warnings };
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function validateOrderShape(order: OrderParams): string[] {
  const errors: string[] = [];
  if (!order.symbol || order.symbol.trim().length === 0) errors.push("symbol is empty");
  if (order.quantity !== undefined && !isPositiveFinite(order.quantity)) {
    errors.push(`quantity must be a finite positive number (got ${order.quantity})`);
  }
  if (order.quoteOrderQty !== undefined && !isPositiveFinite(order.quoteOrderQty)) {
    errors.push(`quoteOrderQty must be a finite positive number (got ${order.quoteOrderQty})`);
  }
  if (order.quantity === undefined && order.quoteOrderQty === undefined) {
    errors.push("quantity or quoteOrderQty is required");
  }
  if (
    (order.type === "LIMIT" ||
      order.type === "STOP_LOSS_LIMIT" ||
      order.type === "TAKE_PROFIT_LIMIT") &&
    !isPositiveFinite(order.price)
  ) {
    errors.push(`${order.type} order requires a finite positive price`);
  }
  if (order.price !== undefined && !isPositiveFinite(order.price)) {
    errors.push(`price must be a finite positive number (got ${order.price})`);
  }
  if (order.stopPrice !== undefined && !isPositiveFinite(order.stopPrice)) {
    errors.push(`stopPrice must be a finite positive number (got ${order.stopPrice})`);
  }
  return errors;
}

function notionalPrice(order: OrderParams): number | undefined {
  if (isPositiveFinite(order.price)) return order.price;
  return undefined;
}

async function resolveRiskPrice(input: ExecutionPreflightInput): Promise<number | undefined> {
  const orderPrice = notionalPrice(input.order);
  if (orderPrice !== undefined) return orderPrice;
  try {
    const livePrice = await input.ctx.exchange?.getPrice(input.order.symbol);
    return isPositiveFinite(livePrice) ? livePrice : undefined;
  } catch {
    return undefined;
  }
}

export async function runExecutionPreflight(
  input: ExecutionPreflightInput,
): Promise<ExecutionPreflightResult> {
  const preflightId = makePreflightId(input.source);
  const shapeErrors = validateOrderShape(input.order);
  if (shapeErrors.length > 0) {
    return fail(input, preflightId, "invalid_order_shape", shapeErrors.join("; "));
  }

  const killBlock = checkKillSwitchForOrder(input.ctx, {
    instrument: input.order.symbol,
    strategyId: input.strategyId,
  });
  if (killBlock.blocked) {
    return fail(input, preflightId, "kill_switch_tripped", killBlock.error);
  }

  const sandboxActive = input.ctx.exchange?.isSandbox ?? input.ctx.broker?.isPaper ?? false;

  const permission = checkTradingPermission(input.ctx.config?.permissionMode, "execute", {
    sandboxActive,
  });
  if (!permission.allowed) {
    return fail(
      input,
      preflightId,
      "permission_mode_blocked",
      permission.reason ?? "Execution blocked by permission mode.",
    );
  }

  // One-time live-trading consent: block the FIRST live order until the
  // operator has acknowledged the disclaimer. Paper / sandbox never gated.
  const consent = requireLiveConsent({ sandboxActive });
  if (!consent.ok) {
    return fail(
      input,
      preflightId,
      "live_consent_required",
      consent.reason ?? "Live-trading consent required.",
    );
  }

  let warnings: string[] = [];
  let order = input.order;
  if (!input.skipRiskGate) {
    const riskPrice = await resolveRiskPrice(input);
    const quantity =
      order.quantity ?? (order.quoteOrderQty && riskPrice ? order.quoteOrderQty / riskPrice : 0);
    if (!isPositiveFinite(quantity)) {
      return fail(
        input,
        preflightId,
        "risk_quantity_unavailable",
        "Risk gate requires a positive base quantity.",
      );
    }
    try {
      const { evaluateOrderRisk } = await import("../../agents/tools/trading/risk-gate.ts");
      const risk = await evaluateOrderRisk(
        {
          symbol: order.symbol,
          side: order.side,
          type: order.type,
          quantity,
          price: riskPrice,
        },
        input.ctx,
        input.source,
      );
      warnings = risk.warnings;
      if (!risk.approved) {
        return fail(input, preflightId, "risk_rejected", risk.reason, warnings);
      }
      if (risk.quantity !== quantity && order.quantity !== undefined) {
        order = { ...order, quantity: risk.quantity };
      }
    } catch (error) {
      return fail(
        input,
        preflightId,
        "risk_gate_failed",
        error instanceof Error ? error.message : String(error),
        warnings,
      );
    }
  }

  recordStructuredObservation({
    eventType: "execution.preflight_approved",
    workflow: "execution",
    source: input.source,
    component: "execution_preflight",
    toolName: input.source,
    outcome: "success",
    status: "approved",
    symbol: order.symbol,
    details: {
      preflightId,
      rationale: input.rationale,
      orderType: order.type,
      side: order.side,
      quantity: order.quantity,
      quoteOrderQty: order.quoteOrderQty,
      price: order.price,
      warnings,
    },
  });

  return { ok: true, order, preflightId, warnings };
}

export function createSafeOrderSubmitter(input: {
  ctx: GordonContext;
  source: string;
  rationale: string;
  strategyId?: string;
}): SafeOrderSubmitter {
  return async (order: OrderParams): Promise<Order> => {
    if (!input.ctx.exchange) {
      throw new Error("No active exchange available for safe order submission.");
    }
    const preflight = await runExecutionPreflight({
      ...input,
      order,
    });
    if (!preflight.ok) {
      throw new Error(`Execution preflight blocked order: ${preflight.reason}`);
    }
    return input.ctx.exchange.placeOrder(preflight.order);
  };
}
