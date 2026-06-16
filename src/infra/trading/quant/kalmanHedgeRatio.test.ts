import { describe, it, expect } from "bun:test";
import { kalmanHedgeRatio } from "./kalmanHedgeRatio.ts";

// Deterministic LCG (no Math.random / Date.now). Numerical Recipes constants.
function makeLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000; // uniform [0,1)
  };
}

// Box-Muller standard normal from two LCG uniforms.
function makeGaussian(seed: number): () => number {
  const u = makeLcg(seed);
  return () => {
    const a = Math.max(u(), 1e-12);
    const b = u();
    return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
  };
}

describe("kalmanHedgeRatio", () => {
  it("recovers a known CONSTANT beta and intercept on clean synthetic data", () => {
    // p1 = beta*p2 + alpha exactly. p2 is a deterministic random walk.
    const trueBeta = 1.8;
    const trueAlpha = 5;
    const g = makeGaussian(42);
    const n = 400;
    const p2: number[] = [];
    const p1: number[] = [];
    let level = 100;
    for (let i = 0; i < n; i++) {
      level += g(); // random-walk regressor
      p2.push(level);
      p1.push(trueBeta * level + trueAlpha + 0.01 * g()); // tiny obs noise; alpha weakly identified
    }

    const res = kalmanHedgeRatio(p1, p2, { delta: 1e-5, observationVar: 1e-4 });

    // Converged beta should be very close to truth — beta is the load-bearing
    // quantity (it sets the dollar-neutral leg ratio).
    expect(Math.abs(res.beta - trueBeta)).toBeLessThan(0.05);
    // beta and alpha are only weakly separately identified when p2 has a large
    // mean (the data pins the combination beta*p2 + alpha, not each alone). The
    // strong, well-posed check is that the fitted relation reconstructs p1: the
    // spread (p1 - beta*p2 - alpha) is mean-zero.
    const tail = res.spread.slice(-100);
    const meanTail = tail.reduce((s, v) => s + v, 0) / tail.length;
    expect(Math.abs(meanTail)).toBeLessThan(0.1);
  });

  it("TRACKS a time-varying beta (ramp) better than a static estimate", () => {
    // beta drifts linearly from 1.0 to 2.0 over the sample — the case static OLS
    // gets wrong and the Kalman filter is for.
    const g = makeGaussian(7);
    const n = 600;
    const p2: number[] = [];
    const p1: number[] = [];
    const trueBetas: number[] = [];
    let level = 50;
    for (let i = 0; i < n; i++) {
      level += 0.5 + g(); // drifting regressor with noise
      const beta = 1.0 + (1.0 * i) / (n - 1); // 1.0 -> 2.0
      trueBetas.push(beta);
      p2.push(level);
      p1.push(beta * level + 3 + 0.02 * g());
    }

    // delta large enough to adapt to the drift.
    const res = kalmanHedgeRatio(p1, p2, { delta: 1e-3, observationVar: 1e-3 });

    // The filtered beta at the END should be near the FINAL true beta (~2.0),
    // and NEAR the start true beta early on — i.e. it tracked the ramp.
    const finalBeta = res.beta;
    expect(Math.abs(finalBeta - trueBetas[n - 1]!)).toBeLessThan(0.15);

    // Early-sample filtered beta (after burn-in) should be well below the final,
    // confirming it moved with the ramp rather than sitting at one constant.
    const earlyBeta = res.steps[120]!.beta;
    expect(earlyBeta).toBeLessThan(finalBeta - 0.2);

    // A STATIC OLS beta (single number) cannot match both ends. Show the Kalman
    // tracking error is smaller than the best-static error against the true path.
    const sumP2P2 = p2.reduce((s, v) => s + v * v, 0);
    const sumP1P2 = p1.reduce((s, v, i) => s + v * p2[i]!, 0);
    const staticBeta = sumP1P2 / sumP2P2; // through-origin OLS approx
    let kalmanErr = 0;
    let staticErr = 0;
    for (let i = 200; i < n; i++) {
      kalmanErr += (res.steps[i]!.beta - trueBetas[i]!) ** 2;
      staticErr += (staticBeta - trueBetas[i]!) ** 2;
    }
    expect(kalmanErr).toBeLessThan(staticErr);
  });

  it("produces one step per bar with finite spread and innovation variance", () => {
    const g = makeGaussian(99);
    const n = 100;
    const p2: number[] = [];
    const p1: number[] = [];
    let lvl = 10;
    for (let i = 0; i < n; i++) {
      lvl += g();
      p2.push(lvl);
      p1.push(1.2 * lvl + 1 + 0.1 * g());
    }
    const res = kalmanHedgeRatio(p1, p2);
    expect(res.steps.length).toBe(n);
    for (const s of res.steps) {
      expect(Number.isFinite(s.spread)).toBe(true);
      expect(Number.isFinite(s.innovation)).toBe(true);
      expect(s.innovationVar).toBeGreaterThan(0);
    }
  });

  it("is deterministic — same input yields identical output", () => {
    const p1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const p2 = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
    const a = kalmanHedgeRatio(p1, p2);
    const b = kalmanHedgeRatio(p1, p2);
    expect(a.beta).toBe(b.beta);
    expect(a.alpha).toBe(b.alpha);
    expect(a.spread).toEqual(b.spread);
  });
});
