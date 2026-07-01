/**
 * Rolling-Cointegration Pair-Health Monitor
 *
 * The Cranfield 2025 pairs-trading study's central operational finding:
 * pairs-trading success depends on cointegration *stability over time*, not
 * one-time selection. A pair that passes a single static cointegration test
 * can silently decouple — a structural break — and keep generating spread
 * signals against a relationship that no longer holds.
 *
 * This module re-tests cointegration on a trailing rolling window and emits a
 * 3-state regime (ACTIVE / WARNING / HALTED) so the live system knows when to
 * trade, hold, or stand aside. It reads `testCointegration` from
 * cointegration.ts; it does not reimplement the statistics.
 *
 * Gordon's ADF returns a *t-statistic* (more negative = more cointegrated)
 * plus critical values, NOT a continuous p-value — so the health signal is the
 * ADF statistic measured against the result's own critical values.
 */

import { testCointegration } from "./cointegration.ts";

// ============================================================================
// Types
// ============================================================================

export interface RollingCointPoint {
  /** ADF statistic for the trailing window ending at this bar (NaN before window is available). */
  adfStat: number;
  /** Whether the trailing window is cointegrated at any level (pct10 gate). */
  cointegrated: boolean;
  /** Half-life of mean reversion for the trailing window (Infinity if none). */
  halfLife: number;
}

export type PairRegimeStatus = "ACTIVE" | "WARNING" | "HALTED";

export interface PairRegimeOptions {
  /** Trailing window length for each rolling re-test. */
  window?: number;
  /** Minimum acceptable half-life (periods). Too-fast reversion is noise, not a tradeable spread. */
  halfLifeMin?: number;
  /** Maximum acceptable half-life (periods). Too-slow reversion ties up capital. */
  halfLifeMax?: number;
}

export interface PairRegime {
  status: PairRegimeStatus;
  /** ADF statistic of the most-recent window. */
  adfStat: number;
  /** Half-life of the most-recent window. */
  halfLife: number;
  /** Strictest gate the latest window clears, or null if not cointegrated. */
  cointegratedAt: "5%" | "10%" | null;
  /** Convenience flag — true only when status is ACTIVE. */
  active: boolean;
}

const DEFAULT_WINDOW = 252;
const DEFAULT_HALF_LIFE_MIN = 5;
const DEFAULT_HALF_LIFE_MAX = 60;

// ============================================================================
// Rolling cointegration
// ============================================================================

/**
 * Re-test cointegration on every trailing `window`-bar slice. Index i < window
 * has insufficient history and is filled with a NaN/false placeholder so the
 * output array aligns 1:1 with the input bars.
 *
 * O(N * window): one O(window) re-test per bar. Fine for a once-per-day health
 * check on daily bars.
 */
export function rollingCointegration(
  pricesX: number[],
  pricesY: number[],
  window: number = DEFAULT_WINDOW,
): RollingCointPoint[] {
  const n = Math.min(pricesX.length, pricesY.length);
  const out: RollingCointPoint[] = new Array(n);

  for (let i = 0; i < n; i++) {
    if (i < window - 1) {
      out[i] = { adfStat: NaN, cointegrated: false, halfLife: NaN };
      continue;
    }
    const start = i - window + 1;
    const wx = pricesX.slice(start, i + 1);
    const wy = pricesY.slice(start, i + 1);
    const r = testCointegration(wx, wy);
    out[i] = {
      adfStat: r.adfStatistic,
      cointegrated: r.cointegrated,
      halfLife: r.halfLife,
    };
  }

  return out;
}

// ============================================================================
// Current regime
// ============================================================================

/**
 * Compute the current pair-health regime from the most-recent trailing window.
 *
 * The 3-state design (vs a binary on/off) exists to avoid cliff-edge churn —
 * the WARNING band is a transition that prevents exiting on temporary noise.
 */
export function pairRegimeMonitor(
  pricesX: number[],
  pricesY: number[],
  opts: PairRegimeOptions = {},
): PairRegime {
  const window = opts.window ?? DEFAULT_WINDOW;
  const halfLifeMin = opts.halfLifeMin ?? DEFAULT_HALF_LIFE_MIN;
  const halfLifeMax = opts.halfLifeMax ?? DEFAULT_HALF_LIFE_MAX;

  const n = Math.min(pricesX.length, pricesY.length);
  const halted = (adfStat: number, halfLife: number): PairRegime => ({
    status: "HALTED",
    adfStat,
    halfLife,
    cointegratedAt: null,
    active: false,
  });

  if (n < window) return halted(NaN, NaN);

  const wx = pricesX.slice(-window);
  const wy = pricesY.slice(-window);
  const r = testCointegration(wx, wy);

  const adfStat = r.adfStatistic;
  const halfLife = r.halfLife;
  const halfLifeInRange = halfLife >= halfLifeMin && halfLife <= halfLifeMax;

  const passesStrict = adfStat < r.criticalValues.pct5;
  const passesLoose = adfStat < r.criticalValues.pct10;

  if (passesStrict && halfLifeInRange) {
    return { status: "ACTIVE", adfStat, halfLife, cointegratedAt: "5%", active: true };
  }
  if (passesLoose && halfLifeInRange) {
    // Weakening: hold existing positions, open nothing new.
    return { status: "WARNING", adfStat, halfLife, cointegratedAt: "10%", active: false };
  }

  return {
    status: "HALTED",
    adfStat,
    halfLife,
    cointegratedAt: passesStrict ? "5%" : passesLoose ? "10%" : null,
    active: false,
  };
}

// ============================================================================
// Complementary health input (Kalman P_trace)
// ============================================================================

/**
 * A second, complementary pair-health verdict derived OUTSIDE the ADF/half-life
 * test — currently the Kalman covariance-trace percentile signal. "degraded"
 * means the hedge-ratio filter is unusually uncertain right now.
 */
export type PairHealthSignal = "healthy" | "degraded";

/**
 * Fold a complementary health signal into the ADF-driven 3-state regime WITHOUT
 * replacing the ADF input. It can only make the regime stricter, never looser:
 * a degraded filter caps ACTIVE at WARNING (hold, open nothing new) but never
 * forces HALTED on its own — flattening stays reserved for genuine cointegration
 * decay measured by the ADF statistic. WARNING/HALTED pass through unchanged.
 */
export function combineRegimeWithHealth(
  adfRegime: PairRegimeStatus,
  health: PairHealthSignal,
): PairRegimeStatus {
  if (health === "degraded" && adfRegime === "ACTIVE") return "WARNING";
  return adfRegime;
}

// ============================================================================
// Formatting
// ============================================================================

export function formatPairRegime(r: PairRegime, symbolX: string, symbolY: string): string {
  const lines: string[] = [];
  lines.push(`Pair Health: ${symbolX} / ${symbolY}`);
  lines.push(`  Regime: ${r.status}${r.active ? " (tradeable)" : ""}`);
  lines.push(`  Cointegrated: ${r.cointegratedAt ? `YES (${r.cointegratedAt} gate)` : "NO"}`);
  lines.push(`  ADF Statistic: ${Number.isNaN(r.adfStat) ? "N/A" : r.adfStat.toFixed(3)}`);
  lines.push(
    `  Half-Life: ${
      Number.isNaN(r.halfLife) || r.halfLife === Infinity ? "N/A" : `${r.halfLife.toFixed(1)} periods`
    }`,
  );
  return lines.join("\n");
}
