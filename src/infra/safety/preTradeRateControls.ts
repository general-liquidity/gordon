/**
 * Pre-Trade Rate Controls (GORDON_PRETRADE_RATE_CONTROLS).
 *
 * Implements the article's defensive-architecture rate limits per
 * Section 7.1. Sliding-window counters for message volume, cancellations,
 * modifications, open orders, and order-to-trade ratio. Designed to be
 * called BEFORE any outbound order is submitted; refuses or throttles
 * when limits are exceeded.
 *
 * Thresholds adapt to time-of-day, volatility regime, and participant
 * role via the optional config rescaler. Static defaults are
 * intentionally conservative — Gordon is a retail-trader harness, not
 * a market maker firing thousands of messages per second.
 */

export const PRETRADE_RATE_CONTROLS_FLAG_ENV = "GORDON_PRETRADE_RATE_CONTROLS";

export function isPreTradeRateControlsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env[PRETRADE_RATE_CONTROLS_FLAG_ENV] === "1" ||
    env[PRETRADE_RATE_CONTROLS_FLAG_ENV] === "true"
  );
}

export type MessageKind = "submit" | "modify" | "cancel" | "fill";

export interface RateEvent {
  /** Event timestamp in ms. */
  t: number;
  kind: MessageKind;
  /** Optional instrument scope for per-instrument limits. */
  instrument?: string;
}

export interface RateLimits {
  /** Max total messages per second. */
  maxMessagesPerSecond?: number;
  /** Max modifications per second. */
  maxModificationsPerSecond?: number;
  /** Max cancellations per second. */
  maxCancellationsPerSecond?: number;
  /** Max order-to-trade ratio over the window. */
  maxOrderToTradeRatio?: number;
  /** Max open orders per instrument (caller tracks instrument set). */
  maxOpenOrdersPerInstrument?: number;
  /** Sliding window in ms. Default 10_000. */
  windowMs?: number;
}

export interface RateCheckInput {
  events: ReadonlyArray<RateEvent>;
  openOrdersPerInstrument?: Record<string, number>;
  proposedKind?: MessageKind;
  proposedInstrument?: string;
  /** Override the current time (defaults to last event time or Date.now). */
  nowMs?: number;
  limits?: RateLimits;
}

export type RateBreach =
  | "messages_per_second"
  | "modifications_per_second"
  | "cancellations_per_second"
  | "order_to_trade_ratio"
  | "open_orders_per_instrument";

export interface RateCheckResult {
  allowed: boolean;
  breaches: RateBreach[];
  observed: {
    messagesPerSecond: number;
    modificationsPerSecond: number;
    cancellationsPerSecond: number;
    orderToTradeRatio: number;
    openOrdersForProposedInstrument: number;
  };
  reason: string;
}

const DEFAULT_LIMITS: Required<RateLimits> = {
  maxMessagesPerSecond: 20,
  maxModificationsPerSecond: 10,
  maxCancellationsPerSecond: 10,
  maxOrderToTradeRatio: 50,
  maxOpenOrdersPerInstrument: 20,
  windowMs: 10_000,
};

function rateFromCount(count: number, windowMs: number): number {
  if (windowMs <= 0) return 0;
  return (count * 1000) / windowMs;
}

export function checkPreTradeRate(input: RateCheckInput): RateCheckResult {
  const lims: Required<RateLimits> = {
    ...DEFAULT_LIMITS,
    ...(input.limits ?? {}),
  };
  const events = input.events;
  const nowMs =
    input.nowMs ?? (events.length > 0 ? events[events.length - 1]!.t : Date.now());
  const windowStart = nowMs - lims.windowMs;

  let submit = 0;
  let modify = 0;
  let cancel = 0;
  let fill = 0;

  for (const e of events) {
    if (e.t < windowStart) continue;
    if (e.kind === "submit") submit++;
    else if (e.kind === "modify") modify++;
    else if (e.kind === "cancel") cancel++;
    else if (e.kind === "fill") fill++;
  }

  const totalMessages = submit + modify + cancel;
  const messagesPerSecond = rateFromCount(totalMessages, lims.windowMs);
  const modificationsPerSecond = rateFromCount(modify, lims.windowMs);
  const cancellationsPerSecond = rateFromCount(cancel, lims.windowMs);
  const orderToTradeRatio = fill > 0 ? submit / fill : submit > 0 ? Number.POSITIVE_INFINITY : 0;

  const openForProposed =
    input.proposedInstrument && input.openOrdersPerInstrument
      ? input.openOrdersPerInstrument[input.proposedInstrument] ?? 0
      : 0;

  const breaches: RateBreach[] = [];
  if (messagesPerSecond > lims.maxMessagesPerSecond) breaches.push("messages_per_second");
  if (modificationsPerSecond > lims.maxModificationsPerSecond) breaches.push("modifications_per_second");
  if (cancellationsPerSecond > lims.maxCancellationsPerSecond) breaches.push("cancellations_per_second");
  if (orderToTradeRatio > lims.maxOrderToTradeRatio) breaches.push("order_to_trade_ratio");
  if (
    input.proposedKind === "submit" &&
    openForProposed >= lims.maxOpenOrdersPerInstrument
  ) {
    breaches.push("open_orders_per_instrument");
  }

  const reason =
    breaches.length === 0
      ? `${messagesPerSecond.toFixed(1)} msg/s, ${cancellationsPerSecond.toFixed(1)} cancel/s, OTR ${Number.isFinite(orderToTradeRatio) ? orderToTradeRatio.toFixed(0) : "∞"} — within limits`
      : `breached: ${breaches.join(", ")}`;

  return {
    allowed: breaches.length === 0,
    breaches,
    observed: {
      messagesPerSecond,
      modificationsPerSecond,
      cancellationsPerSecond,
      orderToTradeRatio,
      openOrdersForProposedInstrument: openForProposed,
    },
    reason,
  };
}

export function rateCheckToPayload(result: RateCheckResult): Record<string, unknown> {
  return {
    kind: "pretrade_rate_controls.evaluated",
    allowed: result.allowed,
    breachCount: result.breaches.length,
    messagesPerSecond: Number(result.observed.messagesPerSecond.toFixed(2)),
    cancellationsPerSecond: Number(result.observed.cancellationsPerSecond.toFixed(2)),
    orderToTradeRatio: Number.isFinite(result.observed.orderToTradeRatio)
      ? Number(result.observed.orderToTradeRatio.toFixed(2))
      : null,
  };
}
