import { describe, it, expect } from "bun:test";

import {
  isLifecycleReconstructionEnabled,
  reconstructLifecycle,
  lifecycleToPayload,
  LIFECYCLE_RECONSTRUCTION_FLAG_ENV,
  type LifecycleEvent,
} from "./lifecycleReconstruction.ts";

describe("isLifecycleReconstructionEnabled", () => {
  it("respects the flag", () => {
    expect(isLifecycleReconstructionEnabled({})).toBe(false);
    expect(isLifecycleReconstructionEnabled({ [LIFECYCLE_RECONSTRUCTION_FLAG_ENV]: "1" })).toBe(true);
  });
});

describe("reconstructLifecycle — empty", () => {
  it("returns zero-event result for unknown correlationId", () => {
    const r = reconstructLifecycle({ events: [], correlationId: "x" });
    expect(r.eventCount).toBe(0);
    expect(r.anomalies).toEqual([]);
  });
});

describe("reconstructLifecycle — clean lifecycle", () => {
  it("no anomalies on standard flow", () => {
    const events: LifecycleEvent[] = [
      { t: 1000, kind: "plan_emitted", correlationId: "p1" },
      { t: 1100, kind: "permission_checked", correlationId: "p1" },
      { t: 1200, kind: "order_submitted", correlationId: "p1" },
      { t: 1500, kind: "order_filled", correlationId: "p1" },
      { t: 1600, kind: "position_changed", correlationId: "p1" },
      { t: 5000, kind: "pnl_recorded", correlationId: "p1" },
    ];
    const r = reconstructLifecycle({ events, correlationId: "p1" });
    expect(r.eventCount).toBe(6);
    expect(r.anomalies).toEqual([]);
    expect(r.durationMs).toBe(4000);
  });
});

describe("reconstructLifecycle — quote-stuffing signature", () => {
  it("rapid cancel without intermediate fill flags both anomalies", () => {
    const events: LifecycleEvent[] = [
      { t: 1000, kind: "permission_checked", correlationId: "p2" },
      { t: 1010, kind: "order_submitted", correlationId: "p2" },
      { t: 1050, kind: "order_cancelled", correlationId: "p2" },
    ];
    const r = reconstructLifecycle({ events, correlationId: "p2" });
    expect(r.anomalies).toContain("rapid_cancel_after_submit");
    expect(r.anomalies).toContain("cancel_without_intermediate_fill");
    expect(r.toxicityHints.some((h) => h.includes("quote-stuffing"))).toBe(true);
  });
});

describe("reconstructLifecycle — excessive modifications", () => {
  it("flags layered-stuffing pattern", () => {
    const events: LifecycleEvent[] = [
      { t: 0, kind: "permission_checked", correlationId: "p3" },
      { t: 1, kind: "order_submitted", correlationId: "p3" },
    ];
    for (let i = 0; i < 7; i++) {
      events.push({ t: 10 + i, kind: "order_modified", correlationId: "p3" });
    }
    const r = reconstructLifecycle({ events, correlationId: "p3" });
    expect(r.anomalies).toContain("excessive_modifications");
    expect(r.toxicityHints.some((h) => h.includes("layered-stuffing"))).toBe(true);
  });
});

describe("reconstructLifecycle — permission audit gap", () => {
  it("missing permission_checked event flags anomaly", () => {
    const events: LifecycleEvent[] = [
      { t: 1000, kind: "order_submitted", correlationId: "p4" },
      { t: 2000, kind: "order_filled", correlationId: "p4" },
    ];
    const r = reconstructLifecycle({ events, correlationId: "p4" });
    expect(r.anomalies).toContain("missing_permission_check");
  });
});

describe("reconstructLifecycle — correlation filter", () => {
  it("ignores events for other correlation ids", () => {
    const events: LifecycleEvent[] = [
      { t: 1000, kind: "permission_checked", correlationId: "a" },
      { t: 1100, kind: "order_submitted", correlationId: "b" },
      { t: 1200, kind: "order_filled", correlationId: "a" },
    ];
    const r = reconstructLifecycle({ events, correlationId: "a" });
    expect(r.eventCount).toBe(2);
  });
});

describe("lifecycleToPayload", () => {
  it("emits stable shape", () => {
    const r = reconstructLifecycle({
      events: [{ t: 1, kind: "order_submitted", correlationId: "p5" }],
      correlationId: "p5",
    });
    const p = lifecycleToPayload(r) as { kind: string; anomalyCount: number };
    expect(p.kind).toBe("lifecycle_reconstruction.evaluated");
    expect(typeof p.anomalyCount).toBe("number");
  });
});
