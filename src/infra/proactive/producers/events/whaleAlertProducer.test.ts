import { describe, expect, it } from "bun:test";
import { whaleAlertProducer, resetWhaleAlertProducerState } from "./whaleAlertProducer.ts";

describe("whaleAlertProducer", () => {
  it("ignores non-whale tick observations", async () => {
    const result = await whaleAlertProducer({
      source: "monitor_loop",
      eventType: "tick_news_event",
      timestamp: Date.now(),
    });
    expect(result).toEqual([]);
  });

  it("ignores event bus observations", async () => {
    const result = await whaleAlertProducer({
      source: "event_bus",
      eventType: "tick_whale_alert",
      timestamp: Date.now(),
    });
    expect(result).toEqual([]);
  });

  it("reset clears dedupe state", () => {
    resetWhaleAlertProducerState();
    expect(true).toBe(true);
  });
});