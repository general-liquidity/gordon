import { describe, expect, it } from "bun:test";
import {
  DEFAULT_SENTINELS,
  checkIndependence,
  checkPropagation,
  checkTradabilityContract,
  checkZeroOnMask,
  injectSentinels,
  type MaskedOperator,
} from "./contract.ts";
import {
  allTradable,
  maskFromFlags,
  maskedRollingMean,
  propagateMask,
  type MaskedSeries,
  type TradabilityMask,
} from "./mask.ts";

const WINDOW = 4;
const SERIES = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
const MASK = maskFromFlags([true, true, false, true, true, true, true, false, true, true]);

const correctOperator: MaskedOperator = (series, mask) => maskedRollingMean(series, mask, WINDOW);

/** Averages the whole window regardless of executability: the bug this module exists to catch. */
const leakyOperator: MaskedOperator = (series, mask) => {
  const outMask = propagateMask(mask, WINDOW);
  const values: (number | null)[] = [];
  for (let i = 0; i < series.length; i++) {
    if (i < WINDOW - 1) {
      values.push(null);
      continue;
    }
    let sum = 0;
    for (let j = i - WINDOW + 1; j <= i; j++) sum += series[j]!;
    values.push(sum / WINDOW);
  }
  return { values, mask: outMask };
};

/** Invalidates only the halted bar itself, leaving the rest of the window contaminated. */
const shortPropagationOperator: MaskedOperator = (series, mask) => {
  const values: (number | null)[] = [];
  for (let i = 0; i < series.length; i++) {
    values.push(mask.tradable[i] === true ? series[i]! : null);
  }
  return { values, mask };
};

describe("checkZeroOnMask", () => {
  it("passes when every masked output is neutral", () => {
    expect(checkZeroOnMask(correctOperator(SERIES, MASK)).passed).toBe(true);
  });

  it("fails an operator that emits a number where the output mask is false", () => {
    const output = leakyOperator(SERIES, MASK);
    const report = checkZeroOnMask(output);
    expect(report.passed).toBe(false);
    expect(report.violations[0]?.property).toBe("zero_on_mask");
  });
});

describe("checkIndependence", () => {
  it("passes when sentinel injection at masked positions does not move any output", () => {
    const report = checkIndependence(correctOperator, SERIES, MASK);
    expect(report.passed).toBe(true);
  });

  it("passes for a NaN sentinel, which would poison any window that read it", () => {
    const report = checkIndependence(correctOperator, SERIES, MASK, {
      sentinels: [Number.NaN],
    });
    expect(report.passed).toBe(true);
  });

  it("fails an operator whose output moves when a masked cell is set to 1e12", () => {
    const report = checkIndependence(leakyOperator, SERIES, MASK, {
      sentinels: [1e12],
    });
    expect(report.passed).toBe(false);
    expect(report.violations.every((v) => v.property === "independence")).toBe(true);
  });

  it("reports a violation for every sentinel that moves an output", () => {
    const report = checkIndependence(leakyOperator, SERIES, MASK);
    expect(report.violations.length).toBeGreaterThan(DEFAULT_SENTINELS.length);
  });
});

describe("injectSentinels", () => {
  it("overwrites only the masked positions", () => {
    const injected = injectSentinels([1, 2, 3], maskFromFlags([true, false, true]), 1e12);
    expect(injected).toEqual([1, 1e12, 3]);
  });
});

describe("checkPropagation", () => {
  it("passes when one masked bar invalidates its whole dependency window", () => {
    const output = correctOperator(SERIES, MASK);
    expect(checkPropagation(output.mask, MASK, WINDOW).passed).toBe(true);
  });

  it("fails an operator that invalidates only the masked bar itself", () => {
    const output = shortPropagationOperator(SERIES, MASK);
    const report = checkPropagation(output.mask, MASK, WINDOW);
    expect(report.passed).toBe(false);
    expect(report.violations.some((v) => v.index === 3)).toBe(true);
  });

  it("fails an output that is valid before the window is fully populated", () => {
    const clean: TradabilityMask = allTradable(6);
    const optimistic: MaskedSeries = {
      values: [1, 2, 3, 4, 5, 6],
      mask: clean,
    };
    const report = checkPropagation(optimistic.mask, clean, 3);
    expect(report.passed).toBe(false);
    expect(report.violations.map((v) => v.index)).toEqual([0, 1]);
  });
});

describe("checkTradabilityContract", () => {
  it("passes for a masked operator that satisfies all three properties", () => {
    const report = checkTradabilityContract(correctOperator, SERIES, MASK, {
      window: WINDOW,
    });
    expect(report.passed).toBe(true);
    expect(report.violations).toEqual([]);
  });

  it("catches every property an ordinary unmasked rolling mean breaks", () => {
    const report = checkTradabilityContract(leakyOperator, SERIES, MASK, {
      window: WINDOW,
    });
    const broken = new Set(report.violations.map((v) => v.property));
    expect(broken.has("zero_on_mask")).toBe(true);
    expect(broken.has("independence")).toBe(true);
  });

  it("passes on a fully executable series, where the mask is a no-op", () => {
    const report = checkTradabilityContract(correctOperator, SERIES, allTradable(SERIES.length), {
      window: WINDOW,
    });
    expect(report.passed).toBe(true);
  });
});
