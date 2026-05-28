import { describe, expect, test } from "bun:test";
import { computeOrchestrationLoad } from "./orchestrationLoad.ts";

describe("computeOrchestrationLoad — tiers", () => {
  test("slack when backlog under saturated threshold", () => {
    const r = computeOrchestrationLoad({ pendingReviewItems: 2, reviewCapacityPerHour: 6 });
    expect(r.backlogHours).toBeCloseTo(0.333, 3);
    expect(r.tier).toBe("slack");
    expect(r.shouldApplyBackpressure).toBe(false);
    expect(r.deferNonCritical).toBe(false);
  });

  test("saturated between thresholds", () => {
    // 5 pending / 6 per hr = 0.833h → between 0.75 and 1.0
    const r = computeOrchestrationLoad({ pendingReviewItems: 5, reviewCapacityPerHour: 6 });
    expect(r.tier).toBe("saturated");
    expect(r.shouldApplyBackpressure).toBe(true);
    expect(r.deferNonCritical).toBe(false);
  });

  test("overloaded at/above overloaded threshold", () => {
    // 8 pending / 4 per hr = 2.0h backlog
    const r = computeOrchestrationLoad({ pendingReviewItems: 8, reviewCapacityPerHour: 4 });
    expect(r.tier).toBe("overloaded");
    expect(r.shouldApplyBackpressure).toBe(true);
    expect(r.deferNonCritical).toBe(true);
    expect(r.interpretation).toContain("OVERLOADED");
  });

  test("exactly at overloaded threshold counts as overloaded", () => {
    const r = computeOrchestrationLoad({ pendingReviewItems: 4, reviewCapacityPerHour: 4 });
    expect(r.backlogHours).toBe(1.0);
    expect(r.tier).toBe("overloaded");
  });

  test("zero pending → slack", () => {
    const r = computeOrchestrationLoad({ pendingReviewItems: 0, reviewCapacityPerHour: 6 });
    expect(r.backlogHours).toBe(0);
    expect(r.tier).toBe("slack");
  });
});

describe("computeOrchestrationLoad — producer outpacing", () => {
  test("null when producedLastHour omitted", () => {
    const r = computeOrchestrationLoad({ pendingReviewItems: 1, reviewCapacityPerHour: 6 });
    expect(r.producerOutpacingConsumer).toBeNull();
  });

  test("true when production exceeds review capacity", () => {
    const r = computeOrchestrationLoad({
      pendingReviewItems: 1,
      reviewCapacityPerHour: 6,
      producedLastHour: 10,
    });
    expect(r.producerOutpacingConsumer).toBe(true);
    expect(r.interpretation).toContain("queue is growing");
  });

  test("false when production within capacity", () => {
    const r = computeOrchestrationLoad({
      pendingReviewItems: 1,
      reviewCapacityPerHour: 6,
      producedLastHour: 3,
    });
    expect(r.producerOutpacingConsumer).toBe(false);
  });
});

describe("computeOrchestrationLoad — custom thresholds", () => {
  test("custom thresholds shift the tiering", () => {
    // 3 pending / 6 = 0.5h. Default → slack. With saturated 0.4 → saturated.
    expect(computeOrchestrationLoad({ pendingReviewItems: 3, reviewCapacityPerHour: 6 }).tier).toBe("slack");
    expect(
      computeOrchestrationLoad({
        pendingReviewItems: 3,
        reviewCapacityPerHour: 6,
        saturatedThreshold: 0.4,
        overloadedThreshold: 0.9,
      }).tier,
    ).toBe("saturated");
  });
});

describe("computeOrchestrationLoad — guards", () => {
  test("throws on non-positive capacity", () => {
    expect(() => computeOrchestrationLoad({ pendingReviewItems: 1, reviewCapacityPerHour: 0 })).toThrow(/reviewCapacityPerHour/);
    expect(() => computeOrchestrationLoad({ pendingReviewItems: 1, reviewCapacityPerHour: -2 })).toThrow(/reviewCapacityPerHour/);
  });

  test("throws on negative pending", () => {
    expect(() => computeOrchestrationLoad({ pendingReviewItems: -1, reviewCapacityPerHour: 6 })).toThrow(/pendingReviewItems/);
  });

  test("throws on inverted thresholds", () => {
    expect(() =>
      computeOrchestrationLoad({
        pendingReviewItems: 1,
        reviewCapacityPerHour: 6,
        saturatedThreshold: 1.0,
        overloadedThreshold: 0.5,
      }),
    ).toThrow(/overloadedThreshold/);
  });
});
