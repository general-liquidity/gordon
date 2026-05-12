/**
 * Volatility-Targeting + Drawdown Overlay
 *
 * Two complementary position scaling strategies:
 *
 * 1. Volatility targeting: scale positions so portfolio vol stays at target
 *    (e.g., target 15% annualized vol → when realized vol = 30%, halve positions)
 *
 * 2. Drawdown overlay: reduce positions when drawdown exceeds threshold
 *    (e.g., at 10% drawdown → 50% position, at 20% → 0% position)
 *
 * These are OVERLAYS — they multiply on top of existing position sizes.
 * A position sized at $10K by vol-percentile sizing gets further reduced
 * by these overlays if conditions warrant.
 *
 * Source: PAAM (Python and AI for Asset Management, ch09)
 */

// ============================================================================
// Types
// ============================================================================

export interface VolTargetConfig {
  /** Target annualized volatility (decimal, e.g., 0.15 = 15%). */
  targetVol: number;
  /** Lookback window for realized vol estimation (days). Default 20. */
  lookbackDays: number;
  /** Min scale factor (floor). Default 0.1 (never below 10% of full size). */
  minScale: number;
  /** Max scale factor (cap). Default 1.5 (allow up to 150% in low-vol). */
  maxScale: number;
  /** Trading days per year. Default 252 for stocks, 365 for crypto. */
  tradingDaysPerYear: number;
}

export interface DrawdownOverlayConfig {
  /** Drawdown threshold where scaling starts (decimal). Default 0.05 (5%). */
  startThreshold: number;
  /** Drawdown level where position goes to zero. Default 0.20 (20%). */
  fullExitThreshold: number;
  /** Scale function: "linear" (gradual) or "step" (hard cutoff). Default "linear". */
  scaleFunction: "linear" | "step";
}

export interface OverlayResult {
  /** Combined scale factor (0-1.5). Multiply with position size. */
  scaleFactor: number;
  /** Vol-targeting component. */
  volScale: number;
  /** Drawdown component. */
  drawdownScale: number;
  /** Current realized volatility (annualized). */
  realizedVol: number;
  /** Current drawdown from peak. */
  currentDrawdown: number;
  /** Whether any overlay is active (scale < 1.0). */
  overlayActive: boolean;
  /** Human-readable explanation. */
  reason: string;
}

export const DEFAULT_VOL_TARGET_CONFIG: VolTargetConfig = {
  targetVol: 0.15,
  lookbackDays: 20,
  minScale: 0.1,
  maxScale: 1.5,
  tradingDaysPerYear: 365, // Crypto default
};

export const DEFAULT_DRAWDOWN_CONFIG: DrawdownOverlayConfig = {
  startThreshold: 0.05,
  fullExitThreshold: 0.20,
  scaleFunction: "linear",
};

// ============================================================================
// Volatility Targeting
// ============================================================================

/**
 * Compute the vol-targeting scale factor.
 * scale = targetVol / realizedVol (clamped to [minScale, maxScale])
 */
export function computeVolTargetScale(
  dailyReturns: number[],
  config: VolTargetConfig = DEFAULT_VOL_TARGET_CONFIG,
): { scale: number; realizedVol: number } {
  const recent = dailyReturns.slice(-config.lookbackDays);
  if (recent.length < 5) return { scale: 1.0, realizedVol: 0 };

  const mean = recent.reduce((s, r) => s + r, 0) / recent.length;
  const variance = recent.reduce((s, r) => s + (r - mean) ** 2, 0) / (recent.length - 1);
  const dailyVol = Math.sqrt(variance);
  const realizedVol = dailyVol * Math.sqrt(config.tradingDaysPerYear);

  if (realizedVol === 0) return { scale: config.maxScale, realizedVol: 0 };

  const rawScale = config.targetVol / realizedVol;
  const scale = Math.max(config.minScale, Math.min(config.maxScale, rawScale));

  return { scale, realizedVol };
}

// ============================================================================
// Drawdown Overlay
// ============================================================================

/**
 * Compute the drawdown-based scale factor.
 * Linear: scale = 1 - (dd - start) / (fullExit - start), clamped to [0, 1]
 * Step: scale = dd > start ? 0.5 : 1.0 (then 0 at fullExit)
 */
export function computeDrawdownScale(
  equityCurve: number[],
  config: DrawdownOverlayConfig = DEFAULT_DRAWDOWN_CONFIG,
): { scale: number; currentDrawdown: number } {
  if (equityCurve.length < 2) return { scale: 1.0, currentDrawdown: 0 };

  // Find peak and current drawdown
  let peak = equityCurve[0]!;
  for (const val of equityCurve) {
    if (val > peak) peak = val;
  }
  const current = equityCurve[equityCurve.length - 1]!;
  const currentDrawdown = peak > 0 ? (peak - current) / peak : 0;

  if (currentDrawdown <= config.startThreshold) {
    return { scale: 1.0, currentDrawdown };
  }

  if (currentDrawdown >= config.fullExitThreshold) {
    return { scale: 0, currentDrawdown };
  }

  if (config.scaleFunction === "step") {
    // Step: halve at start threshold, zero at full exit
    return {
      scale: currentDrawdown > (config.startThreshold + config.fullExitThreshold) / 2 ? 0.25 : 0.5,
      currentDrawdown,
    };
  }

  // Linear interpolation from 1.0 at startThreshold to 0.0 at fullExitThreshold
  const range = config.fullExitThreshold - config.startThreshold;
  const progress = (currentDrawdown - config.startThreshold) / range;
  const scale = Math.max(0, 1 - progress);

  return { scale, currentDrawdown };
}

// ============================================================================
// Combined Overlay
// ============================================================================

/**
 * Compute the combined overlay scale factor.
 * Both overlays multiply together: if vol says 0.5x and drawdown says 0.8x → 0.4x.
 */
export function computeOverlay(
  dailyReturns: number[],
  equityCurve: number[],
  volConfig: VolTargetConfig = DEFAULT_VOL_TARGET_CONFIG,
  ddConfig: DrawdownOverlayConfig = DEFAULT_DRAWDOWN_CONFIG,
): OverlayResult {
  const vol = computeVolTargetScale(dailyReturns, volConfig);
  const dd = computeDrawdownScale(equityCurve, ddConfig);

  const scaleFactor = vol.scale * dd.scale;
  const overlayActive = scaleFactor < 0.99;

  const reasons: string[] = [];
  if (vol.scale < 0.99) {
    reasons.push(`Vol targeting: ${(vol.realizedVol * 100).toFixed(0)}% realized vs ${(volConfig.targetVol * 100).toFixed(0)}% target → ${(vol.scale * 100).toFixed(0)}% scale`);
  }
  if (dd.scale < 0.99) {
    reasons.push(`Drawdown overlay: ${(dd.currentDrawdown * 100).toFixed(1)}% drawdown → ${(dd.scale * 100).toFixed(0)}% scale`);
  }
  if (!overlayActive) {
    reasons.push("No overlay active — full position size.");
  }

  return {
    scaleFactor,
    volScale: vol.scale,
    drawdownScale: dd.scale,
    realizedVol: vol.realizedVol,
    currentDrawdown: dd.currentDrawdown,
    overlayActive,
    reason: reasons.join(". "),
  };
}
