import { describe, it, expect } from "bun:test";

import { createFeatureList, makeEntry, markPass } from "./tradingFeatureList.ts";
import { deriveCyclePlan, cyclePlanToPayload } from "./jitPlanning.ts";

function sampleList() {
  return createFeatureList([
    makeEntry({
      id: "venue-connect",
      category: "venue",
      description: "connect to primary venue",
      steps: ["open ws", "auth", "subscribe ticker"],
      priority: 0,
    }),
    makeEntry({
      id: "analysis-regime",
      category: "analysis",
      description: "compute regime",
      steps: ["load candles", "run classifier"],
      priority: 1,
    }),
    makeEntry({
      id: "exec-place",
      category: "execution",
      description: "place a paper order",
      steps: ["build order", "submit", "reconcile"],
      priority: 2,
    }),
  ]);
}

describe("deriveCyclePlan — milestone selection", () => {
  it("picks the highest-priority not-yet-passing entry as the fixed milestone", () => {
    const plan = deriveCyclePlan(sampleList());
    expect(plan.milestone?.id).toBe("venue-connect");
    expect(plan.items.map((i) => i.action)).toEqual(["open ws", "auth", "subscribe ticker"]);
  });

  it("advances to the next milestone once earlier ones pass", () => {
    let list = sampleList();
    list = markPass(list, "venue-connect")!;
    const plan = deriveCyclePlan(list);
    expect(plan.milestone?.id).toBe("analysis-regime");
  });

  it("reports all-passing with no items", () => {
    let list = sampleList();
    for (const id of ["venue-connect", "analysis-regime", "exec-place"]) {
      list = markPass(list, id)!;
    }
    const plan = deriveCyclePlan(list);
    expect(plan.milestone).toBeNull();
    expect(plan.items).toHaveLength(0);
    expect(plan.reason).toContain("All features passing");
  });
});

describe("deriveCyclePlan — just-in-time from current state", () => {
  it("re-derives against the SAME fixed list depending on cycle state", () => {
    const list = sampleList();
    const cleanPlan = deriveCyclePlan(list);
    const blockedPlan = deriveCyclePlan(list, { blockedFeatureIds: ["venue-connect"] });
    // The list did not change, but the derived milestone did.
    expect(cleanPlan.milestone?.id).toBe("venue-connect");
    expect(blockedPlan.milestone?.id).toBe("analysis-regime");
    expect(blockedPlan.skippedFeatureIds).toContain("venue-connect");
  });

  it("defers blocked steps but keeps the milestone active", () => {
    const plan = deriveCyclePlan(sampleList(), { blockedSteps: ["auth"] });
    expect(plan.milestone?.id).toBe("venue-connect");
    expect(plan.items.map((i) => i.action)).toEqual(["open ws", "subscribe ticker"]);
    expect(plan.deferred.map((i) => i.action)).toEqual(["auth"]);
    expect(plan.deferred[0]?.blocked).toBe(true);
  });

  it("prepends a remediation item when the milestone carries a failedReason", () => {
    let list = sampleList();
    // markFail via a raw edit through the public helper.
    const withFail = {
      ...list,
      entries: list.entries.map((e) =>
        e.id === "venue-connect" ? { ...e, failedReason: "ws handshake timeout" } : e,
      ),
    };
    const plan = deriveCyclePlan(withFail);
    expect(plan.items[0]?.kind).toBe("remediate");
    expect(plan.items[0]?.action).toContain("ws handshake timeout");
  });

  it("reports all-blocked when every failing milestone is blocked", () => {
    const plan = deriveCyclePlan(sampleList(), {
      blockedFeatureIds: ["venue-connect", "analysis-regime", "exec-place"],
    });
    expect(plan.milestone).toBeNull();
    expect(plan.reason).toContain("blocked");
    expect(plan.skippedFeatureIds).toHaveLength(3);
  });

  it("notes churn when revisiting a recently-attempted milestone", () => {
    const plan = deriveCyclePlan(sampleList(), { recentlyAttemptedIds: ["venue-connect"] });
    expect(plan.reason).toContain("recently-attempted");
  });
});

describe("cyclePlanToPayload", () => {
  it("summarizes counts", () => {
    const payload = cyclePlanToPayload(deriveCyclePlan(sampleList(), { blockedSteps: ["auth"] }));
    expect(payload.kind).toBe("jit_planning.cycle_derived");
    expect(payload.milestoneId).toBe("venue-connect");
    expect(payload.activeCount).toBe(2);
    expect(payload.deferredCount).toBe(1);
  });
});
