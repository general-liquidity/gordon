import type {
  BrokerClock,
  BrokerOrderStatus,
  BrokerOrderType,
  BrokerTimeInForce,
} from "../types.ts";

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseNumber(value: unknown): number {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function normalizeFieldName(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

export function findFirstValue(input: unknown, candidateKeys: string[]): unknown {
  const wanted = new Set(candidateKeys.map(normalizeFieldName));
  const queue: unknown[] = [input];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);

    if (Array.isArray(current)) {
      for (const item of current) queue.push(item);
      continue;
    }

    const record = asRecord(current);
    if (!record) continue;

    for (const [key, value] of Object.entries(record)) {
      if (wanted.has(normalizeFieldName(key))) {
        return value;
      }
      if (value && typeof value === "object") queue.push(value);
    }
  }

  return undefined;
}

export function findFirstArray(input: unknown): unknown[] | null {
  const queue: unknown[] = [input];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);

    if (Array.isArray(current)) {
      return current;
    }

    const record = asRecord(current);
    if (!record) continue;

    for (const value of Object.values(record)) {
      if (value && typeof value === "object") queue.push(value);
    }
  }

  return null;
}

export function unwrapPayload(payload: unknown): unknown {
  const record = asRecord(payload);
  if (!record) return payload;

  const wrappers = ["data", "result", "response", "payload", "output"];
  for (const key of wrappers) {
    if (record[key] !== undefined) return record[key];
  }

  return payload;
}

export function normalizeOrderType(value: unknown): BrokerOrderType {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  switch (normalized) {
    case "market":
    case "mkt":
      return "market";
    case "limit":
    case "lmt":
      return "limit";
    case "stop":
    case "stp":
      return "stop";
    case "stop_limit":
    case "stoplimit":
    case "stp_lmt":
      return "stop_limit";
    case "trailing_stop":
    case "trailingstop":
    case "trail":
      return "trailing_stop";
    default:
      return "market";
  }
}

export function normalizeTimeInForce(value: unknown): BrokerTimeInForce {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  switch (normalized) {
    case "day":
      return "day";
    case "gtc":
    case "good_till_cancel":
      return "gtc";
    case "opg":
      return "opg";
    case "cls":
      return "cls";
    case "ioc":
    case "immediate_or_cancel":
      return "ioc";
    case "fok":
    case "fill_or_kill":
      return "fok";
    default:
      return "day";
  }
}

export function normalizeOrderStatus(value: unknown): BrokerOrderStatus {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  switch (normalized) {
    case "new":
    case "accepted":
    case "live":
    case "working":
    case "received":
    case "queued":
    case "pending":
    case "pending_activation":
    case "routed":
      return "accepted";
    case "partial_fill":
    case "partially_filled":
      return "partially_filled";
    case "filled":
    case "executed":
    case "completed":
      return "filled";
    case "done_for_day":
      return "done_for_day";
    case "canceled":
    case "cancelled":
      return "canceled";
    case "expired":
    case "replaced":
    case "pending_cancel":
    case "pending_replace":
    case "pending_new":
    case "rejected":
    case "stopped":
    case "suspended":
    case "calculated":
      return normalized as BrokerOrderStatus;
    default:
      return "unknown";
  }
}

export function normalizeSide(value: unknown): "buy" | "sell" {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "sell" || normalized === "s" || normalized.startsWith("sell")) return "sell";
  return "buy";
}

export function buildUsMarketClockFallback(): BrokerClock {
  const now = new Date();
  const open = new Date(now);
  const close = new Date(now);

  open.setUTCHours(14, 30, 0, 0);
  close.setUTCHours(21, 0, 0, 0);

  const isOpen = now >= open && now <= close;
  const nextOpen = new Date(open);
  const nextClose = new Date(close);

  if (now > close) {
    nextOpen.setUTCDate(nextOpen.getUTCDate() + 1);
    nextClose.setUTCDate(nextClose.getUTCDate() + 1);
  }

  return {
    timestamp: now.toISOString(),
    isOpen,
    nextOpen: nextOpen.toISOString(),
    nextClose: nextClose.toISOString(),
  };
}

export function isOpenOrderStatus(status: BrokerOrderStatus): boolean {
  return (
    status === "new" ||
    status === "accepted" ||
    status === "partially_filled" ||
    status === "pending_new"
  );
}
