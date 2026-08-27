import { describe, expect, test } from "bun:test";
import {
  type Panel,
  makePanel,
  rank,
  scale,
  sign,
  log,
  abs,
  power,
  signedpower,
  add,
  sub,
  mul,
  div,
  ts_lag,
  ts_delta,
  ts_sum,
  ts_mean,
  ts_std,
  ts_min,
  ts_max,
  ts_argmin,
  ts_argmax,
  ts_rank,
  ts_product,
  decay_linear,
  ts_corr,
  ts_cov,
  dailyReturns,
} from "./formulaic-alpha-operators.ts";

// A 1-date panel with 3 tickers, used for cross-sectional ops.
const xs1 = (vals: (number | null)[]): Panel => makePanel(["d0"], ["A", "B", "C"], [vals]);

// A single-ticker time-series panel: one column, T dates.
const tsPanel = (vals: (number | null)[]): Panel =>
  makePanel(
    vals.map((_, i) => `d${i}`),
    ["A"],
    vals.map((v) => [v]),
  );

const col = (p: Panel): (number | null)[] => p.values.map((r) => r[0]!);

describe("cross-sectional rank", () => {
  test("rank([10,20,30]) -> [0, 0.5, 1]", () => {
    expect(rank(xs1([10, 20, 30])).values[0]).toEqual([0, 0.5, 1]);
  });
  test("ties share strictly-smaller count: rank([5,5,5]) -> [0,0,0]", () => {
    expect(rank(xs1([5, 5, 5])).values[0]).toEqual([0, 0, 0]);
  });
  test("nulls stay null; single present cell -> 0.5", () => {
    expect(rank(xs1([null, 42, null])).values[0]).toEqual([null, 0.5, null]);
  });
});

describe("scale (L1 normalize to a)", () => {
  test("Σ|x| = 1 by default; sign preserved", () => {
    const w = scale(xs1([1, -1, 2])).values[0]!; // L1 = 4
    expect(w[0]).toBeCloseTo(0.25, 6);
    expect(w[1]).toBeCloseTo(-0.25, 6);
    expect(w[2]).toBeCloseTo(0.5, 6);
    const l1 = (w as number[]).reduce((s, v) => s + Math.abs(v!), 0);
    expect(l1).toBeCloseTo(1, 6);
  });
  test("scale to a=2", () => {
    const w = scale(xs1([1, 1, 2]), 2).values[0]! as number[]; // L1=4 -> *2/4
    expect(w.reduce((s, v) => s + Math.abs(v), 0)).toBeCloseTo(2, 6);
  });
});

describe("elementwise unary ops", () => {
  test("sign", () => {
    expect(sign(xs1([-3, 0, 7])).values[0]).toEqual([-1, 0, 1]);
  });
  test("log: non-positive -> null", () => {
    const r = log(xs1([Math.E, 0, -1])).values[0]!;
    expect(r[0]).toBeCloseTo(1, 6);
    expect(r[1]).toBeNull();
    expect(r[2]).toBeNull();
  });
  test("abs / power / signedpower", () => {
    expect(abs(xs1([-2, 3, -4])).values[0]).toEqual([2, 3, 4]);
    expect(power(xs1([2, 3, 4]), 2).values[0]).toEqual([4, 9, 16]);
    // signedpower(-4, 0.5) = -2 ; signedpower(9, 0.5) = 3
    const sp = signedpower(xs1([-4, 9, 0]), 0.5).values[0]!;
    expect(sp[0]).toBeCloseTo(-2, 6);
    expect(sp[1]).toBeCloseTo(3, 6);
    expect(sp[2]).toBeCloseTo(0, 6);
  });
});

describe("elementwise binary ops (null propagation)", () => {
  const a = xs1([10, 20, 30]);
  const b = xs1([1, null, 3]);
  test("add propagates null", () => {
    expect(add(a, b).values[0]).toEqual([11, null, 33]);
  });
  test("sub / mul", () => {
    expect(sub(a, b).values[0]).toEqual([9, null, 27]);
    expect(mul(a, b).values[0]).toEqual([10, null, 90]);
  });
  test("div by zero -> null", () => {
    const num = makePanel(["d0"], ["A", "B"], [[6, 8]]);
    const den = makePanel(["d0"], ["A", "B"], [[2, 0]]);
    expect(div(num, den).values[0]).toEqual([3, null]);
  });
});

describe("time-series operators on a single ticker", () => {
  // close series: index 0..5
  const close = tsPanel([10, 12, 11, 15, 14, 20]);

  test("ts_lag(1): shifts forward; first -> null", () => {
    expect(col(ts_lag(close, 1))).toEqual([null, 10, 12, 11, 15, 14]);
  });

  test("ts_delta(1): today - yesterday", () => {
    // [null, 2, -1, 4, -1, 6]
    expect(col(ts_delta(close, 1))).toEqual([null, 2, -1, 4, -1, 6]);
  });

  test("ts_sum(3): trailing 3-day sum", () => {
    // first valid at idx2: 10+12+11=33 ; idx5: 15+14+20=49
    expect(col(ts_sum(close, 3))).toEqual([null, null, 33, 38, 40, 49]);
  });

  test("ts_mean(3)", () => {
    const m = col(ts_mean(close, 3));
    expect(m[2]).toBeCloseTo(33 / 3, 6);
    expect(m[5]).toBeCloseTo(49 / 3, 6);
  });

  test("ts_std(3) sample stddev; window [10,12,11] -> 1", () => {
    // mean 11, ss=(1+1+0)=2, /2 =1, sqrt=1
    const s = col(ts_std(close, 3));
    expect(s[2]).toBeCloseTo(1, 6);
  });

  test("ts_min / ts_max over 3", () => {
    expect(col(ts_min(close, 3))).toEqual([null, null, 10, 11, 11, 14]);
    expect(col(ts_max(close, 3))).toEqual([null, null, 12, 15, 15, 20]);
  });

  test("ts_argmax(3): days-ago of max within window", () => {
    // window ending idx5 = [15,14,20], max is most-recent -> 0 days ago
    // window ending idx3 = [12,11,15], max most-recent -> 0
    // window ending idx2 = [10,12,11], max is 12 at middle -> 1 day ago
    const am = col(ts_argmax(close, 3));
    expect(am[2]).toBe(1);
    expect(am[3]).toBe(0);
    expect(am[5]).toBe(0);
  });

  test("ts_argmin(3)", () => {
    // window idx2 = [10,12,11], min 10 oldest -> 2 days ago
    const am = col(ts_argmin(close, 3));
    expect(am[2]).toBe(2);
  });

  test("ts_rank(3): percentile of current within window", () => {
    // window idx3 = [12,11,15], current 15 is largest -> 1
    // window idx4 = [11,15,14], current 14: one smaller (11) /(3-1) = 0.5
    const r = col(ts_rank(close, 3));
    expect(r[3]).toBeCloseTo(1, 6);
    expect(r[4]).toBeCloseTo(0.5, 6);
  });

  test("ts_product(2)", () => {
    // idx1 = 10*12=120 ; idx5 = 14*20=280
    const pr = col(ts_product(close, 2));
    expect(pr[1]).toBe(120);
    expect(pr[5]).toBe(280);
  });
});

describe("decay_linear", () => {
  test("weights sum to 1 and weight recent highest", () => {
    // window [a,b,c] d=3 -> (1a+2b+3c)/6
    const p = tsPanel([2, 4, 6]);
    const out = col(decay_linear(p, 3));
    // (1*2 + 2*4 + 3*6)/6 = (2+8+18)/6 = 28/6
    expect(out[2]).toBeCloseTo(28 / 6, 6);
  });
  test("decay_linear of a constant series = the constant", () => {
    const p = tsPanel([5, 5, 5, 5]);
    expect(col(decay_linear(p, 3))[3]).toBeCloseTo(5, 6);
  });
});

describe("ts_corr / ts_cov", () => {
  test("ts_corr of identical series = 1", () => {
    const a = tsPanel([1, 2, 3, 4, 5]);
    const c = col(ts_corr(a, a, 3));
    expect(c[4]).toBeCloseTo(1, 6);
  });
  test("ts_corr of perfectly anti-correlated = -1", () => {
    const a = tsPanel([1, 2, 3, 4, 5]);
    const b = tsPanel([5, 4, 3, 2, 1]);
    expect(col(ts_corr(a, b, 3))[4]).toBeCloseTo(-1, 6);
  });
  test("ts_cov sample covariance, window [1,2,3] vs [1,2,3]", () => {
    // var of [1,2,3] sample = ((1+0+1))/2 = 1
    const a = tsPanel([1, 2, 3]);
    expect(col(ts_cov(a, a, 3))[2]).toBeCloseTo(1, 6);
  });
  test("zero-variance window -> null corr", () => {
    const a = tsPanel([5, 5, 5]);
    const b = tsPanel([1, 2, 3]);
    expect(col(ts_corr(a, b, 3))[2]).toBeNull();
  });
});

describe("dailyReturns", () => {
  test("simple returns from close", () => {
    const close = tsPanel([100, 110, 99]);
    const r = col(dailyReturns(close));
    expect(r[0]).toBeNull();
    expect(r[1]).toBeCloseTo(0.1, 6);
    expect(r[2]).toBeCloseTo(-0.1, 6);
  });
});
