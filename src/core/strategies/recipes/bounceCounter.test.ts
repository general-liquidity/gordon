import { describe, it, expect } from "bun:test";
import {
  applyBounceCounter,
  newBounceCounterState,
  type BounceCounterState,
} from "./bounceCounter.ts";

function step(
  state: BounceCounterState,
  rsi: number,
  opts: {
    high?: number;
    low?: number;
    persistence?: number;
    required?: number;
    reset?: number;
  } = {},
) {
  const r = applyBounceCounter({
    state,
    rsi,
    high: opts.high ?? 70,
    low: opts.low ?? 30,
    persistence: opts.persistence ?? 1,
    requiredBounces: opts.required ?? 0,
    resetAfterFlats: opts.reset,
  });
  return r;
}

describe("applyBounceCounter", () => {
  it("does not fire on first entry when requiredBounces > 0", () => {
    let s = newBounceCounterState();
    const r = step(s, 80, { required: 2 });
    expect(r.signal).toBe("none");
    s = r.state;
    expect(s.zone).toBe("high");
    expect(s.bounces).toBe(0);
  });

  it("fires on second OB re-entry when requiredBounces=1", () => {
    let s = newBounceCounterState();
    // Enter OB once
    s = step(s, 80, { required: 1 }).state;
    // Leave OB
    s = step(s, 50, { required: 1 }).state;
    expect(s.willBounce).toBe(true);
    // Re-enter — bounce counted, condition met
    const r = step(s, 80, { required: 1 });
    expect(r.state.bounces).toBe(1);
    expect(r.signal).toBe("short");
  });

  it("symmetrically fires long after re-entries to OS", () => {
    let s = newBounceCounterState();
    s = step(s, 20, { required: 1 }).state;
    s = step(s, 50, { required: 1 }).state;
    const r = step(s, 20, { required: 1 });
    expect(r.signal).toBe("long");
  });

  it("only fires once per zone — stays silent until next zone change", () => {
    let s = newBounceCounterState();
    s = step(s, 80, { required: 0 }).state;
    const first = step(s, 81, { required: 0 });
    expect(first.signal).toBe("none"); // already fired on entry candle? required=0 → fires immediately
    // With required=0 the first call already fires (bounces=0 ≥ 0).
  });

  it("does not re-fire on continued candles in the same zone", () => {
    let s = newBounceCounterState();
    let r = step(s, 80, { required: 0 });
    expect(r.signal).toBe("short");
    s = r.state;
    r = step(s, 81, { required: 0 });
    expect(r.signal).toBe("none");
    expect(r.state.duration).toBe(2);
  });

  it("resets bounces after resetAfterFlats neutral candles", () => {
    let s = newBounceCounterState();
    // Bounce to 1
    s = step(s, 80, { required: 5, reset: 3 }).state;
    s = step(s, 50, { required: 5, reset: 3 }).state;
    s = step(s, 80, { required: 5, reset: 3 }).state;
    expect(s.bounces).toBe(1);
    // 3 neutral candles → reset
    s = step(s, 50, { required: 5, reset: 3 }).state;
    s = step(s, 50, { required: 5, reset: 3 }).state;
    s = step(s, 50, { required: 5, reset: 3 }).state;
    expect(s.bounces).toBe(0);
    expect(s.flats).toBe(0);
  });

  it("requires both persistence and bounces to fire", () => {
    let s = newBounceCounterState();
    // Build up 1 bounce
    s = step(s, 80, { required: 1, persistence: 3 }).state;
    s = step(s, 50, { required: 1, persistence: 3 }).state;
    let r = step(s, 80, { required: 1, persistence: 3 });
    // Bounce satisfied (1 ≥ 1) but persistence is 1 of 3 → no fire
    expect(r.signal).toBe("none");
    s = r.state;
    s = step(s, 81, { required: 1, persistence: 3 }).state;
    r = step(s, 82, { required: 1, persistence: 3 });
    // Now duration = 3, bounces = 1 → fires
    expect(r.signal).toBe("short");
  });
});
