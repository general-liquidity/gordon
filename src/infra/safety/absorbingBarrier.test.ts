import { describe, it, expect } from "bun:test";

import {
  isAbsorbingBarrierEnabled,
  distanceToBarriers,
  shouldBlockNewTrades,
  barriersToPayload,
  ABSORBING_BARRIER_FLAG_ENV,
} from "./absorbingBarrier.ts";

describe("isAbsorbingBarrierEnabled", () => {
  it("respects the flag (default-on, explicit opt-out)", () => {
    expect(isAbsorbingBarrierEnabled({})).toBe(true);
    expect(isAbsorbingBarrierEnabled({ [ABSORBING_BARRIER_FLAG_ENV]: "1" })).toBe(true);
    expect(isAbsorbingBarrierEnabled({ [ABSORBING_BARRIER_FLAG_ENV]: "true" })).toBe(true);
    expect(isAbsorbingBarrierEnabled({ [ABSORBING_BARRIER_FLAG_ENV]: "0" })).toBe(false);
    expect(isAbsorbingBarrierEnabled({ [ABSORBING_BARRIER_FLAG_ENV]: "false" })).toBe(false);
  });
});

describe("distanceToBarriers — broker", () => {
  it("computes distance via maintenance margin", () => {
    const r = distanceToBarriers({
      currentEquity: 100_000,
      maintenanceMarginEquity: 80_000,
      baseRiskPerTradeUsd: 1000,
    });
    const broker = r.barriers.find((b) => b.kind === "broker")!;
    expect(broker.active).toBe(true);
    expect(broker.dollarsToBarrier).toBe(20_000);
    expect(broker.rUnitsToBarrier).toBe(20);
    expect(broker.alertLevel).toBe("ok");
  });

  it("computes distance via daily loss budget", () => {
    const r = distanceToBarriers({
      currentEquity: 100_000,
      dailyLossBudgetUsd: 3000,
      baseRiskPerTradeUsd: 1000,
    });
    const broker = r.barriers.find((b) => b.kind === "broker")!;
    expect(broker.dollarsToBarrier).toBe(3000);
    expect(broker.rUnitsToBarrier).toBe(3);
    expect(broker.alertLevel).toBe("warn");
  });

  it("picks the tighter trigger when both broker inputs are provided", () => {
    const r = distanceToBarriers({
      currentEquity: 100_000,
      maintenanceMarginEquity: 80_000,
      dailyLossBudgetUsd: 5000,
      baseRiskPerTradeUsd: 1000,
    });
    const broker = r.barriers.find((b) => b.kind === "broker")!;
    expect(broker.dollarsToBarrier).toBe(5000);
  });
});

describe("distanceToBarriers — prop firm trailing", () => {
  it("activates only when both HWM and trailing DD are given", () => {
    const r1 = distanceToBarriers({
      currentEquity: 100_000,
      propFirmTrailingDdUsd: 2000,
      baseRiskPerTradeUsd: 500,
    });
    expect(r1.barriers.find((b) => b.kind === "prop_firm")!.active).toBe(false);

    const r2 = distanceToBarriers({
      currentEquity: 100_000,
      equityHighWaterMark: 102_000,
      propFirmTrailingDdUsd: 2000,
      baseRiskPerTradeUsd: 500,
    });
    const pf = r2.barriers.find((b) => b.kind === "prop_firm")!;
    expect(pf.active).toBe(true);
    expect(pf.triggerEquity).toBe(100_000); // 102k - 2k
    expect(pf.dollarsToBarrier).toBe(0);
    expect(pf.rUnitsToBarrier).toBe(0);
    expect(pf.alertLevel).toBe("critical");
  });

  it("trailing barrier follows the high-water mark up", () => {
    const r = distanceToBarriers({
      currentEquity: 105_000,
      equityHighWaterMark: 110_000,
      propFirmTrailingDdUsd: 2000,
      baseRiskPerTradeUsd: 1000,
    });
    const pf = r.barriers.find((b) => b.kind === "prop_firm")!;
    expect(pf.triggerEquity).toBe(108_000);
    expect(pf.dollarsToBarrier).toBe(-3000);
    expect(pf.alertLevel).toBe("breached");
  });
});

describe("distanceToBarriers — psychological tilt", () => {
  it("uses operator-supplied tilt amount", () => {
    const r = distanceToBarriers({
      currentEquity: 100_000,
      psychologicalTiltUsd: 5000,
      baseRiskPerTradeUsd: 1000,
    });
    const psych = r.barriers.find((b) => b.kind === "psychological")!;
    expect(psych.active).toBe(true);
    expect(psych.dollarsToBarrier).toBe(5000);
    expect(psych.rUnitsToBarrier).toBe(5);
    expect(psych.alertLevel).toBe("watch");
  });

  it("inactive when no tilt point provided (no universal formula)", () => {
    const r = distanceToBarriers({ currentEquity: 100_000 });
    expect(r.barriers.find((b) => b.kind === "psychological")!.active).toBe(false);
  });
});

describe("distanceToBarriers — nearest selection", () => {
  it("returns nearest active barrier in R-units", () => {
    const r = distanceToBarriers({
      currentEquity: 100_000,
      maintenanceMarginEquity: 90_000,
      equityHighWaterMark: 102_000,
      propFirmTrailingDdUsd: 5000,
      psychologicalTiltUsd: 8000,
      baseRiskPerTradeUsd: 1000,
    });
    // broker = 10R, prop = 3R, psych = 8R
    expect(r.nearest).toBe("prop_firm");
    expect(r.nearestRUnits).toBe(3);
  });

  it("nearest is null when no barriers are active", () => {
    const r = distanceToBarriers({ currentEquity: 100_000 });
    expect(r.nearest).toBeNull();
    expect(r.nearestRUnits).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("alert levels", () => {
  it("matches the R-unit thresholds: ok≥10 > watch≥5 > warn≥2 > critical≥0 > breached<0", () => {
    const cases: Array<[number, string]> = [
      [12, "ok"],
      [10, "ok"],
      [9.99, "watch"],
      [5, "watch"],
      [4.99, "warn"],
      [2, "warn"],
      [1.99, "critical"],
      [0, "critical"],
      [-0.5, "breached"],
    ];
    for (const [rUnits, expected] of cases) {
      const r = distanceToBarriers({
        currentEquity: 100_000,
        dailyLossBudgetUsd: rUnits * 1000,
        baseRiskPerTradeUsd: 1000,
      });
      expect(r.barriers.find((b) => b.kind === "broker")!.alertLevel).toBe(expected as "ok");
    }
  });
});

describe("shouldBlockNewTrades", () => {
  it("blocks at warn or worse", () => {
    const r = distanceToBarriers({
      currentEquity: 100_000,
      dailyLossBudgetUsd: 1500,
      baseRiskPerTradeUsd: 1000,
    });
    expect(shouldBlockNewTrades(r)).toBe(true);
  });

  it("allows at watch level", () => {
    const r = distanceToBarriers({
      currentEquity: 100_000,
      dailyLossBudgetUsd: 7000,
      baseRiskPerTradeUsd: 1000,
    });
    expect(shouldBlockNewTrades(r)).toBe(false);
  });
});

describe("barriersToPayload", () => {
  it("emits only active barriers and stable shape", () => {
    const r = distanceToBarriers({
      currentEquity: 100_000,
      dailyLossBudgetUsd: 3000,
      baseRiskPerTradeUsd: 1000,
    });
    const p = barriersToPayload(r) as {
      kind: string;
      barriers: Array<{ kind: string }>;
      nearest: string;
    };
    expect(p.kind).toBe("absorbing_barrier.evaluated");
    expect(p.barriers.length).toBe(1);
    expect(p.barriers[0]!.kind).toBe("broker");
    expect(p.nearest).toBe("broker");
  });
});
