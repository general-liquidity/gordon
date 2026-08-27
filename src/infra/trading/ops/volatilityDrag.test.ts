import { describe, it, expect } from "bun:test";

import {
  volatilityDrag,
  geometricFromArithmetic,
  recoveryReturn,
  expectedReturnUnderLeverage,
  leveragePrivilege,
  annualizeSharpe,
  compareStrategies,
  dragToPayload,
} from "./volatilityDrag.ts";

describe("volatilityDrag", () => {
  it("is σ²/2", () => {
    expect(volatilityDrag(0.2)).toBeCloseTo(0.02, 10);
    expect(volatilityDrag(0.5)).toBeCloseTo(0.125, 10);
  });

  it("is zero at zero stddev", () => {
    expect(volatilityDrag(0)).toBe(0);
  });

  it("is always non-negative regardless of sign", () => {
    expect(volatilityDrag(-0.3)).toBeCloseTo(0.045, 10);
  });
});

describe("geometricFromArithmetic", () => {
  it("subtracts the drag from arithmetic return", () => {
    expect(geometricFromArithmetic(0.1, 0.2)).toBeCloseTo(0.08, 10);
  });

  it("Wright surgeon scenario: 10% arith, 3% σ → ~9.96% geometric", () => {
    const g = geometricFromArithmetic(0.1, 0.03);
    expect(g).toBeCloseTo(0.09955, 4);
  });

  it("Wright gunslinger scenario: 30% arith, 40% σ → 22% geometric", () => {
    const g = geometricFromArithmetic(0.3, 0.4);
    expect(g).toBeCloseTo(0.22, 4);
  });
});

describe("recoveryReturn", () => {
  it("matches Wright's drawdown-recovery table", () => {
    expect(recoveryReturn(0.1)).toBeCloseTo(0.1111, 3);
    expect(recoveryReturn(0.2)).toBeCloseTo(0.25, 3);
    expect(recoveryReturn(0.3)).toBeCloseTo(0.4286, 3);
    expect(recoveryReturn(0.5)).toBeCloseTo(1.0, 3);
    expect(recoveryReturn(0.9)).toBeCloseTo(9.0, 3);
  });

  it("returns NaN for invalid drawdowns", () => {
    expect(Number.isNaN(recoveryReturn(0))).toBe(true);
    expect(Number.isNaN(recoveryReturn(1))).toBe(true);
    expect(Number.isNaN(recoveryReturn(-0.1))).toBe(true);
  });
});

describe("expectedReturnUnderLeverage", () => {
  it("variance scales by leverage² — drag explodes nonlinearly", () => {
    const s1 = expectedReturnUnderLeverage(0.1, 0.2, 1);
    const s2 = expectedReturnUnderLeverage(0.1, 0.2, 2);
    expect(s2.arithmetic).toBe(0.2);
    expect(s2.stddev).toBeCloseTo(0.4, 10);
    expect(s2.drag).toBeCloseTo(0.08, 10);
    expect(s2.drag / s1.drag).toBeCloseTo(4, 10);
  });

  it("Wright surgeon-with-4x-leverage: 10/3 levered to 40/12, drag stays small", () => {
    const s = expectedReturnUnderLeverage(0.1, 0.03, 4);
    expect(s.arithmetic).toBeCloseTo(0.4, 10);
    expect(s.drag).toBeCloseTo(0.0072, 4);
    expect(s.geometric).toBeCloseTo(0.3928, 4);
  });
});

describe("leveragePrivilege", () => {
  it("denies leverage below Sharpe floor", () => {
    const r = leveragePrivilege({ sharpeAnnualized: 0.5 });
    expect(r.earned).toBe(false);
    expect(r.reasons[0]).toContain("below annualized floor");
  });

  it("grants leverage at Sharpe 2.0", () => {
    const r = leveragePrivilege({ sharpeAnnualized: 2.0 });
    expect(r.earned).toBe(true);
  });

  it("denies when observed DD already exceeds tolerance", () => {
    const r = leveragePrivilege({
      sharpeAnnualized: 2.0,
      observedMaxDrawdown: 0.15,
      drawdownTolerance: 0.1,
    });
    expect(r.earned).toBe(false);
    expect(r.reasons.some((s) => s.includes("exceeds tolerance"))).toBe(true);
  });

  it("suggests max leverage as tolerance / observed DD", () => {
    const r = leveragePrivilege({
      sharpeAnnualized: 2.0,
      observedMaxDrawdown: 0.03,
      drawdownTolerance: 0.12,
    });
    expect(r.earned).toBe(true);
    expect(r.suggestedMaxLeverage).toBeCloseTo(4, 5);
  });

  it("the 1.5 floor is annualized: a per-period Sharpe must be converted first", () => {
    // A strategy with an annualized Sharpe of 2.0 on 252 daily bars has a
    // per-period Sharpe of 0.126. Handing the per-period number to a field
    // called `sharpe` denied leverage the strategy had earned; handing a
    // per-period 1.5 (annualized 23.8) granted it on a fiction.
    const perPeriod = 2.0 / Math.sqrt(252);
    expect(perPeriod).toBeCloseTo(0.126, 3);
    expect(annualizeSharpe(perPeriod, 252)).toBeCloseTo(2.0, 9);
    expect(leveragePrivilege({ sharpeAnnualized: annualizeSharpe(perPeriod, 252) }).earned).toBe(
      true,
    );
    // Unconverted, it falls below the annualized floor, which is the safe
    // direction but the wrong answer.
    expect(leveragePrivilege({ sharpeAnnualized: perPeriod }).earned).toBe(false);
  });

  it("annualizeSharpe scales by sqrt(periodsPerYear), not by periodsPerYear", () => {
    expect(annualizeSharpe(0.1, 252)).toBeCloseTo(1.5875, 4);
    expect(annualizeSharpe(0.1, 8760)).toBeCloseTo(9.3595, 4);
    expect(() => annualizeSharpe(0.1, 0)).toThrow();
  });

  it("respects custom Sharpe floor", () => {
    expect(leveragePrivilege({ sharpeAnnualized: 1.0, minSharpeAnnualized: 0.8 }).earned).toBe(
      true,
    );
    expect(leveragePrivilege({ sharpeAnnualized: 1.0, minSharpeAnnualized: 1.2 }).earned).toBe(
      false,
    );
  });
});

describe("compareStrategies", () => {
  it("at 1×, gunslinger (30/40) beats surgeon (10/3) on raw geometric return", () => {
    const r = compareStrategies(
      { arithmetic: 0.1, stddev: 0.03 },
      { arithmetic: 0.3, stddev: 0.4 },
    );
    expect(r.winner).toBe("b");
    expect(r.geometricB).toBeGreaterThan(r.geometricA);
  });

  it("levered surgeon at 4× overtakes gunslinger — Wright's actual point", () => {
    const surgeonLev = expectedReturnUnderLeverage(0.1, 0.03, 4);
    const r = compareStrategies(
      { arithmetic: surgeonLev.arithmetic, stddev: surgeonLev.stddev },
      { arithmetic: 0.3, stddev: 0.4 },
    );
    expect(r.winner).toBe("a");
    expect(r.geometricA).toBeGreaterThan(r.geometricB);
  });

  it("declares tie when geometric returns match within epsilon", () => {
    const r = compareStrategies({ arithmetic: 0.1, stddev: 0.2 }, { arithmetic: 0.1, stddev: 0.2 });
    expect(r.winner).toBe("tie");
  });
});

describe("dragToPayload", () => {
  it("emits stable shape", () => {
    const p = dragToPayload(0.3, 0.4) as { kind: string; geometric: number };
    expect(p.kind).toBe("volatility_drag.computed");
    expect(p.geometric).toBeCloseTo(0.22, 4);
  });
});
