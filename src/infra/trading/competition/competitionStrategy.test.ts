import { describe, it, expect } from "bun:test";
import {
  makeTsmomSignal,
  competitionSignals,
  COMPETITION_TRADEABLE,
  COMPETITION_LIVE_CONFIG,
  COMPETITION_RISK,
} from "./competitionStrategy.ts";
import type { Mt5Bar } from "../../broker/mt5/bridgeClient.ts";

/** Build M15-ish bars from a close path; high/low straddle the close by ±halfRange. */
function bars(closes: number[], halfRange = 0.5): Mt5Bar[] {
  return closes.map((c, i) => ({
    time: 1_700_000_000 + i * 900,
    open: c,
    high: c + halfRange,
    low: c - halfRange,
    close: c,
    tick_volume: 1,
    spread: 0,
    real_volume: 0,
  })) as unknown as Mt5Bar[];
}

describe("makeTsmomSignal", () => {
  const sig = makeTsmomSignal({ lookback: 20, deadbandAtr: 0.6, stopAtr: 2, targetAtr: 3 });

  it("goes LONG on a sustained uptrend", () => {
    const up = Array.from({ length: 30 }, (_, i) => 100 + i * 2); // strong up move >> deadband
    const s = sig(bars(up));
    expect(s).not.toBeNull();
    expect(s!.side).toBe("long");
    expect(s!.stopDistance).toBeGreaterThan(0);
    expect(s!.targetDistance).toBeGreaterThan(s!.stopDistance); // 3 ATR > 2 ATR
  });

  it("goes SHORT on a sustained downtrend", () => {
    const down = Array.from({ length: 30 }, (_, i) => 200 - i * 2);
    const s = sig(bars(down));
    expect(s).not.toBeNull();
    expect(s!.side).toBe("short");
  });

  it("stands aside in chop (move below the deadband)", () => {
    // flat with tiny wiggle: |move over lookback| ≈ 0, well under deadband·ATR.
    const chop = Array.from({ length: 30 }, (_, i) => 100 + (i % 2 === 0 ? 0.01 : -0.01));
    expect(sig(bars(chop))).toBeNull();
  });

  it("returns null without enough history", () => {
    expect(sig(bars([100, 101, 102]))).toBeNull();
  });

  it("scales the stop with volatility (wider ATR → wider stop)", () => {
    const up = Array.from({ length: 30 }, (_, i) => 100 + i * 2);
    const calm = sig(bars(up, 0.25))!;
    const wild = sig(bars(up, 2.0))!;
    expect(wild.stopDistance).toBeGreaterThan(calm.stopDistance);
  });
});

describe("frozen competition config", () => {
  it("covers exactly the 15 tradeable instruments", () => {
    expect(COMPETITION_TRADEABLE).toHaveLength(15);
    expect(COMPETITION_TRADEABLE).toContain("XAUUSD");
    expect(COMPETITION_TRADEABLE).toContain("BTCUSD");
  });

  it("registers a signal per symbol", () => {
    const sigs = competitionSignals();
    expect(Object.keys(sigs)).toHaveLength(15);
    for (const s of COMPETITION_TRADEABLE) expect(typeof sigs[s]).toBe("function");
  });

  it("is TAKER execution (Cypher is FOK/IOC, no maker) with the survival kill", () => {
    expect(COMPETITION_LIVE_CONFIG.execution).toBe("taker");
    expect(COMPETITION_LIVE_CONFIG.dailyLossKillPct).toBe(COMPETITION_RISK.dailyLossKillPct);
    expect(COMPETITION_RISK.maxLeverage).toBeLessThanOrEqual(3); // far under the 28x red-line
  });
});
