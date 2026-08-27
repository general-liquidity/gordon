/**
 * Price-Implied Expectations (PIE) — Mauboussin's reverse DCF.
 *
 * Given a current stock price + base FCF + WACC + terminal growth +
 * explicit horizon, solve for the growth rate during the explicit
 * period that makes the DCF-derived price-per-share match the market.
 *
 * The point (per Mauboussin's "Expectations Investing"): before
 * taking a variant view on a stock, know what the market is already
 * pricing in. If consensus is 8% growth and the market is implying
 * 12%, you can be "directionally bullish on fundamentals" and still
 * lose money because expectations are even higher than your forecast.
 * PIE makes the embedded expectations explicit.
 *
 * Three solve modes are supported via the `solveFor` field:
 *
 *   - 'growth_rate'           — solve for the explicit-period growth
 *                                rate (most common). Other inputs known.
 *   - 'competitive_advantage' — solve for the explicit horizon N
 *                                (years of supranormal growth). Growth
 *                                rate + terminal known.
 *   - 'wacc'                  — solve for the discount rate. Growth +
 *                                terminal known. Useful for "what risk
 *                                premium is the market demanding?"
 *
 * Bisection search, no calculus needed. Each mode constrains the
 * search interval to a sensible band; outside the band we report
 * 'unresolvable' rather than silently extrapolate.
 *
 * Honest scope: the operator MUST supply a sensible terminal growth
 * + initial FCF + WACC. Garbage-in-garbage-out; the tool just makes
 * the implied expectation explicit, it doesn't validate the inputs.
 */

export type PieSolveFor = "growth_rate" | "competitive_advantage" | "wacc";

export interface PieInput {
  /** Current market cap derived input — price × shares + net debt,
   *  i.e. enterprise value the market currently implies. */
  enterpriseValue: number;
  /** Most recent annual FCF (the base from which the explicit period
   *  grows). */
  baseFcf: number;
  /** Discount rate. Required unless solveFor === 'wacc'. */
  wacc?: number;
  /** Terminal growth rate after the explicit period. Required for
   *  every solve mode. Must be < wacc to keep TV finite. */
  terminalGrowthPct: number;
  /** Length of the explicit growth period in years. Required unless
   *  solveFor === 'competitive_advantage'. */
  horizonYears?: number;
  /** Explicit-period growth rate. Required unless solveFor ===
   *  'growth_rate'. */
  growthRate?: number;
  /** What to solve for. */
  solveFor: PieSolveFor;
}

export interface PieResult {
  /** Solved value, in the units appropriate to solveFor. */
  solvedValue: number;
  /** Which variable was solved. */
  solveFor: PieSolveFor;
  /** Cross-check — the DCF-derived enterprise value at the solved
   *  point. Should match the input EV within tolerance. */
  derivedEnterpriseValue: number;
  /** Absolute error in EV after convergence. */
  residualError: number;
  /** Bisection iterations used. */
  iterations: number;
  /** True when the search converged within tolerance. False when the
   *  market's implied value falls outside the search band (e.g. the
   *  market is implying NEGATIVE growth for this EV, or implying a
   *  WACC > 50%). Caller should treat the result as advisory in that
   *  case. */
  converged: boolean;
  /** Human-readable summary. */
  interpretation: string;
}

const MAX_ITER = 100;
const EV_TOLERANCE = 1e-3; // absolute EV match within $0.001 in the input's units

function dcfEv(
  baseFcf: number,
  growthRate: number,
  horizonYears: number,
  wacc: number,
  terminalGrowthPct: number,
): number {
  if (wacc <= terminalGrowthPct) return Infinity;
  let pvExplicit = 0;
  let lastFcf = baseFcf;
  for (let t = 1; t <= horizonYears; t++) {
    lastFcf = baseFcf * (1 + growthRate) ** t;
    pvExplicit += lastFcf / (1 + wacc) ** t;
  }
  const terminal = (lastFcf * (1 + terminalGrowthPct)) / (wacc - terminalGrowthPct);
  const pvTerminal = terminal / (1 + wacc) ** horizonYears;
  return pvExplicit + pvTerminal;
}

interface BisectOptions {
  lo: number;
  hi: number;
  evaluate: (x: number) => number;
  target: number;
  monotoneIncreasing: boolean;
}

function bisect(opts: BisectOptions): { x: number; iterations: number; converged: boolean } {
  let lo = opts.lo;
  let hi = opts.hi;
  const evLo = opts.evaluate(lo);
  const evHi = opts.evaluate(hi);
  // Detect when target is outside the search band — bisection only
  // works when the function brackets the target.
  if (opts.monotoneIncreasing) {
    if (opts.target < evLo) return { x: lo, iterations: 0, converged: false };
    if (opts.target > evHi) return { x: hi, iterations: 0, converged: false };
  } else {
    if (opts.target > evLo) return { x: lo, iterations: 0, converged: false };
    if (opts.target < evHi) return { x: hi, iterations: 0, converged: false };
  }
  let iter = 0;
  for (iter = 0; iter < MAX_ITER; iter++) {
    const mid = 0.5 * (lo + hi);
    const evMid = opts.evaluate(mid);
    const diff = Math.abs(evMid - opts.target);
    if (diff < EV_TOLERANCE || Math.abs(hi - lo) < 1e-10) {
      return { x: mid, iterations: iter + 1, converged: true };
    }
    const goesUp = opts.monotoneIncreasing ? evMid < opts.target : evMid > opts.target;
    if (goesUp) lo = mid;
    else hi = mid;
  }
  return { x: 0.5 * (lo + hi), iterations: iter, converged: false };
}

export function computePriceImpliedExpectations(input: PieInput): PieResult {
  if (!Number.isFinite(input.enterpriseValue) || input.enterpriseValue <= 0) {
    throw new Error("PIE: enterpriseValue must be positive finite");
  }
  if (!Number.isFinite(input.baseFcf) || input.baseFcf <= 0) {
    throw new Error("PIE: baseFcf must be positive finite (operator-supplied)");
  }
  if (!Number.isFinite(input.terminalGrowthPct)) {
    throw new Error("PIE: terminalGrowthPct must be finite");
  }

  const target = input.enterpriseValue;

  switch (input.solveFor) {
    case "growth_rate": {
      const wacc = input.wacc;
      const horizon = input.horizonYears;
      if (wacc == null || !Number.isFinite(wacc) || wacc <= 0) {
        throw new Error("PIE growth_rate mode: wacc must be positive");
      }
      if (horizon == null || !Number.isInteger(horizon) || horizon < 1) {
        throw new Error("PIE growth_rate mode: horizonYears must be a positive integer");
      }
      if (wacc <= input.terminalGrowthPct) {
        throw new Error("PIE: wacc must exceed terminalGrowthPct");
      }
      // EV is monotone increasing in growth (for positive baseFcf and
      // wacc > terminal). Search g ∈ [-50%, +50%] — covers nearly all
      // sensible markets, refuses to extrapolate beyond.
      const { x, iterations, converged } = bisect({
        lo: -0.5,
        hi: 0.5,
        evaluate: (g) => dcfEv(input.baseFcf, g, horizon, wacc, input.terminalGrowthPct),
        target,
        monotoneIncreasing: true,
      });
      const derived = dcfEv(input.baseFcf, x, horizon, wacc, input.terminalGrowthPct);
      const interpretation = !converged
        ? `Market's implied growth rate falls outside [-50%, +50%] given the other inputs. Likely the operator's baseFcf, wacc, or terminal assumption is misspecified.`
        : x > input.terminalGrowthPct
          ? `Market is implying ${(x * 100).toFixed(2)}% growth for ${horizon} years vs ${(input.terminalGrowthPct * 100).toFixed(2)}% terminal. Take a variant view only if your forecast diverges meaningfully from this.`
          : `Market is implying decelerating fundamentals — ${(x * 100).toFixed(2)}% explicit growth is below terminal ${(input.terminalGrowthPct * 100).toFixed(2)}%. Either the operator's terminal is too high, or the market expects a normalization.`;
      return {
        solvedValue: x,
        solveFor: "growth_rate",
        derivedEnterpriseValue: derived,
        residualError: Math.abs(derived - target),
        iterations,
        converged,
        interpretation,
      };
    }

    case "competitive_advantage": {
      const wacc = input.wacc;
      const growth = input.growthRate;
      if (wacc == null || !Number.isFinite(wacc) || wacc <= 0) {
        throw new Error("PIE CAP mode: wacc must be positive");
      }
      if (growth == null || !Number.isFinite(growth)) {
        throw new Error("PIE CAP mode: growthRate must be finite");
      }
      if (wacc <= input.terminalGrowthPct) {
        throw new Error("PIE: wacc must exceed terminalGrowthPct");
      }
      if (growth <= input.terminalGrowthPct) {
        // No supranormal period to extend — solveable only at horizon = 0,
        // but the DCF math doesn't accept that. Surface honestly.
        return {
          solvedValue: 0,
          solveFor: "competitive_advantage",
          derivedEnterpriseValue: 0,
          residualError: target,
          iterations: 0,
          converged: false,
          interpretation: `Growth rate ${(growth * 100).toFixed(2)}% is at or below terminal ${(input.terminalGrowthPct * 100).toFixed(2)}% — no supranormal period to solve for.`,
        };
      }
      // EV is monotone increasing in horizon when growth > terminal.
      // Search horizon ∈ [1, 50] years.
      const { x, iterations, converged } = bisect({
        lo: 1,
        hi: 50,
        evaluate: (h) => dcfEv(input.baseFcf, growth, h, wacc, input.terminalGrowthPct),
        target,
        monotoneIncreasing: true,
      });
      const rounded = Math.max(1, Math.round(x));
      const derived = dcfEv(input.baseFcf, growth, rounded, wacc, input.terminalGrowthPct);
      const interpretation = !converged
        ? `Market's implied CAP falls outside 1–50 years. Likely the operator's growth or terminal assumption is misspecified.`
        : `Market is pricing in ~${rounded} years of ${(growth * 100).toFixed(2)}% supranormal growth before fading to ${(input.terminalGrowthPct * 100).toFixed(2)}% terminal. Compare to industry CAP base rates before underwriting.`;
      return {
        solvedValue: rounded,
        solveFor: "competitive_advantage",
        derivedEnterpriseValue: derived,
        residualError: Math.abs(derived - target),
        iterations,
        converged,
        interpretation,
      };
    }

    case "wacc": {
      const growth = input.growthRate;
      const horizon = input.horizonYears;
      if (growth == null || !Number.isFinite(growth)) {
        throw new Error("PIE wacc mode: growthRate must be finite");
      }
      if (horizon == null || !Number.isInteger(horizon) || horizon < 1) {
        throw new Error("PIE wacc mode: horizonYears must be a positive integer");
      }
      // EV is monotone DECREASING in wacc. Lower bound must be >
      // terminalGrowthPct to keep TV finite.
      const minWacc = input.terminalGrowthPct + 1e-4;
      const { x, iterations, converged } = bisect({
        lo: minWacc,
        hi: 0.5,
        evaluate: (w) => dcfEv(input.baseFcf, growth, horizon, w, input.terminalGrowthPct),
        target,
        monotoneIncreasing: false,
      });
      const derived = dcfEv(input.baseFcf, growth, horizon, x, input.terminalGrowthPct);
      const interpretation = !converged
        ? `Market's implied WACC falls outside (${(minWacc * 100).toFixed(2)}%, 50%). Either inputs are misspecified or the market is pricing in a risk premium outside typical bounds.`
        : `Market is pricing in a ${(x * 100).toFixed(2)}% discount rate. Compare to your own risk-free + equity-risk-premium estimate; a wider implied WACC suggests the market sees more risk than you do.`;
      return {
        solvedValue: x,
        solveFor: "wacc",
        derivedEnterpriseValue: derived,
        residualError: Math.abs(derived - target),
        iterations,
        converged,
        interpretation,
      };
    }
  }
}
