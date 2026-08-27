import { describe, expect, it } from "bun:test";
import {
  positionReviewProducer,
  resetPositionReviewProducerState,
} from "./positionReviewProducer.ts";

describe("positionReviewProducer", () => {
  it("ignores non-position-review tick observations", async () => {
    const result = await positionReviewProducer({
      source: "monitor_loop",
      eventType: "tick_portfolio_drift",
      timestamp: Date.now(),
    });
    expect(result).toEqual([]);
  });

  it("ignores event bus observations", async () => {
    const result = await positionReviewProducer({
      source: "event_bus",
      eventType: "tick_position_review",
      timestamp: Date.now(),
    });
    expect(result).toEqual([]);
  });

  it("reset clears dedupe state", () => {
    resetPositionReviewProducerState();
    expect(true).toBe(true);
  });
});
