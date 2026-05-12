/**
 * Synthetic Futures Generator — Monte Carlo with Correlated Paths
 *
 * Generate realistic future price scenarios for stress-testing strategies
 * on conditions that haven't happened yet.
 *
 * "What if BTC drops 40% while rates rise 2%?" — run it.
 *
 * Features:
 *   - Cholesky-decomposed correlated returns (realistic correlation structure)
 *   - Multiple scenario branches (base, bull, bear, tail)
 *   - Event injection (earnings, FOMC, flash crash)
 *   - Configurable volatility, drift, and correlation per asset
 *
 * Source: Atlas GIC MiroFish (simulation-enhanced training)
 */

// ============================================================================
// Types
// ============================================================================

export interface AssetConfig {
  symbol: string;
  /** Current price. */
  currentPrice: number;
  /** Annual drift (expected return, decimal). Default 0. */
  annualDrift: number;
  /** Annual volatility (decimal). */
  annualVol: number;
}

export interface CorrelationPair {
  assetA: string;
  assetB: string;
  correlation: number;
}

export interface ScenarioEvent {
  /** Day on which the event occurs. */
  day: number;
  /** Which assets are affected. */
  affectedAssets: string[];
  /** Price shock (decimal, e.g., -0.05 = 5% drop). */
  shock: number;
  /** Label. */
  label: string;
}

export interface FuturesConfig {
  /** Number of days to simulate. Default 30. */
  horizonDays: number;
  /** Number of Monte Carlo paths per scenario. Default 100. */
  pathsPerScenario: number;
  /** Scenario types to generate. */
  scenarios: ScenarioType[];
  /** Injected events (e.g., earnings, FOMC). */
  events?: ScenarioEvent[];
  /** Trading days per year. Default 365 (crypto). */
  tradingDaysPerYear?: number;
}

export type ScenarioType = "base" | "bull" | "bear" | "tail_down" | "tail_up" | "vol_spike";

export interface SimulatedPath {
  /** Daily prices for each asset. paths[assetIndex][dayIndex]. */
  prices: number[][];
  /** Scenario type this path belongs to. */
  scenario: ScenarioType;
}

export interface FuturesResult {
  /** All simulated paths grouped by scenario. */
  scenarios: Record<ScenarioType, SimulatedPath[]>;
  /** Asset symbols in order. */
  assets: string[];
  /** Summary statistics per scenario per asset. */
  stats: Record<ScenarioType, Array<{
    symbol: string;
    medianReturn: number;
    p5Return: number;
    p95Return: number;
    maxDrawdown: number;
    endPrice: { median: number; p5: number; p95: number };
  }>>;
  /** Total paths generated. */
  totalPaths: number;
}

// ============================================================================
// Cholesky Decomposition
// ============================================================================

/**
 * Build correlation matrix from pairs. Diagonal = 1.
 */
function buildCorrelationMatrix(n: number, pairs: CorrelationPair[], assetIndex: Map<string, number>): number[][] {
  const matrix: number[][] = Array.from({ length: n }, (_, i) => {
    const row = new Array(n).fill(0) as number[];
    row[i] = 1; // Diagonal
    return row;
  });

  for (const pair of pairs) {
    const i = assetIndex.get(pair.assetA);
    const j = assetIndex.get(pair.assetB);
    if (i !== undefined && j !== undefined) {
      matrix[i]![j] = pair.correlation;
      matrix[j]![i] = pair.correlation;
    }
  }

  return matrix;
}

/**
 * Cholesky decomposition: A = L * L^T.
 * L is lower triangular. Used to generate correlated random variables.
 */
function choleskyDecomposition(matrix: number[][]): number[][] {
  const n = matrix.length;
  const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0) as number[]);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) {
        sum += L[i]![k]! * L[j]![k]!;
      }

      if (i === j) {
        const val = matrix[i]![i]! - sum;
        L[i]![j] = val > 0 ? Math.sqrt(val) : 0;
      } else {
        const diag = L[j]![j]!;
        L[i]![j] = diag > 0 ? (matrix[i]![j]! - sum) / diag : 0;
      }
    }
  }

  return L;
}

// ============================================================================
// Random Number Generation
// ============================================================================

/**
 * Box-Muller transform: generate standard normal random variable.
 */
function normalRandom(): number {
  let u1 = 0, u2 = 0;
  while (u1 === 0) u1 = Math.random();
  while (u2 === 0) u2 = Math.random();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

/**
 * Generate correlated normal random vector using Cholesky factor.
 */
function correlatedNormals(L: number[][], n: number): number[] {
  const z = Array.from({ length: n }, () => normalRandom());
  const correlated: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = 0; j <= i; j++) {
      sum += L[i]![j]! * z[j]!;
    }
    correlated[i] = sum;
  }
  return correlated;
}

// ============================================================================
// Scenario Drift/Vol Modifiers
// ============================================================================

function getScenarioModifiers(scenario: ScenarioType): { driftMult: number; volMult: number } {
  switch (scenario) {
    case "base": return { driftMult: 1.0, volMult: 1.0 };
    case "bull": return { driftMult: 2.5, volMult: 0.8 };
    case "bear": return { driftMult: -2.0, volMult: 1.3 };
    case "tail_down": return { driftMult: -4.0, volMult: 2.5 };
    case "tail_up": return { driftMult: 4.0, volMult: 2.0 };
    case "vol_spike": return { driftMult: 0, volMult: 3.0 };
  }
}

// ============================================================================
// Main Generator
// ============================================================================

/**
 * Generate synthetic future price paths for multiple correlated assets.
 *
 * @param assets Asset configurations (current price, drift, vol).
 * @param correlations Pairwise correlations between assets.
 * @param config Simulation parameters.
 */
export function generateSyntheticFutures(
  assets: AssetConfig[],
  correlations: CorrelationPair[],
  config: FuturesConfig,
): FuturesResult {
  const n = assets.length;
  const horizonDays = config.horizonDays ?? 30;
  const pathsPerScenario = config.pathsPerScenario ?? 100;
  const tradingDays = config.tradingDaysPerYear ?? 365;

  // Build correlation matrix and Cholesky factor
  const assetIndex = new Map(assets.map((a, i) => [a.symbol, i]));
  const corrMatrix = buildCorrelationMatrix(n, correlations, assetIndex);
  const L = choleskyDecomposition(corrMatrix);

  // Build event map: day → { assetIndex → shock }
  const eventMap = new Map<number, Map<number, number>>();
  for (const event of config.events ?? []) {
    if (!eventMap.has(event.day)) eventMap.set(event.day, new Map());
    const dayEvents = eventMap.get(event.day)!;
    for (const symbol of event.affectedAssets) {
      const idx = assetIndex.get(symbol);
      if (idx !== undefined) dayEvents.set(idx, event.shock);
    }
  }

  const scenarios: Record<ScenarioType, SimulatedPath[]> = {
    base: [], bull: [], bear: [], tail_down: [], tail_up: [], vol_spike: [],
  };

  let totalPaths = 0;

  for (const scenario of config.scenarios) {
    const { driftMult, volMult } = getScenarioModifiers(scenario);

    for (let p = 0; p < pathsPerScenario; p++) {
      const prices: number[][] = Array.from({ length: n }, () => new Array(horizonDays + 1).fill(0) as number[]);

      // Initialize day 0
      for (let i = 0; i < n; i++) {
        prices[i]![0] = assets[i]!.currentPrice;
      }

      // Simulate each day
      for (let day = 1; day <= horizonDays; day++) {
        const z = correlatedNormals(L, n);

        for (let i = 0; i < n; i++) {
          const asset = assets[i]!;
          const dt = 1 / tradingDays;
          const drift = asset.annualDrift * driftMult * dt;
          const vol = asset.annualVol * volMult * Math.sqrt(dt);

          // Geometric Brownian Motion: S(t+1) = S(t) * exp((μ - σ²/2)dt + σ√dt * Z)
          let logReturn = (drift - 0.5 * vol * vol) + vol * z[i]!;

          // Apply event shock if any
          const dayEvents = eventMap.get(day);
          if (dayEvents?.has(i)) {
            logReturn += dayEvents.get(i)!;
          }

          prices[i]![day] = prices[i]![day - 1]! * Math.exp(logReturn);
        }
      }

      scenarios[scenario].push({ prices, scenario });
      totalPaths++;
    }
  }

  // Compute summary statistics
  const stats: FuturesResult["stats"] = {} as any;

  for (const scenario of config.scenarios) {
    const paths = scenarios[scenario];
    stats[scenario] = assets.map((asset, i) => {
      const finalPrices = paths.map((p) => p.prices[i]![horizonDays]!);
      const returns = finalPrices.map((fp) => (fp - asset.currentPrice) / asset.currentPrice);
      returns.sort((a, b) => a - b);

      // Max drawdown across all paths (median)
      const drawdowns = paths.map((p) => {
        let peak = p.prices[i]![0]!;
        let maxDD = 0;
        for (let d = 1; d <= horizonDays; d++) {
          if (p.prices[i]![d]! > peak) peak = p.prices[i]![d]!;
          const dd = (peak - p.prices[i]![d]!) / peak;
          if (dd > maxDD) maxDD = dd;
        }
        return maxDD;
      });
      drawdowns.sort((a, b) => a - b);

      finalPrices.sort((a, b) => a - b);

      return {
        symbol: asset.symbol,
        medianReturn: returns[Math.floor(returns.length / 2)]!,
        p5Return: returns[Math.floor(returns.length * 0.05)]!,
        p95Return: returns[Math.floor(returns.length * 0.95)]!,
        maxDrawdown: drawdowns[Math.floor(drawdowns.length / 2)]!,
        endPrice: {
          median: finalPrices[Math.floor(finalPrices.length / 2)]!,
          p5: finalPrices[Math.floor(finalPrices.length * 0.05)]!,
          p95: finalPrices[Math.floor(finalPrices.length * 0.95)]!,
        },
      };
    });
  }

  return {
    scenarios,
    assets: assets.map((a) => a.symbol),
    stats,
    totalPaths,
  };
}

/**
 * Format futures result summary for display.
 */
export function formatFuturesSummary(result: FuturesResult): string {
  const lines: string[] = [`Synthetic Futures (${result.totalPaths} paths)`, ""];

  for (const [scenario, assetStats] of Object.entries(result.stats)) {
    lines.push(`  ${scenario.toUpperCase()}:`);
    for (const stat of assetStats) {
      lines.push(
        `    ${stat.symbol.padEnd(8)} median: ${(stat.medianReturn * 100).toFixed(1)}%  ` +
        `range: [${(stat.p5Return * 100).toFixed(1)}%, ${(stat.p95Return * 100).toFixed(1)}%]  ` +
        `DD: ${(stat.maxDrawdown * 100).toFixed(1)}%  ` +
        `price: $${stat.endPrice.median.toFixed(0)} [$${stat.endPrice.p5.toFixed(0)}-$${stat.endPrice.p95.toFixed(0)}]`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}
