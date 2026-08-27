import { describe, expect, it } from "bun:test";
import {
  buildRejectedCandidate,
  elapsedDays,
  reviewRegret,
  scoreCandidateAtHorizon,
  summarizeByGate,
  type HorizonObservation,
  type RejectedCandidate,
} from "./regretLedger.ts";

function longCandidate(overrides: Partial<RejectedCandidate> = {}): RejectedCandidate {
  return buildRejectedCandidate({
    id: overrides.id ?? "c1",
    symbol: overrides.symbol ?? "BTCUSDT",
    side: "long",
    rejectedAt: overrides.rejectedAt ?? "2026-01-01T00:00:00.000Z",
    reason: overrides.reason ?? "low conviction",
    gate: overrides.gate ?? "convictionGate",
    bracket: overrides.bracket ?? { entry: 100, stop: 90, target: 120 },
  });
}

describe("buildRejectedCandidate", () => {
  it("accepts a coherent long bracket", () => {
    expect(() => longCandidate()).not.toThrow();
  });

  it("accepts a coherent short bracket", () => {
    expect(() =>
      buildRejectedCandidate({
        id: "s1",
        symbol: "ETHUSDT",
        side: "short",
        rejectedAt: "2026-01-01T00:00:00.000Z",
        reason: "extended",
        gate: "extensionGate",
        bracket: { entry: 100, stop: 110, target: 80 },
      }),
    ).not.toThrow();
  });

  it("rejects an incoherent long bracket (stop above entry)", () => {
    expect(() =>
      buildRejectedCandidate({
        id: "bad",
        symbol: "BTCUSDT",
        side: "long",
        rejectedAt: "2026-01-01T00:00:00.000Z",
        reason: "x",
        gate: "g",
        bracket: { entry: 100, stop: 110, target: 120 },
      }),
    ).toThrow(/Incoherent long bracket/);
  });

  it("rejects an incoherent short bracket", () => {
    expect(() =>
      buildRejectedCandidate({
        id: "bad2",
        symbol: "BTCUSDT",
        side: "short",
        rejectedAt: "2026-01-01T00:00:00.000Z",
        reason: "x",
        gate: "g",
        bracket: { entry: 100, stop: 90, target: 120 },
      }),
    ).toThrow(/Incoherent short bracket/);
  });
});

describe("elapsedDays", () => {
  it("computes whole day deltas", () => {
    expect(elapsedDays("2026-01-01T00:00:00.000Z", "2026-01-06T00:00:00.000Z")).toBe(5);
  });
  it("is negative when asOf precedes rejection", () => {
    expect(elapsedDays("2026-01-06T00:00:00.000Z", "2026-01-01T00:00:00.000Z")).toBe(-5);
  });
});

describe("scoreCandidateAtHorizon — long", () => {
  const c = longCandidate(); // entry 100, stop 90 (R=10), target 120 (reward 20 = 2R)

  it("cost a gain when target hit and no stop (positive regret)", () => {
    const obs: HorizonObservation = {
      candidateId: "c1",
      horizonDays: 5,
      high: 125,
      low: 98,
      close: 122,
    };
    const e = scoreCandidateAtHorizon(c, obs);
    expect(e.outcome).toBe("would_have_won");
    expect(e.regretR).toBe(2); // reward 20 / risk 10
    expect(e.costGain).toBe(true);
    expect(e.savedLoss).toBe(false);
  });

  it("saved a loss when stop hit and no target (negative regret)", () => {
    const obs: HorizonObservation = {
      candidateId: "c1",
      horizonDays: 5,
      high: 105,
      low: 88,
      close: 92,
    };
    const e = scoreCandidateAtHorizon(c, obs);
    expect(e.outcome).toBe("would_have_lost");
    expect(e.regretR).toBe(-1);
    expect(e.savedLoss).toBe(true);
    expect(e.costGain).toBe(false);
  });

  it("marks-to-market when neither level hit (open)", () => {
    const obs: HorizonObservation = {
      candidateId: "c1",
      horizonDays: 5,
      high: 108,
      low: 95,
      close: 105,
    };
    const e = scoreCandidateAtHorizon(c, obs);
    expect(e.outcome).toBe("open");
    expect(e.regretR).toBeCloseTo(0.5, 10); // (105-100)/10
  });

  it("resolves ambiguous (both touched) by close", () => {
    const obs: HorizonObservation = {
      candidateId: "c1",
      horizonDays: 5,
      high: 121,
      low: 89,
      close: 95,
    };
    const e = scoreCandidateAtHorizon(c, obs);
    expect(e.outcome).toBe("ambiguous");
    expect(e.regretR).toBeCloseTo(-0.5, 10); // (95-100)/10
    expect(e.savedLoss).toBe(true);
  });
});

describe("scoreCandidateAtHorizon — short", () => {
  const c = buildRejectedCandidate({
    id: "s1",
    symbol: "ETHUSDT",
    side: "short",
    rejectedAt: "2026-01-01T00:00:00.000Z",
    reason: "extended",
    gate: "extensionGate",
    bracket: { entry: 100, stop: 110, target: 80 }, // R=10, reward 20 = 2R
  });

  it("cost a gain when target (down) hit and no stop", () => {
    const obs: HorizonObservation = {
      candidateId: "s1",
      horizonDays: 20,
      high: 104,
      low: 78,
      close: 82,
    };
    const e = scoreCandidateAtHorizon(c, obs);
    expect(e.outcome).toBe("would_have_won");
    expect(e.regretR).toBe(2);
    expect(e.costGain).toBe(true);
  });

  it("saved a loss when stop (up) hit and no target", () => {
    const obs: HorizonObservation = {
      candidateId: "s1",
      horizonDays: 20,
      high: 112,
      low: 96,
      close: 108,
    };
    const e = scoreCandidateAtHorizon(c, obs);
    expect(e.outcome).toBe("would_have_lost");
    expect(e.regretR).toBe(-1);
    expect(e.savedLoss).toBe(true);
  });

  it("open marks-to-market: short profits when price falls", () => {
    const obs: HorizonObservation = {
      candidateId: "s1",
      horizonDays: 20,
      high: 105,
      low: 94,
      close: 96,
    };
    const e = scoreCandidateAtHorizon(c, obs);
    expect(e.outcome).toBe("open");
    expect(e.regretR).toBeCloseTo(0.4, 10); // (100-96)/10
  });
});

describe("reviewRegret", () => {
  it("only scores horizons that have elapsed AND have an observation", () => {
    const c = longCandidate({ rejectedAt: "2026-01-01T00:00:00.000Z" });
    const observations: HorizonObservation[] = [
      { candidateId: "c1", horizonDays: 5, high: 125, low: 98, close: 122 },
      { candidateId: "c1", horizonDays: 20, high: 130, low: 98, close: 128 },
    ];
    // Only 5 days elapsed → T+20 deferred even though its observation exists.
    const review = reviewRegret({
      asOf: "2026-01-06T00:00:00.000Z",
      candidates: [c],
      observations,
    });
    expect(review.entries).toHaveLength(1);
    expect(review.entries[0]!.horizonDays).toBe(5);
  });

  it("defers a horizon that elapsed but has no injected observation", () => {
    const c = longCandidate();
    const review = reviewRegret({
      asOf: "2026-02-01T00:00:00.000Z",
      candidates: [c],
      observations: [{ candidateId: "c1", horizonDays: 20, high: 130, low: 98, close: 128 }],
    });
    // T+5 elapsed but no obs; T+20 elapsed and has obs.
    expect(review.entries.map((e) => e.horizonDays)).toEqual([20]);
  });

  it("scores both horizons once elapsed", () => {
    const c = longCandidate();
    const review = reviewRegret({
      asOf: "2026-03-01T00:00:00.000Z",
      candidates: [c],
      observations: [
        { candidateId: "c1", horizonDays: 5, high: 125, low: 98, close: 122 },
        { candidateId: "c1", horizonDays: 20, high: 130, low: 98, close: 128 },
      ],
    });
    expect(review.entries).toHaveLength(2);
  });
});

describe("summarizeByGate", () => {
  it("flags a gate that repeatedly costs gains as loosen", () => {
    const c = longCandidate();
    const entries = [];
    for (let i = 0; i < 6; i++) {
      entries.push(
        scoreCandidateAtHorizon(c, {
          candidateId: "c1",
          horizonDays: 5,
          high: 125,
          low: 98,
          close: 122,
        }),
      );
    }
    const [summary] = summarizeByGate(entries);
    expect(summary!.gate).toBe("convictionGate");
    expect(summary!.costCount).toBe(6);
    expect(summary!.savedCount).toBe(0);
    expect(summary!.netRegretR).toBe(12);
    expect(summary!.amendmentSignal).toBe("loosen");
  });

  it("keeps a gate that saves losses", () => {
    const c = longCandidate();
    const entries = [];
    for (let i = 0; i < 6; i++) {
      entries.push(
        scoreCandidateAtHorizon(c, {
          candidateId: "c1",
          horizonDays: 5,
          high: 105,
          low: 88,
          close: 92,
        }),
      );
    }
    const [summary] = summarizeByGate(entries);
    expect(summary!.savedCount).toBe(6);
    expect(summary!.netRegretR).toBe(-6);
    expect(summary!.amendmentSignal).toBe("keep");
  });

  it("returns insufficient_data below the minimum sample", () => {
    const c = longCandidate();
    const entries = [
      scoreCandidateAtHorizon(c, {
        candidateId: "c1",
        horizonDays: 5,
        high: 125,
        low: 98,
        close: 122,
      }),
    ];
    const [summary] = summarizeByGate(entries);
    expect(summary!.amendmentSignal).toBe("insufficient_data");
  });
});
