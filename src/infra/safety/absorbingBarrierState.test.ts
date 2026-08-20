import { describe, it, expect, beforeEach, afterEach } from "bun:test";

import {
  observeSessionEquity,
  recordSessionExternalFlow,
  readAbsorbingBarrierConfigFromEnv,
  sessionAbsorbingBarrierState,
  resetSessionAbsorbingBarrierForTesting,
  INCEPTION_LOSS_FRACTION_ENV,
  TRAILING_DD_FRACTION_ENV,
  INCEPTION_EQUITY_ENV,
} from "./absorbingBarrierState.ts";
import { distanceToBarriers, shouldBlockNewTrades } from "./absorbingBarrier.ts";

const TOUCHED = [
  INCEPTION_LOSS_FRACTION_ENV,
  TRAILING_DD_FRACTION_ENV,
  INCEPTION_EQUITY_ENV,
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  resetSessionAbsorbingBarrierForTesting();
  saved = {};
  for (const key of TOUCHED) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of TOUCHED) {
    const prior = saved[key];
    if (prior === undefined) delete process.env[key];
    else process.env[key] = prior;
  }
  resetSessionAbsorbingBarrierForTesting();
});

describe("an operator who configured no limit is governed exactly as before", () => {
  it("produces no reading and creates no state", () => {
    expect(observeSessionEquity(100_000)).toBeNull();
    expect(observeSessionEquity(50_000)).toBeNull();
    expect(sessionAbsorbingBarrierState()).toBeNull();
  });

  it("reads an empty config when the limit env vars are absent", () => {
    expect(readAbsorbingBarrierConfigFromEnv({})).toEqual({});
  });

  it("ignores a limit outside the fraction range rather than inventing a threshold", () => {
    expect(
      readAbsorbingBarrierConfigFromEnv({ [INCEPTION_LOSS_FRACTION_ENV]: "0" }),
    ).toEqual({});
    expect(
      readAbsorbingBarrierConfigFromEnv({ [INCEPTION_LOSS_FRACTION_ENV]: "20" }),
    ).toEqual({});
    expect(
      readAbsorbingBarrierConfigFromEnv({ [INCEPTION_LOSS_FRACTION_ENV]: "abc" }),
    ).toEqual({});
    expect(
      readAbsorbingBarrierConfigFromEnv({ [INCEPTION_LOSS_FRACTION_ENV]: "0.2" }),
    ).toEqual({ inceptionLossFraction: 0.2 });
  });
});

describe("recovering to a new high and losing again still destroys capital", () => {
  const config = { inceptionLossFraction: 0.2, trailingDrawdownFraction: 0.2 };

  it("the trailing barrier alone never sees the account 20% below its peak", () => {
    const path = [100_000, 82_000, 101_000, 82_820];
    let worstTrailing = 0;
    for (const equity of path) {
      const evaluation = observeSessionEquity(equity, config);
      worstTrailing = Math.max(worstTrailing, evaluation!.trailing.lossFraction);
    }
    expect(worstTrailing).toBeLessThan(0.2);
  });

  it("the inception barrier halts on that same path", () => {
    const path = [100_000, 82_000, 101_000, 82_820];
    let last = observeSessionEquity(path[0]!, config)!;
    for (const equity of path.slice(1)) {
      last = observeSessionEquity(equity, config)!;
    }
    expect(last.tripped).toBe(true);
    expect(last.boundBy).toBe("inception");
  });
});

describe("the barrier remembers what happened before the current observation", () => {
  const config = { inceptionLossFraction: 0.2 };

  it("accumulates a closed decline into the next observation", () => {
    observeSessionEquity(100_000, config);
    observeSessionEquity(85_000, config);
    observeSessionEquity(102_000, config);
    const state = sessionAbsorbingBarrierState()!;
    expect(state.closedEpisodeLossUsd).toBe(15_000);
    expect(state.highWaterMarkUsd).toBe(102_000);
  });

  it("stays tripped on a later observation that on its own looks healthy", () => {
    observeSessionEquity(100_000, config);
    const tripping = observeSessionEquity(75_000, config)!;
    expect(tripping.tripped).toBe(true);
    const later = observeSessionEquity(99_000, config)!;
    expect(later.tripped).toBe(true);
  });

  it("starts from the operator-declared inception equity when one is set", () => {
    process.env[INCEPTION_EQUITY_ENV] = "200000";
    observeSessionEquity(100_000, config);
    expect(sessionAbsorbingBarrierState()!.referenceCapitalUsd).toBe(200_000);
  });

  it("forgets nothing within a process and everything across a reset", () => {
    observeSessionEquity(100_000, config);
    observeSessionEquity(85_000, config);
    resetSessionAbsorbingBarrierForTesting();
    expect(sessionAbsorbingBarrierState()).toBeNull();
    const fresh = observeSessionEquity(85_000, config)!;
    expect(fresh.inception.lossFraction).toBe(0);
  });
});

describe("cash movement is not a trading result", () => {
  const config = { inceptionLossFraction: 0.2 };

  it("a withdrawal leaves the loss fraction untouched", () => {
    observeSessionEquity(100_000, config);
    expect(recordSessionExternalFlow(-40_000)).toBe(true);
    const after = observeSessionEquity(60_000, config)!;
    expect(after.inception.lossFraction).toBe(0);
    expect(after.tripped).toBe(false);
    expect(after.state.referenceCapitalUsd).toBe(60_000);
  });

  it("a deposit does not manufacture headroom out of an existing loss", () => {
    observeSessionEquity(100_000, config);
    observeSessionEquity(85_000, config);
    recordSessionExternalFlow(100_000);
    const after = observeSessionEquity(185_000, config)!;
    expect(after.state.closedEpisodeLossUsd + (after.state.highWaterMarkUsd - 185_000)).toBe(
      15_000,
    );
  });

  it("refuses a flow before any equity has been observed", () => {
    expect(recordSessionExternalFlow(-10_000)).toBe(false);
  });
});

describe("the combined gate blocks whenever either barrier blocks", () => {
  const config = { inceptionLossFraction: 0.2 };

  function combined(equity: number, hwm: number, trailingDd: number): boolean {
    const trailing = distanceToBarriers({
      currentEquity: equity,
      equityHighWaterMark: hwm,
      propFirmTrailingDdUsd: trailingDd,
      baseRiskPerTradeUsd: 1_000,
    });
    const terminal = observeSessionEquity(equity, config);
    return shouldBlockNewTrades(trailing) || (terminal?.tripped ?? false);
  }

  it("keeps blocking where the trailing barrier already blocked", () => {
    const trailing = distanceToBarriers({
      currentEquity: 99_000,
      equityHighWaterMark: 100_000,
      propFirmTrailingDdUsd: 5_000,
      baseRiskPerTradeUsd: 1_000,
    });
    expect(shouldBlockNewTrades(trailing)).toBe(true);
    expect(combined(99_000, 100_000, 5_000)).toBe(true);
  });

  it("blocks where only the inception barrier is breached", () => {
    observeSessionEquity(100_000, config);
    observeSessionEquity(82_000, config);
    observeSessionEquity(101_000, config);
    const trailing = distanceToBarriers({
      currentEquity: 82_820,
      equityHighWaterMark: 101_000,
      propFirmTrailingDdUsd: 30_000,
      baseRiskPerTradeUsd: 1_000,
    });
    expect(shouldBlockNewTrades(trailing)).toBe(false);
    expect(combined(82_820, 101_000, 30_000)).toBe(true);
  });

  it("passes only when neither barrier is breached", () => {
    expect(combined(100_000, 100_000, 30_000)).toBe(false);
  });
});
