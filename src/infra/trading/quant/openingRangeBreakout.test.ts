import { describe, it, expect } from "bun:test";
import {
  evaluateORBSetup,
  simulateORBTrade,
  openingRangeBreakoutToPayload,
  type OHLCBar,
} from "./openingRangeBreakout.ts";

const goodEligibility = {
  dailyATR: 5,
  openPrice: 100,
  avg14dVolume: 2_000_000,
  capital: 25_000,
};

describe("evaluateORBSetup — eligibility filter", () => {
  it("rejects open price <= $5", () => {
    const r = evaluateORBSetup({
      openingRangeBar: { open: 4, high: 4.5, low: 3.9, close: 4.3 },
      ...goodEligibility,
      openPrice: 4,
    });
    expect(r.eligible).toBe(false);
    expect(r.side).toBe("none");
    expect(r.rejections.some((s) => s.includes("open"))).toBe(true);
  });

  it("rejects avg 14d volume < 1M", () => {
    const r = evaluateORBSetup({
      openingRangeBar: { open: 100, high: 101, low: 99, close: 100.5 },
      ...goodEligibility,
      avg14dVolume: 500_000,
    });
    expect(r.eligible).toBe(false);
    expect(r.rejections.some((s) => s.includes("volume"))).toBe(true);
  });

  it("rejects ATR <= $0.50", () => {
    const r = evaluateORBSetup({
      openingRangeBar: { open: 100, high: 101, low: 99, close: 100.5 },
      ...goodEligibility,
      dailyATR: 0.4,
    });
    expect(r.eligible).toBe(false);
    expect(r.rejections.some((s) => s.includes("ATR"))).toBe(true);
  });

  it("rejects bar with high < low", () => {
    const r = evaluateORBSetup({
      openingRangeBar: { open: 100, high: 99, low: 101, close: 100.5 },
      ...goodEligibility,
    });
    expect(r.eligible).toBe(false);
  });
});

describe("evaluateORBSetup — direction lock", () => {
  it("bullish bar → LONG side, entry at 5-min HIGH", () => {
    const r = evaluateORBSetup({
      openingRangeBar: { open: 100, high: 102, low: 99.5, close: 101 },
      ...goodEligibility,
    });
    expect(r.side).toBe("long");
    expect(r.entryStop).toBe(102);
  });

  it("bearish bar → SHORT side, entry at 5-min LOW", () => {
    const r = evaluateORBSetup({
      openingRangeBar: { open: 100, high: 100.5, low: 98, close: 99 },
      ...goodEligibility,
    });
    expect(r.side).toBe("short");
    expect(r.entryStop).toBe(98);
  });

  it("doji (open == close) → no trade even if eligible", () => {
    const r = evaluateORBSetup({
      openingRangeBar: { open: 100, high: 101, low: 99, close: 100 },
      ...goodEligibility,
    });
    expect(r.eligible).toBe(true);
    expect(r.side).toBe("none");
  });
});

describe("evaluateORBSetup — risk + sizing", () => {
  it("stop loss = entry +/- (10% × ATR) by default", () => {
    const r = evaluateORBSetup({
      openingRangeBar: { open: 100, high: 102, low: 99.5, close: 101 },
      ...goodEligibility,
    });
    // ATR=5, 10% = $0.50, long entry @ 102 → SL = 101.50
    expect(r.stopLossPrice).toBeCloseTo(101.5, 6);
    expect(r.riskPerShare).toBeCloseTo(0.5, 6);
  });

  it("short: stop above entry", () => {
    const r = evaluateORBSetup({
      openingRangeBar: { open: 100, high: 100.5, low: 98, close: 99 },
      ...goodEligibility,
    });
    expect(r.stopLossPrice).toBeCloseTo(98.5, 6);
  });

  it("position size: 1% capital / risk-per-share", () => {
    const r = evaluateORBSetup({
      openingRangeBar: { open: 100, high: 102, low: 99.5, close: 101 },
      ...goodEligibility,
    });
    // $25,000 × 1% = $250 risk; $0.50/share → 500 shares
    expect(r.positionShares).toBe(500);
    expect(r.riskDollars).toBeCloseTo(250, 6);
  });

  it("max leverage caps shares when notional exceeds capital × maxLev", () => {
    // Tiny ATR with small risk-per-share → naive sizing would over-leverage
    const r = evaluateORBSetup({
      openingRangeBar: { open: 100, high: 102, low: 99.5, close: 101 },
      dailyATR: 0.6,
      openPrice: 100,
      avg14dVolume: 2_000_000,
      capital: 25_000,
      maxLeverage: 4,
    });
    // 1% of 25k = $250, risk/share = 0.06 → naive shares = 4166
    // Notional at entry 102 = $425k > 4×$25k = $100k cap
    // Cap = floor(100k / 102) = 980 shares
    expect(r.positionShares).toBeLessThanOrEqual(Math.floor(100_000 / 102));
  });

  it("throws on invalid stopLossAtrFraction", () => {
    expect(() =>
      evaluateORBSetup({
        openingRangeBar: { open: 100, high: 102, low: 99.5, close: 101 },
        ...goodEligibility,
        stopLossAtrFraction: 0,
      }),
    ).toThrow();
  });
});

describe("simulateORBTrade — long path", () => {
  const sig = evaluateORBSetup({
    openingRangeBar: { open: 100, high: 102, low: 99.5, close: 101 },
    ...goodEligibility,
  });

  it("breakout fills + reaches EoD profitably", () => {
    const bars: OHLCBar[] = [
      { open: 101, high: 101.8, low: 100.8, close: 101.5 }, // no breakout yet
      { open: 101.5, high: 102.5, low: 101.4, close: 102.3 }, // breaks 102, fills
      { open: 102.3, high: 103.5, low: 102, close: 103.2 },
      { open: 103.2, high: 104, low: 103, close: 103.8 }, // EoD close
    ];
    const o = simulateORBTrade({ signal: sig, intradayBars: bars });
    expect(o.filled).toBe(true);
    expect(o.fillBarIndex).toBe(1);
    expect(o.fillPrice).toBe(102);
    expect(o.exitReason).toBe("end_of_day");
    expect(o.exitPrice).toBe(103.8);
    expect(o.pnlPerShare).toBeCloseTo(1.8, 6);
    expect(o.rMultiple).toBeCloseTo(1.8 / 0.5, 4); // 3.6 R
  });

  it("stop-loss hits before EoD", () => {
    const bars: OHLCBar[] = [
      { open: 101, high: 102.2, low: 100.8, close: 102.1 }, // breaks 102, fills @102
      { open: 102.1, high: 102.3, low: 101.4, close: 101.5 }, // SL at 101.5 not hit (low > SL)
      { open: 101.5, high: 101.6, low: 101.3, close: 101.4 }, // low 101.3 < 101.5 → SL hit
      { open: 101.4, high: 102, low: 101.2, close: 101.8 },
    ];
    const o = simulateORBTrade({ signal: sig, intradayBars: bars });
    expect(o.filled).toBe(true);
    expect(o.exitReason).toBe("stop_loss");
    expect(o.exitPrice).toBeCloseTo(101.5, 6);
    expect(o.rMultiple).toBeCloseTo(-1, 4); // exactly -1R
  });

  it("breakout never triggers → not filled", () => {
    const bars: OHLCBar[] = [
      { open: 101, high: 101.5, low: 100.8, close: 101.2 },
      { open: 101.2, high: 101.9, low: 100.5, close: 101 },
      { open: 101, high: 101.6, low: 100.2, close: 100.8 },
    ];
    const o = simulateORBTrade({ signal: sig, intradayBars: bars });
    expect(o.filled).toBe(false);
    expect(o.exitReason).toBe("not_filled");
    expect(o.pnlDollars).toBe(0);
  });
});

describe("simulateORBTrade — short path", () => {
  const sig = evaluateORBSetup({
    openingRangeBar: { open: 100, high: 100.5, low: 98, close: 99 },
    ...goodEligibility,
  });

  it("breakdown fills, runs down to EoD", () => {
    const bars: OHLCBar[] = [
      { open: 99, high: 99.2, low: 97.5, close: 97.8 }, // breaks 98 low, fills @98
      { open: 97.8, high: 98, low: 96.5, close: 96.8 },
      { open: 96.8, high: 97, low: 95.5, close: 95.8 },
      { open: 95.8, high: 96.1, low: 95, close: 95.2 }, // EoD
    ];
    const o = simulateORBTrade({ signal: sig, intradayBars: bars });
    expect(o.filled).toBe(true);
    expect(o.fillPrice).toBe(98);
    expect(o.exitReason).toBe("end_of_day");
    expect(o.exitPrice).toBe(95.2);
    expect(o.pnlPerShare).toBeCloseTo(2.8, 6); // 98 - 95.2 (short profit)
    expect(o.rMultiple).toBeCloseTo(2.8 / 0.5, 4);
  });

  it("short stops out (high reaches SL above entry)", () => {
    const bars: OHLCBar[] = [
      { open: 99, high: 99.2, low: 97.9, close: 98 }, // fills @98
      { open: 98, high: 98.6, low: 97.8, close: 98.4 }, // high 98.6 >= SL 98.5 → stopped
    ];
    const o = simulateORBTrade({ signal: sig, intradayBars: bars });
    expect(o.filled).toBe(true);
    expect(o.exitReason).toBe("stop_loss");
    expect(o.exitPrice).toBeCloseTo(98.5, 6);
    expect(o.rMultiple).toBeCloseTo(-1, 4);
  });
});

describe("simulateORBTrade — no-trade pass-through", () => {
  it("ineligible signal → not filled with zero P&L", () => {
    const sig = evaluateORBSetup({
      openingRangeBar: { open: 100, high: 101, low: 99, close: 100.5 },
      ...goodEligibility,
      openPrice: 4, // ineligible
    });
    const o = simulateORBTrade({ signal: sig, intradayBars: [] });
    expect(o.filled).toBe(false);
    expect(o.pnlDollars).toBe(0);
  });
});

describe("openingRangeBreakoutToPayload", () => {
  it("emits stable shape with outcome", () => {
    const sig = evaluateORBSetup({
      openingRangeBar: { open: 100, high: 102, low: 99.5, close: 101 },
      ...goodEligibility,
    });
    const bars: OHLCBar[] = [
      { open: 101, high: 102.5, low: 100.8, close: 102.3 },
      { open: 102.3, high: 103, low: 102, close: 102.8 },
    ];
    const o = simulateORBTrade({ signal: sig, intradayBars: bars });
    const p = openingRangeBreakoutToPayload(sig, o) as {
      kind: string;
      outcome: { filled: boolean };
    };
    expect(p.kind).toBe("opening_range_breakout.computed");
    expect(p.outcome.filled).toBe(true);
  });

  it("emits stable shape without outcome", () => {
    const sig = evaluateORBSetup({
      openingRangeBar: { open: 100, high: 102, low: 99.5, close: 101 },
      ...goodEligibility,
    });
    const p = openingRangeBreakoutToPayload(sig) as { kind: string };
    expect(p.kind).toBe("opening_range_breakout.computed");
  });
});
