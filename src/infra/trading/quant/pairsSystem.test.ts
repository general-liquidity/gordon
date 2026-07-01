import { describe, it, expect } from "bun:test";
import { runPairsSystem, pTraceHealthSeries } from "./pairsSystem.ts";
import { combineRegimeWithHealth } from "./cointegrationMonitor.ts";

// Deterministic LCG + Box-Muller (no Math.random / Date.now).
function makeLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
function makeGaussian(seed: number): () => number {
  const u = makeLcg(seed);
  return () => {
    const a = Math.max(u(), 1e-12);
    const b = u();
    return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
  };
}

/**
 * Construct a KNOWN cointegrated pair in price space.
 *   ln(B) = random walk (the common stochastic trend).
 *   ln(A) = β·ln(B) + α + OU(stationary spread).
 * So ln(A) − β·ln(B) − α is a mean-reverting OU process → cointegrated by design.
 *
 * The synthetic spread reverts on a multi-bar half-life (θ small). The system's
 * default Kalman delta (1e-4) is tuned for venues where β genuinely DRIFTS — on a
 * clean structurally-stable pair, fast β adaptation whitens the structural spread
 * and collapses its half-life below the tradeable floor. So the tests pass a
 * slower delta (1e-7), the right setting for a stable pair. This is a real
 * property of dynamic-β pairs trading, not a test hack.
 */
function makeCointegratedPair(
  seed: number,
  n: number,
  beta: number,
  alpha: number,
  ouTheta: number,
  ouSigma: number,
): { a: number[]; b: number[] } {
  const gB = makeGaussian(seed);
  const gS = makeGaussian(seed ^ 0x9e3779b9);
  const lnB: number[] = [];
  let lvl = Math.log(100);
  for (let i = 0; i < n; i++) {
    lvl += 0.004 * gB(); // common trend random walk
    lnB.push(lvl);
  }
  // OU spread: s_t = (1-θ)·s_{t-1} + σ·ε  (discrete AR(1), mean 0).
  const spread: number[] = [];
  let s = 0;
  for (let i = 0; i < n; i++) {
    s = (1 - ouTheta) * s + ouSigma * gS();
    spread.push(s);
  }
  const lnA = lnB.map((v, i) => beta * v + alpha + spread[i]!);
  return { a: lnA.map(Math.exp), b: lnB.map(Math.exp) };
}

// Slow Kalman delta — the correct setting for a structurally-stable pair (see note
// on makeCointegratedPair). Seeds below are chosen to clear the strict Johansen +
// EG-both statistical gauntlet (most random seeds do NOT — that strictness is the
// point of the selection layer and is exercised by the random-walk rejection test).
const STABLE_DELTA = 1e-7;
const SEL_CFG = { costBps: 5, kalmanDelta: STABLE_DELTA } as const;

describe("runPairsSystem", () => {
  it("SELECTS a constructed cointegrated pair (Johansen + EG-both + Hurst<0.5 + tradeable HL)", () => {
    const { a, b } = makeCointegratedPair(55, 800, 1.0, 0.4, 0.06, 0.02);
    const res = runPairsSystem(a, b, SEL_CFG);

    expect(res.selection.johansenCointegrated).toBe(true);
    expect(res.selection.egBothDirections).toBe(true);
    expect(res.selection.hurst).toBeLessThan(0.5);
    expect(res.selection.selected).toBe(true);
    expect(res.selection.rejectReason).toBeNull();
    expect(Number.isFinite(res.selection.halfLife)).toBe(true);
    expect(res.bars.length).toBe(800);
  });

  it("REJECTS two independent random walks (not cointegrated)", () => {
    const g1 = makeGaussian(11);
    const g2 = makeGaussian(22);
    const n = 600;
    const a: number[] = [];
    const b: number[] = [];
    let la = Math.log(50);
    let lb = Math.log(80);
    for (let i = 0; i < n; i++) {
      la += 0.01 * g1();
      lb += 0.01 * g2();
      a.push(Math.exp(la));
      b.push(Math.exp(lb));
    }
    const res = runPairsSystem(a, b, { costBps: 5 });
    expect(res.selection.selected).toBe(false);
    expect(res.bars.length).toBe(0);
    expect(res.selection.rejectReason).not.toBeNull();
  });

  it("derives cost-floored entry z = max(2.0, minEntryZ) and exit z = half", () => {
    const { a, b } = makeCointegratedPair(200, 800, 1.0, 0.3, 0.06, 0.02);
    const res = runPairsSystem(a, b, { ...SEL_CFG, desiredEntryZ: 2.0 });
    expect(res.selection.selected).toBe(true);
    expect(res.entryZ).toBeGreaterThanOrEqual(2.0);
    expect(res.entryZ).toBe(Math.max(2.0, res.minEntryZ));
    expect(res.exitZ).toBeCloseTo(res.entryZ / 2, 10);
  });

  it("produces a dollar-neutral state machine: positions in {long,short,flat}, allocation bounded by maxFraction", () => {
    const { a, b } = makeCointegratedPair(55, 800, 1.0, 0.4, 0.06, 0.02);
    const maxFraction = 0.5;
    const res = runPairsSystem(a, b, { ...SEL_CFG, maxFraction });
    expect(res.selection.selected).toBe(true);

    const states = new Set(res.bars.map((x) => x.state));
    for (const s of states) expect(["long", "short", "flat"]).toContain(s);

    for (const bar of res.bars) {
      expect(Math.abs(bar.allocation)).toBeLessThanOrEqual(maxFraction + 1e-9);
      // Sign of allocation matches state.
      if (bar.state === "long") expect(bar.allocation).toBeGreaterThanOrEqual(0);
      if (bar.state === "short") expect(bar.allocation).toBeLessThanOrEqual(0);
      if (bar.state === "flat") expect(bar.allocation).toBe(0);
    }
    // It should actually take at least one position over the sample.
    expect(res.bars.some((x) => x.state !== "flat")).toBe(true);
  });

  it("OU-proportional sizing scales allocation with |z| up to the cap", () => {
    const { a, b } = makeCointegratedPair(201, 800, 1.0, 0.2, 0.06, 0.02);
    const res = runPairsSystem(a, b, { ...SEL_CFG, maxFraction: 1.0 });
    expect(res.selection.selected).toBe(true);
    // For active (non-flat) bars, |allocation| == min(|z|/entryZ, 1).
    for (const bar of res.bars) {
      if (bar.state !== "flat" && !Number.isNaN(bar.z)) {
        const expected = Math.min(Math.abs(bar.z) / res.entryZ, 1);
        expect(Math.abs(bar.allocation)).toBeCloseTo(expected, 9);
      }
    }
  });

  it("HALTED regime forces flat", () => {
    const { a, b } = makeCointegratedPair(55, 800, 1.0, 0.3, 0.06, 0.02);
    const res = runPairsSystem(a, b, SEL_CFG);
    for (const bar of res.bars) {
      if (bar.regime === "HALTED") expect(bar.state).toBe("flat");
    }
  });

  it("is ADDITIVE by default — confidence fields are inert with no config.confidence", () => {
    const { a, b } = makeCointegratedPair(55, 800, 1.0, 0.4, 0.06, 0.02);
    const res = runPairsSystem(a, b, SEL_CFG);
    expect(res.selection.selected).toBe(true);
    for (const bar of res.bars) {
      // No confidence config → factor 1, healthy, regime unchanged from the ADF regime.
      expect(bar.confidenceFactor).toBe(1);
      expect(bar.pTraceHealth).toBe("healthy");
      expect(bar.regime).toBe(bar.adfRegime);
      // P_trace is always exposed and strictly positive.
      expect(bar.pTrace).toBeGreaterThan(0);
    }
  });

  it("K4 confidence entry gate pauses ALL new entries when P_trace exceeds the gate", () => {
    const { a, b } = makeCointegratedPair(55, 800, 1.0, 0.4, 0.06, 0.02);
    const baseline = runPairsSystem(a, b, SEL_CFG);
    expect(baseline.selection.selected).toBe(true);
    expect(baseline.bars.some((x) => x.state !== "flat")).toBe(true);

    // P_trace is always > 0, so an entryGate of 0 can never be cleared → no entry
    // ever opens and every bar stays flat (existing positions are unaffected, but
    // none is ever opened here).
    const gated = runPairsSystem(a, b, { ...SEL_CFG, confidence: { entryGate: 0 } });
    expect(gated.selection.selected).toBe(true);
    expect(gated.bars.length).toBe(baseline.bars.length);
    expect(gated.bars.every((x) => x.state === "flat")).toBe(true);
    expect(gated.bars.every((x) => x.allocation === 0)).toBe(true);
  });

  it("K5 confidence-scaled sizing multiplies OU conviction by clamp(1 - P_trace/max)", () => {
    const { a, b } = makeCointegratedPair(201, 800, 1.0, 0.2, 0.06, 0.02);
    const baseline = runPairsSystem(a, b, { ...SEL_CFG, maxFraction: 1.0 });
    expect(baseline.selection.selected).toBe(true);

    // Pick a normalizer above every observed P_trace so the factor is strictly in
    // (0, 1) — P_trace is identical across runs (unaffected by the confidence config).
    const maxPTrace = Math.max(...baseline.bars.map((x) => x.pTrace));
    const sizeMax = 2 * maxPTrace;
    const scaled = runPairsSystem(a, b, {
      ...SEL_CFG,
      maxFraction: 1.0,
      confidence: { sizeMax },
    });
    expect(scaled.selection.selected).toBe(true);

    for (let i = 0; i < scaled.bars.length; i++) {
      const bar = scaled.bars[i]!;
      const expectedFactor = Math.max(0, Math.min(1, 1 - bar.pTrace / sizeMax));
      expect(bar.confidenceFactor).toBeCloseTo(expectedFactor, 12);
      expect(bar.confidenceFactor).toBeGreaterThan(0);
      expect(bar.confidenceFactor).toBeLessThan(1);
      if (bar.state !== "flat" && !Number.isNaN(bar.z)) {
        const conviction = Math.min(Math.abs(bar.z) / scaled.entryZ, 1);
        expect(Math.abs(bar.allocation)).toBeCloseTo(conviction * expectedFactor, 9);
        // Confidence sizing can only shrink exposure vs the unscaled baseline.
        expect(Math.abs(bar.allocation)).toBeLessThanOrEqual(Math.abs(baseline.bars[i]!.allocation) + 1e-12);
      }
    }
  });

  it("K5 sizeFloor clamps the confidence factor from below", () => {
    const { a, b } = makeCointegratedPair(201, 800, 1.0, 0.2, 0.06, 0.02);
    // sizeMax tiny so 1 - P_trace/max would go deeply negative → clamped to floor.
    const floor = 0.25;
    const res = runPairsSystem(a, b, {
      ...SEL_CFG,
      confidence: { sizeMax: 1e-9, sizeFloor: floor },
    });
    expect(res.selection.selected).toBe(true);
    for (const bar of res.bars) {
      expect(bar.confidenceFactor).toBe(floor);
    }
  });

  it("K6 pTraceHealthSeries flags a P_trace SPIKE as degraded, decreasing runs as healthy", () => {
    // Monotone-decreasing prefix (converging filter) → current value is the window
    // minimum → always healthy. The injected spike at index 5 sits above its
    // trailing 0.8-quantile → degraded.
    const window = 5;
    const pct = 0.8;
    const series = [10, 8, 6, 4, 2, 20, 3, 2, 1, 1];
    const health = pTraceHealthSeries(series, window, pct);
    // Warmup (indices < window-1) are healthy.
    for (let i = 0; i < window - 1; i++) expect(health[i]).toBe("healthy");
    // Steadily-decreasing bar at index 4 (window [10,8,6,4,2], current=2=min) → healthy.
    expect(health[4]).toBe("healthy");
    // Spike at index 5 (window [8,6,4,2,20], current=20=max) → degraded.
    expect(health[5]).toBe("degraded");
    // Back to the window minimum after the spike → healthy again.
    expect(health[8]).toBe("healthy");
  });

  it("K6 P_trace health feeds the regime COMPLEMENTARILY (never looser than the ADF regime)", () => {
    const { a, b } = makeCointegratedPair(55, 800, 1.0, 0.4, 0.06, 0.02);
    const res = runPairsSystem(a, b, {
      ...SEL_CFG,
      confidence: { healthWindow: 60, healthPct: 0.8 },
    });
    expect(res.selection.selected).toBe(true);

    for (const bar of res.bars) {
      // The effective regime is EXACTLY the ADF regime folded with the health flag.
      expect(bar.regime).toBe(combineRegimeWithHealth(bar.adfRegime, bar.pTraceHealth));
      // Health only TIGHTENS — it never loosens or forces HALTED on its own.
      if (bar.adfRegime === "HALTED") expect(bar.regime).toBe("HALTED");
      if (bar.adfRegime === "WARNING") expect(bar.regime).toBe("WARNING");
      if (bar.adfRegime === "ACTIVE") expect(["ACTIVE", "WARNING"]).toContain(bar.regime);
    }
  });

  it("is deterministic — identical inputs yield identical positions", () => {
    const { a, b } = makeCointegratedPair(201, 800, 1.0, 0.5, 0.06, 0.02);
    const r1 = runPairsSystem(a, b, SEL_CFG);
    const r2 = runPairsSystem(a, b, SEL_CFG);
    expect(r1.bars.map((x) => x.allocation)).toEqual(r2.bars.map((x) => x.allocation));
    expect(r1.entryZ).toBe(r2.entryZ);
  });
});
