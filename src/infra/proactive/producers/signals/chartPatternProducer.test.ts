import { describe, expect, test } from "bun:test";
import { chartPatternProducer, resetChartPatternProducerState } from "./chartPatternProducer.ts";
import type { ProactiveObservation } from "../../engine/proactiveEngine.ts";

// These guard checks return before any network/candle fetch, so they're
// deterministic and dependency-free. Pattern-detection behaviour itself is
// covered by core/indicators/lmw-patterns.test.ts.
describe("chartPatternProducer", () => {
  test("ignores observations that aren't its tick", async () => {
    resetChartPatternProducerState();
    const wrongEvent: ProactiveObservation = {
      source: "monitor_loop",
      eventType: "tick_regime_flip",
      timestamp: 0,
    };
    const wrongSource: ProactiveObservation = {
      source: "event_bus",
      eventType: "tick_chart_pattern",
      timestamp: 0,
    };
    expect(await chartPatternProducer(wrongEvent)).toEqual([]);
    expect(await chartPatternProducer(wrongSource)).toEqual([]);
  });
});
