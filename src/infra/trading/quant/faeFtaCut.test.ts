import { describe, it, expect } from "bun:test";
import {
  computeFaeFtaCut,
  faeFtaCutToPayload,
} from "./faeFtaCut.ts";

describe("computeFaeFtaCut — validation", () => {
  const base = {
    entryPrice: 100,
    stoplossPrice: 98,
    currentPrice: 99,
    side: "BUY" as const,
    ftaThresholdR: 0.5,
  };

  it("rejects non-positive entry/stoploss/current prices", () => {
    expect(() => computeFaeFtaCut({ ...base, entryPrice: 0 })).toThrow();
    expect(() => computeFaeFtaCut({ ...base, stoplossPrice: 0 })).toThrow();
    expect(() => computeFaeFtaCut({ ...base, currentPrice: 0 })).toThrow();
  });

  it("rejects non-positive FTA threshold", () => {
    expect(() => computeFaeFtaCut({ ...base, ftaThresholdR: 0 })).toThrow();
    expect(() => computeFaeFtaCut({ ...base, ftaThresholdR: -0.5 })).toThrow();
  });

  it("rejects stoploss on wrong side of entry", () => {
    expect(() =>
      computeFaeFtaCut({ ...base, side: "BUY", stoplossPrice: 101 }),
    ).toThrow();
    expect(() =>
      computeFaeFtaCut({
        entryPrice: 100,
        stoplossPrice: 99,
        currentPrice: 101,
        side: "SELL",
        ftaThresholdR: 0.5,
      }),
    ).toThrow();
  });
});

describe("computeFaeFtaCut — BUY R-unit math", () => {
  const base = {
    entryPrice: 100,
    stoplossPrice: 98,
    side: "BUY" as const,
    ftaThresholdR: 0.5,
  };

  it("current = entry → R = 0, hold", () => {
    const r = computeFaeFtaCut({ ...base, currentPrice: 100 });
    expect(r.currentR).toBeCloseTo(0, 6);
    expect(r.verdict).toBe("hold");
    expect(r.ftaCrossed).toBe(false);
    expect(r.riskUnit).toBe(2);
  });

  it("current = stoploss → R = -1, FTA crossed", () => {
    const r = computeFaeFtaCut({ ...base, currentPrice: 98 });
    expect(r.currentR).toBeCloseTo(-1, 6);
    expect(r.ftaCrossed).toBe(true);
    expect(r.verdict).toBe("cut");
  });

  it("current at -0.5R exactly → FTA crossed (≤ threshold)", () => {
    const r = computeFaeFtaCut({ ...base, currentPrice: 99 });
    expect(r.currentR).toBeCloseTo(-0.5, 6);
    expect(r.ftaCrossed).toBe(true);
    expect(r.verdict).toBe("cut");
  });

  it("current at -0.4R → not yet crossed, hold", () => {
    const r = computeFaeFtaCut({ ...base, currentPrice: 99.2 });
    expect(r.currentR).toBeCloseTo(-0.4, 6);
    expect(r.ftaCrossed).toBe(false);
    expect(r.verdict).toBe("hold");
  });

  it("current above entry → positive R, hold", () => {
    const r = computeFaeFtaCut({ ...base, currentPrice: 102 });
    expect(r.currentR).toBeCloseTo(1, 6);
    expect(r.verdict).toBe("hold");
  });
});

describe("computeFaeFtaCut — SELL R-unit math (symmetric)", () => {
  const base = {
    entryPrice: 100,
    stoplossPrice: 102,
    side: "SELL" as const,
    ftaThresholdR: 0.5,
  };

  it("current = entry → R = 0, hold", () => {
    const r = computeFaeFtaCut({ ...base, currentPrice: 100 });
    expect(r.currentR).toBeCloseTo(0, 6);
    expect(r.verdict).toBe("hold");
  });

  it("current = stoploss → R = -1, cut", () => {
    const r = computeFaeFtaCut({ ...base, currentPrice: 102 });
    expect(r.currentR).toBeCloseTo(-1, 6);
    expect(r.verdict).toBe("cut");
  });

  it("current below entry → positive R, hold", () => {
    const r = computeFaeFtaCut({ ...base, currentPrice: 98 });
    expect(r.currentR).toBeCloseTo(1, 6);
    expect(r.verdict).toBe("hold");
  });
});

describe("computeFaeFtaCut — MAE / MFE from price history", () => {
  it("with priceHistory, MAE is most-adverse R observed", () => {
    const r = computeFaeFtaCut({
      entryPrice: 100,
      stoplossPrice: 98,
      currentPrice: 100,
      side: "BUY",
      ftaThresholdR: 0.5,
      priceHistory: [100, 99, 98.5, 99.2, 100], // went to 98.5 (-0.75R) then recovered
    });
    expect(r.maeR).toBeCloseTo(-0.75, 6);
    expect(r.mfeR).toBeCloseTo(0, 6);
    expect(r.currentR).toBeCloseTo(0, 6);
  });

  it("with priceHistory, MFE is most-favorable R observed", () => {
    const r = computeFaeFtaCut({
      entryPrice: 100,
      stoplossPrice: 98,
      currentPrice: 100,
      side: "BUY",
      ftaThresholdR: 0.5,
      priceHistory: [100, 101, 101.5, 100.8, 100],
    });
    expect(r.mfeR).toBeCloseTo(0.75, 6);
    expect(r.maeR).toBeCloseTo(0, 6);
  });

  it("without priceHistory, MAE = MFE = currentR", () => {
    const r = computeFaeFtaCut({
      entryPrice: 100,
      stoplossPrice: 98,
      currentPrice: 99,
      side: "BUY",
      ftaThresholdR: 0.5,
    });
    expect(r.maeR).toBeCloseTo(-0.5, 6);
    expect(r.mfeR).toBeCloseTo(-0.5, 6);
  });
});

describe("faeFtaCutToPayload", () => {
  it("emits stable shape", () => {
    const r = computeFaeFtaCut({
      entryPrice: 100,
      stoplossPrice: 98,
      currentPrice: 99,
      side: "BUY",
      ftaThresholdR: 0.5,
    });
    const p = faeFtaCutToPayload(r) as {
      kind: string;
      currentR: number;
      verdict: string;
      ftaCrossed: boolean;
    };
    expect(p.kind).toBe("fae_fta_cut.computed");
    expect(p.verdict).toBe("cut");
    expect(p.ftaCrossed).toBe(true);
  });
});
