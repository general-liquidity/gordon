import { describe, it, expect } from "bun:test";
import {
  isElderMomentumEnabled,
  computeForceIndex,
  computeElderRay,
  forceIndexToPayload,
  elderRayToPayload,
  ELDER_MOMENTUM_FLAG_ENV,
  type OhlcvBar,
} from "./elderMomentum.ts";

describe("isElderMomentumEnabled", () => {
  it("respects the flag", () => {
    expect(isElderMomentumEnabled({})).toBe(false);
    expect(isElderMomentumEnabled({ [ELDER_MOMENTUM_FLAG_ENV]: "1" })).toBe(true);
  });
});

function bars(samples: Array<[number, number, number, number]>): OhlcvBar[] {
  return samples.map(([high, low, close, volume]) => ({ high, low, close, volume }));
}

describe("computeForceIndex", () => {
  it("up close with volume → positive", () => {
    const r = computeForceIndex({
      bars: bars([
        [101, 99, 100, 1000],
        [102, 100, 101, 1500],
        [103, 101, 102, 2000],
      ]),
    });
    expect(r.sign).toBe("positive");
    expect(r.current).toBeGreaterThan(0);
  });

  it("down close with volume → negative", () => {
    const r = computeForceIndex({
      bars: bars([
        [101, 99, 100, 1000],
        [102, 100, 99, 1500],
        [103, 101, 98, 2000],
      ]),
    });
    expect(r.sign).toBe("negative");
    expect(r.current).toBeLessThan(0);
  });
});

describe("computeElderRay", () => {
  it("strong uptrend → bullish bias", () => {
    const samples = Array.from({ length: 40 }, (_, i) =>
      [100 + i + 1, 100 + i - 0.5, 100 + i, 1000] as [number, number, number, number],
    );
    const r = computeElderRay({ bars: bars(samples) });
    expect(r.bias).toBe("bullish");
    expect(r.currentBull).toBeGreaterThan(0);
  });

  it("strong downtrend → bearish bias", () => {
    const samples = Array.from({ length: 40 }, (_, i) =>
      [200 - i + 0.5, 200 - i - 1, 200 - i, 1000] as [number, number, number, number],
    );
    const r = computeElderRay({ bars: bars(samples) });
    expect(r.bias).toBe("bearish");
    expect(r.currentBear).toBeLessThan(0);
  });
});

describe("payloads", () => {
  it("force index payload shape", () => {
    const r = computeForceIndex({ bars: bars([[101, 99, 100, 1000], [102, 100, 101, 1500]]) });
    const p = forceIndexToPayload(r) as { kind: string; sign: string };
    expect(p.kind).toBe("force_index.computed");
    expect(typeof p.sign).toBe("string");
  });

  it("elder ray payload shape", () => {
    const r = computeElderRay({ bars: bars([[101, 99, 100, 1000], [102, 100, 101, 1500]]) });
    const p = elderRayToPayload(r) as { kind: string; bias: string };
    expect(p.kind).toBe("elder_ray.computed");
    expect(typeof p.bias).toBe("string");
  });
});
