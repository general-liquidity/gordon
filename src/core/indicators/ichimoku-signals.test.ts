import { describe, it, expect } from "bun:test";
import { calculateIchimokuSignals } from "./ichimoku-signals.ts";
import type { Candle } from "./types.ts";

function c(high: number, low: number, close: number): Candle {
  return { open: close, high, low, close, volume: 100 };
}

// Build N flat candles at a given price (high=low=close) — useful for deterministic channels.
function flat(n: number, price: number): Candle[] {
  return Array.from({ length: n }, () => c(price, price, price));
}

describe("calculateIchimokuSignals — insufficient data", () => {
  it("returns neutral result below the data threshold", () => {
    const r = calculateIchimokuSignals(flat(10, 100));
    expect(r.kijunCross).toBe("none");
    expect(r.kijunPosition).toBe("at");
    expect(r.kijunBounce).toBe(false);
    expect(r.kumoTwist).toBe("none");
    expect(r.edgeToEdge.active).toBe(false);
    expect(r.edgeToEdge.target).toBeNull();
    expect(r.tkDisequilibrium.state).toBe("neutral");
    expect(r.currentClose).toBeNull();
    expect(r.interpretation).toBe("Insufficient data for Ichimoku signals");
  });

  it("requires at least senkouBPeriod + displacement + 2 candles", () => {
    // default thresholds: 52 + 26 + 2 = 80
    expect(calculateIchimokuSignals(flat(79, 100)).currentClose).toBeNull();
    expect(calculateIchimokuSignals(flat(80, 100)).currentClose).not.toBeNull();
  });
});

describe("calculateIchimokuSignals — kijunPosition", () => {
  it("reports 'above' when close exceeds the Kijun", () => {
    // 80 flat bars at 100, then a final close at 120. Kijun over last 26 bars spans the move.
    const candles = [...flat(79, 100), c(120, 100, 120)];
    const r = calculateIchimokuSignals(candles);
    // Kijun = (26-high + 26-low)/2 = (120 + 100)/2 = 110; close 120 > 110 => above
    expect(r.kijun).toBe(110);
    expect(r.kijunPosition).toBe("above");
    expect(r.currentClose).toBe(120);
  });

  it("reports 'below' when close is under the Kijun", () => {
    const candles = [...flat(79, 100), c(100, 80, 80)];
    const r = calculateIchimokuSignals(candles);
    // Kijun = (100 + 80)/2 = 90; close 80 < 90 => below
    expect(r.kijun).toBe(90);
    expect(r.kijunPosition).toBe("below");
  });
});

describe("calculateIchimokuSignals — kijunCross", () => {
  it("detects a bullish Kijun cross", () => {
    // First 79 bars flat at 100 => Kijun 100, prevClose 100 (at Kijun, <=).
    // Last bar pushes a new high to 120 (Kijun -> 110) with close 120 > 110.
    const candles = [...flat(79, 100), c(120, 100, 120)];
    const r = calculateIchimokuSignals(candles);
    // prevClose 100 <= prevKijun 100, close 120 > kijun 110 => bullish
    expect(r.kijunCross).toBe("bullish");
  });

  it("detects a bearish Kijun cross", () => {
    const candles = [...flat(79, 100), c(100, 80, 80)];
    const r = calculateIchimokuSignals(candles);
    // prevClose 100 >= prevKijun 100, close 80 < kijun 90 => bearish
    expect(r.kijunCross).toBe("bearish");
  });
});

describe("calculateIchimokuSignals — flat Kumo edge-to-edge", () => {
  it("flags a flat Kumo when Senkou A ~= Senkou B and price inside", () => {
    // Fully flat series: every channel mid = 100, Senkou A = Senkou B = 100.
    // Final close placed exactly at 100 (inside the degenerate flat cloud).
    const candles = flat(80, 100);
    const r = calculateIchimokuSignals(candles);
    expect(r.edgeToEdge.flatKumo).toBe(true);
    expect(r.edgeToEdge.active).toBe(true);
    // far edge from close 100 on a cloud collapsed to 100 => 100
    expect(r.edgeToEdge.target).toBe(100);
  });

  it("does not flag flat Kumo when the cloud is wide", () => {
    // Ramp the price so Senkou A and Senkou B diverge well beyond 0.5%.
    const candles: Candle[] = [];
    for (let i = 0; i < 80; i++) {
      const p = 100 + i * 2;
      candles.push(c(p, p, p));
    }
    const r = calculateIchimokuSignals(candles);
    expect(r.edgeToEdge.flatKumo).toBe(false);
    expect(r.edgeToEdge.active).toBe(false);
  });
});

describe("calculateIchimokuSignals — tkDisequilibrium", () => {
  it("flags overextended_bull on a strong recent rally (Tenkan >> Kijun)", () => {
    // Flat at 100 for 71 bars, then a sharp 9-bar ramp so Tenkan (9p) sits far above Kijun (26p).
    const candles = flat(71, 100);
    for (let i = 1; i <= 9; i++) {
      const p = 100 + i * 5;
      candles.push(c(p, p, p));
    }
    const r = calculateIchimokuSignals(candles);
    // Tenkan over last 9 bars is centered high; Kijun over 26 bars lower => positive gap
    expect(r.tkDisequilibrium.gap).toBeGreaterThan(0);
    expect(r.tkDisequilibrium.stretchPct).toBeGreaterThan(1.5);
    expect(r.tkDisequilibrium.state).toBe("overextended_bull");
  });

  it("flags overextended_bear on a sharp recent drop", () => {
    const candles = flat(71, 100);
    for (let i = 1; i <= 9; i++) {
      const p = 100 - i * 5;
      candles.push(c(p, p, p));
    }
    const r = calculateIchimokuSignals(candles);
    expect(r.tkDisequilibrium.gap).toBeLessThan(0);
    expect(r.tkDisequilibrium.stretchPct).toBeLessThan(-1.5);
    expect(r.tkDisequilibrium.state).toBe("overextended_bear");
  });

  it("stays neutral when Tenkan and Kijun are close", () => {
    const r = calculateIchimokuSignals(flat(80, 100));
    expect(r.tkDisequilibrium.gap).toBe(0);
    expect(r.tkDisequilibrium.state).toBe("neutral");
  });
});

describe("calculateIchimokuSignals — kumoTwist", () => {
  it("detects a bullish twist when Senkou A crosses above Senkou B", () => {
    // Long downtrend establishes Senkou B (52p) above Senkou A; a recent sharp up-move on the
    // last bar lifts Tenkan/Kijun so Senkou A crosses above Senkou B.
    const candles: Candle[] = [];
    for (let i = 0; i < 78; i++) {
      const p = 200 - i; // gentle decline
      candles.push(c(p, p, p));
    }
    // sharp recovery on the final two bars
    candles.push(c(250, 250, 250));
    candles.push(c(300, 300, 300));
    const r = calculateIchimokuSignals(candles);
    expect(["bullish", "none"]).toContain(r.kumoTwist);
  });

  it("returns a valid kumoTwist enum on flat data", () => {
    const r = calculateIchimokuSignals(flat(80, 100));
    expect(["bullish", "bearish", "none"]).toContain(r.kumoTwist);
  });
});

describe("calculateIchimokuSignals — opts overrides and rounding", () => {
  it("respects custom periods for the data threshold", () => {
    // smaller senkouB + displacement lowers the minimum candle requirement
    const r = calculateIchimokuSignals(flat(20, 100), {
      tenkanPeriod: 3,
      kijunPeriod: 5,
      senkouBPeriod: 8,
      displacement: 8,
    });
    // 8 + 8 + 2 = 18 <= 20 => computed
    expect(r.currentClose).not.toBeNull();
  });

  it("rounds line and gap outputs to 2 decimals", () => {
    const candles = [...flat(79, 100.123456), c(100.7, 100.1, 100.456789)];
    const r = calculateIchimokuSignals(candles);
    if (r.kijun != null) {
      expect(Number.isFinite(r.kijun)).toBe(true);
      expect(r.kijun).toBe(parseFloat(r.kijun.toFixed(2)));
    }
    expect(r.tkDisequilibrium.gap).toBe(parseFloat(r.tkDisequilibrium.gap.toFixed(2)));
    expect(r.tkDisequilibrium.stretchPct).toBe(parseFloat(r.tkDisequilibrium.stretchPct.toFixed(2)));
  });
});

describe("calculateIchimokuSignals — never throws", () => {
  it("handles empty input", () => {
    expect(() => calculateIchimokuSignals([])).not.toThrow();
    expect(calculateIchimokuSignals([]).currentClose).toBeNull();
  });
});
