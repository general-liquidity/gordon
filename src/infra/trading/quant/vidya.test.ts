import { describe, it, expect } from "bun:test";
import { isVidyaEnabled, computeVidya, vidyaToPayload, VIDYA_FLAG_ENV } from "./vidya.ts";

describe("isVidyaEnabled", () => {
  it("respects the flag", () => {
    expect(isVidyaEnabled({})).toBe(false);
    expect(isVidyaEnabled({ [VIDYA_FLAG_ENV]: "1" })).toBe(true);
  });
});

describe("computeVidya", () => {
  it("short series → NaN", () => {
    const r = computeVidya({ prices: [100, 101] });
    expect(Number.isNaN(r.currentVidya)).toBe(true);
  });

  it("follows trending prices", () => {
    const prices = Array.from({ length: 60 }, (_, i) => 100 + i);
    const r = computeVidya({ prices });
    expect(r.currentVidya).toBeGreaterThan(140);
    expect(r.currentVidya).toBeLessThan(160);
  });

  it("flat prices → VIDYA equals price", () => {
    const prices = Array.from({ length: 60 }, () => 100);
    const r = computeVidya({ prices });
    expect(r.currentVidya).toBeCloseTo(100, 2);
  });

  it("effective alpha is bounded by 1", () => {
    let s = 7;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff;
    };
    const prices = Array.from({ length: 60 }, (_, i) => 100 + (rand() - 0.5) * (i < 30 ? 1 : 20));
    const r = computeVidya({ prices });
    for (const a of r.effectiveAlpha) {
      if (Number.isFinite(a)) expect(a).toBeLessThanOrEqual(1);
    }
  });
});

describe("vidyaToPayload", () => {
  it("emits a stable shape", () => {
    const r = computeVidya({ prices: Array.from({ length: 60 }, (_, i) => 100 + i) });
    const p = vidyaToPayload(r) as { kind: string; currentVidya: number };
    expect(p.kind).toBe("vidya.computed");
    expect(typeof p.currentVidya).toBe("number");
  });
});
