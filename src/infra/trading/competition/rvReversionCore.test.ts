import { describe, expect, test } from "bun:test";
import { rvPairTargets, type RvReversionConfig, type RvHysteresisState } from "./rvReversionCore.ts";
import type { Mt5Bar } from "../../broker/mt5/bridgeClient.ts";

const bar = (time: number, close: number): Mt5Bar =>
  ({ time, open: close, high: close, low: close, close, tickVolume: 1, spread: 0, realVolume: 0 }) as Mt5Bar;

/**
 * Build two symbols whose log-ratio spread is a small alternating ±0.005 base (so the rolling
 * std ≈ 0.005, mean ≈ 0) with the LAST bar overridden to `lastSpread` — which drives the final
 * z ≈ lastSpread / 0.005. So lastSpread 0.03 → z≈6, 0.006 → z≈1.2, 0.0005 → z≈0.1.
 */
function barsForZ(lastSpread: number, nBase = 90): { A: Mt5Bar[]; B: Mt5Bar[] } {
  const spread: number[] = [];
  for (let i = 0; i < nBase; i++) spread.push((i % 2 === 0 ? 1 : -1) * 0.005);
  spread[spread.length - 1] = lastSpread;
  const A: Mt5Bar[] = [];
  const B: Mt5Bar[] = [];
  for (let i = 0; i < spread.length; i++) {
    const t = i * 900;
    B.push(bar(t, 1));
    A.push(bar(t, Math.exp(spread[i]!)));
  }
  return { A, B };
}

const CFG: RvReversionConfig = {
  clusters: [["AAA", "BBB"]],
  lookback: 48,
  entryZ: 2.0,
  exitZ: 0.5,
  perPairFraction: 0.03,
  maxPairs: 11,
  minObs: 60,
};

const targetsFor = (lastSpread: number, state?: RvHysteresisState) => {
  const { A, B } = barsForZ(lastSpread);
  return rvPairTargets({ AAA: A, BBB: B }, 1_000_000, CFG, state);
};

describe("rvPairTargets — discrete hysteresis (stateful)", () => {
  test("enters only when |z| ≥ entryZ; a mid-z does NOT open a fresh position", () => {
    const state: RvHysteresisState = new Map();
    // mid-z (~1.2, between exit 0.5 and entry 2.0) from FLAT → stay flat.
    expect(targetsFor(0.006, state)).toHaveLength(0);
    expect(state.get("AAA/BBB") ?? 0).toBe(0);
    // high-z (~6 ≥ entry) → enter (one dollar-neutral pair target).
    const entered = targetsFor(0.03, state);
    expect(entered).toHaveLength(1);
    expect(entered[0]!.symbolA).toBe("AAA");
    expect(state.get("AAA/BBB")).not.toBe(0);
  });

  test("HOLDS through the reversion band, then exits at |z| ≤ exitZ", () => {
    const state: RvHysteresisState = new Map();
    targetsFor(0.03, state); // enter (z high). ratio rich → short spread (sideA sell)
    const side0 = state.get("AAA/BBB");
    expect(side0).toBe(-1); // z>0 → short spread

    // mid-z (~1.2, inside the hold band) → STILL held (hysteresis), same side.
    const held = targetsFor(0.006, state);
    expect(held).toHaveLength(1);
    expect(state.get("AAA/BBB")).toBe(-1);

    // low-z (~0.1 ≤ exitZ) → reverted → exit (flat).
    expect(targetsFor(0.0005, state)).toHaveLength(0);
    expect(state.get("AAA/BBB")).toBe(0);
  });

  test("entry side fades the deviation (z>0 ⇒ short spread = sell A / buy B)", () => {
    const state: RvHysteresisState = new Map();
    const t = targetsFor(0.03, state); // spread rich (z>0)
    expect(t[0]!.sideA).toBe("sell");
    expect(t[0]!.sideB).toBe("buy");
    expect(t[0]!.notionalA).toBeCloseTo(0.03 * 1_000_000, 6); // full leg at perPairFraction
  });
});

describe("rvPairTargets — continuous mode (no state) is unchanged", () => {
  test("a mid-z opens a PARTIAL fade position (the legacy behavior, no hysteresis)", () => {
    // Same mid-z that discrete leaves flat → continuous holds a partial fade. This is exactly
    // the per-bar churn the discrete mode fixes; the legacy path must still behave this way.
    const t = targetsFor(0.006); // no state
    expect(t).toHaveLength(1);
    expect(Math.abs(t[0]!.allocation)).toBeGreaterThan(0);
    expect(Math.abs(t[0]!.allocation)).toBeLessThan(1); // partial fade, not full
  });

  test("inside the exit band → flat (continuous)", () => {
    expect(targetsFor(0.0005)).toHaveLength(0);
  });
});
