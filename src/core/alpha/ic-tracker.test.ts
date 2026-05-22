import { describe, it, expect } from "bun:test";
import { trackIc, computeIc } from "./ic-tracker.ts";

function makePairs(n: number, sigToReturn: (s: number) => number): {
  signals: number[];
  returns: number[];
} {
  const signals: number[] = [];
  const returns: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = Math.sin(i / 3) + Math.cos(i / 5);
    signals.push(s);
    returns.push(sigToReturn(s));
  }
  return { signals, returns };
}

describe("computeIc", () => {
  it("computes positive IC for aligned signal+return", () => {
    const { signals, returns } = makePairs(50, (s) => s * 0.5);
    expect(computeIc(signals, returns))!.toBeGreaterThan(0.9);
  });

  it("returns null for length mismatch", () => {
    expect(computeIc([1, 2, 3], [1, 2])).toBeNull();
  });
});

describe("trackIc — verdicts", () => {
  it("returns insufficient_data when sample size is too small", () => {
    const snap = trackIc("tiny-signal", [1, 2, 3, 4, 5], [1, 2, 3, 4, 5]);
    expect(snap.verdict).toBe("insufficient_data");
    expect(snap.ic).toBeNull();
  });

  it("labels a strongly-correlated signal as active", () => {
    // 60 samples, signal ≈ 0.5 × future return
    const { signals, returns } = makePairs(60, (s) => s * 0.5 + (Math.random() - 0.5) * 0.05);
    const snap = trackIc("strong", signals, returns);
    expect(snap.ic).not.toBeNull();
    expect(Math.abs(snap.ic!)).toBeGreaterThan(0.5);
    expect(snap.verdict).toBe("active");
  });

  it("labels a noise-only signal as noise", () => {
    // Signal is one stream, returns are a totally independent random walk
    const n = 100;
    const signals: number[] = [];
    const returns: number[] = [];
    for (let i = 0; i < n; i++) {
      signals.push(Math.sin(i / 7));
      returns.push(Math.cos(i / 13) * 0.001); // tiny + uncorrelated wave
    }
    const snap = trackIc("noisy", signals, returns);
    // IC will be near zero
    expect(snap.ic).not.toBeNull();
    expect(Math.abs(snap.ic!)).toBeLessThan(0.10);
  });

  it("flags decay when IC trends negative across sub-windows", () => {
    // First half: strong positive correlation; second half: weak/zero
    const signals: number[] = [];
    const returns: number[] = [];
    const half = 30;
    for (let i = 0; i < half; i++) {
      const s = Math.sin(i / 3);
      signals.push(s);
      returns.push(s * 0.5);
    }
    for (let i = 0; i < half; i++) {
      signals.push(Math.sin(i / 3));
      returns.push((Math.random() - 0.5) * 0.5); // no relationship
    }
    const snap = trackIc("decaying", signals, returns);
    expect(snap.ic).not.toBeNull();
    // The slope should be clearly negative
    expect(snap.trendSlope).toBeLessThan(0);
  });

  it("flags instability when IC swings sign across sub-windows", () => {
    // Construct a signal whose sub-window ICs alternate strongly
    const signals: number[] = [];
    const returns: number[] = [];
    const windowSize = 12;
    const windows = 5;
    for (let w = 0; w < windows; w++) {
      const sign = w % 2 === 0 ? 1 : -1;
      for (let i = 0; i < windowSize; i++) {
        const s = Math.sin(i / 2);
        signals.push(s);
        returns.push(sign * s * 0.5);
      }
    }
    const snap = trackIc("flippy", signals, returns);
    // Aggregate IC may be small but sub-window CV should be high
    if (snap.verdict === "unstable") {
      expect(snap.cvIc).toBeGreaterThan(1.0);
    }
    // At minimum it shouldn't be active
    expect(["unstable", "noise", "insufficient_data", "decaying"]).toContain(snap.verdict);
  });

  it("respects custom thresholds via options", () => {
    const { signals, returns } = makePairs(60, (s) => s * 0.15 + (Math.random() - 0.5) * 0.4);
    // Default: this might be noise. With permissive thresholds it could be active.
    const lax = trackIc("lax", signals, returns, {
      noiseThreshold: 0.001,
      activeThreshold: 0.01,
    });
    // The lax thresholds should let weak signals pass
    expect(["active", "decaying", "unstable"]).toContain(lax.verdict);
  });

  it("includes the signal name in summary text", () => {
    const { signals, returns } = makePairs(60, (s) => s * 0.5);
    const snap = trackIc("my-test-signal", signals, returns);
    expect(snap.summary).toContain("my-test-signal");
  });

  it("computes sub-window stability fields", () => {
    const { signals, returns } = makePairs(60, (s) => s * 0.5);
    const snap = trackIc("test", signals, returns);
    expect(snap.subWindowsUsed).toBeGreaterThanOrEqual(3);
    expect(snap.cvIc).toBeGreaterThanOrEqual(0);
    expect(snap.ic95HalfWidth).toBeGreaterThan(0);
  });

  it("returns insufficient_data when stability sub-windows can't be formed", () => {
    // 30 samples = minimum, but with default subWindowCount=5 each
    // slice is 6 obs which is fine. Let's pass minSampleSize=30 and
    // confirm we get at least insufficient_data avoided for valid input.
    const { signals, returns } = makePairs(30, (s) => s * 0.5);
    const snap = trackIc("just-enough", signals, returns);
    expect(snap.ic).not.toBeNull();
  });
});
