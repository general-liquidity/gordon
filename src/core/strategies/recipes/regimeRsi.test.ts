import { describe, it, expect } from "bun:test";
import {
  regimeRsiSignal,
  DEFAULT_REGIME_RSI_SETTINGS,
} from "./regimeRsi.ts";

describe("regimeRsiSignal", () => {
  it("uses bull bands in trending_up regime", () => {
    const r = regimeRsiSignal({
      regime: "trending_up",
      rsi: 80, // above default bull rsiHigh of 75
      adx: 20, // mid range — no modulation
      settings: DEFAULT_REGIME_RSI_SETTINGS,
    });
    expect(r.appliedBucket).toBe("bull");
    expect(r.signal).toBe("short");
    expect(r.effectiveHigh).toBe(75);
  });

  it("uses bear bands in trending_down regime — easier to short rallies", () => {
    const r = regimeRsiSignal({
      regime: "trending_down",
      rsi: 65, // above bear rsiHigh of 60 but below bull rsiHigh of 75
      adx: 20,
      settings: DEFAULT_REGIME_RSI_SETTINGS,
    });
    expect(r.appliedBucket).toBe("bear");
    expect(r.signal).toBe("short");
  });

  it("widens OB threshold when ADX > settings.adx.high", () => {
    const r = regimeRsiSignal({
      regime: "trending_up",
      rsi: 78, // would short under base bull (75) but not after +5 mod
      adx: 35, // above default high of 30
      settings: DEFAULT_REGIME_RSI_SETTINGS,
    });
    expect(r.effectiveHigh).toBe(80);
    expect(r.signal).toBe("none");
  });

  it("lowers OS threshold when ADX < settings.adx.low — don't catch slow bleeds", () => {
    const r = regimeRsiSignal({
      regime: "trending_down",
      rsi: 22, // base bear rsiLow=25 → would long; with -5 mod → 20 → no
      adx: 10, // below default low of 15
      settings: DEFAULT_REGIME_RSI_SETTINGS,
    });
    expect(r.effectiveLow).toBe(20);
    expect(r.signal).toBe("none");
  });

  it("falls back to bull bands when idle bucket is unset", () => {
    const settings = { ...DEFAULT_REGIME_RSI_SETTINGS };
    delete (settings as { idle?: unknown }).idle;
    const r = regimeRsiSignal({
      regime: "ranging",
      rsi: 80,
      adx: 20,
      settings,
    });
    expect(r.appliedBucket).toBe("idle");
    expect(r.effectiveHigh).toBe(settings.bull.rsiHigh);
    expect(r.signal).toBe("short");
  });

  it("returns 'none' when rsi sits inside the band", () => {
    const r = regimeRsiSignal({
      regime: "trending_up",
      rsi: 50,
      adx: 20,
      settings: DEFAULT_REGIME_RSI_SETTINGS,
    });
    expect(r.signal).toBe("none");
  });

  it("maps breakout → bull and volatile → bear", () => {
    const breakout = regimeRsiSignal({
      regime: "breakout",
      rsi: 80,
      adx: 20,
      settings: DEFAULT_REGIME_RSI_SETTINGS,
    });
    expect(breakout.appliedBucket).toBe("bull");

    const volatile = regimeRsiSignal({
      regime: "volatile",
      rsi: 65,
      adx: 20,
      settings: DEFAULT_REGIME_RSI_SETTINGS,
    });
    expect(volatile.appliedBucket).toBe("bear");
  });
});
