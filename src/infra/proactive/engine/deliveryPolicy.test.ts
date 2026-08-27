import { describe, expect, test, beforeEach } from "bun:test";
import {
  DeliveryPolicy,
  BATCH_THRESHOLD,
  defaultSeverityForCategory,
  effectiveSeverity,
  buildDedupeKey,
  buildSummaryRollup,
} from "./deliveryPolicy.ts";
import { SUMMARY_ROLLUP_MARKER } from "../types.ts";
import type { ProactiveSuggestion, ProactiveCategory, ProactiveSeverity } from "../types.ts";

let seq = 0;
function mkSuggestion(
  category: ProactiveCategory,
  opts: {
    severity?: ProactiveSeverity;
    dedupeKey?: string;
    symbol?: string;
    eventType?: string;
  } = {},
): ProactiveSuggestion {
  seq += 1;
  return {
    id: `ps_test_${seq}`,
    category,
    title: `${category} title`,
    body: `${category} body`,
    confidence: 0.8,
    severity: opts.severity,
    dedupeKey: opts.dedupeKey,
    createdAt: new Date().toISOString(),
    status: "pending",
    triggers: {
      source: "monitor_loop",
      eventType: opts.eventType,
      symbol: opts.symbol,
    },
  };
}

describe("DeliveryPolicy", () => {
  let policy: DeliveryPolicy;

  beforeEach(() => {
    policy = new DeliveryPolicy();
    seq = 0;
  });

  // (a) urgent delivers immediately ----------------------------------------
  test("urgent suggestions deliver immediately, never batched", () => {
    const s = mkSuggestion("risk_warning", { severity: "urgent", symbol: "BTC" });
    const decision = policy.admit(s);
    expect(decision.kind).toBe("deliver");
    if (decision.kind === "deliver") {
      expect(decision.severity).toBe("urgent");
    }
    // urgent never enters the batch queue
    expect(policy.pendingBatchCount()).toBe(0);
  });

  test("capital-protective categories are forced urgent even if declared low", () => {
    // A producer mis-declaring a stop-loss as low must not be batched.
    const s = mkSuggestion("stop_loss_tighten", { severity: "low", symbol: "ETH" });
    const decision = policy.admit(s);
    expect(decision.kind).toBe("deliver");
    expect(s.severity).toBe("urgent");
  });

  // (b) >=4 normal/low pending -> one summary rollup ------------------------
  test("batchable suggestions hold until threshold, then emit one rollup", () => {
    // First BATCH_THRESHOLD-1 are held (no card).
    const held: ProactiveSuggestion[] = [];
    for (let i = 0; i < BATCH_THRESHOLD - 1; i++) {
      const s = mkSuggestion("news_event", { symbol: `SYM${i}` });
      const d = policy.admit(s);
      expect(d.kind).toBe("hold");
      held.push(s);
    }
    expect(policy.pendingBatchCount()).toBe(BATCH_THRESHOLD - 1);

    // The threshold-th batchable card flushes a single rollup.
    const trigger = mkSuggestion("regime_flip", { eventType: "regime_change" });
    const decision = policy.admit(trigger);
    expect(decision.kind).toBe("rollup");
    if (decision.kind === "rollup") {
      expect(decision.rolledUpIds.length).toBe(BATCH_THRESHOLD);
      // Title carries the marker so the TUI renders the digest variant.
      expect(decision.rollup.title.startsWith(SUMMARY_ROLLUP_MARKER)).toBe(true);
      // Body groups by category with counts: "4 pending · news_event:3 · regime_flip:1".
      expect(decision.rollup.body).toContain(`${BATCH_THRESHOLD} pending`);
      expect(decision.rollup.body).toContain("news_event:3");
      expect(decision.rollup.body).toContain("regime_flip:1");
      const meta = decision.rollup.triggers.metadata as { byCategory: Record<string, number> };
      expect(meta.byCategory.news_event).toBe(3);
      expect(meta.byCategory.regime_flip).toBe(1);
    }
    // Queue resets after the flush.
    expect(policy.pendingBatchCount()).toBe(0);
  });

  test("rollup category counts are ordered by descending count", () => {
    const rollup = buildSummaryRollup(
      [
        { category: "news_event" },
        { category: "funding_alert" },
        { category: "funding_alert" },
        { category: "funding_alert" },
      ],
      0,
    );
    // funding_alert (3) before news_event (1)
    expect(rollup.body).toBe("4 pending · funding_alert:3 · news_event:1");
  });

  // (c) duplicate dedupeKey coalesces --------------------------------------
  test("a duplicate dedupeKey coalesces — no second card", () => {
    const first = mkSuggestion("funding_alert", { symbol: "BTC", eventType: "funding" });
    const firstDecision = policy.admit(first);
    expect(firstDecision.kind).toBe("hold"); // batchable, under threshold
    expect(first.dedupeKey).toBe("funding_alert:BTC:funding");

    // Same condition fires again before the first is resolved.
    const dup = mkSuggestion("funding_alert", { symbol: "BTC", eventType: "funding" });
    const dupDecision = policy.admit(dup);
    expect(dupDecision.kind).toBe("coalesce");
    if (dupDecision.kind === "coalesce") {
      expect(dupDecision.existingId).toBe(first.id);
    }
    // The duplicate did NOT grow the batch queue.
    expect(policy.pendingBatchCount()).toBe(1);
  });

  test("urgent cards also coalesce on dedupeKey (no duplicate card)", () => {
    const first = mkSuggestion("risk_warning", {
      severity: "urgent",
      symbol: "BTC",
      eventType: "risk:rejected",
    });
    expect(policy.admit(first).kind).toBe("deliver");

    const dup = mkSuggestion("risk_warning", {
      severity: "urgent",
      symbol: "BTC",
      eventType: "risk:rejected",
    });
    expect(policy.admit(dup).kind).toBe("coalesce");
  });

  test("once resolved, an identical condition fires a fresh card", () => {
    const first = mkSuggestion("news_event", { symbol: "BTC", eventType: "tick_news_event" });
    expect(policy.admit(first).kind).toBe("hold");

    policy.onResolved(first.id);

    const again = mkSuggestion("news_event", { symbol: "BTC", eventType: "tick_news_event" });
    const d = policy.admit(again);
    // Not coalesced — the prior one is gone from tracking.
    expect(d.kind).toBe("hold");
    expect(policy.pendingBatchCount()).toBe(1);
  });

  test("reset clears batch and dedupe state", () => {
    policy.admit(mkSuggestion("news_event", { symbol: "BTC", eventType: "t" }));
    policy.admit(mkSuggestion("news_event", { symbol: "ETH", eventType: "t" }));
    expect(policy.pendingBatchCount()).toBe(2);
    policy.reset();
    expect(policy.pendingBatchCount()).toBe(0);
  });
});

describe("delivery helpers", () => {
  test("defaultSeverityForCategory maps the documented tiers", () => {
    expect(defaultSeverityForCategory("risk_warning")).toBe("urgent");
    expect(defaultSeverityForCategory("stop_loss_tighten")).toBe("urgent");
    expect(defaultSeverityForCategory("news_event")).toBe("low");
    expect(defaultSeverityForCategory("journal_prompt")).toBe("low");
    expect(defaultSeverityForCategory("session_review")).toBe("low");
    expect(defaultSeverityForCategory("whale_alert")).toBe("normal");
    expect(defaultSeverityForCategory("regime_flip")).toBe("normal");
  });

  test("effectiveSeverity: explicit wins for non-protective categories", () => {
    const s = mkSuggestion("whale_alert", { severity: "low", symbol: "BTC" });
    expect(effectiveSeverity(s)).toBe("low");
  });

  test("effectiveSeverity: protective categories cannot be downgraded", () => {
    const s = mkSuggestion("risk_warning", { severity: "normal" });
    expect(effectiveSeverity(s)).toBe("urgent");
  });

  test("buildDedupeKey needs at least category + one of symbol/trigger", () => {
    expect(buildDedupeKey(mkSuggestion("funding_alert", { symbol: "BTC" }))).toBe(
      "funding_alert:BTC",
    );
    expect(buildDedupeKey(mkSuggestion("regime_flip", { eventType: "rc" }))).toBe("regime_flip:rc");
    expect(
      buildDedupeKey(mkSuggestion("funding_alert", { symbol: "BTC", eventType: "funding" })),
    ).toBe("funding_alert:BTC:funding");
    // category alone is too coarse.
    expect(buildDedupeKey(mkSuggestion("portfolio_drift"))).toBeUndefined();
  });

  test("buildDedupeKey reads symbol from trigger metadata when not top-level", () => {
    const s = mkSuggestion("news_event");
    s.triggers.metadata = { symbol: "SOL" };
    s.triggers.eventType = "tick_news_event";
    expect(buildDedupeKey(s)).toBe("news_event:SOL:tick_news_event");
  });
});
