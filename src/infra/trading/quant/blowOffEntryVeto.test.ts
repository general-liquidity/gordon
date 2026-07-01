import { describe, it, expect } from "bun:test";
import {
  assessBlowOffEntryVeto,
  blowOffVetoToPayload,
  type BlowOffCandle,
} from "./blowOffEntryVeto.ts";

const HOUR_MS = 3_600_000;

/**
 * Build a calm base of `calmCount` small-range bars followed by a 5-bar
 * parabolic ramp (+5 per bar) with FADING volume — the classic blow-off
 * climax. Bars are spaced one hour apart from t=0.
 */
function buildBlowOff(opts: { calmCount: number; withVolume: boolean }): BlowOffCandle[] {
  const { calmCount, withVolume } = opts;
  const candles: BlowOffCandle[] = [];
  for (let i = 0; i < calmCount; i++) {
    // The 5 bars immediately before the ramp are the high-volume climax.
    const isClimaxWindow = i >= calmCount - 5;
    candles.push({
      timestamp: i * HOUR_MS,
      high: 100.5,
      low: 99.5,
      close: 100,
      ...(withVolume ? { volumeUsd: isClimaxWindow ? 1_000_000 : 800_000 } : {}),
    });
  }
  let prev = 100;
  for (let k = 0; k < 5; k++) {
    const close = prev + 5;
    candles.push({
      timestamp: (calmCount + k) * HOUR_MS,
      high: close + 0.5,
      low: prev - 0.5,
      close,
      ...(withVolume ? { volumeUsd: 400_000 } : {}), // volume fades into the top
    });
    prev = close;
  }
  return candles;
}

/** Calm-only series: no vertical move. */
function buildCalm(n: number): BlowOffCandle[] {
  const candles: BlowOffCandle[] = [];
  for (let i = 0; i < n; i++) {
    candles.push({
      timestamp: i * HOUR_MS,
      high: 100.5 + Math.sin(i / 5),
      low: 99.5 + Math.sin(i / 5),
      close: 100 + Math.sin(i / 5),
      volumeUsd: 800_000,
    });
  }
  return candles;
}

describe("assessBlowOffEntryVeto — parabolic chase", () => {
  it("VETOES a long that chases a vertical up blow-off with fading volume", () => {
    const candles = buildBlowOff({ calmCount: 25, withVolume: true });
    const r = assessBlowOffEntryVeto({ side: "long", candles });

    expect(r.blowOffDetected).toBe(true);
    expect(r.blowOffDirection).toBe("up");
    expect(r.chasing).toBe(true);
    expect(r.verdict).toBe("veto");
    expect(r.sizeMultiplier).toBe(0);
    expect(r.extensionAtrMultiple).toBeGreaterThanOrEqual(3);
    expect(r.directionalAgreement).toBe(1);
    expect(r.volumeExhaustion?.severity).toBe("severe");
    expect(r.vetoScore).toBeGreaterThanOrEqual(65);
  });

  it("ALLOWS a short that fades the same blow-off (counter-trend)", () => {
    const candles = buildBlowOff({ calmCount: 25, withVolume: true });
    const r = assessBlowOffEntryVeto({ side: "short", candles });

    // Blow-off still detected, but the entry fades it — no veto.
    expect(r.blowOffDetected).toBe(true);
    expect(r.chasing).toBe(false);
    expect(r.verdict).toBe("allow");
    expect(r.sizeMultiplier).toBe(1);
    expect(r.vetoScore).toBe(0);
  });

  it("still bites without volume (extension + progression legs only)", () => {
    const candles = buildBlowOff({ calmCount: 25, withVolume: false });
    const r = assessBlowOffEntryVeto({ side: "long", candles });

    expect(r.volumeExhaustion).toBeNull();
    expect(r.chasing).toBe(true);
    expect(r.verdict).not.toBe("allow");
    expect(r.sizeMultiplier).toBeLessThan(1);
  });
});

describe("assessBlowOffEntryVeto — no blow-off", () => {
  it("ALLOWS entries in a calm, non-parabolic market", () => {
    const candles = buildCalm(40);
    const long = assessBlowOffEntryVeto({ side: "long", candles });
    const short = assessBlowOffEntryVeto({ side: "short", candles });

    expect(long.blowOffDetected).toBe(false);
    expect(long.verdict).toBe("allow");
    expect(short.verdict).toBe("allow");
    expect(long.vetoScore).toBe(0);
  });

  it("ALLOWS when there is insufficient data", () => {
    const candles = buildCalm(3);
    const r = assessBlowOffEntryVeto({ side: "long", candles });
    expect(r.verdict).toBe("allow");
    expect(r.reasoning).toContain("insufficient");
  });
});

describe("blowOffVetoToPayload", () => {
  it("emits a stable payload shape", () => {
    const candles = buildBlowOff({ calmCount: 25, withVolume: true });
    const p = blowOffVetoToPayload(assessBlowOffEntryVeto({ side: "long", candles })) as {
      kind: string;
      verdict: string;
    };
    expect(p.kind).toBe("blow_off_entry_veto.computed");
    expect(["allow", "downgrade", "veto"]).toContain(p.verdict);
  });
});
