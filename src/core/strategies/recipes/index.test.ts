import { describe, it, expect } from "bun:test";
import { evaluateRecipes, newRecipePipelineState, DEFAULT_REGIME_RSI_SETTINGS } from "./index.ts";

describe("evaluateRecipes (pipeline)", () => {
  it("threads state across calls and runs all four stages", () => {
    let s = newRecipePipelineState();

    // Candle 1: bull regime, deep OS, MA already bullish — fires immediately.
    const r1 = evaluateRecipes({
      state: s,
      regime: "trending_up",
      rsi: 28,
      adx: 20,
      fastMa: 110,
      slowMa: 100,
      price: 105,
      regimeRsiSettings: DEFAULT_REGIME_RSI_SETTINGS,
      bounceCounter: { persistence: 1, requiredBounces: 0 },
      maxExposureCandles: 10,
    });
    expect(r1.trace.regimeRsi.signal).toBe("long");
    expect(r1.trace.signalGate.status).toBe("executed-immediately");
    expect(r1.action).toBe("long");
    s = r1.state;

    // Candle 2: hold (no fresh signal, position open)
    const r2 = evaluateRecipes({
      state: s,
      regime: "trending_up",
      rsi: 50,
      adx: 20,
      fastMa: 110,
      slowMa: 100,
      price: 106,
      regimeRsiSettings: DEFAULT_REGIME_RSI_SETTINGS,
      bounceCounter: { persistence: 1, requiredBounces: 0 },
      maxExposureCandles: 10,
    });
    expect(r2.action).toBe("none");
    expect(r2.state.maxExposure.candlesHeld).toBeGreaterThanOrEqual(1);
  });

  it("delays execution when MA disagrees, fires when it confirms", () => {
    let s = newRecipePipelineState();

    // Candle 1: deep OS but MA is still bearish — gate parks.
    const r1 = evaluateRecipes({
      state: s,
      regime: "trending_up",
      rsi: 28,
      adx: 20,
      fastMa: 95,
      slowMa: 100,
      price: 96,
      regimeRsiSettings: DEFAULT_REGIME_RSI_SETTINGS,
      bounceCounter: { persistence: 1, requiredBounces: 0 },
      maxExposureCandles: 10,
    });
    expect(r1.action).toBe("none");
    expect(r1.trace.signalGate.status).toBe("pending");
    s = r1.state;

    // Candle 2: MA crosses up — pending fires.
    const r2 = evaluateRecipes({
      state: s,
      regime: "trending_up",
      rsi: 50,
      adx: 20,
      fastMa: 102,
      slowMa: 100,
      price: 101,
      regimeRsiSettings: DEFAULT_REGIME_RSI_SETTINGS,
      bounceCounter: { persistence: 1, requiredBounces: 0 },
      maxExposureCandles: 10,
    });
    expect(r2.action).toBe("long");
    expect(r2.trace.signalGate.status).toBe("executed-after-confirmation");
  });

  it("force-exits on max-exposure timeout", () => {
    let s = newRecipePipelineState();
    // Open a long
    s = evaluateRecipes({
      state: s,
      regime: "trending_up",
      rsi: 28,
      adx: 20,
      fastMa: 110,
      slowMa: 100,
      price: 100,
      regimeRsiSettings: DEFAULT_REGIME_RSI_SETTINGS,
      bounceCounter: { persistence: 1, requiredBounces: 0 },
      maxExposureCandles: 2,
    }).state;
    // Hold one candle
    s = evaluateRecipes({
      state: s,
      regime: "trending_up",
      rsi: 50,
      adx: 20,
      fastMa: 110,
      slowMa: 100,
      price: 101,
      regimeRsiSettings: DEFAULT_REGIME_RSI_SETTINGS,
      bounceCounter: { persistence: 1, requiredBounces: 0 },
      maxExposureCandles: 2,
    }).state;
    // Second hold candle → timeout fires
    const r = evaluateRecipes({
      state: s,
      regime: "trending_up",
      rsi: 50,
      adx: 20,
      fastMa: 110,
      slowMa: 100,
      price: 102,
      regimeRsiSettings: DEFAULT_REGIME_RSI_SETTINGS,
      bounceCounter: { persistence: 1, requiredBounces: 0 },
      maxExposureCandles: 2,
    });
    expect(r.forceExit).toBe(true);
    expect(r.action).toBe("short");
  });
});
