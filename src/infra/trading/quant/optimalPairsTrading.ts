/**
 * Optimal Pairs Trading on Cointegrated Spread — CJ4.
 *
 * Long-horizon stationary optimal trading speed for pairs trading on
 * an Ornstein-Uhlenbeck (mean-reverting) spread, with quadratic costs
 * and risk aversion.
 *
 * Model (Cartea-Jaimungal-Penalva 2015 ch. 12 / Drissi 2024 Sec 12):
 *   Spread:   dX_t = θ·(μ − X_t) dt + σ·dW_t        (OU mean-reverting)
 *   Position: dQ_t = ν_t dt                          (spread inventory)
 *   Wealth:   dC_t = -ν_t · X_t dt − k·ν_t² dt      (linear-impact cost)
 *   Objective: maximize E[C_T + Q_T·X_T − γ·∫Q_t² dt − α·Q_T²]
 *
 *   θ = OU mean-reversion rate (>0)
 *   μ = equilibrium spread level
 *   σ = OU volatility
 *   k = quadratic execution cost (impact)
 *   γ = running inventory penalty (risk aversion, ≥0)
 *
 * Long-horizon stationary policy (T→∞ limit):
 *
 *   ν*(q, X) = −A · q − B · (X − μ)
 *
 *   A = √(γ·σ² / k) + θ/2 − √((θ/2)² + γ·σ²/k)   ... rearranged form
 *
 *   For the symmetric problem (which is what this implementation
 *   targets), the closed-form coefficients are:
 *
 *   B = θ / (k · (2·A/k + θ))
 *   A = solution to algebraic Riccati equation:
 *       (A/k)² + θ·(A/k) − γ·σ²/k = 0
 *     → A/k = (−θ + √(θ² + 4·γ·σ²/k)) / 2
 *
 * Behavior:
 *   - X = μ, q = 0 → ν* = 0 (no trade at equilibrium with no position)
 *   - X > μ, q = 0 → ν* < 0 (sell spread when overpriced)
 *   - X < μ, q = 0 → ν* > 0 (buy spread when underpriced)
 *   - q > 0, X = μ → ν* < 0 (unwind inventory at equilibrium)
 *   - higher θ → larger response to mispricing
 *   - higher k → smaller response (impact dampens)
 *   - higher γ → faster inventory reduction (risk-averse)
 *
 * Sign convention: q is the spread position (long spread = long asset
 * A, short asset B with hedge ratio). ν > 0 increases the long-spread
 * position; ν < 0 decreases it.
 *
 * Pedigree: Drissi (2022) "Solvability of differential Riccati
 * equations and applications to algorithmic trading with signals,"
 * SSRN. Cartea-Jaimungal-Penalva (2015) ch. 12. Long-horizon
 * stationary limit chosen for deterministic closed-form (full
 * time-dependent version requires solving a matrix Riccati ODE which
 * has no closed form and is deferred).
 *
 * Pure compute. Consumes Gordon's existing cointegration detection
 * (`src/infra/trading/quant/cointegration.ts`) which produces θ, μ, σ
 * estimates upstream.
 */

export interface OptimalPairsTradingInput {
  /** Current spread value X_t. */
  currentSpread: number;
  /** Equilibrium spread μ (OU mean). */
  equilibriumSpread: number;
  /** OU mean-reversion rate θ (>0). Faster reversion = larger θ. */
  meanReversionRate: number;
  /** OU volatility σ (>0). */
  spreadVolatility: number;
  /** Current spread position q (signed; long spread = positive). */
  currentInventory: number;
  /** Linear-impact coefficient k (>0). */
  impactCoef: number;
  /** Running inventory penalty γ (≥0). 0 = no risk aversion. Default 0.01. */
  riskAversion?: number;
}

export interface OptimalPairsTradingResult {
  /** Optimal trading speed ν* (units per time, signed). */
  tradingSpeed: number;
  /** Inventory-reversion coefficient A. */
  inventoryCoef: number;
  /** Spread-response coefficient B. */
  spreadCoef: number;
  /** Inventory-reversion contribution to speed (−A·q). */
  inventoryContribution: number;
  /** Spread-response contribution to speed (−B·(X−μ)). */
  spreadContribution: number;
  /** Implied position half-life (ln 2 / A) — time to unwind half the inventory. */
  inventoryHalfLife: number;
  reasoning: string;
}

export function computeOptimalPairsTrading(
  input: OptimalPairsTradingInput,
): OptimalPairsTradingResult {
  if (input.meanReversionRate <= 0) {
    throw new Error("meanReversionRate must be > 0");
  }
  if (input.spreadVolatility <= 0) {
    throw new Error("spreadVolatility must be > 0");
  }
  if (input.impactCoef <= 0) {
    throw new Error("impactCoef must be > 0");
  }
  const gamma = input.riskAversion ?? 0.01;
  if (gamma < 0) {
    throw new Error("riskAversion must be ≥ 0");
  }

  const theta = input.meanReversionRate;
  const sigma = input.spreadVolatility;
  const k = input.impactCoef;
  const q = input.currentInventory;
  const X = input.currentSpread;
  const mu = input.equilibriumSpread;
  const spreadDeviation = X - mu;

  // Algebraic Riccati equation for A:
  //   (A/k)² + θ·(A/k) − γ·σ²/k = 0
  // Positive root:
  const aOverK = (-theta + Math.sqrt(theta * theta + (4 * gamma * sigma * sigma) / k)) / 2;
  const A = aOverK * k;

  // B from the coupling equation. In the symmetric stationary form:
  //   B = θ / (2·A/k + θ)
  // which gives B ∈ (0, 1) — bounded response to spread deviation.
  const B = theta / (2 * aOverK + theta);

  // Optimal speed: ν*(q, X) = −A·q − B·(X − μ)
  const inventoryContribution = -A * q;
  const spreadContribution = -B * spreadDeviation;
  const tradingSpeed = inventoryContribution + spreadContribution;

  const inventoryHalfLife = A > 0 ? Math.log(2) / A : Infinity;

  const reasoning =
    `OptimalPairs X=${X.toFixed(4)} (μ=${mu}, dev=${spreadDeviation.toFixed(4)}), ` +
    `q=${q.toFixed(2)}, θ=${theta}, σ=${sigma}, γ=${gamma}, k=${k}: ` +
    `A=${A.toFixed(4)} B=${B.toFixed(4)} → ν*=${tradingSpeed.toFixed(4)} ` +
    `(inv=${inventoryContribution.toFixed(4)} + spread=${spreadContribution.toFixed(4)}, ` +
    `inventory half-life=${inventoryHalfLife.toFixed(2)}).`;

  return {
    tradingSpeed,
    inventoryCoef: A,
    spreadCoef: B,
    inventoryContribution,
    spreadContribution,
    inventoryHalfLife,
    reasoning,
  };
}

export function optimalPairsTradingToPayload(
  result: OptimalPairsTradingResult,
): Record<string, unknown> {
  return {
    kind: "optimal_pairs_trading.computed",
    tradingSpeed: Number(result.tradingSpeed.toFixed(6)),
    inventoryCoef: Number(result.inventoryCoef.toFixed(6)),
    spreadCoef: Number(result.spreadCoef.toFixed(6)),
    inventoryHalfLife: Number.isFinite(result.inventoryHalfLife)
      ? Number(result.inventoryHalfLife.toFixed(4))
      : null,
  };
}
