import { describe, expect, test, beforeEach } from "bun:test";
import type { CandidateProducer, ProactiveObservation } from "../engine/proactiveEngine.ts";
import type { ProactiveSuggestion } from "../types.ts";
import { getProducerHealthTracker } from "../engine/producerHealth.ts";
import {
  tradeEventProducer,
  resetTradeEventProducerState,
} from "./events/tradeEventProducer.ts";
import { scanOpportunityProducer } from "./signals/scanOpportunityProducer.ts";
import { riskProducer } from "./risk/riskProducer.ts";
import { stopProducer } from "./risk/stopProducer.ts";
import {
  producerHealthAlertProducer,
  resetProducerHealthAlertProducerState,
} from "./risk/producerHealthAlertProducer.ts";
import { periodicProducer } from "./periodicProducer.ts";
import { portfolioDriftProducer } from "./risk/portfolioDriftProducer.ts";
import { positionReviewProducer } from "./risk/positionReviewProducer.ts";
import { regimeFlipProducer } from "./signals/regimeFlipProducer.ts";
import { volatilitySpikeProducer } from "./signals/volatilitySpikeProducer.ts";
import { fundingAlertProducer } from "./signals/fundingAlertProducer.ts";
import { newsEventProducer } from "./events/newsEventProducer.ts";
import { stockNewsEventProducer } from "./events/stockNewsEventProducer.ts";
import {
  earningsApproachingProducer,
  insiderFlowProducer,
  analystUpgradeProducer,
  congressionalTradeProducer,
} from "./events/stockEventsProducer.ts";

function busObs(eventType: string, extra: Partial<ProactiveObservation> = {}): ProactiveObservation {
  return {
    source: "event_bus",
    eventType,
    timestamp: Date.now(),
    ...extra,
  };
}

function tickObs(eventType: string, extra: Partial<ProactiveObservation> = {}): ProactiveObservation {
  return {
    source: "monitor_loop",
    eventType,
    timestamp: Date.now(),
    ...extra,
  };
}

async function runProducer(
  fn: CandidateProducer,
  obs: ProactiveObservation,
): Promise<ProactiveSuggestion[]> {
  return Promise.resolve(fn(obs));
}

describe("proactive producers — smoke coverage", () => {
  describe("tradeEventProducer", () => {
    beforeEach(() => resetTradeEventProducerState());

    test("ignores non-event_bus observations", async () => {
      expect(await runProducer(tradeEventProducer, tickObs("trade:closed"))).toEqual([]);
    });

    test("fires journal_prompt after five closed trades", async () => {
      for (let i = 0; i < 4; i++) {
        expect(await runProducer(tradeEventProducer, busObs("trade:closed", { symbol: "BTCUSDT" }))).toEqual([]);
      }
      const cards = await runProducer(
        tradeEventProducer,
        busObs("trade:closed", { symbol: "BTCUSDT", change: 12 }),
      );
      expect(cards.length).toBe(1);
      expect(cards[0]!.category).toBe("journal_prompt");
    });
  });

  describe("scanOpportunityProducer", () => {
    test("ignores low-confidence scans", async () => {
      expect(
        await runProducer(
          scanOpportunityProducer,
          busObs("scan:opportunity", {
            symbol: "ETHUSDT",
            metadata: { confidence: 0.4, symbol: "ETHUSDT" },
          }),
        ),
      ).toEqual([]);
    });

    test("fires missed_entry on high-confidence scan", async () => {
      const cards = await runProducer(
        scanOpportunityProducer,
        busObs("scan:opportunity", {
          symbol: "SOLUSDT",
          metadata: { confidence: 0.85, bias: "long", symbol: "SOLUSDT" },
        }),
      );
      expect(cards.length).toBe(1);
      expect(cards[0]!.category).toBe("missed_entry");
      expect(cards[0]!.title).toContain("SOLUSDT");
    });
  });

  describe("riskProducer", () => {
    test("ignores unrelated events", async () => {
      expect(await runProducer(riskProducer, busObs("trade:closed"))).toEqual([]);
    });

    test("fires risk_warning on risk:rejected", async () => {
      const cards = await runProducer(
        riskProducer,
        busObs("risk:rejected", {
          symbol: "BTCUSDT",
          metadata: { reason: "exposure cap", checks: ["max_exposure"] },
        }),
      );
      expect(cards.length).toBe(1);
      expect(cards[0]!.category).toBe("risk_warning");
    });
  });

  describe("stopProducer", () => {
    test("ignores unrelated events", async () => {
      expect(await runProducer(stopProducer, busObs("risk:rejected"))).toEqual([]);
    });

    test("fires stop_loss_tighten when stop is near", async () => {
      const cards = await runProducer(
        stopProducer,
        busObs("alert:stop_approaching", {
          symbol: "BTCUSDT",
          metadata: { symbol: "BTCUSDT", distance: 0.5, currentPrice: 100, stopPrice: 99.5 },
        }),
      );
      expect(cards.length).toBe(1);
      expect(cards[0]!.category).toBe("stop_loss_tighten");
    });
  });

  describe("producerHealthAlertProducer", () => {
    beforeEach(() => {
      resetProducerHealthAlertProducerState();
      getProducerHealthTracker().stop();
    });

    test("ignores non-health ticks", async () => {
      expect(await producerHealthAlertProducer(tickObs("tick_kill_switch"))).toEqual([]);
    });

    test("fires when a producer is in errored state", async () => {
      const tracker = getProducerHealthTracker();
      tracker.start();
      tracker.registerProducer("flakyProducer");
      for (let i = 0; i < 3; i++) {
        tracker.recordHeartbeat("flakyProducer");
        tracker.recordError("flakyProducer", "fetch failed");
      }
      const cards = await producerHealthAlertProducer(tickObs("tick_producer_health"));
      expect(cards.length).toBe(1);
      expect(cards[0]!.category).toBe("risk_warning");
      expect(cards[0]!.title).toContain("health");
    });
  });

  describe("periodicProducer", () => {
    test("ignores unrelated ticks", async () => {
      expect(await periodicProducer(tickObs("tick_portfolio_drift"))).toEqual([]);
    });

    test("fires session_review on Friday evening UTC", async () => {
      // 2026-06-12 is a Friday; 21:30 UTC satisfies end-of-week gate
      const fridayEvening = Date.UTC(2026, 5, 12, 21, 30, 0);
      const cards = await periodicProducer(
        tickObs("tick_session_review", { timestamp: fridayEvening }),
      );
      expect(cards.length).toBe(1);
      expect(cards[0]!.category).toBe("session_review");
    });
  });

  describe("async tick producers — wrong observation guard", () => {
    const asyncProducers: Array<{ name: string; fn: CandidateProducer }> = [
      { name: "portfolioDrift", fn: portfolioDriftProducer },
      { name: "positionReview", fn: positionReviewProducer },
      { name: "regimeFlip", fn: regimeFlipProducer },
      { name: "volatilitySpike", fn: volatilitySpikeProducer },
      { name: "fundingAlert", fn: fundingAlertProducer },
      { name: "newsEvent", fn: newsEventProducer },
      { name: "stockNewsEvent", fn: stockNewsEventProducer },
      { name: "earningsApproaching", fn: earningsApproachingProducer },
      { name: "insiderFlow", fn: insiderFlowProducer },
      { name: "analystUpgrade", fn: analystUpgradeProducer },
      { name: "congressionalTrade", fn: congressionalTradeProducer },
    ];

    for (const { name, fn } of asyncProducers) {
      test(`${name} returns [] for wrong source/event`, async () => {
        const wrongSource = await runProducer(fn, busObs("tick_portfolio_drift"));
        const wrongEvent = await runProducer(fn, tickObs("tick_unknown"));
        expect(wrongSource).toEqual([]);
        expect(wrongEvent).toEqual([]);
      });
    }
  });
});