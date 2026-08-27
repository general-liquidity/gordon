/**
 * Parity test — SPEC Win #1 (`docs/library-adoption/SPEC.md`, Cluster A).
 *
 * For every function in `src/core/numerics/`, this imports BOTH the existing
 * hand-rolled Gordon implementation AND the new `@stdlib`-backed wrapper, then
 * asserts they agree across a grid of representative inputs (incl. tails / edge
 * cases). This proves the eventual caller migration is a safe one-line swap.
 *
 * Tolerance: abs/rel 1e-6. The hand-rolled versions use Abramowitz-&-Stegun
 * polynomial approximations (worst-case ~1.5e-7), so they differ from
 * `@stdlib`'s double-precision results by ~1e-7 — well inside 1e-6.
 *
 * Several hand-rolled functions are file-private (not exported). To compare
 * against them WITHOUT editing those modules, the exact A&S transcriptions are
 * re-created here as local references, copied verbatim from their source files
 * (citation in each helper). They are the parity oracle, not new production code.
 */

import { describe, expect, test } from "bun:test";

import {
  normalCdf,
  normalPpf,
  erf,
  erfInv,
  gammaln,
  incompleteBeta,
  studentTCdf,
  studentTTwoSidedPValue,
  chiSquareCdf,
  chiSquarePValue,
} from "./index.ts";

// The one hand-rolled function that IS exported — import directly so we test
// against the real production code path, not a copy.
import { studentTTwoSidedPValue as handStudentTTwoSidedPValue } from "../indicators/linearRegression.ts";

// ---------------------------------------------------------------------------
// Hand-rolled reference implementations (verbatim copies of the file-private
// originals — the parity oracle). Source file noted on each.
// ---------------------------------------------------------------------------

/** Source: blackScholesGreeks.ts — A&S 26.2.17 standard-normal CDF. */
const SQRT_2PI = Math.sqrt(2 * Math.PI);
function handNormalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}
function handNormalCDF_AS26217(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const b1 = 0.31938153;
  const b2 = -0.356563782;
  const b3 = 1.781477937;
  const b4 = -1.821255978;
  const b5 = 1.330274429;
  const p = 0.2316419;
  const t = 1 / (1 + p * ax);
  const poly = ((((b5 * t + b4) * t + b3) * t + b2) * t + b1) * t;
  const cdfPositive = 1 - handNormalPDF(ax) * poly;
  return sign > 0 ? cdfPositive : 1 - cdfPositive;
}

/** Source: vpin.ts — A&S 7.1.26 erf → standard-normal CDF. */
function handNormalCDF_AS7126(x: number): number {
  const z = x / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z);
  const erfApprox = z >= 0 ? y : -y;
  return 0.5 * (1 + erfApprox);
}

/** Source: twoSampleTest.ts — A&S 7.1.26 erf, evaluated at u directly. */
function handErf_AS7126(u: number): number {
  const a = Math.abs(u);
  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-a * a);
  return u >= 0 ? y : -y;
}

/** Source: linearRegression.ts / conditional-distribution-test.ts — Lanczos ln Γ. */
function handGammaln(x: number): number {
  const cof = [
    76.18009172947146, -86.50532032941678, 24.01409824083091, -1.231739572450155,
    0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    y += 1;
    ser += cof[j]! / y;
  }
  return -tmp + Math.log((2.5066282746310007 * ser) / x);
}

/** Source: linearRegression.ts — continued-fraction incomplete beta (Lentz). */
function handBetacf(a: number, b: number, x: number): number {
  const MAXIT = 200;
  const EPS = 3e-14;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Source: linearRegression.ts — regularized incomplete beta I_x(a, b). */
function handIncompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    handGammaln(a + b) - handGammaln(a) - handGammaln(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) {
    return (bt * handBetacf(a, b, x)) / a;
  }
  return 1 - (bt * handBetacf(b, a, 1 - x)) / b;
}

/** Source: conditional-distribution-test.ts — Lanczos + series/CF gammaP → χ² SF. */
function handGammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 0; n < 300; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - handGammaln(a));
  }
  const FPMIN = 1e-300;
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 300; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  const q = Math.exp(-x + a * Math.log(x) - handGammaln(a)) * h;
  return 1 - q;
}
function handChiSquareSf(x: number, df: number): number {
  if (x <= 0) return 1;
  return 1 - handGammaP(df / 2, x / 2);
}

// erf⁻¹ and the normal PPF have no hand-rolled Gordon original (the codebase
// only ever needed the forward direction). Reference them against their
// defining identities instead: erfInv is the inverse of the A&S erf, and the
// normal PPF satisfies normalCdf(normalPpf(p)) == p.

// ---------------------------------------------------------------------------
// Tolerance helpers + delta tracking
// ---------------------------------------------------------------------------

const TOL = 1e-6;
const maxDelta: Record<string, number> = {};

function agree(name: string, got: number, ref: number): void {
  const delta = Math.abs(got - ref);
  const rel = delta / Math.max(1, Math.abs(ref));
  maxDelta[name] = Math.max(maxDelta[name] ?? 0, Math.min(delta, rel));
  // Pass if EITHER abs or rel is within tolerance (matches the spec's abs/rel 1e-6).
  expect(delta < TOL || rel < TOL).toBe(true);
}

// ---------------------------------------------------------------------------
// Grids
// ---------------------------------------------------------------------------

const NORMAL_X = [
  -6, -4, -3.5, -2.575, -1.96, -1.2, -0.5, -0.1, 0, 0.1, 0.5, 1, 1.2, 1.96, 2.575, 3.5, 4, 6,
];
const PROBS = [
  1e-6, 0.001, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.975, 0.99, 0.999, 0.999999,
];
const ERF_X = [-3, -2, -1, -0.5, -0.1, 0, 0.1, 0.5, 1, 2, 3, 5];
const ERFINV_X = [-0.999, -0.95, -0.8, -0.5, -0.1, 0, 0.1, 0.5, 0.8, 0.95, 0.999];
const GAMMALN_X = [0.1, 0.5, 1, 1.5, 2, 2.5, 3, 4.5, 7, 10, 25, 100];
const BETA_PARAMS: Array<[number, number]> = [
  [0.5, 0.5],
  [1, 1],
  [2, 2],
  [2, 5],
  [5, 2],
  [0.5, 5],
  [10, 10],
  [3, 7],
];
const BETA_X = [0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99];
const T_STATS = [-5, -3, -2.5, -1.5, -0.5, 0, 0.5, 1.5, 2.5, 3, 5];
const DFS = [1, 2, 3, 5, 10, 30, 100, 250];
const CHI_X = [0.1, 0.5, 1, 2, 3.84, 5, 7, 9.21, 12, 20, 40];
const CHI_K = [1, 2, 3, 4, 5, 9, 10, 30];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("normalCdf parity (A&S 26.2.17 — blackScholesGreeks)", () => {
  for (const x of NORMAL_X) {
    test(`x=${x}`, () => {
      agree("normalCdf_vs_AS26217", normalCdf(x), handNormalCDF_AS26217(x));
    });
  }
});

describe("normalCdf parity (A&S 7.1.26 — vpin)", () => {
  for (const x of NORMAL_X) {
    test(`x=${x}`, () => {
      agree("normalCdf_vs_AS7126", normalCdf(x), handNormalCDF_AS7126(x));
    });
  }
  test("with mu/sigma (standardization identity)", () => {
    const mu = 2.5;
    const sigma = 1.7;
    for (const x of NORMAL_X) {
      agree("normalCdf_param", normalCdf(x * sigma + mu, mu, sigma), handNormalCDF_AS7126(x));
    }
  });
});

describe("normalPpf parity (inverse identity)", () => {
  for (const p of PROBS) {
    test(`p=${p}`, () => {
      // normalCdf(normalPpf(p)) == p — round-trip against the @stdlib CDF.
      agree("normalPpf_roundtrip", normalCdf(normalPpf(p)), p);
    });
  }
  test("with mu/sigma round-trip", () => {
    const mu = -3;
    const sigma = 4.2;
    for (const p of PROBS) {
      agree("normalPpf_param", normalCdf(normalPpf(p, mu, sigma), mu, sigma), p);
    }
  });
});

describe("erf parity (A&S 7.1.26 — twoSampleTest)", () => {
  for (const x of ERF_X) {
    test(`x=${x}`, () => {
      agree("erf_vs_AS7126", erf(x), handErf_AS7126(x));
    });
  }
});

describe("erfInv parity (inverse identity)", () => {
  for (const x of ERFINV_X) {
    test(`x=${x}`, () => {
      // erf(erfInv(x)) == x — round-trip against @stdlib's own forward erf.
      agree("erfInv_roundtrip", erf(erfInv(x)), x);
    });
  }
});

describe("gammaln parity (Lanczos — linearRegression / conditional-dist-test)", () => {
  for (const x of GAMMALN_X) {
    test(`x=${x}`, () => {
      agree("gammaln_vs_lanczos", gammaln(x), handGammaln(x));
    });
  }
});

describe("incompleteBeta parity (Lentz CF — linearRegression)", () => {
  for (const [a, b] of BETA_PARAMS) {
    for (const x of BETA_X) {
      test(`I_${x}(${a},${b})`, () => {
        // wrapper takes (x, a, b); hand-rolled takes (a, b, x).
        agree("incompleteBeta_vs_lentz", incompleteBeta(x, a, b), handIncompleteBeta(a, b, x));
      });
    }
  }
});

describe("studentTCdf parity (incomplete-beta t-CDF)", () => {
  // F_t(t; df) = 1 - 0.5 * I_{df/(df+t²)}(df/2, 1/2) for t >= 0, mirrored for t<0.
  function handStudentTCdf(t: number, df: number): number {
    const x = df / (df + t * t);
    const ib = handIncompleteBeta(df / 2, 0.5, x);
    return t >= 0 ? 1 - 0.5 * ib : 0.5 * ib;
  }
  for (const df of DFS) {
    for (const t of T_STATS) {
      test(`t=${t}, df=${df}`, () => {
        agree("studentTCdf", studentTCdf(t, df), handStudentTCdf(t, df));
      });
    }
  }
});

describe("studentTTwoSidedPValue parity (exported linearRegression fn)", () => {
  for (const df of DFS) {
    for (const t of T_STATS) {
      test(`t=${t}, df=${df}`, () => {
        const ref = handStudentTTwoSidedPValue(t, df);
        const got = studentTTwoSidedPValue(t, df);
        expect(ref).not.toBeNull();
        expect(got).not.toBeNull();
        agree("studentTTwoSidedPValue", got!, ref!);
      });
    }
  }
  test("null guards match", () => {
    expect(studentTTwoSidedPValue(NaN, 5)).toBeNull();
    expect(studentTTwoSidedPValue(2, 0)).toBeNull();
    expect(studentTTwoSidedPValue(2, -1)).toBeNull();
  });
});

describe("chiSquareCdf / chiSquarePValue parity (gammaP SF — conditional-dist-test)", () => {
  for (const k of CHI_K) {
    for (const x of CHI_X) {
      test(`x=${x}, k=${k}`, () => {
        agree("chiSquarePValue_vs_SF", chiSquarePValue(x, k), handChiSquareSf(x, k));
        // CDF = 1 - SF
        agree("chiSquareCdf_vs_SF", chiSquareCdf(x, k), 1 - handChiSquareSf(x, k));
      });
    }
  }
  test("x<=0 → p-value 1", () => {
    expect(chiSquarePValue(0, 3)).toBe(1);
    expect(chiSquarePValue(-1, 3)).toBe(1);
  });
});

describe("observed max deltas (abs-or-rel) per function", () => {
  test("all within 1e-6 and report", () => {
    const lines = Object.entries(maxDelta)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `  ${k}: ${v.toExponential(3)}`);
    // eslint-disable-next-line no-console
    console.log(`\nMax observed delta (min(abs,rel)) per function:\n${lines.join("\n")}`);
    for (const [, v] of Object.entries(maxDelta)) {
      expect(v).toBeLessThan(TOL);
    }
  });
});
