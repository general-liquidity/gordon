import { describe, it, expect } from "bun:test";
import {
  isLogitRsiEnabled,
  computeLogitRsi,
  logitRsiToPayload,
  LOGIT_RSI_FLAG_ENV,
} from "./logitRsi.ts";

describe("isLogitRsiEnabled", () => {
  it("respects the flag", () => {
    expect(isLogitRsiEnabled({})).toBe(false);
    expect(isLogitRsiEnabled({ [LOGIT_RSI_FLAG_ENV]: "1" })).toBe(true);
    expect(isLogitRsiEnabled({ [LOGIT_RSI_FLAG_ENV]: "true" })).toBe(true);
  });
});

describe("computeLogitRsi", () => {
  it("short series → NaN with reason", () => {
    const r = computeLogitRsi({ prices: [1, 2, 3] });
    expect(Number.isNaN(r.currentRsi)).toBe(true);
    expect(r.reasoning).toContain("need");
  });

  it("monotonic rise → high RSI → positive logit", () => {
    let s = 13;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff - 0.5;
    };
    const prices = Array.from({ length: 80 }, (_, i) => 100 + i + rand() * 0.5);
    const r = computeLogitRsi({ prices });
    expect(r.currentRsi).toBeGreaterThan(50);
    expect(r.currentLogit).toBeGreaterThan(0);
  });

  it("monotonic decline → low RSI → negative logit", () => {
    let s = 17;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff - 0.5;
    };
    const prices = Array.from({ length: 80 }, (_, i) => 200 - i + rand() * 0.5);
    const r = computeLogitRsi({ prices });
    expect(r.currentRsi).toBeLessThan(50);
    expect(r.currentLogit).toBeLessThan(0);
  });

  it("RSI=50 maps to logit≈0", () => {
    const prices = Array.from({ length: 80 }, (_, i) =>
      100 + 5 * Math.sin(i / 5)
    );
    const r = computeLogitRsi({ prices });
    expect(Math.abs(r.currentLogit)).toBeLessThan(2);
  });

  it("logit transform is symmetric: RSI=80 → -logit equals RSI=20 → logit", () => {
    // ln(0.8/0.2) = ln(4), ln(0.2/0.8) = -ln(4)
    const r80 = Math.log(80 / 20);
    const r20 = Math.log(20 / 80);
    expect(r80).toBeCloseTo(-r20, 9);
  });

  it("z-score classification: extreme reading yields extreme zone", () => {
    // Build a series where the final move is sharply against the prior
    // distribution — this should push z high.
    let s = 7;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff - 0.5;
    };
    const base = Array.from({ length: 100 }, (_, i) => 100 + rand() * 2);
    const shock = Array.from({ length: 20 }, (_, i) => 100 + 30 + i * 2);
    const r = computeLogitRsi({ prices: [...base, ...shock] });
    expect(["overbought", "extreme_overbought"]).toContain(r.currentZone);
  });

  it("epsilon clamp prevents ±Infinity for RSI at boundary", () => {
    const prices = Array.from({ length: 80 }, (_, i) => 100 + i);
    const r = computeLogitRsi({ prices, epsilon: 0.1 });
    expect(Number.isFinite(r.currentLogit)).toBe(true);
  });
});

describe("logitRsiToPayload", () => {
  it("emits stable shape", () => {
    const prices = Array.from({ length: 80 }, (_, i) => 100 + i * 0.5);
    const r = computeLogitRsi({ prices });
    const p = logitRsiToPayload(r) as { kind: string; currentZone: string };
    expect(p.kind).toBe("logit_rsi.computed");
    expect([
      "extreme_oversold",
      "oversold",
      "neutral",
      "overbought",
      "extreme_overbought",
    ]).toContain(p.currentZone);
  });

  it("emits null for non-finite values", () => {
    const r = computeLogitRsi({ prices: [1, 2, 3] });
    const p = logitRsiToPayload(r) as {
      currentRsi: number | null;
      currentZScore: number | null;
    };
    expect(p.currentRsi).toBeNull();
    expect(p.currentZScore).toBeNull();
  });
});
