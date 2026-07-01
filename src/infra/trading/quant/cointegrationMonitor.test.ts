import { test, expect, describe } from "bun:test";
import {
  rollingCointegration,
  pairRegimeMonitor,
  formatPairRegime,
  combineRegimeWithHealth,
} from "./cointegrationMonitor.ts";

// ============================================================================
// Deterministic PRNG (LCG) — no Math.random / Date.now so tests are stable.
// Numerical Recipes constants; returns uniform in [0, 1).
// ============================================================================

function makeLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Box-Muller standard normal from a uniform source. */
function makeGaussian(uniform: () => number): () => number {
  return () => {
    let u = 0;
    let v = 0;
    while (u === 0) u = uniform();
    while (v === 0) v = uniform();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

/** Random walk of length n starting at `start`, step ~ N(0, sigma). */
function randomWalk(n: number, start: number, sigma: number, gauss: () => number): number[] {
  const out: number[] = new Array(n);
  let level = start;
  for (let i = 0; i < n; i++) {
    level += sigma * gauss();
    out[i] = level;
  }
  return out;
}

/** Stationary AR(1) noise: e_t = phi * e_{t-1} + N(0, sigma). */
function ar1Noise(n: number, phi: number, sigma: number, gauss: () => number): number[] {
  const out: number[] = new Array(n);
  let e = 0;
  for (let i = 0; i < n; i++) {
    e = phi * e + sigma * gauss();
    out[i] = e;
  }
  return out;
}

const WINDOW = 120;
const N = 400;
const BETA = 1.5;

describe("rollingCointegration / pairRegimeMonitor", () => {
  test("stable cointegrated pair across the whole sample → ACTIVE", () => {
    // p2 random walk; p1 = BETA*p2 + AR(1) stationary noise. phi=0.95 gives a
    // measured half-life inside [5,60] over a 120-bar window (the OLS half-life
    // estimator is downward-biased in small samples — calibrated empirically).
    const gauss = makeGaussian(makeLcg(52));
    const p2 = randomWalk(N, 100, 1.0, gauss);
    const noise = ar1Noise(N, 0.95, 0.4, gauss);
    const p1 = p2.map((v, i) => BETA * v + noise[i]!);

    const regime = pairRegimeMonitor(p1, p2, {
      window: WINDOW,
      halfLifeMin: 5,
      halfLifeMax: 60,
    });

    expect(regime.status).toBe("ACTIVE");
    expect(regime.active).toBe(true);
    expect(regime.cointegratedAt).toBe("5%");
    expect(regime.halfLife).toBeGreaterThanOrEqual(5);
    expect(regime.halfLife).toBeLessThanOrEqual(60);

    const roll = rollingCointegration(p1, p2, WINDOW);
    // Recent windows should be cointegrated.
    const recent = roll.slice(-20);
    const cointegratedCount = recent.filter((r) => r.cointegrated).length;
    expect(cointegratedCount).toBeGreaterThan(10);
  });

  test("structural break: cointegrated first half, decoupled second half → HALTED at the end", () => {
    const gauss = makeGaussian(makeLcg(7));
    const p2 = randomWalk(N, 100, 1.0, gauss);
    const noise = ar1Noise(N, 0.95, 0.4, gauss);
    const mid = Math.floor(N / 2);

    // First half: cointegrated. Second half: p1 follows its OWN independent
    // random walk (starting from where it left off), severing the relationship.
    const p1: number[] = new Array(N);
    for (let i = 0; i < mid; i++) p1[i] = BETA * p2[i]! + noise[i]!;
    let indepLevel = p1[mid - 1]!;
    for (let i = mid; i < N; i++) {
      indepLevel += 1.0 * gauss();
      p1[i] = indepLevel;
    }

    const regime = pairRegimeMonitor(p1, p2, {
      window: WINDOW,
      halfLifeMin: 5,
      halfLifeMax: 60,
    });

    // The key assertion: the monitor catches the regime shift.
    expect(regime.status).not.toBe("ACTIVE");
    expect(regime.active).toBe(false);
    expect(regime.status).toBe("HALTED");

    // Health degrades across the break: a window ending just before the break
    // (fully pre-break) is cointegrated; the final window (fully post-break) is
    // not, and its ADF statistic is less negative (weaker / worse).
    const roll = rollingCointegration(p1, p2, WINDOW);
    const earlyIdx = mid - 1; // trailing window [mid-WINDOW .. mid-1], pre-break
    const lateIdx = N - 1; // trailing window fully post-break
    expect(roll[earlyIdx]!.cointegrated).toBe(true);
    expect(roll[lateIdx]!.cointegrated).toBe(false);
    expect(roll[lateIdx]!.adfStat).toBeGreaterThan(roll[earlyIdx]!.adfStat);
  });

  test("half-life gate: too-fast spread (HL < 5) is not ACTIVE even when cointegrated", () => {
    const gauss = makeGaussian(makeLcg(24680));
    const p2 = randomWalk(N, 100, 1.0, gauss);
    // phi=0.3 → fast reversion → measured half-life well under 5.
    const noise = ar1Noise(N, 0.3, 0.5, gauss);
    const p1 = p2.map((v, i) => BETA * v + noise[i]!);

    const regime = pairRegimeMonitor(p1, p2, {
      window: WINDOW,
      halfLifeMin: 5,
      halfLifeMax: 60,
    });

    expect(regime.cointegratedAt).not.toBeNull(); // cointegrated, but...
    expect(regime.halfLife).toBeLessThan(5);
    expect(regime.status).not.toBe("ACTIVE");
    expect(regime.active).toBe(false);
  });

  test("half-life gate: too-slow spread (HL > 60) is not ACTIVE", () => {
    // A near-unit-root residual (deterministic slow decay, target HL=100) with
    // negligible noise so phi-hat stays near 1. Needs a wider window for the
    // estimator to resolve the slow reversion — measured HL > 60. The
    // simplified ADF then reads it as borderline / non-stationary → HALTED.
    const W = 200;
    const gauss = makeGaussian(makeLcg(13579));
    const p2 = randomWalk(N, 100, 1.0, gauss);
    const phi = Math.exp(-Math.log(2) / 100); // half-life target = 100 periods
    let e = 10;
    const noise: number[] = new Array(N);
    for (let i = 0; i < N; i++) {
      e = phi * e + 0.01 * gauss();
      noise[i] = e;
    }
    const p1 = p2.map((v, i) => BETA * v + noise[i]!);

    const regime = pairRegimeMonitor(p1, p2, {
      window: W,
      halfLifeMin: 5,
      halfLifeMax: 60,
    });

    expect(regime.halfLife).toBeGreaterThan(60);
    expect(regime.status).not.toBe("ACTIVE");
    expect(regime.active).toBe(false);
  });

  test("insufficient history (series shorter than window) → HALTED, no throw", () => {
    const gauss = makeGaussian(makeLcg(11111));
    const short = WINDOW - 10;
    const p2 = randomWalk(short, 100, 1.0, gauss);
    const p1 = p2.map((v) => BETA * v);

    const regime = pairRegimeMonitor(p1, p2, { window: WINDOW });
    expect(regime.status).toBe("HALTED");
    expect(regime.active).toBe(false);
    expect(Number.isNaN(regime.adfStat)).toBe(true);

    // rollingCointegration over a short series: all bars are NaN placeholders.
    const roll = rollingCointegration(p1, p2, WINDOW);
    expect(roll.length).toBe(short);
    expect(roll.every((r) => Number.isNaN(r.adfStat) && !r.cointegrated)).toBe(true);
  });

  test("combineRegimeWithHealth: degraded only tightens (ACTIVE→WARNING), never loosens or HALTS", () => {
    // healthy is a pass-through for all three states.
    expect(combineRegimeWithHealth("ACTIVE", "healthy")).toBe("ACTIVE");
    expect(combineRegimeWithHealth("WARNING", "healthy")).toBe("WARNING");
    expect(combineRegimeWithHealth("HALTED", "healthy")).toBe("HALTED");

    // degraded caps ACTIVE at WARNING; WARNING/HALTED pass through (never forced
    // to HALTED by health alone — flattening stays reserved for ADF decay).
    expect(combineRegimeWithHealth("ACTIVE", "degraded")).toBe("WARNING");
    expect(combineRegimeWithHealth("WARNING", "degraded")).toBe("WARNING");
    expect(combineRegimeWithHealth("HALTED", "degraded")).toBe("HALTED");
  });

  test("formatPairRegime renders a short summary", () => {
    const gauss = makeGaussian(makeLcg(52));
    const p2 = randomWalk(N, 100, 1.0, gauss);
    const noise = ar1Noise(N, 0.95, 0.4, gauss);
    const p1 = p2.map((v, i) => BETA * v + noise[i]!);
    const regime = pairRegimeMonitor(p1, p2, { window: WINDOW });
    const s = formatPairRegime(regime, "AAA", "BBB");
    expect(s).toContain("Pair Health: AAA / BBB");
    expect(s).toContain("Regime:");
    expect(s).toContain("ADF Statistic:");
  });
});
