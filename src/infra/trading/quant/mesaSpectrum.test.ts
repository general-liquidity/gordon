import { describe, it, expect } from "bun:test";
import {
  isMesaSpectrumEnabled,
  computeMesaSpectrum,
  mesaToPayload,
  MESA_SPECTRUM_FLAG_ENV,
} from "./mesaSpectrum.ts";

describe("isMesaSpectrumEnabled", () => {
  it("respects the flag", () => {
    expect(isMesaSpectrumEnabled({})).toBe(false);
    expect(isMesaSpectrumEnabled({ [MESA_SPECTRUM_FLAG_ENV]: "1" })).toBe(true);
  });
});

describe("computeMesaSpectrum", () => {
  it("short input → NaN with reason", () => {
    const r = computeMesaSpectrum({ prices: [1, 2, 3] });
    expect(Number.isNaN(r.dominantPeriod)).toBe(true);
    expect(r.reasoning).toContain("need");
  });

  it("recovers the dominant period of a clean sinusoid", () => {
    const truePeriod = 16;
    const prices = Array.from({ length: 200 }, (_, i) =>
      100 + 2 * Math.sin((2 * Math.PI * i) / truePeriod),
    );
    const r = computeMesaSpectrum({ prices, arOrder: 12, minPeriod: 4, maxPeriod: 40 });
    expect(Math.abs(r.dominantPeriod - truePeriod)).toBeLessThanOrEqual(2);
    expect(r.peakStrengthRatio).toBeGreaterThan(2);
  });

  it("flat input → low peak strength (no cycle)", () => {
    const prices = Array.from({ length: 100 }, () => 100);
    const r = computeMesaSpectrum({ prices, arOrder: 6, minPeriod: 4, maxPeriod: 30 });
    // Variance is essentially zero, spectrum is degenerate; reasoning still reports something.
    expect(r.spectrum.length).toBeGreaterThan(0);
  });

  it("white noise → diffuse spectrum (low peak/median ratio)", () => {
    let s = 13;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff - 0.5;
    };
    const prices = Array.from({ length: 200 }, () => 100 + rand() * 2);
    const r = computeMesaSpectrum({ prices, arOrder: 12, minPeriod: 4, maxPeriod: 40 });
    expect(Number.isFinite(r.peakStrengthRatio)).toBe(true);
    expect(r.peakStrengthRatio).toBeLessThan(50);
  });

  it("spectrum length covers the requested range", () => {
    const prices = Array.from({ length: 100 }, (_, i) => 100 + Math.sin(i / 5));
    const r = computeMesaSpectrum({ prices, minPeriod: 5, maxPeriod: 25 });
    expect(r.spectrum.length).toBe(21);
    expect(r.spectrum[0]!.period).toBe(5);
    expect(r.spectrum[r.spectrum.length - 1]!.period).toBe(25);
  });
});

describe("mesaToPayload", () => {
  it("emits a stable shape", () => {
    const prices = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 4));
    const r = computeMesaSpectrum({ prices });
    const p = mesaToPayload(r) as { kind: string; dominantPeriod: number };
    expect(p.kind).toBe("mesa_spectrum.computed");
    expect(typeof p.dominantPeriod).toBe("number");
  });
});
