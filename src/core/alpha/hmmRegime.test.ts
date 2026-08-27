import { describe, expect, test } from "bun:test";
import { fitHmmRegime } from "./hmmRegime.ts";

/** Generate observations from a 2-regime ground-truth process.
 *  Regime 0 — low mean (bear). Regime 1 — high mean (bull). */
function twoRegimeSeries(
  nPerRegime: number,
  bearMean = -0.02,
  bullMean = 0.02,
  noise = 0.005,
  seed = 1,
): { obs: number[]; trueStates: number[] } {
  let s = seed >>> 0;
  const rng = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  // Box-Muller for Gaussian noise.
  const gauss = () => Math.sqrt(-2 * Math.log(rng() + 1e-12)) * Math.cos(2 * Math.PI * rng());
  const obs: number[] = [];
  const trueStates: number[] = [];
  for (let i = 0; i < nPerRegime; i++) {
    obs.push(bearMean + gauss() * noise);
    trueStates.push(0);
  }
  for (let i = 0; i < nPerRegime; i++) {
    obs.push(bullMean + gauss() * noise);
    trueStates.push(1);
  }
  return { obs, trueStates };
}

describe("fitHmmRegime — basic recovery", () => {
  test("recovers means from a clean 2-regime series", () => {
    const { obs } = twoRegimeSeries(80, -0.02, 0.02, 0.003);
    const r = fitHmmRegime({ observations: obs, nStates: 2, nRestarts: 5, seed: 7 });
    expect(r.means).toHaveLength(2);
    // Means should be sorted ascending and bracket the truth.
    expect(r.means[0]).toBeLessThan(r.means[1]!);
    expect(r.means[0]).toBeLessThan(0);
    expect(r.means[1]).toBeGreaterThan(0);
  });

  test("labels are stable: 2 states → bear / bull", () => {
    const { obs } = twoRegimeSeries(60);
    const r = fitHmmRegime({ observations: obs, nStates: 2, seed: 11 });
    expect(r.stateLabels).toEqual(["bear", "bull"]);
  });

  test("3-state fit returns bear / sideways / bull labels", () => {
    // Need a 3-regime series for sensible 3-state fit.
    const segLen = 50;
    const obs: number[] = [];
    let s = 99;
    const rng = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff;
    };
    const gauss = () => Math.sqrt(-2 * Math.log(rng() + 1e-12)) * Math.cos(2 * Math.PI * rng());
    for (let i = 0; i < segLen; i++) obs.push(-0.02 + gauss() * 0.003);
    for (let i = 0; i < segLen; i++) obs.push(0 + gauss() * 0.003);
    for (let i = 0; i < segLen; i++) obs.push(0.02 + gauss() * 0.003);
    const r = fitHmmRegime({ observations: obs, nStates: 3, seed: 13 });
    expect(r.stateLabels).toEqual(["bear", "sideways", "bull"]);
    expect(r.means[0]).toBeLessThan(r.means[1]!);
    expect(r.means[1]).toBeLessThan(r.means[2]!);
  });

  test("Viterbi sequence approximately matches ground truth", () => {
    const { obs, trueStates } = twoRegimeSeries(100, -0.05, 0.05, 0.005, 17);
    const r = fitHmmRegime({ observations: obs, nStates: 2, nRestarts: 5, seed: 19 });
    // Label permutation between true and fit is unknown; check both
    // direct and inverted alignment, take the better one.
    let agreeDirect = 0;
    let agreeInv = 0;
    for (let i = 0; i < trueStates.length; i++) {
      if (trueStates[i] === r.stateSequence[i]) agreeDirect++;
      if (1 - trueStates[i]! === r.stateSequence[i]) agreeInv++;
    }
    const best = Math.max(agreeDirect, agreeInv);
    // Expect at least 80% agreement on a clean two-regime split.
    expect(best / trueStates.length).toBeGreaterThan(0.8);
  });
});

describe("fitHmmRegime — properties", () => {
  test("transition matrix rows sum to ~1", () => {
    const { obs } = twoRegimeSeries(60);
    const r = fitHmmRegime({ observations: obs, nStates: 2, seed: 23 });
    for (const row of r.transitions) {
      const rowSum = row.reduce((a, b) => a + b, 0);
      expect(rowSum).toBeCloseTo(1, 4);
    }
  });

  test("stationary distribution sums to 1", () => {
    const { obs } = twoRegimeSeries(60);
    const r = fitHmmRegime({ observations: obs, nStates: 2, seed: 29 });
    const sum = r.stationaryDistribution.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 4);
  });

  test("means are sorted ascending after permutation", () => {
    const { obs } = twoRegimeSeries(60);
    const r = fitHmmRegime({ observations: obs, nStates: 2, seed: 31 });
    for (let i = 1; i < r.means.length; i++) {
      expect(r.means[i]).toBeGreaterThanOrEqual(r.means[i - 1]!);
    }
  });

  test("variances are positive", () => {
    const { obs } = twoRegimeSeries(60);
    const r = fitHmmRegime({ observations: obs, nStates: 2, seed: 37 });
    for (const v of r.variances) expect(v).toBeGreaterThan(0);
  });

  test("initialProbs sums to 1", () => {
    const { obs } = twoRegimeSeries(60);
    const r = fitHmmRegime({ observations: obs, nStates: 2, seed: 41 });
    const sum = r.initialProbs.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 4);
  });
});

describe("fitHmmRegime — reproducibility", () => {
  test("same seed → identical fit", () => {
    const { obs } = twoRegimeSeries(60);
    const a = fitHmmRegime({ observations: obs, nStates: 2, seed: 43 });
    const b = fitHmmRegime({ observations: obs, nStates: 2, seed: 43 });
    expect(a.means).toEqual(b.means);
    expect(a.logLikelihood).toBe(b.logLikelihood);
  });
});

describe("fitHmmRegime — error handling", () => {
  test("throws on too few observations", () => {
    expect(() => fitHmmRegime({ observations: [1, 2, 3], nStates: 3 })).toThrow(/observations/);
  });

  test("throws on nStates < 2", () => {
    expect(() => fitHmmRegime({ observations: Array(20).fill(0.1), nStates: 1 })).toThrow(
      /nStates/,
    );
  });

  test("throws on non-finite observations", () => {
    expect(() =>
      fitHmmRegime({
        observations: [0.01, NaN, 0.02, 0.01, 0.01, 0.01],
        nStates: 2,
      }),
    ).toThrow(/finite/);
  });
});

describe("fitHmmRegime — diagnostics", () => {
  test("convergedRestarts is in [0, nRestarts]", () => {
    const { obs } = twoRegimeSeries(60);
    const r = fitHmmRegime({ observations: obs, nStates: 2, nRestarts: 5, seed: 47 });
    expect(r.convergedRestarts).toBeGreaterThanOrEqual(0);
    expect(r.convergedRestarts).toBeLessThanOrEqual(5);
  });

  test("stateSequence length matches observations", () => {
    const { obs } = twoRegimeSeries(60);
    const r = fitHmmRegime({ observations: obs, nStates: 2, seed: 53 });
    expect(r.stateSequence).toHaveLength(obs.length);
  });

  test("logLikelihood is finite", () => {
    const { obs } = twoRegimeSeries(60);
    const r = fitHmmRegime({ observations: obs, nStates: 2, seed: 59 });
    expect(Number.isFinite(r.logLikelihood)).toBe(true);
  });
});
