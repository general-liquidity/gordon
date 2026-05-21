/**
 * Fundamental Law of Active Management (GORDON_FUNDAMENTAL_LAW_AM).
 *
 * Grinold-Kahn's Sharpe-ratio decomposition:
 *
 *   Sharpe = IC × √breadth
 *
 * where IC is the information coefficient (correlation between the trader's
 * alphas and realised returns), and breadth is the number of independent
 * trading decisions per year. This gives the theoretical upper bound on the
 * Sharpe ratio achievable by a strategy with a given edge size and trading
 * frequency.
 *
 * Useful as a pre-trade sanity check. Example: IC = 0.05 and breadth = 50 →
 * best possible Sharpe is 0.35. No amount of clever sizing will lift it.
 * Pursue strategies where IC × √N implies the target Sharpe is at least
 * achievable in principle.
 *
 * Inverse calculations:
 *   - required IC for a target Sharpe at given breadth
 *   - required breadth for a target Sharpe at given IC
 *
 * Pairs with `barrierTradingThresholds.ts` (G2): G2's breadth output feeds
 * directly into this primitive's `breadthPerYear` input to score whether
 * the chosen barriers leave enough trading frequency for the desired
 * Sharpe target.
 *
 * Source: Giller, "Essays on Trading Strategy" (2023), Essay 5.2.1.
 *         Original: Grinold & Kahn, "Active Portfolio Management" (2000).
 *
 * Pure compute. No I/O.
 */

export const FUNDAMENTAL_LAW_AM_FLAG_ENV = "GORDON_FUNDAMENTAL_LAW_AM";

export function isFundamentalLawAMEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env[FUNDAMENTAL_LAW_AM_FLAG_ENV] === "1" ||
    env[FUNDAMENTAL_LAW_AM_FLAG_ENV] === "true"
  );
}

export interface FundamentalLawAMInput {
  /** Information coefficient (correlation between alpha forecast and realised return). */
  informationCoefficient: number;
  /** Annual breadth: number of independent trading decisions per year. */
  breadthPerYear: number;
  /** Optional: target Sharpe ratio for gap analysis. */
  targetSharpe?: number;
}

export interface FundamentalLawAMResult {
  /** Theoretical Sharpe = IC × √breadth. */
  theoreticalSharpe: number;
  informationCoefficient: number;
  breadthPerYear: number;
  /** If targetSharpe given: IC needed at current breadth to hit it. */
  requiredICForTarget: number | null;
  /** If targetSharpe given: breadth needed at current IC to hit it. */
  requiredBreadthForTarget: number | null;
  /** If targetSharpe given: whether theoreticalSharpe ≥ targetSharpe. */
  meetsTarget: boolean | null;
  reasoning: string;
}

export function computeFundamentalLawAM(
  input: FundamentalLawAMInput,
): FundamentalLawAMResult {
  const ic = input.informationCoefficient;
  const breadth = input.breadthPerYear;

  if (breadth < 0) {
    throw new Error("breadthPerYear must be non-negative");
  }
  if (ic < -1 || ic > 1) {
    throw new Error("informationCoefficient must lie in [-1, 1]");
  }

  const theoreticalSharpe = ic * Math.sqrt(breadth);

  let requiredICForTarget: number | null = null;
  let requiredBreadthForTarget: number | null = null;
  let meetsTarget: boolean | null = null;
  if (input.targetSharpe !== undefined) {
    const target = input.targetSharpe;
    requiredICForTarget = breadth > 0 ? target / Math.sqrt(breadth) : Infinity;
    requiredBreadthForTarget = ic !== 0 ? (target / ic) ** 2 : Infinity;
    meetsTarget = theoreticalSharpe >= target;
  }

  const reasoning =
    `IC=${ic.toFixed(4)}, breadth=${breadth.toFixed(1)}/year → ` +
    `theoretical Sharpe=${theoreticalSharpe.toFixed(3)}` +
    (input.targetSharpe !== undefined
      ? `; target=${input.targetSharpe.toFixed(2)} ` +
        `(${meetsTarget ? "achievable" : "infeasible"} at this edge/frequency)`
      : "");

  return {
    theoreticalSharpe,
    informationCoefficient: ic,
    breadthPerYear: breadth,
    requiredICForTarget,
    requiredBreadthForTarget,
    meetsTarget,
    reasoning,
  };
}

export function fundamentalLawAMToPayload(
  result: FundamentalLawAMResult,
): Record<string, unknown> {
  return {
    kind: "fundamental_law_am.computed",
    theoreticalSharpe: Number(result.theoreticalSharpe.toFixed(4)),
    informationCoefficient: Number(result.informationCoefficient.toFixed(4)),
    breadthPerYear: Number(result.breadthPerYear.toFixed(2)),
    requiredICForTarget:
      result.requiredICForTarget !== null && Number.isFinite(result.requiredICForTarget)
        ? Number(result.requiredICForTarget.toFixed(4))
        : result.requiredICForTarget,
    requiredBreadthForTarget:
      result.requiredBreadthForTarget !== null &&
      Number.isFinite(result.requiredBreadthForTarget)
        ? Number(result.requiredBreadthForTarget.toFixed(2))
        : result.requiredBreadthForTarget,
    meetsTarget: result.meetsTarget,
  };
}
