import { describe, it, expect } from "bun:test";

import {
  isAbsorbingBarrierEnabled,
  distanceToBarriers,
  shouldBlockNewTrades,
  barriersToPayload,
  ABSORBING_BARRIER_FLAG_ENV,
  createAbsorbingBarrierState,
  recordExternalFlow,
  evaluateAbsorbingBarrier,
  absorbingBarrierToPayload,
  type AbsorbingBarrierConfig,
  type AbsorbingBarrierEvaluation,
  type TerminalBarrierKind,
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
      dailyLoss: { windowStartEquityUsd: 100_000, budgetUsd: 3000 },
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
      dailyLoss: { windowStartEquityUsd: 100_000, budgetUsd: 5000 },
      baseRiskPerTradeUsd: 1000,
    });
    const broker = r.barriers.find((b) => b.kind === "broker")!;
    expect(broker.dollarsToBarrier).toBe(5000);
  });
});

describe("distanceToBarriers — loss budgets are anchored, not floating", () => {
  // Anchoring a budget to CURRENT equity put the trigger the same distance
  // below the operator at every moment: the distance stayed equal to the
  // budget forever and neither barrier could fire. These pin the anchor.

  it("daily-loss distance shrinks as the day's loss accrues", () => {
    const read = (equity: number) =>
      distanceToBarriers({
        currentEquity: equity,
        dailyLoss: { windowStartEquityUsd: 100_000, budgetUsd: 2000 },
        baseRiskPerTradeUsd: 500,
      }).barriers.find((b) => b.kind === "broker")!;

    expect(read(100_000).dollarsToBarrier).toBe(2000);
    expect(read(99_000).dollarsToBarrier).toBe(1000);
    expect(read(98_100).dollarsToBarrier).toBe(100);
    // Old behaviour: every one of these read 2000 / 4R / "warn".
    expect(read(98_100).rUnitsToBarrier).toBeCloseTo(0.2, 9);
    expect(read(98_100).alertLevel).toBe("critical");
  });

  it("daily-loss barrier can actually be breached", () => {
    const r = distanceToBarriers({
      currentEquity: 97_000,
      dailyLoss: { windowStartEquityUsd: 100_000, budgetUsd: 2000 },
      baseRiskPerTradeUsd: 500,
    });
    const broker = r.barriers.find((b) => b.kind === "broker")!;
    expect(broker.triggerEquity).toBe(98_000);
    expect(broker.dollarsToBarrier).toBe(-1000);
    expect(broker.alertLevel).toBe("breached");
    expect(shouldBlockNewTrades(r)).toBe(true);
  });

  it("psychological tilt is measured from the session open, not from now", () => {
    const r = distanceToBarriers({
      currentEquity: 96_000,
      psychologicalTilt: { windowStartEquityUsd: 100_000, budgetUsd: 5000 },
      baseRiskPerTradeUsd: 1000,
    });
    const psych = r.barriers.find((b) => b.kind === "psychological")!;
    expect(psych.triggerEquity).toBe(95_000);
    expect(psych.dollarsToBarrier).toBe(1000);
    expect(psych.alertLevel).toBe("critical");
  });

  it("rejects a missing R unit instead of falling back to $1 per R", () => {
    // baseR of 1 made rUnits equal dollars, so a $2,000 distance read 2000R
    // and classified "ok". Every barrier was permanently ok.
    expect(() =>
      distanceToBarriers({
        currentEquity: 100_000,
        maintenanceMarginEquity: 98_000,
        baseRiskPerTradeUsd: 0,
      }),
    ).toThrow();
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
      psychologicalTilt: { windowStartEquityUsd: 100_000, budgetUsd: 5000 },
      baseRiskPerTradeUsd: 1000,
    });
    const psych = r.barriers.find((b) => b.kind === "psychological")!;
    expect(psych.active).toBe(true);
    expect(psych.dollarsToBarrier).toBe(5000);
    expect(psych.rUnitsToBarrier).toBe(5);
    expect(psych.alertLevel).toBe("watch");
  });

  it("inactive when no tilt point provided (no universal formula)", () => {
    const r = distanceToBarriers({ currentEquity: 100_000, baseRiskPerTradeUsd: 1000 });
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
      psychologicalTilt: { windowStartEquityUsd: 100_000, budgetUsd: 8000 },
      baseRiskPerTradeUsd: 1000,
    });
    // broker = 10R, prop = 3R, psych = 8R
    expect(r.nearest).toBe("prop_firm");
    expect(r.nearestRUnits).toBe(3);
  });

  it("nearest is null when no barriers are active", () => {
    const r = distanceToBarriers({ currentEquity: 100_000, baseRiskPerTradeUsd: 1000 });
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
        dailyLoss: { windowStartEquityUsd: 100_000, budgetUsd: rUnits * 1000 },
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
      dailyLoss: { windowStartEquityUsd: 100_000, budgetUsd: 1500 },
      baseRiskPerTradeUsd: 1000,
    });
    expect(shouldBlockNewTrades(r)).toBe(true);
  });

  it("allows at watch level", () => {
    const r = distanceToBarriers({
      currentEquity: 100_000,
      dailyLoss: { windowStartEquityUsd: 100_000, budgetUsd: 7000 },
      baseRiskPerTradeUsd: 1000,
    });
    expect(shouldBlockNewTrades(r)).toBe(false);
  });
});

describe("barriersToPayload", () => {
  it("emits only active barriers and stable shape", () => {
    const r = distanceToBarriers({
      currentEquity: 100_000,
      dailyLoss: { windowStartEquityUsd: 100_000, budgetUsd: 3000 },
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

describe("inception loss barrier", () => {
  const TAU: AbsorbingBarrierConfig = {
    inceptionLossFraction: 0.2,
    trailingDrawdownFraction: 0.2,
  };

  function fold(
    equities: number[],
    config: AbsorbingBarrierConfig = TAU,
    inception = 100_000,
  ): AbsorbingBarrierEvaluation {
    let state = createAbsorbingBarrierState(inception);
    let evaluation = evaluateAbsorbingBarrier(state, inception, config);
    state = evaluation.state;
    for (const equity of equities) {
      evaluation = evaluateAbsorbingBarrier(state, equity, config);
      state = evaluation.state;
    }
    return evaluation;
  }

  it("an account that twice loses 18% and twice makes a new high survives the trailing limit while a fifth of committed capital is gone", () => {
    // 100k down to 82k, back up to a new high of 110k, down 18% again to 90.2k.
    const evaluation = fold([82_000, 110_000, 90_200]);

    expect(evaluation.trailing.lossFraction).toBeCloseTo(0.18, 10);
    expect(evaluation.trailing.headroomFraction).toBeGreaterThan(0);

    expect(evaluation.inception.lossFraction).toBeCloseTo(0.378, 10);
    expect(evaluation.tripped).toBe(true);
    expect(evaluation.boundBy).toBe("inception");
  });

  it("the same path never halts when only the trailing limit is configured", () => {
    const evaluation = fold([82_000, 110_000, 90_200], {
      trailingDrawdownFraction: 0.2,
    });
    expect(evaluation.tripped).toBe(false);
    expect(evaluation.inception.active).toBe(false);
  });

  it("names the barrier that bound and reports the distance to each", () => {
    const evaluation = fold([82_000, 110_000, 90_200]);

    expect(evaluation.boundBy).toBe("inception");
    expect(evaluation.trailing.limitFraction).toBe(0.2);
    expect(evaluation.trailing.headroomFraction).toBeCloseTo(0.02, 10);
    expect(evaluation.trailing.triggerEquityUsd).toBe(88_000);
    expect(evaluation.inception.headroomFraction).toBeCloseTo(-0.178, 10);
    expect(evaluation.inception.triggerEquityUsd).toBe(108_000);
    expect(evaluation.state.trippedAtEquityUsd).toBe(90_200);
  });

  it("names the trailing barrier when one uninterrupted collapse breaches both", () => {
    const evaluation = fold([70_000]);
    expect(evaluation.tripped).toBe(true);
    expect(evaluation.boundBy).toBe("trailing_high_water");
    expect(evaluation.trailing.lossFraction).toBeCloseTo(0.3, 10);
    expect(evaluation.inception.lossFraction).toBeCloseTo(0.3, 10);
  });

  it("stays tripped after equity recovers past the high-water mark", () => {
    const tripped = fold([82_000, 110_000, 90_200]);
    expect(tripped.tripped).toBe(true);

    const recovered = evaluateAbsorbingBarrier(tripped.state, 130_000, TAU);
    expect(recovered.tripped).toBe(true);
    expect(recovered.boundBy).toBe("inception");
    expect(recovered.state.trippedAtEquityUsd).toBe(90_200);
    expect(recovered.inceptionPointInTimeLossFraction).toBeLessThan(0);
  });

  it("never halts when no limits are configured", () => {
    const evaluation = fold([50_000, 10_000, 1_000], {});
    expect(evaluation.tripped).toBe(false);
    expect(evaluation.boundBy).toBeNull();
    expect(evaluation.inception.active).toBe(false);
    expect(evaluation.trailing.active).toBe(false);
    expect(evaluation.inception.headroomFraction).toBe(Number.POSITIVE_INFINITY);
  });

  it("a withdrawal from a flat account is not a loss", () => {
    const state = createAbsorbingBarrierState(100_000);
    const afterWithdrawal = recordExternalFlow(state, -30_000);
    const evaluation = evaluateAbsorbingBarrier(afterWithdrawal, 70_000, TAU);

    expect(evaluation.state.referenceCapitalUsd).toBe(70_000);
    expect(evaluation.inception.lossFraction).toBe(0);
    expect(evaluation.trailing.lossFraction).toBe(0);
    expect(evaluation.tripped).toBe(false);
  });

  it("a deposit raises the reference instead of forgiving the open decline", () => {
    const start = createAbsorbingBarrierState(100_000);
    const afterLoss = evaluateAbsorbingBarrier(start, 85_000, TAU).state;
    const afterDeposit = recordExternalFlow(afterLoss, 100_000);

    // 185k of equity against 200k contributed: the open 15k decline survives
    // the deposit, it is neither erased nor restated as a fresh loss.
    const evaluation = evaluateAbsorbingBarrier(afterDeposit, 185_000, TAU);
    expect(evaluation.state.referenceCapitalUsd).toBe(200_000);
    expect(evaluation.inception.lossFraction).toBeCloseTo(0.075, 10);
    expect(evaluation.tripped).toBe(false);
  });

  it("capital destroyed before a deposit still counts against the limit after it", () => {
    let state = createAbsorbingBarrierState(100_000);
    state = evaluateAbsorbingBarrier(state, 85_000, TAU).state;
    state = evaluateAbsorbingBarrier(state, 102_000, TAU).state;
    state = recordExternalFlow(state, 100_000);

    // 15k destroyed and re-earned before the deposit, 27k destroyed after,
    // against 200k contributed: 21% cumulative on a 13% trailing decline.
    const evaluation = evaluateAbsorbingBarrier(state, 175_000, TAU);
    expect(evaluation.inception.lossFraction).toBeCloseTo(0.21, 10);
    expect(evaluation.trailing.headroomFraction).toBeGreaterThan(0);
    expect(evaluation.boundBy).toBe("inception");
  });

  it("produces identical results for identical equity paths", () => {
    const path = [95_000, 108_000, 91_000, 120_000, 88_000];
    const a = fold(path);
    const b = fold(path);
    expect(a).toEqual(b);
    expect(absorbingBarrierToPayload(a)).toEqual(absorbingBarrierToPayload(b));
  });

  it("reads no wall clock", () => {
    const realNow = Date.now;
    let clockReads = 0;
    Date.now = () => {
      clockReads += 1;
      return realNow();
    };
    let boundBy: TerminalBarrierKind | null;
    try {
      const evaluation = fold([82_000, 110_000, 90_200]);
      absorbingBarrierToPayload(evaluation);
      boundBy = evaluation.boundBy;
    } finally {
      Date.now = realNow;
    }
    expect(clockReads).toBe(0);
    expect(boundBy).toBe("inception");
  });

  it("payload carries the bound barrier and both readings", () => {
    const payload = absorbingBarrierToPayload(fold([82_000, 110_000, 90_200])) as {
      tripped: boolean;
      boundBy: string;
      referenceCapitalUsd: number;
      barriers: Array<{ kind: string; headroomFraction: number }>;
    };
    expect(payload.tripped).toBe(true);
    expect(payload.boundBy).toBe("inception");
    expect(payload.referenceCapitalUsd).toBe(100_000);
    expect(payload.barriers.map((b) => b.kind)).toEqual([
      "trailing_high_water",
      "inception",
    ]);
  });
});
