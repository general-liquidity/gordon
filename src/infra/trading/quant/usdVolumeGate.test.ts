import { describe, it, expect } from "bun:test";
import {
  evaluateUsdVolumeGate,
  usdVolumeGateToPayload,
} from "./usdVolumeGate.ts";

function mkCandle(close: number, volume: number) {
  return { close, volume };
}

describe("evaluateUsdVolumeGate — validation", () => {
  it("rejects empty candles", () => {
    expect(() => evaluateUsdVolumeGate({ candles: [] })).toThrow();
  });

  it("rejects maPeriod < 1", () => {
    expect(() =>
      evaluateUsdVolumeGate({ candles: [mkCandle(100, 1)], maPeriod: 0 }),
    ).toThrow();
  });

  it("rejects non-positive threshold", () => {
    expect(() =>
      evaluateUsdVolumeGate({ candles: [mkCandle(100, 1)], thresholdUSD: 0 }),
    ).toThrow();
  });

  it("rejects non-positive close", () => {
    expect(() =>
      evaluateUsdVolumeGate({ candles: [mkCandle(0, 1)] }),
    ).toThrow();
  });

  it("rejects negative volume", () => {
    expect(() =>
      evaluateUsdVolumeGate({ candles: [mkCandle(100, -1)] }),
    ).toThrow();
  });
});

describe("evaluateUsdVolumeGate — USD computation", () => {
  it("computes USD volume as close × volume", () => {
    // 1 candle at $50, 2000 vol = $100K USD vol
    const r = evaluateUsdVolumeGate({ candles: [mkCandle(50, 2000)] });
    expect(r.latestVolUSD).toBeCloseTo(100_000, 4);
    expect(r.rollingAvgVolUSD).toBeCloseTo(100_000, 4);
  });

  it("USD-denominated equivalence: $0.50 × 200K = $50 × 2K = $100K", () => {
    // Same USD volume, different raw contracts
    const lowPriceHighContracts = evaluateUsdVolumeGate({
      candles: [mkCandle(0.5, 200_000)],
    });
    const highPriceLowContracts = evaluateUsdVolumeGate({
      candles: [mkCandle(50, 2000)],
    });
    expect(lowPriceHighContracts.rollingAvgVolUSD).toBeCloseTo(
      highPriceLowContracts.rollingAvgVolUSD,
      4,
    );
  });

  it("computes rolling average over multiple candles", () => {
    // 3 candles, each $50 × 1000 = $50K USD, MA over 3 = $50K
    const candles = [mkCandle(50, 1000), mkCandle(50, 1000), mkCandle(50, 1000)];
    const r = evaluateUsdVolumeGate({ candles, maPeriod: 3 });
    expect(r.rollingAvgVolUSD).toBeCloseTo(50_000, 4);
    expect(r.effectiveMaPeriod).toBe(3);
  });
});

describe("evaluateUsdVolumeGate — threshold logic", () => {
  it("MA exactly at threshold → tradeable", () => {
    const r = evaluateUsdVolumeGate({
      candles: [mkCandle(50, 2000)],
      thresholdUSD: 100_000,
    });
    expect(r.rollingAvgVolUSD).toBeCloseTo(100_000, 4);
    expect(r.tradeable).toBe(true);
    expect(r.verdict).toBe("tradeable");
  });

  it("MA above threshold → tradeable", () => {
    const r = evaluateUsdVolumeGate({
      candles: [mkCandle(50, 4000)],
      thresholdUSD: 100_000,
    });
    expect(r.rollingAvgVolUSD).toBeCloseTo(200_000, 4);
    expect(r.tradeable).toBe(true);
  });

  it("MA below threshold → skip", () => {
    const r = evaluateUsdVolumeGate({
      candles: [mkCandle(50, 1000)],
      thresholdUSD: 100_000,
    });
    expect(r.rollingAvgVolUSD).toBeCloseTo(50_000, 4);
    expect(r.tradeable).toBe(false);
    expect(r.verdict).toBe("skip");
  });
});

describe("evaluateUsdVolumeGate — MA window behavior", () => {
  it("maPeriod > candles.length → uses available candles", () => {
    const candles = [mkCandle(50, 1000)];
    const r = evaluateUsdVolumeGate({ candles, maPeriod: 60 });
    expect(r.effectiveMaPeriod).toBe(1);
    expect(r.rollingAvgVolUSD).toBeCloseTo(50_000, 4);
  });

  it("uses last maPeriod candles when more are available", () => {
    // 5 candles: first 2 high vol, last 3 low vol; maPeriod=3 should
    // only average the low-vol candles.
    const candles = [
      mkCandle(50, 10_000), // $500K
      mkCandle(50, 10_000), // $500K
      mkCandle(50, 1000), // $50K
      mkCandle(50, 1000), // $50K
      mkCandle(50, 1000), // $50K
    ];
    const r = evaluateUsdVolumeGate({ candles, maPeriod: 3 });
    expect(r.effectiveMaPeriod).toBe(3);
    expect(r.rollingAvgVolUSD).toBeCloseTo(50_000, 4);
  });
});

describe("evaluateUsdVolumeGate — defaults", () => {
  it("uses maPeriod=60 and thresholdUSD=$100K by default", () => {
    const r = evaluateUsdVolumeGate({ candles: [mkCandle(50, 2000)] });
    expect(r.thresholdUSD).toBe(100_000);
    // maPeriod=60 clamped to 1 since only 1 candle
    expect(r.effectiveMaPeriod).toBe(1);
  });
});

describe("usdVolumeGateToPayload", () => {
  it("emits stable shape", () => {
    const r = evaluateUsdVolumeGate({ candles: [mkCandle(50, 2000)] });
    const p = usdVolumeGateToPayload(r) as {
      kind: string;
      tradeable: boolean;
      verdict: string;
    };
    expect(p.kind).toBe("usd_volume_gate.evaluated");
    expect(p.tradeable).toBe(true);
    expect(p.verdict).toBe("tradeable");
  });
});
