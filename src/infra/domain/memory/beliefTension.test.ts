import { describe, it, expect } from "bun:test";

import {
  formatTension,
  netEvidence,
  openTension,
  recordObservation,
  resolution,
  tensionToPayload,
  type Belief,
  type Observation,
} from "./beliefTension.ts";

const belief: Belief = { id: "btc-uptrend", statement: "BTC uptrend intact", heldSince: 1 };

const against = (weight = 1, note?: string): Observation => ({ supports: false, weight, note });
const forObs = (weight = 1, note?: string): Observation => ({ supports: true, weight, note });

describe("openTension", () => {
  it("seeds the against tally from a contradicting observation", () => {
    const t = openTension(belief, against(1));
    expect(t.beliefId).toBe("btc-uptrend");
    expect(t.againstCount).toBe(1);
    expect(t.forCount).toBe(0);
    expect(t.againstWeight).toBe(1);
    expect(t.verdict).toBe("open");
    expect(netEvidence(t)).toBe(-1);
  });

  it("carries the opening timestamp", () => {
    const t = openTension(belief, { supports: false, at: 42 });
    expect(t.openedAt).toBe(42);
  });

  it("resolves immediately to flipped if the opening weight already crosses the bar", () => {
    const t = openTension(belief, against(5), { bar: 3 });
    expect(t.verdict).toBe("flipped");
  });
});

describe("recordObservation — accrual", () => {
  it("flips once contradicting evidence crosses the bar", () => {
    let t = openTension(belief, against(1), { bar: 3 });
    t = recordObservation(t, against(1), { bar: 3 });
    expect(t.verdict).toBe("open");
    t = recordObservation(t, against(1), { bar: 3 });
    expect(t.verdict).toBe("flipped");
    expect(t.againstCount).toBe(3);
    expect(netEvidence(t)).toBe(-3);
  });

  it("reconfirms once supporting evidence overwhelms the initial contradiction", () => {
    let t = openTension(belief, against(1), { bar: 3 });
    // net starts at -1; need forWeight - againstWeight >= 3 => 4 supporting
    for (let i = 0; i < 4; i++) t = recordObservation(t, forObs(1), { bar: 3 });
    expect(t.verdict).toBe("reconfirmed");
    expect(t.forCount).toBe(4);
    expect(netEvidence(t)).toBe(3);
  });

  it("stays open while net evidence is within the bar", () => {
    let t = openTension(belief, against(1), { bar: 5 });
    t = recordObservation(t, forObs(1), { bar: 5 });
    t = recordObservation(t, against(1), { bar: 5 });
    expect(t.verdict).toBe("open");
  });

  it("weights count, not just counts", () => {
    let t = openTension(belief, against(1), { bar: 3 });
    t = recordObservation(t, against(3), { bar: 3 });
    expect(t.verdict).toBe("flipped");
    expect(t.againstCount).toBe(2);
    expect(t.againstWeight).toBe(4);
  });
});

describe("adjustable bar", () => {
  it("a higher bar demands more evidence to flip", () => {
    const low = openTension(belief, against(2), { bar: 2 });
    expect(low.verdict).toBe("flipped");

    let high = openTension(belief, against(2), { bar: 5 });
    expect(high.verdict).toBe("open");
    high = recordObservation(high, against(3), { bar: 5 });
    expect(high.verdict).toBe("flipped");
  });
});

describe("terminal resolution", () => {
  it("ignores further observations once resolved", () => {
    const t = openTension(belief, against(5), { bar: 3 });
    expect(t.verdict).toBe("flipped");
    const obsBefore = t.observations.length;
    const after = recordObservation(t, forObs(10), { bar: 3 });
    expect(after).toBe(t);
    expect(after.observations.length).toBe(obsBefore);
    expect(after.verdict).toBe("flipped");
  });
});

describe("purity", () => {
  it("openTension logs the opening observation", () => {
    const t = openTension(belief, against(1, "lower-high printed"));
    expect(t.observations).toHaveLength(1);
    expect(t.observations[0]!.note).toBe("lower-high printed");
  });

  it("recordObservation does not mutate the prior state", () => {
    const t0 = openTension(belief, against(1), { bar: 3 });
    const t1 = recordObservation(t0, against(1), { bar: 3 });
    expect(t0.againstCount).toBe(1);
    expect(t0.observations).toHaveLength(1);
    expect(t1.againstCount).toBe(2);
    expect(t1.observations).toHaveLength(2);
  });
});

describe("resolution / format / payload", () => {
  it("resolution reflects flip", () => {
    const t = openTension(belief, against(4), { bar: 3 });
    const r = resolution(t);
    expect(r.resolved).toBe(true);
    expect(r.shouldFlip).toBe(true);
    expect(r.shouldReconfirm).toBe(false);
    expect(r.net).toBe(-4);
  });

  it("resolution reflects an open tension", () => {
    const t = openTension(belief, against(1), { bar: 3 });
    const r = resolution(t);
    expect(r.resolved).toBe(false);
    expect(r.verdict).toBe("open");
  });

  it("format includes verdict and net", () => {
    const t = openTension(belief, against(2), { bar: 5 });
    const s = formatTension(t);
    expect(s).toContain("btc-uptrend");
    expect(s).toContain("[open]");
    expect(s).toContain("net -2");
  });

  it("payload emits a stable shape", () => {
    const t = openTension(belief, against(4), { bar: 3 });
    const p = tensionToPayload(t);
    expect(p.kind).toBe("belief_tension.recorded");
    expect(p.verdict).toBe("flipped");
    expect(p.net).toBe(-4);
    expect(p.observationCount).toBe(1);
  });
});
