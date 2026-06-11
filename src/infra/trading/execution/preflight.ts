import type { GordonContext } from "../../agents/types.ts";
import type { Order, OrderParams } from "../../exchange/types.ts";
import { recordStructuredObservation } from "../../platform/observability/index.ts";
import { checkKillSwitchForOrder } from "../../safety/killSwitchGate.ts";
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
  if ((order.type === "LIMIT" || order.type === "STOP_LOSS_LIMIT" || order.type === "TAKE_PROFIT_LIMIT") && !isPositiveFinite(order.price)) {
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

  const permission = checkTradingPermission(input.ctx.config?.permissionMode, "execute", {
    sandboxActive: input.ctx.exchange?.isSandbox ?? input.ctx.broker?.isPaper,
  });
  if (!permission.allowed) {
    return fail(
      input,
      preflightId,
      "permission_mode_blocked",
      permission.reason ?? "Execution blocked by permission mode.",
    );
  }

  let warnings: string[] = [];
  let order = input.order;
  if (!input.skipRiskGate) {
    const riskPrice = await resolveRiskPrice(input);
    const quantity = order.quantity ??
      (order.quoteOrderQty && riskPrice ? order.quoteOrderQty / riskPrice : 0);
    if (!isPositiveFinite(quantity)) {
      return fail(input, preflightId, "risk_quantity_unavailable", "Risk gate requires a positive base quantity.");
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
