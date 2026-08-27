/**
 * Volatility drag + leverage-privilege math (GORDON_VOLATILITY_DRAG).
 *
 * Port of Ch 13 (Mathematics of Survival) from Ryan Wright. Core insight:
 * geometric (compounded) returns are systematically lower than arithmetic
 * (average) returns by a term proportional to variance:
 *
 *   R_geometric ≈ R_arithmetic - σ²/2
 *
 * The drag is ALWAYS subtractive — variance never adds to compounded
 * wealth. This means a smooth strategy with modest returns can outperform
 * a turbulent strategy with higher returns once leverage is applied,
 * because the smooth one earns the "leverage privilege" (Wright Ch 13):
 * a strategy with Sharpe > ~1.5 can be levered without the variance term
 * exploding into ruin.
 *
 * Distinct from `multipleTestingTracker` (Q4 — DSR / PSR, deflated for
 * trial count) and `marketImpact` (Q3 — slippage modeling). This is pure
 * geometric-vs-arithmetic math, intended to compose with the backtest
 * report so users see "your 30% headline compounds to 18% after drag."
 */

/**
 * Drag term σ²/2. Stddev should be expressed as a decimal return per the
 * same period as the arithmetic return (e.g. annualized σ for annualized
 * arithmetic return).
 */
export function volatilityDrag(stddev: number): number {
  return (stddev * stddev) / 2;
}

/** Geometric (compounded) return ≈ arithmetic - σ²/2. */
export function geometricFromArithmetic(arith: number, stddev: number): number {
  return arith - volatilityDrag(stddev);
}

/**
 * Recovery return required after a drawdown to return to break-even.
 * Lose 50% → need +100%. Lose 20% → need +25%.
 * Negative drawdown returns NaN (input contract: drawdown ∈ (0, 1)).
 */
export function recoveryReturn(drawdown: number): number {
  if (drawdown <= 0 || drawdown >= 1) return Number.NaN;
  return drawdown / (1 - drawdown);
}

export interface LeverageScenario {
  arithmetic: number;
  geometric: number;
  drag: number;
  stddev: number;
}

/**
 * Apply a constant leverage multiplier and re-compute the full set of
 * return + drag numbers. Variance scales by leverage² which is why
 * leverage on a volatile strategy can be ruinous even when the
 * arithmetic return looks great.
 */
export function expectedReturnUnderLeverage(
  arith: number,
  stddev: number,
  leverage: number,
): LeverageScenario {
  const a = arith * leverage;
  const s = stddev * leverage;
  const d = volatilityDrag(s);
  return { arithmetic: a, geometric: a - d, drag: d, stddev: s };
}

/**
 * Bars per year for a return series. Use it to convert a per-period Sharpe
 * into the annualized units `leveragePrivilege` requires.
 *
 *   - crypto daily (24/7): 365
 *   - equity/FX daily:     252
 *   - hourly crypto:       8760
 */
export function annualizeSharpe(sharpePerPeriod: number, periodsPerYear: number): number {
  if (!(periodsPerYear > 0)) {
    throw new Error("periodsPerYear must be positive");
  }
  return sharpePerPeriod * Math.sqrt(periodsPerYear);
}

export interface LeveragePrivilegeInput {
  /**
   * ANNUALIZED Sharpe. The name carries the period on purpose: the 1.5 floor
   * below is annualized in Wright Ch 13, and a bare `sharpe` field let a
   * per-period number be compared against it. On 252 daily bars an annualized
   * 1.5 is a per-period 0.0945, and a per-period 1.5 is an annualized 23.8;
   * on hourly bars, 140. Convert with `annualizeSharpe` before calling.
   */
  sharpeAnnualized: number;
  /**
   * Minimum ANNUALIZED Sharpe required to earn leverage. Default 1.5 per
   * Wright Ch 13, which quotes it in annualized units.
   */
  minSharpeAnnualized?: number;
  /** Max drawdown observed at 1× sizing, as a positive fraction. */
  observedMaxDrawdown?: number;
  /** Max drawdown the operator can tolerate before psychological break. */
  drawdownTolerance?: number;
}

export interface LeveragePrivilegeResult {
  earned: boolean;
  reasons: string[];
  /**
   * Suggested max leverage given the observed drawdown and tolerance.
   * Null if the privilege isn't earned.
   */
  suggestedMaxLeverage: number | null;
}

const DEFAULT_MIN_SHARPE_ANNUALIZED = 1.5;

export function leveragePrivilege(input: LeveragePrivilegeInput): LeveragePrivilegeResult {
  const minSharpe = input.minSharpeAnnualized ?? DEFAULT_MIN_SHARPE_ANNUALIZED;
  const reasons: string[] = [];
  let earned = input.sharpeAnnualized >= minSharpe;
  if (!earned) {
    reasons.push(
      `annualized sharpe ${input.sharpeAnnualized.toFixed(2)} below annualized floor ${minSharpe}`,
    );
  }

  let suggestedMaxLeverage: number | null = null;
  if (
    earned &&
    input.observedMaxDrawdown !== undefined &&
    input.drawdownTolerance !== undefined &&
    input.observedMaxDrawdown > 0
  ) {
    const ratio = input.drawdownTolerance / input.observedMaxDrawdown;
    if (ratio < 1) {
      earned = false;
      reasons.push(
        `observed DD ${(input.observedMaxDrawdown * 100).toFixed(1)}% already exceeds tolerance ${(input.drawdownTolerance * 100).toFixed(1)}%`,
      );
    } else {
      suggestedMaxLeverage = ratio;
    }
  }

  if (earned && reasons.length === 0) reasons.push("smoothness justifies leverage");
  return { earned, reasons, suggestedMaxLeverage };
}

/**
 * Wright Ch 13 surgeon-vs-gunslinger comparison. Given two strategies
 * with arithmetic returns and stddevs, return which one has the better
 * geometric return AFTER drag, plus the gap.
 */
export interface StrategyComparison {
  winner: "a" | "b" | "tie";
  geometricA: number;
  geometricB: number;
  gap: number;
}

export function compareStrategies(
  a: { arithmetic: number; stddev: number },
  b: { arithmetic: number; stddev: number },
): StrategyComparison {
  const ga = geometricFromArithmetic(a.arithmetic, a.stddev);
  const gb = geometricFromArithmetic(b.arithmetic, b.stddev);
  const gap = Math.abs(ga - gb);
  let winner: "a" | "b" | "tie" = "tie";
  if (ga > gb + 1e-9) winner = "a";
  else if (gb > ga + 1e-9) winner = "b";
  return { winner, geometricA: ga, geometricB: gb, gap };
}

export function dragToPayload(arith: number, stddev: number): Record<string, unknown> {
  const drag = volatilityDrag(stddev);
  return {
    kind: "volatility_drag.computed",
    arithmetic: Number(arith.toFixed(4)),
    stddev: Number(stddev.toFixed(4)),
    drag: Number(drag.toFixed(4)),
    geometric: Number((arith - drag).toFixed(4)),
  };
}
