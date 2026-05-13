import { describe, it, expect } from "bun:test";

import {
  FeaturePipeline,
  momentum,
  realizedVol,
  zscore,
  range,
  type OhlcvBar,
} from "./featurePipeline.ts";

const bar = (close: number, open = close, high = close, low = close, volume = 1000): OhlcvBar => ({
  open, high, low, close, volume,
});

const linear = (n: number): OhlcvBar[] =>
  Array.from({ length: n }, (_, i) => bar(100 + i));

describe("FeaturePipeline.add", () => {
  it("rejects non-positive lookback", () => {
    const p = new FeaturePipeline<OhlcvBar>();
    expect(() => p.add("x", 0, () => 1)).toThrow();
    expect(() => p.add("x", -1, () => 1)).toThrow();
  });

  it("rejects non-integer lookback", () => {
    const p = new FeaturePipeline<OhlcvBar>();
    expect(() => p.add("x", 1.5, () => 1)).toThrow();
  });

  it("rejects duplicate feature names", () => {
    const p = new FeaturePipeline<OhlcvBar>().add("x", 5, () => 1);
    expect(() => p.add("x", 10, () => 2)).toThrow();
  });

  it("returns this for chaining", () => {
    const p = new FeaturePipeline<OhlcvBar>();
    expect(p.add("a", 1, () => 1)).toBe(p);
  });
});

describe("FeaturePipeline.list", () => {
  it("reports registered transforms in order", () => {
    const p = new FeaturePipeline<OhlcvBar>()
      .add("a", 5, () => 1)
      .add("b", 10, () => 2);
    expect(p.list().map((t) => t.name)).toEqual(["a", "b"]);
  });
});

describe("FeaturePipeline.transform — leakage prevention (the load-bearing test)", () => {
  it("window for row i never contains data[i] itself", () => {
    const p = new FeaturePipeline<OhlcvBar>();
    // For every call, record the window's last-bar close and the current
    // index. The pipeline does NOT pass the index, so we tag each row's
    // close with a unique sentinel and check the window never includes it.
    const violations: number[] = [];
    p.add("guard", 3, (w) => {
      // Window for row i should never contain a bar whose close is the
      // sentinel for row i. We can't see i from inside the fn, so we
      // instead verify: window length == 3 AND every close in window
      // is strictly less than 1000 + i. The closes go 1000, 1001, 1002, ...
      // so window for row i contains closes 1000+(i-3), 1000+(i-2), 1000+(i-1).
      // None should equal 1000 + i.
      const maxClose = Math.max(...w.map((b) => b.close));
      // The fn sees a window; record the max so the outer test can verify.
      violations.push(maxClose);
      return 1;
    });

    const data = Array.from({ length: 10 }, (_, i) => bar(1000 + i));
    p.transform(data);
    // Window for row i has closes 1000+(i-3), 1000+(i-2), 1000+(i-1). Max
    // close in window is 1000+(i-1). For i=3, that's 1002. For i=9, 1008.
    // The current row's close (1000+i) must NEVER appear. We can verify
    // this by checking max close per call is always strictly less than
    // 1000+i (with i ranging from 3 to 9).
    for (let k = 0; k < violations.length; k++) {
      const i = k + 3;
      expect(violations[k]!).toBeLessThan(1000 + i);
    }
  });

  it("function receives strictly past window of correct length", () => {
    const p = new FeaturePipeline<OhlcvBar>();
    const observedLengths: number[] = [];
    const observedLastCloses: number[] = [];
    p.add("probe", 3, (w) => {
      observedLengths.push(w.length);
      observedLastCloses.push(w[w.length - 1]!.close);
      return 1;
    });

    p.transform(linear(10)); // closes 100..109

    expect(observedLengths.every((l) => l === 3)).toBe(true);
    // At index i=3, window is [0,1,2] => closes 100, 101, 102. Last = 102.
    // At index i=9, window is [6,7,8] => closes 106, 107, 108. Last = 108.
    expect(observedLastCloses[0]).toBe(102);
    expect(observedLastCloses[observedLastCloses.length - 1]).toBe(108);
  });

  it("first `lookback` rows are null", () => {
    const p = new FeaturePipeline<OhlcvBar>().add("x", 4, () => 42);
    const matrix = p.transform(linear(10));
    expect(matrix.rows[0]![0]).toBeNull();
    expect(matrix.rows[3]![0]).toBeNull();
    expect(matrix.rows[4]![0]).toBe(42);
  });
});

describe("FeaturePipeline.transform — output shape", () => {
  it("produces one row per input row, one column per feature", () => {
    const p = new FeaturePipeline<OhlcvBar>()
      .add("a", 2, () => 1)
      .add("b", 3, () => 2);
    const m = p.transform(linear(5));
    expect(m.columns).toEqual(["a", "b"]);
    expect(m.rows.length).toBe(5);
    expect(m.rows.every((r) => r.length === 2)).toBe(true);
  });

  it("preserves transform order in columns", () => {
    const p = new FeaturePipeline<OhlcvBar>()
      .add("z", 1, () => 1)
      .add("a", 1, () => 2);
    expect(p.transform(linear(3)).columns).toEqual(["z", "a"]);
  });
});

describe("FeaturePipeline.transform — error handling", () => {
  it("swallows feature errors as null", () => {
    const p = new FeaturePipeline<OhlcvBar>().add("bad", 1, () => {
      throw new Error("kaboom");
    });
    const m = p.transform(linear(5));
    expect(m.rows.slice(1).every((r) => r[0] === null)).toBe(true);
  });

  it("coerces non-finite returns to null", () => {
    const p = new FeaturePipeline<OhlcvBar>()
      .add("nan", 1, () => Number.NaN)
      .add("inf", 1, () => Number.POSITIVE_INFINITY);
    const m = p.transform(linear(5));
    expect(m.rows[3]![0]).toBeNull();
    expect(m.rows[3]![1]).toBeNull();
  });
});

describe("FeaturePipeline.transformStrict", () => {
  it("propagates feature errors", () => {
    const p = new FeaturePipeline<OhlcvBar>().add("bad", 1, () => {
      throw new Error("propagate me");
    });
    expect(() => p.transformStrict(linear(5))).toThrow("propagate me");
  });
});

describe("Built-in features", () => {
  it("momentum(5) returns last/first - 1 over the past 5 bars", () => {
    const p = new FeaturePipeline<OhlcvBar>().add(...Object.values(momentum(5)) as [string, number, any]);
    const data = [bar(100), bar(101), bar(102), bar(103), bar(104), bar(200)];
    const m = p.transform(data);
    // At index 5 the window is bars 0..4 with closes 100..104.
    expect(m.rows[5]![0]).toBeCloseTo(104 / 100 - 1);
  });

  it("realizedVol(5) returns annualized stdev of log returns", () => {
    const p = new FeaturePipeline<OhlcvBar>();
    const t = realizedVol(5, 252);
    p.add(t.name, t.lookback, t.fn);
    const flat = [100, 100, 100, 100, 100, 100].map((c) => bar(c));
    const m = p.transform(flat);
    expect(m.rows[5]![0]).toBe(0);
  });

  it("zscore(5) is 0 when last == mean and undefined for constant series", () => {
    const p = new FeaturePipeline<OhlcvBar>();
    const t = zscore(5);
    p.add(t.name, t.lookback, t.fn);
    const flat = [100, 100, 100, 100, 100, 100].map((c) => bar(c));
    const m = p.transform(flat);
    expect(m.rows[5]![0]).toBeNull();
  });

  it("range(5) returns (high-low)/close", () => {
    const p = new FeaturePipeline<OhlcvBar>();
    const t = range(5);
    p.add(t.name, t.lookback, t.fn);
    const data = [
      bar(100, 100, 110, 90),
      bar(101, 101, 111, 91),
      bar(102, 102, 112, 92),
      bar(103, 103, 113, 93),
      bar(104, 104, 114, 94),
      bar(100, 100, 100, 100),
    ];
    const m = p.transform(data);
    // Window 0..4: high=114, low=90, last close=104. (114-90)/104.
    expect(m.rows[5]![0]).toBeCloseTo((114 - 90) / 104);
  });
});
