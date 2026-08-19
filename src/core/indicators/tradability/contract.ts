/**
 * Tradability contract — the three properties any masked indicator must satisfy,
 * expressed as check functions rather than prose so a future indicator can be held
 * to them without re-deriving the argument.
 *
 *   1. zero-on-mask   output is neutral wherever the output mask is false.
 *   2. independence   output does not depend on the value at a masked input cell.
 *   3. propagation    output mask is false if ANY input cell in the dependency
 *                     window is masked.
 *
 * Independence is verified by sentinel injection: overwrite the masked positions
 * with absurd values (1e12, NaN) and assert nothing downstream moves. That is how
 * the paper verifies it, and it is the part worth copying, because it converts an
 * abstract contract into a test any new indicator can run in three lines.
 */

import type { MaskedSeries, TradabilityMask } from "./mask.ts";

/** A rolling operator that consumes a mask and reports which outputs are usable. */
export type MaskedOperator = (
  series: readonly number[],
  mask: TradabilityMask,
) => MaskedSeries;

export type ContractProperty = "zero_on_mask" | "independence" | "propagation";

export interface ContractViolation {
  property: ContractProperty;
  index: number;
  detail: string;
}

export interface ContractReport {
  passed: boolean;
  violations: ContractViolation[];
}

/**
 * Sentinels chosen to be loud: a magnitude no price reaches, its negation, and a
 * value that poisons every arithmetic path it touches. A leak cannot hide behind
 * rounding.
 */
export const DEFAULT_SENTINELS: readonly number[] = [1e12, -1e12, NaN];

function report(violations: ContractViolation[]): ContractReport {
  return { passed: violations.length === 0, violations };
}

/**
 * Replace the value at every masked position with `sentinel`. Valid positions are
 * untouched, so any change in the output is proof the operator read a cell it had
 * no right to read.
 */
export function injectSentinels(
  series: readonly number[],
  mask: TradabilityMask,
  sentinel: number,
): number[] {
  return series.map((value, i) => (mask.tradable[i] === true ? value : sentinel));
}

/** Property 1: no number may be emitted where the output mask says unusable. */
export function checkZeroOnMask(output: MaskedSeries): ContractReport {
  const violations: ContractViolation[] = [];
  for (let i = 0; i < output.values.length; i++) {
    if (output.mask.tradable[i] === true) continue;
    const value = output.values[i];
    if (value !== null) {
      violations.push({
        property: "zero_on_mask",
        index: i,
        detail: `emitted ${String(value)} at a masked output`,
      });
    }
  }
  return report(violations);
}

/**
 * Property 2: sentinel injection at masked positions must not move any output, and
 * must not move the output mask either. A mask that shifts under injection means the
 * operator is deriving validity from values instead of from executability.
 */
export function checkIndependence(
  operator: MaskedOperator,
  series: readonly number[],
  mask: TradabilityMask,
  options: { sentinels?: readonly number[] } = {},
): ContractReport {
  const sentinels = options.sentinels ?? DEFAULT_SENTINELS;
  const baseline = operator(series, mask);
  const violations: ContractViolation[] = [];

  for (const sentinel of sentinels) {
    const perturbed = operator(injectSentinels(series, mask, sentinel), mask);

    for (let i = 0; i < baseline.values.length; i++) {
      if (baseline.mask.tradable[i] !== perturbed.mask.tradable[i]) {
        violations.push({
          property: "independence",
          index: i,
          detail: `output mask moved when sentinel ${String(sentinel)} was injected`,
        });
        continue;
      }
      if (!Object.is(baseline.values[i] ?? null, perturbed.values[i] ?? null)) {
        violations.push({
          property: "independence",
          index: i,
          detail:
            `output moved from ${String(baseline.values[i])} to ` +
            `${String(perturbed.values[i])} under sentinel ${String(sentinel)}`,
        });
      }
    }
  }

  return report(violations);
}

/**
 * Property 3: an output is valid only when its whole dependency window was
 * executable. One halted bar invalidates `window` outputs, not one.
 */
export function checkPropagation(
  outputMask: TradabilityMask,
  inputMask: TradabilityMask,
  window: number,
): ContractReport {
  const violations: ContractViolation[] = [];

  for (let i = 0; i < inputMask.length; i++) {
    const hasHistory = i >= window - 1;
    let clean = hasHistory;
    if (hasHistory) {
      for (let j = i - window + 1; j <= i; j++) {
        if (inputMask.tradable[j] !== true) {
          clean = false;
          break;
        }
      }
    }

    if (outputMask.tradable[i] === true && !clean) {
      violations.push({
        property: "propagation",
        index: i,
        detail: hasHistory
          ? "output valid despite a masked cell inside its dependency window"
          : "output valid before the window is fully populated",
      });
    } else if (outputMask.tradable[i] !== true && clean) {
      violations.push({
        property: "propagation",
        index: i,
        detail: "output invalidated despite a fully executable dependency window",
      });
    }
  }

  return report(violations);
}

/**
 * Run all three properties against an operator. This is the single call a new
 * indicator adds to its own test file to earn the right to be used on live money.
 */
export function checkTradabilityContract(
  operator: MaskedOperator,
  series: readonly number[],
  mask: TradabilityMask,
  options: { window: number; sentinels?: readonly number[] },
): ContractReport {
  const output = operator(series, mask);
  const violations = [
    ...checkZeroOnMask(output).violations,
    ...checkIndependence(operator, series, mask, { sentinels: options.sentinels })
      .violations,
    ...checkPropagation(output.mask, mask, options.window).violations,
  ];
  return report(violations);
}
