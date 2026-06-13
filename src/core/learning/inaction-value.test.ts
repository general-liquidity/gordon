import { describe, expect, it } from "bun:test";
import type { Candle } from "../../types/index.ts";
import {
  scoreDeclinedDecision,
  aggregateInactionValue,
  type DeclinedDecision,
  type InactionOutcome,
} from "./inaction-value.ts";

function c(openTime: number, low: number, high: number, close = (low + high) / 2): Candle {
  return { openTime, open: close, high, low, close, volume: 1, closeTime: openTime + 1 };
}

const LONG: DeclinedDecision = { id: "d1", symbol: "BTCUSDT", side: "long", entry: 100, stop: 95, target: 110, decidedAt: 0 };

describe("scoreDeclinedDecision", () => {
  it("credits a veto that dodged a loss (would have hit stop → +1R veto value)", () => {
    const o = scoreDeclinedDecision(LONG, [c(1, 99, 101), c(2, 94, 98)])!;
    expect(o.wouldHave).toBe("hit_stop");
    expect(o.wouldHaveR).toBeCloseTo(-1, 9);
    expect(o.vetoValueR).toBeCloseTo(1, 9);
    expect(o.vetoCorrect).toBe(true);
    expect(o.candlesToResolve).toBe(2);
  });

  it("charges a veto that missed a gain (would have hit target → −2R veto value)", () => {
    const o = scoreDeclinedDecision(LONG, [c(1, 99, 101), c(2, 108, 112)])!;
    expect(o.wouldHave).toBe("hit_target");
    expect(o.wouldHaveR).toBeCloseTo(2, 9);
    expect(o.vetoValueR).toBeCloseTo(-2, 9);
    expect(o.vetoCorrect).toBe(false);
  });

  it("resolves a candle that touches both bracket sides conservatively to the stop", () => {
    const o = scoreDeclinedDecision(LONG, [c(1, 94, 112)])!;
    expect(o.wouldHave).toBe("hit_stop"); // never flatter the veto
  });

  it("marks an unresolved bracket as open and marks-to-close", () => {
    const o = scoreDeclinedDecision(LONG, [c(1, 99, 101), c(2, 100, 102, 101)])!;
    expect(o.wouldHave).toBe("open");
    expect(o.wouldHaveR).toBeCloseTo((101 - 100) / 5, 9);
  });

  it("handles the short side (stop is above entry)", () => {
    const short: DeclinedDecision = { id: "s1", symbol: "ETHUSDT", side: "short", entry: 100, stop: 105, target: 90, decidedAt: 0 };
    const o = scoreDeclinedDecision(short, [c(1, 99, 106)])!;
    expect(o.wouldHave).toBe("hit_stop");
    expect(o.vetoValueR).toBeCloseTo(1, 9); // avoided a 1R loss
    expect(o.vetoCorrect).toBe(true);
  });

  it("only judges candles at/after the decision moment", () => {
    const decision = { ...LONG, decidedAt: 50 };
    const o = scoreDeclinedDecision(decision, [c(10, 94, 98), c(60, 94, 98)])!;
    expect(o.wouldHave).toBe("hit_stop");
    expect(o.candlesToResolve).toBe(1); // the pre-decision candle is ignored
  });

  it("returns null for a degenerate bracket or no forward data", () => {
    expect(scoreDeclinedDecision({ ...LONG, stop: 100 }, [c(1, 90, 110)])).toBeNull();
    expect(scoreDeclinedDecision(LONG, [])).toBeNull();
    expect(scoreDeclinedDecision({ ...LONG, decidedAt: 999 }, [c(1, 94, 98)])).toBeNull();
  });
});

describe("aggregateInactionValue", () => {
  const mk = (vetoValueR: number): InactionOutcome => ({
    decision: LONG,
    wouldHave: vetoValueR > 0 ? "hit_stop" : "hit_target",
    wouldHaveR: -vetoValueR,
    vetoValueR,
    vetoCorrect: vetoValueR > 0,
    candlesToResolve: 1,
  });

  it("rolls up veto precision, avoided loss, missed gain, and net inaction value", () => {
    const r = aggregateInactionValue(4, [mk(1), mk(1), mk(-2)]);
    expect(r.correctVetoes).toBe(2);
    expect(r.wrongVetoes).toBe(1);
    expect(r.vetoPrecision).toBeCloseTo(2 / 3, 9);
    expect(r.avoidedLossR).toBeCloseTo(2, 9);
    expect(r.missedGainR).toBeCloseTo(2, 9);
    expect(r.netInactionValueR).toBeCloseTo(0, 9);
    expect(r.scored).toBe(3);
    expect(r.summary).toContain("veto precision 67%");
  });

  it("handles the empty case without dividing by zero", () => {
    const r = aggregateInactionValue(0, []);
    expect(r.vetoPrecision).toBe(0);
    expect(r.valuePerDecisionR).toBe(0);
    expect(r.summary).toContain("none scoreable");
  });
});
