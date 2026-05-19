import { describe, it, expect } from "bun:test";

import {
  isCrossVenueDivergenceEnabled,
  detectCrossVenueDivergence,
  divergenceToPayload,
  CROSS_VENUE_DIVERGENCE_FLAG_ENV,
} from "./crossVenueDivergence.ts";

describe("isCrossVenueDivergenceEnabled", () => {
  it("respects the flag", () => {
    expect(isCrossVenueDivergenceEnabled({})).toBe(false);
    expect(isCrossVenueDivergenceEnabled({ [CROSS_VENUE_DIVERGENCE_FLAG_ENV]: "1" })).toBe(true);
  });
});

describe("detectCrossVenueDivergence — aligned venues → no alert", () => {
  it("two venues with identical mids → no alert", () => {
    const mids = [100, 100.1, 100.05, 100.2, 100.15];
    const r = detectCrossVenueDivergence({
      venues: [
        { venue: "binance", mids },
        { venue: "coinbase", mids },
      ],
    });
    expect(r.anyAlert).toBe(false);
    expect(r.maxObservedDivergence).toBeLessThan(0.001);
  });
});

describe("detectCrossVenueDivergence — persistent divergence triggers alert", () => {
  it("venue A drifts away from venue B by >20bps for >3 bars → alert", () => {
    const a = [100, 100.5, 101, 101.5, 102, 102.5];
    const b = [100, 100, 100, 100, 100, 100];
    const r = detectCrossVenueDivergence({
      venues: [
        { venue: "venue_a", mids: a },
        { venue: "venue_b", mids: b },
      ],
      divergenceThreshold: 0.002,
      persistenceBars: 3,
    });
    expect(r.anyAlert).toBe(true);
    expect(r.pairs[0]!.persistentBars).toBeGreaterThanOrEqual(3);
  });

  it("brief divergence below persistence threshold → no alert", () => {
    const a = [100, 100, 100.5, 100, 100, 100];
    const b = [100, 100, 100, 100, 100, 100];
    const r = detectCrossVenueDivergence({
      venues: [
        { venue: "a", mids: a },
        { venue: "b", mids: b },
      ],
    });
    expect(r.anyAlert).toBe(false);
  });
});

describe("detectCrossVenueDivergence — quote-vs-execution flip", () => {
  it("venue A noisy / no executions, venue B quiet / lots executions → flagged", () => {
    const mids = [100, 100, 100, 100, 100];
    const r = detectCrossVenueDivergence({
      venues: [
        {
          venue: "noisy",
          mids,
          quoteIntensity: [1000, 1000, 1000, 1000, 1000],
          executedVolume: [1, 1, 1, 1, 1],
        },
        {
          venue: "executor",
          mids,
          quoteIntensity: [100, 100, 100, 100, 100],
          executedVolume: [500, 500, 500, 500, 500],
        },
      ],
    });
    expect(r.anyAlert).toBe(true);
    expect(r.pairs[0]!.quoteExecutionFlip).toBe(true);
  });
});

describe("detectCrossVenueDivergence — boundary cases", () => {
  it("single venue → no alert", () => {
    const r = detectCrossVenueDivergence({ venues: [{ venue: "x", mids: [100, 100] }] });
    expect(r.anyAlert).toBe(false);
    expect(r.reason).toContain("fewer than 2");
  });

  it("respects custom divergence threshold", () => {
    const a = [100, 100.05, 100.05, 100.05, 100.05];
    const b = [100, 100, 100, 100, 100];
    const tight = detectCrossVenueDivergence({
      venues: [
        { venue: "a", mids: a },
        { venue: "b", mids: b },
      ],
      divergenceThreshold: 0.0001,
    });
    const lax = detectCrossVenueDivergence({
      venues: [
        { venue: "a", mids: a },
        { venue: "b", mids: b },
      ],
      divergenceThreshold: 0.01,
    });
    expect(tight.anyAlert).toBe(true);
    expect(lax.anyAlert).toBe(false);
  });
});

describe("detectCrossVenueDivergence — multi-venue", () => {
  it("3 venues → 3 pairs evaluated", () => {
    const mids = [100, 100.1, 100.2];
    const r = detectCrossVenueDivergence({
      venues: [
        { venue: "a", mids },
        { venue: "b", mids },
        { venue: "c", mids },
      ],
    });
    expect(r.pairs.length).toBe(3);
  });
});

describe("divergenceToPayload", () => {
  it("emits stable shape", () => {
    const r = detectCrossVenueDivergence({
      venues: [
        { venue: "a", mids: [100, 100, 100] },
        { venue: "b", mids: [100, 100.5, 101] },
      ],
    });
    const p = divergenceToPayload(r) as { kind: string; anyAlert: boolean };
    expect(p.kind).toBe("cross_venue_divergence.evaluated");
    expect(typeof p.anyAlert).toBe("boolean");
  });
});
