import { describe, it, expect } from "bun:test";

import {
  params,
  normalizeDials,
  neutralTemperament,
  maxAggressionDials,
  paramsToPayload,
  TEMPERAMENT_CAPS,
  type TemperamentDials,
} from "./temperament.ts";

describe("normalizeDials", () => {
  it("clamps out-of-range dials into [0,1]", () => {
    const n = normalizeDials({ boldness: 5, skepticism: -3, patience: 0.7 });
    expect(n.boldness).toBe(1);
    expect(n.skepticism).toBe(0);
    expect(n.patience).toBeCloseTo(0.7);
  });

  it("defaults missing dials to neutral 0.5", () => {
    const n = normalizeDials({});
    expect(n).toEqual(neutralTemperament());
  });

  it("maps NaN to neutral 0.5", () => {
    const n = normalizeDials({ curiosity: Number.NaN });
    expect(n.curiosity).toBe(0.5);
  });
});

describe("params — determinism", () => {
  it("is a pure function of its inputs", () => {
    const dials: TemperamentDials = {
      boldness: 0.3,
      skepticism: 0.8,
      patience: 0.6,
      greed_fear: 0.4,
      curiosity: 0.9,
      bluntness: 0.5,
    };
    expect(params(dials)).toEqual(params(dials));
  });

  it("neutral temperament lands inside every guard band", () => {
    const p = params(neutralTemperament());
    expect(p.conviction).toBeGreaterThanOrEqual(TEMPERAMENT_CAPS.convictionFloor);
    expect(p.sizeAggression).toBeLessThanOrEqual(TEMPERAMENT_CAPS.sizeAggressionCeil);
    expect(p.confirmations).toBeGreaterThanOrEqual(TEMPERAMENT_CAPS.confirmationsFloor);
  });
});

describe("params — directional response", () => {
  it("higher skepticism raises conviction + confirmations", () => {
    const skeptic = params({ skepticism: 1, boldness: 0 });
    const bold = params({ skepticism: 0, boldness: 1 });
    expect(skeptic.conviction).toBeGreaterThan(bold.conviction);
    expect(skeptic.confirmations).toBeGreaterThanOrEqual(bold.confirmations);
  });

  it("higher curiosity widens discovery breadth", () => {
    const curious = params({ curiosity: 1 });
    const narrow = params({ curiosity: 0 });
    expect(curious.discoveryBreadth).toBeGreaterThan(narrow.discoveryBreadth);
  });

  it("higher patience lengthens prune-after-idle and lifts target R", () => {
    const patient = params({ patience: 1, greed_fear: 1 });
    const impatient = params({ patience: 0, greed_fear: 0 });
    expect(patient.pruneAfterIdle).toBeGreaterThan(impatient.pruneAfterIdle);
    expect(patient.targetR).toBeGreaterThan(impatient.targetR);
  });
});

describe("BOUNDED cap invariant — dials can NEVER loosen a guard past its hard cap", () => {
  it("the most-aggressive temperament still respects every guard cap", () => {
    const p = params(maxAggressionDials());
    // Conviction floored: cannot be relaxed below the floor.
    expect(p.conviction).toBeGreaterThanOrEqual(TEMPERAMENT_CAPS.convictionFloor);
    // Size ceilinged: cannot exceed the aggression ceiling.
    expect(p.sizeAggression).toBeLessThanOrEqual(TEMPERAMENT_CAPS.sizeAggressionCeil);
    // Confirmations floored: at least the minimum.
    expect(p.confirmations).toBeGreaterThanOrEqual(TEMPERAMENT_CAPS.confirmationsFloor);
  });

  it("out-of-band dial spam (all 999) cannot escape the caps", () => {
    const p = params({
      boldness: 999,
      skepticism: -999,
      patience: 999,
      greed_fear: 999,
      curiosity: 999,
      bluntness: 999,
    } as TemperamentDials);
    expect(p.conviction).toBeGreaterThanOrEqual(TEMPERAMENT_CAPS.convictionFloor);
    expect(p.sizeAggression).toBeLessThanOrEqual(TEMPERAMENT_CAPS.sizeAggressionCeil);
    expect(p.confirmations).toBeGreaterThanOrEqual(TEMPERAMENT_CAPS.confirmationsFloor);
  });

  it("every guard param stays within its full band across a dial sweep", () => {
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const p = params({
        boldness: t,
        skepticism: 1 - t,
        patience: t,
        greed_fear: t,
        curiosity: t,
        bluntness: t,
      });
      expect(p.conviction).toBeGreaterThanOrEqual(TEMPERAMENT_CAPS.convictionFloor);
      expect(p.conviction).toBeLessThanOrEqual(TEMPERAMENT_CAPS.convictionCeil);
      expect(p.sizeAggression).toBeGreaterThanOrEqual(TEMPERAMENT_CAPS.sizeAggressionFloor);
      expect(p.sizeAggression).toBeLessThanOrEqual(TEMPERAMENT_CAPS.sizeAggressionCeil);
      expect(p.confirmations).toBeGreaterThanOrEqual(TEMPERAMENT_CAPS.confirmationsFloor);
      expect(p.confirmations).toBeLessThanOrEqual(TEMPERAMENT_CAPS.confirmationsCeil);
    }
  });
});

describe("paramsToPayload", () => {
  it("emits a structured observation payload", () => {
    const payload = paramsToPayload(params(neutralTemperament()));
    expect(payload.kind).toBe("temperament.params_recorded");
    expect(typeof payload.conviction).toBe("number");
  });
});
