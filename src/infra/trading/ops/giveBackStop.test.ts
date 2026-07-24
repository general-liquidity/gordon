import { describe, it, expect } from "bun:test";

import {
  isGiveBackStopEnabled,
  evaluateGiveBack,
  giveBackToPayload,
  GIVE_BACK_STOP_FLAG_ENV,
} from "./giveBackStop.ts";

describe("isGiveBackStopEnabled", () => {
  it("respects the flag (default-on, explicit opt-out)", () => {
    expect(isGiveBackStopEnabled({})).toBe(true);
    expect(isGiveBackStopEnabled({ [GIVE_BACK_STOP_FLAG_ENV]: "1" })).toBe(true);
    expect(isGiveBackStopEnabled({ [GIVE_BACK_STOP_FLAG_ENV]: "0" })).toBe(false);
    expect(isGiveBackStopEnabled({ [GIVE_BACK_STOP_FLAG_ENV]: "false" })).toBe(false);
  });
});

describe("evaluateGiveBack — Wright's 50% rule example", () => {
  it("$10k HWM, give-back floor is +$5k", () => {
    const r = evaluateGiveBack({
      sessionStartEquityUsd: 100_000,
      sessionHighWaterMarkUsd: 110_000,
      currentEquityUsd: 108_000,
    });
    expect(r.giveBackFloorUsd).toBe(105_000);
    expect(r.state).toBe("ok");
  });

  it("hitting the floor triggers flatten", () => {
    const r = evaluateGiveBack({
      sessionStartEquityUsd: 100_000,
      sessionHighWaterMarkUsd: 110_000,
      currentEquityUsd: 105_000,
    });
    expect(r.state).toBe("triggered");
    expect(r.positionSizeMultiplier).toBe(0);
    expect(r.reason).toContain("flatten");
  });

  it("crossing below floor also triggers", () => {
    const r = evaluateGiveBack({
      sessionStartEquityUsd: 100_000,
      sessionHighWaterMarkUsd: 110_000,
      currentEquityUsd: 104_000,
    });
    expect(r.state).toBe("triggered");
  });
});

describe("evaluateGiveBack — warn band", () => {
  it("given back >25% but not yet at floor → warn", () => {
    const r = evaluateGiveBack({
      sessionStartEquityUsd: 100_000,
      sessionHighWaterMarkUsd: 110_000,
      currentEquityUsd: 106_500,
    });
    expect(r.state).toBe("warn");
  });
});

describe("evaluateGiveBack — dormant when no HWM profit", () => {
  it("session below start equity → rule dormant", () => {
    const r = evaluateGiveBack({
      sessionStartEquityUsd: 100_000,
      sessionHighWaterMarkUsd: 100_000,
      currentEquityUsd: 95_000,
    });
    expect(r.state).toBe("ok");
    expect(r.reason).toContain("dormant");
  });
});

describe("evaluateGiveBack — custom give-back fraction", () => {
  it("33% give-back is tighter than 50% default", () => {
    const r = evaluateGiveBack({
      sessionStartEquityUsd: 100_000,
      sessionHighWaterMarkUsd: 110_000,
      currentEquityUsd: 109_000,
      giveBackFraction: 0.33,
    });
    expect(r.giveBackFloorUsd).toBeCloseTo(106_700, 0);
    expect(r.state).toBe("ok");
  });
});

describe("evaluateGiveBack — outlier territory size decay", () => {
  it("HWM PnL >2σ above average daily win → size halved", () => {
    const r = evaluateGiveBack({
      sessionStartEquityUsd: 100_000,
      sessionHighWaterMarkUsd: 150_000,
      currentEquityUsd: 145_000,
      averageDailyWinUsd: 5_000,
      dailyWinStddevUsd: 10_000,
    });
    expect(r.inOutlierTerritory).toBe(true);
    expect(r.positionSizeMultiplier).toBe(0.5);
  });

  it("HWM PnL within normal range → no size reduction", () => {
    const r = evaluateGiveBack({
      sessionStartEquityUsd: 100_000,
      sessionHighWaterMarkUsd: 108_000,
      currentEquityUsd: 107_000,
      averageDailyWinUsd: 5_000,
      dailyWinStddevUsd: 5_000,
    });
    expect(r.inOutlierTerritory).toBe(false);
    expect(r.positionSizeMultiplier).toBe(1.0);
  });
});

describe("giveBackToPayload", () => {
  it("emits stable shape", () => {
    const r = evaluateGiveBack({
      sessionStartEquityUsd: 100_000,
      sessionHighWaterMarkUsd: 110_000,
      currentEquityUsd: 108_000,
    });
    const p = giveBackToPayload(r) as { kind: string; state: string };
    expect(p.kind).toBe("give_back_stop.evaluated");
    expect(p.state).toBe("ok");
  });
});
