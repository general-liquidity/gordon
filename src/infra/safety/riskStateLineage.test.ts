import { describe, it, expect } from "bun:test";

import { RiskStateLineage, type RiskDimension, type RiskState } from "./riskStateLineage.ts";

const DIMS: RiskDimension[] = [
  { name: "maxPositionPct", saferDirection: "lower" },
  { name: "maxLeverage", saferDirection: "lower" },
  { name: "minStopDistancePct", saferDirection: "higher" },
];

// Floor = the riskiest values ever allowed.
const FLOOR: RiskState = { maxPositionPct: 25, maxLeverage: 5, minStopDistancePct: 0.5 };
const INITIAL: RiskState = { maxPositionPct: 10, maxLeverage: 2, minStopDistancePct: 1.5 };

function fresh(): RiskStateLineage {
  return new RiskStateLineage(DIMS, INITIAL, FLOOR);
}

describe("construction", () => {
  it("seeds the initial state as effective and seen", () => {
    const l = fresh();
    expect(l.effective()).toEqual(INITIAL);
    expect(l.hasSeen(INITIAL)).toBe(true);
    expect(l.depth()).toBe(0);
  });

  it("rejects an initial state that breaches the floor", () => {
    expect(
      () =>
        new RiskStateLineage(
          DIMS,
          { maxPositionPct: 50, maxLeverage: 2, minStopDistancePct: 1.5 },
          FLOOR,
        ),
    ).toThrow();
  });
});

describe("tightening auto-applies", () => {
  it("applies a change that is safer on every dimension", () => {
    const l = fresh();
    const res = l.propose({ maxPositionPct: 8, maxLeverage: 1, minStopDistancePct: 2 });
    expect(res.verdict).toBe("applied");
    expect(res.changeClass).toBe("tightening");
    expect(l.effective().maxPositionPct).toBe(8);
    expect(l.depth()).toBe(1);
  });
});

describe("loosening into never-held territory stages pending_approval", () => {
  it("does not take effect until approved", () => {
    const l = fresh();
    const res = l.propose({ maxPositionPct: 15, maxLeverage: 2, minStopDistancePct: 1.5 });
    expect(res.verdict).toBe("staged");
    expect(res.loosenedDims).toContain("maxPositionPct");
    // Effective is unchanged while staged.
    expect(l.effective()).toEqual(INITIAL);
    expect(l.pendingState()?.maxPositionPct).toBe(15);

    const approved = l.approve();
    expect(approved.verdict).toBe("applied");
    expect(l.effective().maxPositionPct).toBe(15);
    expect(l.pendingState()).toBeNull();
  });

  it("rejectPending discards without applying", () => {
    const l = fresh();
    l.propose({ maxPositionPct: 15, maxLeverage: 2, minStopDistancePct: 1.5 });
    l.rejectPending();
    expect(l.pendingState()).toBeNull();
    expect(l.effective()).toEqual(INITIAL);
  });
});

describe("revisiting a previously-held set auto-applies", () => {
  it("a loosening back to a seen state does not need approval", () => {
    const l = fresh();
    // Tighten to a new state (now held + seen).
    l.propose({ maxPositionPct: 5, maxLeverage: 1, minStopDistancePct: 3 });
    expect(l.effective().maxPositionPct).toBe(5);
    // Loosening back to INITIAL is a revisit -> auto-apply.
    const res = l.propose(INITIAL);
    expect(res.verdict).toBe("applied");
    expect(res.reason).toContain("previously-held");
    expect(l.effective()).toEqual(INITIAL);
  });
});

describe("undo restores the prior applied state", () => {
  it("pops the versioned stack", () => {
    const l = fresh();
    l.propose({ maxPositionPct: 8, maxLeverage: 1, minStopDistancePct: 2 });
    expect(l.effective().maxPositionPct).toBe(8);
    const restored = l.undo();
    expect(restored).toEqual(INITIAL);
    expect(l.effective()).toEqual(INITIAL);
    expect(l.undo()).toBeNull();
  });
});

describe("ADDITIVE floor invariant — never drops below the safety floor", () => {
  it("rejects a proposal riskier than the floor outright, preserving current", () => {
    const l = fresh();
    const res = l.propose({ maxPositionPct: 40, maxLeverage: 2, minStopDistancePct: 1.5 });
    expect(res.verdict).toBe("rejected");
    expect(res.changeClass).toBe("floor_breach");
    expect(res.floorBreachDims).toContain("maxPositionPct");
    // Current state untouched — additive guard preserved.
    expect(l.effective()).toEqual(INITIAL);
  });

  it("rejects a floor breach on the higher-is-safer dimension too", () => {
    const l = fresh();
    const res = l.propose({ maxPositionPct: 10, maxLeverage: 2, minStopDistancePct: 0.1 });
    expect(res.verdict).toBe("rejected");
    expect(res.floorBreachDims).toContain("minStopDistancePct");
    expect(l.effective()).toEqual(INITIAL);
  });

  it("a state exactly at the floor is allowed (not past it)", () => {
    const l = fresh();
    const res = l.propose({ ...FLOOR });
    expect(res.verdict).not.toBe("rejected");
    expect(l.breachesFloor({ ...FLOOR })).toEqual([]);
  });

  it("never stages a floor-breaching change, so approval cannot breach it", () => {
    const l = fresh();
    l.propose({ maxPositionPct: 40, maxLeverage: 2, minStopDistancePct: 1.5 });
    // The rejected proposal was never staged.
    expect(l.pendingState()).toBeNull();
    const approved = l.approve();
    expect(approved.verdict).toBe("noop");
    expect(l.effective()).toEqual(INITIAL);
  });
});

describe("no-op detection", () => {
  it("returns noop when the proposal equals the current state", () => {
    const l = fresh();
    const res = l.propose({ ...INITIAL });
    expect(res.verdict).toBe("noop");
    expect(res.changeClass).toBe("unchanged");
  });
});
