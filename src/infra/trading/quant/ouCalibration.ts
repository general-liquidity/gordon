/**
 * Ornstein-Uhlenbeck (OU) Spread Calibration + cost-calibrated entry z-score.
 *
 * Gordon already has the *consumer* of OU parameters
 * (`optimalPairsTrading.ts`, which TAKES θ/μ/σ as input) and the spread
 * *generator* (`cointegration.ts`, Engle-Granger residuals with a private
 * half-life). The missing piece, supplied here, is the OU *estimator*:
 * fit (θ, μ, σ) from a spread series, plus the minimum viable entry
 * z-score implied by trading costs.
 *
 * Model:   dX_t = θ·(μ − X_t) dt + σ·dW_t
 * Discrete form is an AR(1):   X_t = a + b·X_{t-1} + ε_t   (fit by OLS)
 *   θ        = (1 − b) / dt                       (mean-reversion speed)
 *   μ        = a / (θ · dt)                       (long-run mean)
 *   σ        = stdev(residuals, ddof=1) / √dt     (diffusion)
 *   halfLife = ln(2) / θ                          (same time units as dt)
 *   ouStd    = σ / √(2θ)                          (equilibrium dispersion)
 *
 * ouStd is the steady-state standard deviation of the spread and is what
 * threshold calibration keys off — NOT the diffusion σ.
 *
 * Pure compute, no I/O.
 */

// ============================================================================
// Types
// ============================================================================

export interface OUParams {
  /** Mean-reversion speed θ (per unit time; clamped ≥ 1e-10). */
  theta: number;
  /** Long-run mean μ. */
  mu: number;
  /** Diffusion coefficient σ. */
  sigma: number;
  /** Half-life of mean reversion ln(2)/θ (same time units as dt). */
  halfLife: number;
  /** Equilibrium standard deviation σ/√(2θ) — drives threshold calibration. */
  ouStd: number;
  /** Whether the half-life sits in the practical trading band. */
  tradeable: boolean;
}

const MIN_THETA = 1e-10;
const MIN_OBSERVATIONS = 10;

function degenerate(): OUParams {
  return {
    theta: MIN_THETA,
    mu: 0,
    sigma: 0,
    halfLife: Infinity,
    ouStd: Infinity,
    tradeable: false,
  };
}

// ============================================================================
// OLS (AR(1)) calibration
// ============================================================================

/**
 * Fit the OU process to a spread series.
 *
 * @param spread Spread series (e.g. cointegration residuals).
 * @param dt     Time step between observations (default 1, i.e. daily bars).
 * @param opts   Optional half-life band for the `tradeable` flag.
 */
export function calibrateOU(
  spread: number[],
  dt: number = 1,
  opts?: { minHalfLife?: number; maxHalfLife?: number },
): OUParams {
  if (spread.length < MIN_OBSERVATIONS) return degenerate();

  const minHalfLife = opts?.minHalfLife ?? 5;
  const maxHalfLife = opts?.maxHalfLife ?? 60;

  // AR(1): X_t = a + b·X_{t-1} + ε_t
  const x = spread.slice(0, -1); // X_{t-1}
  const y = spread.slice(1); // X_t
  const n = x.length;

  const sumX = x.reduce((s, v) => s + v, 0);
  const sumY = y.reduce((s, v) => s + v, 0);
  const sumXY = x.reduce((s, v, i) => s + v * y[i]!, 0);
  const sumX2 = x.reduce((s, v) => s + v * v, 0);

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return degenerate();

  const b = (n * sumXY - sumX * sumY) / denom;
  const a = (sumY - b * sumX) / n;

  // θ = (1 − b)/dt, clamped so downstream √(2θ) and ln(2)/θ stay defined.
  const theta = Math.max((1 - b) / dt, MIN_THETA);
  // μ = a / (θ·dt) — recovers the long-run mean from the AR(1) intercept.
  const mu = a / (theta * dt);

  // Residual standard deviation, ddof=1 (sample): the AR(1) consumed two
  // degrees of freedom (a, b), so divide by (n − 2) for an unbiased σ.
  const residuals = y.map((yi, i) => yi - (a + b * x[i]!));
  const rss = residuals.reduce((s, r) => s + r * r, 0);
  const residStd = n > 2 ? Math.sqrt(rss / (n - 2)) : 0;
  const sigma = residStd / Math.sqrt(dt);

  const halfLife = theta > 0 ? Math.log(2) / theta : Infinity;
  const ouStd = theta > 0 ? sigma / Math.sqrt(2 * theta) : Infinity;

  const tradeable =
    Number.isFinite(halfLife) &&
    halfLife >= minHalfLife &&
    halfLife <= maxHalfLife;

  return { theta, mu, sigma, halfLife, ouStd, tradeable };
}

// ============================================================================
// Cost-calibrated entry z-score
// ============================================================================

/**
 * Minimum entry z-score for the trade to clear costs.
 *
 * A pairs round trip is 4 transactions (open leg A, open leg B, close
 * leg A, close leg B), so the cost floor scales the per-transaction cost
 * by 4. We express that floor in z-units by dividing by the equilibrium
 * dispersion ouStd.
 *
 *   minEntryZ = (4 · costFraction) / ouStd,  costFraction = costBps / 10_000
 *
 * Non-finite or non-positive ouStd → Infinity (non-tradeable).
 */
export function minimumEntryZScore(ouStd: number, costBps: number): number {
  if (!Number.isFinite(ouStd) || ouStd <= 0) return Infinity;
  const costFraction = costBps / 10_000;
  return (4 * costFraction) / ouStd;
}

/** Never enter below the cost floor: max(desired, cost-implied minimum). */
export function effectiveEntryZ(desiredEntryZ: number, minEntryZ: number): number {
  return Math.max(desiredEntryZ, minEntryZ);
}

/** Recommended exit z ≈ half the effective entry (caller decides usage). */
export function recommendedExitZ(effectiveEntryZ: number): number {
  return effectiveEntryZ / 2;
}

// ============================================================================
// Formatting
// ============================================================================

/** Short multi-line summary, mirroring formatCointegrationResult's style. */
export function formatOUParams(p: OUParams): string {
  const lines: string[] = [];
  lines.push("OU Spread Calibration");
  lines.push(`  θ (mean-reversion): ${p.theta.toFixed(4)}`);
  lines.push(`  μ (long-run mean): ${p.mu.toFixed(4)}`);
  lines.push(`  σ (diffusion): ${p.sigma.toFixed(4)}`);
  lines.push(
    `  Half-Life: ${Number.isFinite(p.halfLife) ? `${p.halfLife.toFixed(1)} periods` : "N/A (no mean reversion)"}`,
  );
  lines.push(
    `  OU Std (equilibrium): ${Number.isFinite(p.ouStd) ? p.ouStd.toFixed(4) : "N/A"}`,
  );
  lines.push(`  Tradeable: ${p.tradeable ? "YES" : "NO"}`);
  return lines.join("\n");
}
