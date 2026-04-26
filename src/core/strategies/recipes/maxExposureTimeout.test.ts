import { describe, it, expect } from "bun:test";
import { applyMaxExposure, newMaxExposureState } from "./maxExposureTimeout.ts";

describe("applyMaxExposure", () => {
  it("enters on a long signal when flat", () => {
    const r = applyMaxExposure({
      state: newMaxExposureState(),
      externalSignal: "long",
      currentPrice: 100,
      maxCandles: 10,
    });
    expect(r.action).toBe("long");
    expect(r.forceExit).toBe(false);
    expect(r.state.side).toBe("long");
    expect(r.state.entryPrice).toBe(100);
    expect(r.state.candlesHeld).toBe(0);
  });

  it("holds open position with no signal", () => {
    let s = applyMaxExposure({
      state: newMaxExposureState(),
      externalSignal: "long",
      currentPrice: 100,
      maxCandles: 5,
    }).state;
    const r = applyMaxExposure({
      state: s,
      externalSignal: "none",
      currentPrice: 101,
      maxCandles: 5,
    });
    expect(r.action).toBe("none");
    expect(r.forceExit).toBe(false);
    expect(r.state.candlesHeld).toBe(1);
  });

  it("force-exits after maxCandles regardless of P&L", () => {
    let s = applyMaxExposure({
      state: newMaxExposureState(),
      externalSignal: "long",
      currentPrice: 100,
      maxCandles: 3,
    }).state;
    s = applyMaxExposure({ state: s, externalSignal: "none", currentPrice: 101, maxCandles: 3 }).state;
    s = applyMaxExposure({ state: s, externalSignal: "none", currentPrice: 102, maxCandles: 3 }).state;
    const r = applyMaxExposure({ state: s, externalSignal: "none", currentPrice: 103, maxCandles: 3 });
    expect(r.forceExit).toBe(true);
    expect(r.action).toBe("short"); // exit long → short side
    expect(r.state.side).toBe("none");
    expect(r.reason).toContain("timeout");
  });

  it("honours opposing external signal as a natural exit", () => {
    let s = applyMaxExposure({
      state: newMaxExposureState(),
      externalSignal: "long",
      currentPrice: 100,
      maxCandles: 10,
    }).state;
    s = applyMaxExposure({ state: s, externalSignal: "none", currentPrice: 101, maxCandles: 10 }).state;
    const r = applyMaxExposure({
      state: s,
      externalSignal: "short",
      currentPrice: 99,
      maxCandles: 10,
    });
    expect(r.forceExit).toBe(false);
    expect(r.action).toBe("short");
    expect(r.state.side).toBe("none");
  });

  it("symmetrically force-exits a short position", () => {
    let s = applyMaxExposure({
      state: newMaxExposureState(),
      externalSignal: "short",
      currentPrice: 100,
      maxCandles: 2,
    }).state;
    s = applyMaxExposure({ state: s, externalSignal: "none", currentPrice: 99, maxCandles: 2 }).state;
    const r = applyMaxExposure({ state: s, externalSignal: "none", currentPrice: 98, maxCandles: 2 });
    expect(r.forceExit).toBe(true);
    expect(r.action).toBe("long"); // exit short → long side
    expect(r.state.side).toBe("none");
  });
});
