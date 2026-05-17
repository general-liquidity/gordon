/**
 * Shannon's Demon Rebalancer (GORDON_SHANNONS_DEMON).
 *
 * Port of Ch 13 from Ryan Wright. Claude Shannon's 1940s thought
 * experiment: a stock that doubles one year and halves the next produces
 * zero buy-and-hold return, but a 50/50 stock/cash rebalanced annually
 * harvests the volatility for a positive geometric return.
 *
 *   Year 1: stock 100 → 200, allocation 50/50 = 150 total, rebalance to 75/75
 *   Year 2: stock halves → 37.50, cash still 75 = 112.50 total
 *
 * Same underlying flat asset, +12.5% rebalanced. The trick:
 * rebalancing forces sell-high / buy-low behavior, harvesting variance
 * as return on assets where directional bet has zero expectancy.
 *
 * Caveat Wright is explicit about: the demon dies if you cross an
 * absorbing barrier (margin call, broker liquidation) during a deep
 * drawdown. Pair with `absorbingBarrier.ts` (WW2) before applying.
 *
 * Pure compute. No persistence. Given current allocations + target
 * weights + total portfolio value, returns rebalance trades that
 * restore target weights, plus an estimate of harvested return when
 * called repeatedly on simulated mean-reverting paths.
 */

export const SHANNONS_DEMON_FLAG_ENV = "GORDON_SHANNONS_DEMON";

export function isShannonsDemonEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env[SHANNONS_DEMON_FLAG_ENV] === "1" ||
    env[SHANNONS_DEMON_FLAG_ENV] === "true"
  );
}

export interface Allocation {
  symbol: string;
  /** Current market value of the position in account currency. */
  currentValueUsd: number;
}

export interface AllocationTarget {
  symbol: string;
  /** Target weight in [0, 1]. All targets must sum to 1.0 (within tolerance). */
  targetWeight: number;
}

export interface RebalanceInput {
  allocations: ReadonlyArray<Allocation>;
  targets: ReadonlyArray<AllocationTarget>;
  /** Minimum imbalance threshold to actually rebalance (fraction). Default 0.05. */
  minDriftToRebalance?: number;
}

export interface RebalanceTrade {
  symbol: string;
  /** Negative = sell, positive = buy. In account currency. */
  deltaUsd: number;
  currentWeight: number;
  targetWeight: number;
  driftFraction: number;
}

export interface RebalanceResult {
  totalValueUsd: number;
  trades: RebalanceTrade[];
  triggered: boolean;
  maxDrift: number;
  reason: string;
}

const DEFAULT_MIN_DRIFT = 0.05;
const TARGET_SUM_TOLERANCE = 0.01;

export class TargetWeightSumError extends Error {
  constructor(observed: number) {
    super(`Target weights must sum to 1.0 (observed ${observed.toFixed(4)})`);
    this.name = "TargetWeightSumError";
  }
}

export function rebalance(input: RebalanceInput): RebalanceResult {
  const targetSum = input.targets.reduce((s, t) => s + t.targetWeight, 0);
  if (Math.abs(targetSum - 1) > TARGET_SUM_TOLERANCE) {
    throw new TargetWeightSumError(targetSum);
  }

  const totalValueUsd = input.allocations.reduce((s, a) => s + a.currentValueUsd, 0);
  const minDrift = input.minDriftToRebalance ?? DEFAULT_MIN_DRIFT;
  const targetBySymbol = new Map(input.targets.map((t) => [t.symbol, t.targetWeight]));

  const trades: RebalanceTrade[] = [];
  let maxDrift = 0;

  for (const alloc of input.allocations) {
    const target = targetBySymbol.get(alloc.symbol) ?? 0;
    const currentWeight = totalValueUsd > 0 ? alloc.currentValueUsd / totalValueUsd : 0;
    const targetValue = target * totalValueUsd;
    const deltaUsd = targetValue - alloc.currentValueUsd;
    const driftFraction = Math.abs(currentWeight - target);
    if (driftFraction > maxDrift) maxDrift = driftFraction;
    trades.push({
      symbol: alloc.symbol,
      deltaUsd,
      currentWeight,
      targetWeight: target,
      driftFraction,
    });
  }

  const triggered = maxDrift >= minDrift;
  const reason = triggered
    ? `Max drift ${(maxDrift * 100).toFixed(2)}% ≥ threshold ${(minDrift * 100).toFixed(2)}% — rebalance`
    : `Max drift ${(maxDrift * 100).toFixed(2)}% < threshold ${(minDrift * 100).toFixed(2)}% — no action`;

  return { totalValueUsd, trades, triggered, maxDrift, reason };
}

/**
 * Simulate a Shannon's Demon path on a single asset that doubles then
 * halves (Wright's exact example). Returns the terminal value of a
 * portfolio that started with `initialUsd` split per `targetWeight`
 * (asset vs cash) and rebalanced after each move.
 */
export function simulateDoubleHalfPath(
  initialUsd: number,
  targetAssetWeight: number,
): { finalValueUsd: number; assetReturn: number; rebalanceReturn: number } {
  let asset = initialUsd * targetAssetWeight;
  let cash = initialUsd * (1 - targetAssetWeight);

  asset *= 2;
  let total = asset + cash;
  asset = total * targetAssetWeight;
  cash = total * (1 - targetAssetWeight);

  asset *= 0.5;
  total = asset + cash;

  return {
    finalValueUsd: total,
    assetReturn: 0,
    rebalanceReturn: total / initialUsd - 1,
  };
}

export function formatRebalance(result: RebalanceResult): string {
  const lines: string[] = [];
  lines.push(`Shannon's Demon rebalance ($${result.totalValueUsd.toFixed(2)}): ${result.triggered ? "TRIGGERED" : "skipped"}`);
  lines.push(`  ${result.reason}`);
  if (result.triggered) {
    for (const t of result.trades) {
      const action = t.deltaUsd >= 0 ? "BUY" : "SELL";
      lines.push(
        `  ${action} ${t.symbol}: ${Math.abs(t.deltaUsd).toFixed(2)} (${(t.currentWeight * 100).toFixed(1)}% → ${(t.targetWeight * 100).toFixed(1)}%)`,
      );
    }
  }
  return lines.join("\n");
}

export function rebalanceToPayload(result: RebalanceResult): Record<string, unknown> {
  return {
    kind: "shannons_demon.rebalance",
    triggered: result.triggered,
    maxDrift: Number(result.maxDrift.toFixed(4)),
    totalValue: Number(result.totalValueUsd.toFixed(2)),
    tradeCount: result.trades.filter((t) => Math.abs(t.deltaUsd) > 0.01).length,
  };
}
