import { describe, it, expect } from "bun:test";

import {
  isPreTradeRateControlsEnabled,
  checkPreTradeRate,
  rateCheckToPayload,
  recordRateEvent,
  evaluatePreTradeRate,
  resetRateEvents,
  DEFAULT_LIMITS,
  PRETRADE_RATE_CONTROLS_FLAG_ENV,
  PRETRADE_RATE_CONTROLS_DISABLE_ENV,
  type RateEvent,
} from "./preTradeRateControls.ts";

describe("isPreTradeRateControlsEnabled — default-on", () => {
  it("enabled by default (empty env)", () => {
    expect(isPreTradeRateControlsEnabled({})).toBe(true);
  });

  it("stays enabled even when the legacy affirmative flag is set", () => {
    expect(isPreTradeRateControlsEnabled({ [PRETRADE_RATE_CONTROLS_FLAG_ENV]: "1" })).toBe(true);
  });

  it("disabled only by the explicit opt-out env", () => {
    expect(isPreTradeRateControlsEnabled({ [PRETRADE_RATE_CONTROLS_DISABLE_ENV]: "1" })).toBe(
      false,
    );
    expect(isPreTradeRateControlsEnabled({ [PRETRADE_RATE_CONTROLS_DISABLE_ENV]: "true" })).toBe(
      false,
    );
  });
});

describe("in-process recorder — recordRateEvent / evaluatePreTradeRate", () => {
  it("records submits and breaches the message-rate cap under a flood", () => {
    resetRateEvents();
    const t0 = Date.now();
    // Push more than maxMessagesPerSecond * windowMs/1000 submits inside the window.
    const flood = DEFAULT_LIMITS.maxMessagesPerSecond * (DEFAULT_LIMITS.windowMs / 1000) + 50;
    for (let i = 0; i < flood; i++) recordRateEvent("submit", "BTC", t0 + i);
    const r = evaluatePreTradeRate({
      proposedKind: "submit",
      proposedInstrument: "BTC",
      nowMs: t0 + flood,
    });
    expect(r.allowed).toBe(false);
    expect(r.breaches).toContain("messages_per_second");
    resetRateEvents();
  });

  it("a quiet window is allowed", () => {
    resetRateEvents();
    const t0 = Date.now();
    recordRateEvent("submit", "ETH", t0);
    recordRateEvent("fill", "ETH", t0 + 1);
    const r = evaluatePreTradeRate({
      proposedKind: "submit",
      proposedInstrument: "ETH",
      nowMs: t0 + 2,
    });
    expect(r.allowed).toBe(true);
    resetRateEvents();
  });

  it("open-order count per instrument trips the cap", () => {
    resetRateEvents();
    const t0 = Date.now();
    for (let i = 0; i < DEFAULT_LIMITS.maxOpenOrdersPerInstrument; i++) {
      recordRateEvent("submit", "SOL", t0 + i);
    }
    const r = evaluatePreTradeRate({
      proposedKind: "submit",
      proposedInstrument: "SOL",
      nowMs: t0 + 100,
    });
    expect(r.breaches).toContain("open_orders_per_instrument");
    resetRateEvents();
  });

  it("resetRateEvents clears the window", () => {
    resetRateEvents();
    recordRateEvent("submit", "BTC");
    resetRateEvents();
    const r = evaluatePreTradeRate({
      proposedKind: "submit",
      proposedInstrument: "BTC",
      nowMs: Date.now(),
    });
    expect(r.observed.messagesPerSecond).toBe(0);
  });
});

function burst(t0: number, count: number, kind: RateEvent["kind"]): RateEvent[] {
  const out: RateEvent[] = [];
  for (let i = 0; i < count; i++) out.push({ t: t0 + i * 10, kind });
  return out;
}

describe("checkPreTradeRate — within limits", () => {
  it("low activity → allowed", () => {
    const events: RateEvent[] = [
      { t: 1000, kind: "submit" },
      { t: 2000, kind: "fill" },
      { t: 3000, kind: "submit" },
      { t: 4000, kind: "fill" },
    ];
    const r = checkPreTradeRate({ events, nowMs: 5000 });
    expect(r.allowed).toBe(true);
    expect(r.breaches).toEqual([]);
  });
});

describe("checkPreTradeRate — message rate breach", () => {
  it("flood of submits → messages_per_second breach", () => {
    const events = burst(0, 300, "submit");
    const r = checkPreTradeRate({ events, nowMs: 3000 });
    expect(r.allowed).toBe(false);
    expect(r.breaches).toContain("messages_per_second");
  });
});

describe("checkPreTradeRate — cancel rate breach", () => {
  it("burst of cancellations → cancellations_per_second breach", () => {
    const events = burst(0, 200, "cancel");
    const r = checkPreTradeRate({ events, nowMs: 2000 });
    expect(r.allowed).toBe(false);
    expect(r.breaches).toContain("cancellations_per_second");
  });
});

describe("checkPreTradeRate — order-to-trade ratio breach", () => {
  it("many submits, zero fills → breach", () => {
    const events: RateEvent[] = [];
    for (let i = 0; i < 100; i++) events.push({ t: i * 100, kind: "submit" });
    const r = checkPreTradeRate({
      events,
      nowMs: 10_000,
      limits: { maxOrderToTradeRatio: 10, windowMs: 11_000, maxMessagesPerSecond: 1000 },
    });
    expect(r.breaches).toContain("order_to_trade_ratio");
  });
});

describe("checkPreTradeRate — open orders cap", () => {
  it("submitting when 20 orders already open → breach", () => {
    const r = checkPreTradeRate({
      events: [],
      proposedKind: "submit",
      proposedInstrument: "BTC",
      openOrdersPerInstrument: { BTC: 20 },
    });
    expect(r.breaches).toContain("open_orders_per_instrument");
  });

  it("submitting when 5 open → allowed", () => {
    const r = checkPreTradeRate({
      events: [],
      proposedKind: "submit",
      proposedInstrument: "BTC",
      openOrdersPerInstrument: { BTC: 5 },
    });
    expect(r.allowed).toBe(true);
  });
});

describe("checkPreTradeRate — sliding window", () => {
  it("old events outside window don't count", () => {
    const events: RateEvent[] = [];
    for (let i = 0; i < 100; i++) events.push({ t: i * 10, kind: "submit" }); // long ago
    events.push({ t: 50_000, kind: "submit" });
    const r = checkPreTradeRate({ events, nowMs: 50_500, limits: { windowMs: 1000 } });
    expect(r.observed.messagesPerSecond).toBeLessThan(20);
  });
});

describe("checkPreTradeRate — custom limits", () => {
  it("tighter limits flag what defaults wouldn't", () => {
    const events = burst(0, 30, "submit");
    const lax = checkPreTradeRate({ events, nowMs: 1000 });
    const strict = checkPreTradeRate({
      events,
      nowMs: 1000,
      limits: { maxMessagesPerSecond: 10 },
    });
    expect(strict.allowed).toBe(false);
    expect(lax.observed.messagesPerSecond).toBeGreaterThan(strict.observed.messagesPerSecond * 0.9);
  });
});

describe("rateCheckToPayload", () => {
  it("emits stable shape", () => {
    const events = burst(0, 5, "submit");
    const r = checkPreTradeRate({ events, nowMs: 100 });
    const p = rateCheckToPayload(r) as { kind: string; allowed: boolean };
    expect(p.kind).toBe("pretrade_rate_controls.evaluated");
    expect(typeof p.allowed).toBe("boolean");
  });

  it("handles infinite OTR", () => {
    const r = checkPreTradeRate({
      events: [{ t: 0, kind: "submit" }],
      nowMs: 100,
    });
    const p = rateCheckToPayload(r) as { orderToTradeRatio: number | null };
    expect(p.orderToTradeRatio).toBeNull();
  });
});
