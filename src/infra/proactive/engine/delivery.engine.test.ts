import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { getProactiveEngine, buildCandidate } from "./proactiveEngine.ts";
import { BATCH_THRESHOLD } from "./deliveryPolicy.ts";
import { getSuggestionStore } from "../storage/suggestionStore.ts";
import { getCategoryPolicy } from "../judges/categoryPolicy.ts";
import { getEventBus } from "../../../events/index.ts";
import { SUMMARY_ROLLUP_MARKER } from "../types.ts";
import type { ProactiveCategory } from "../types.ts";

// End-to-end delivery-layer behavior at the engine boundary: judge approval →
// delivery policy → which proactive:suggestion_fired events actually emit.

interface FiredEvent {
  title: string;
  category: string;
  body: string;
}

function captureFired(): { events: FiredEvent[]; stop: () => void } {
  const events: FiredEvent[] = [];
  const unsubscribe = getEventBus().on("proactive:suggestion_fired", (e) => {
    events.push({ title: e.title, category: e.category, body: e.body });
  });
  return { events, stop: unsubscribe };
}

const engine = getProactiveEngine();

beforeEach(() => {
  engine.stop(); // resets delivery policy
  getSuggestionStore().clear();
  getCategoryPolicy().reset();
  engine.start();
});

afterEach(() => {
  engine.stop();
  getSuggestionStore().clear();
  getCategoryPolicy().reset();
});

describe("proactive delivery — engine end-to-end", () => {
  test("urgent suggestion emits a card immediately", async () => {
    const cap = captureFired();
    try {
      const res = await engine.fireCandidate(
        buildCandidate("risk_warning", "Risk kernel rejected order", "blocked", {
          confidence: 0.95,
          triggers: { source: "event_bus", eventType: "risk:rejected", symbol: "BTC" },
        }),
      );
      expect(res.fired).toBe(true);
      expect(cap.events.length).toBe(1);
      expect(cap.events[0]!.title).toContain("Risk kernel");
    } finally {
      cap.stop();
    }
  });

  test("normal/low cards batch into a single rollup at threshold", async () => {
    const cap = captureFired();
    try {
      // Distinct categories + symbols so each card clears the judge's
      // per-category cooldown and near-duplicate gate and reaches the
      // delivery policy as a batchable card. (Same-category repeats are
      // already collapsed earlier by the judge's cooldown — a separate gate.)
      const cats: ProactiveCategory[] = [
        "funding_alert",
        "whale_alert",
        "playbook_suggest",
        "news_event",
      ];
      for (let i = 0; i < BATCH_THRESHOLD; i++) {
        const res = await engine.fireCandidate(
          buildCandidate(cats[i]!, `card ${i}`, "body", {
            confidence: 0.9,
            triggers: { source: "monitor_loop", eventType: "tick", symbol: `SYM${i}` },
          }),
        );
        // The first BATCH_THRESHOLD-1 are held; the last flushes the rollup.
        if (i < BATCH_THRESHOLD - 1) expect(res.fired).toBe(false);
      }

      // Only ONE card emitted for the whole batch: the rollup.
      expect(cap.events.length).toBe(1);
      const rollup = cap.events[0]!;
      expect(rollup.title.startsWith(SUMMARY_ROLLUP_MARKER)).toBe(true);
      expect(rollup.body).toContain(`${BATCH_THRESHOLD} pending`);
      for (const c of cats) {
        expect(rollup.body).toContain(`${c}:1`);
      }

      // The individual cards are still in the store as pending (queryable),
      // not rendered as cards.
      const pending = getSuggestionStore().getRecent(50, { status: "pending" });
      const individuals = pending.filter((s) => !s.title.startsWith(SUMMARY_ROLLUP_MARKER));
      expect(individuals.length).toBe(BATCH_THRESHOLD);
    } finally {
      cap.stop();
    }
  });
});
