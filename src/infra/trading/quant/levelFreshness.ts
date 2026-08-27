/**
 * Level Freshness Classifier — LV2.
 *
 * Classifies any support/resistance level as `fresh` or `recycled`
 * based on how many times price has touched it within a recent
 * window. Composes with any level-producing tool — supply-demand
 * zones, order blocks, fibonacci, camarilla, smc-patterns,
 * marketProfile — to grade the level's tradeable quality.
 *
 *   Fresh    (0–1 touches in window) → momentum / breakout territory
 *   Recycled (2+ touches in window)  → mean-reversion territory
 *
 * A "touch" is any candle whose range overlaps the band
 * [price·(1−tol), price·(1+tol)] for a caller-supplied tolerance
 * (default 0.1% of the level).
 *
 * Pedigree: prop-trading discipline (ZCT 2025 S/R article), same
 * family as the TM-tier / D-tier / LV1 primitives. Direct operator-
 * shadow value: distinguishing fresh vs recycled levels is the kind
 * of judgment call traders make manually; a parameterizable
 * classifier lets Gordon expose it as a consistent observable.
 *
 * Pure compute. No I/O.
 */

export interface LevelFreshnessCandle {
  /** Timestamp in milliseconds (ms epoch). */
  timestamp: number;
  /** Candle high. */
  high: number;
  /** Candle low. */
  low: number;
}

export interface LevelFreshnessInput {
  /** The price level to classify. Must be > 0. */
  level: number;
  /** Recent OHLC history. Order does not matter; filtered by timestamp. */
  candles: ReadonlyArray<LevelFreshnessCandle>;
  /**
   * Window length in minutes. Touches before `windowEnd − window` are
   * not counted. Default 360 (6 hours, ZCT convention).
   */
  windowMinutes?: number;
  /**
   * Touch tolerance as fraction of the level (e.g., 0.001 = 0.1%).
   * A candle is a "touch" iff its [low, high] range overlaps with
   * [level·(1−tol), level·(1+tol)]. Default 0.001.
   */
  touchTolerancePct?: number;
  /**
   * Touch-count threshold at which the level is classified as
   * recycled. Default 2 (i.e., 0–1 touches → fresh, 2+ → recycled).
   */
  recycledThreshold?: number;
  /**
   * End-of-window timestamp in milliseconds. Default: timestamp of
   * the latest candle. Use this to anchor the window to a specific
   * moment (e.g., the moment a level is being considered for entry).
   */
  windowEndMs?: number;
}

export type LevelFreshnessClassification = "fresh" | "recycled";

export interface LevelFreshnessResult {
  touchCount: number;
  windowStartMs: number;
  windowEndMs: number;
  classification: LevelFreshnessClassification;
  /** Subset of candles classified as touches (timestamps only, for tracing). */
  touchTimestamps: number[];
  /** Tolerance band [level·(1−tol), level·(1+tol)]. */
  toleranceBand: { lower: number; upper: number };
  reasoning: string;
}

const DEFAULT_WINDOW_MIN = 360; // 6 hours
const DEFAULT_TOL_PCT = 0.001; // 0.1%
const DEFAULT_RECYCLED_THRESHOLD = 2;
const MIN_TO_MS = 60_000;

function isTouch(c: LevelFreshnessCandle, lower: number, upper: number): boolean {
  // Range overlap: candle.high ≥ band.lower AND candle.low ≤ band.upper
  return c.high >= lower && c.low <= upper;
}

export function evaluateLevelFreshness(input: LevelFreshnessInput): LevelFreshnessResult {
  if (!Number.isFinite(input.level) || input.level <= 0) {
    throw new Error("level must be > 0");
  }
  if (input.candles.length === 0) {
    throw new Error("candles must not be empty");
  }
  const windowMin = input.windowMinutes ?? DEFAULT_WINDOW_MIN;
  const tolPct = input.touchTolerancePct ?? DEFAULT_TOL_PCT;
  const recycledThreshold = input.recycledThreshold ?? DEFAULT_RECYCLED_THRESHOLD;
  if (windowMin <= 0) {
    throw new Error("windowMinutes must be > 0");
  }
  if (tolPct <= 0) {
    throw new Error("touchTolerancePct must be > 0");
  }
  if (recycledThreshold < 1) {
    throw new Error("recycledThreshold must be ≥ 1");
  }

  // Resolve window end (default = latest candle timestamp).
  const explicitEnd = input.windowEndMs;
  let latestTs = -Infinity;
  for (const c of input.candles) {
    if (!Number.isFinite(c.timestamp)) {
      throw new Error("candle timestamps must be finite");
    }
    if (!Number.isFinite(c.high) || !Number.isFinite(c.low) || c.high < c.low) {
      throw new Error(`invalid OHLC: high=${c.high} low=${c.low}`);
    }
    if (c.timestamp > latestTs) latestTs = c.timestamp;
  }
  const windowEndMs = explicitEnd ?? latestTs;
  const windowStartMs = windowEndMs - windowMin * MIN_TO_MS;

  const lower = input.level * (1 - tolPct);
  const upper = input.level * (1 + tolPct);

  const touchTimestamps: number[] = [];
  for (const c of input.candles) {
    if (c.timestamp < windowStartMs || c.timestamp > windowEndMs) continue;
    if (isTouch(c, lower, upper)) touchTimestamps.push(c.timestamp);
  }

  const touchCount = touchTimestamps.length;
  const classification: LevelFreshnessClassification =
    touchCount >= recycledThreshold ? "recycled" : "fresh";

  const reasoning =
    `level=${input.level} (band [${lower.toFixed(6)}, ${upper.toFixed(6)}], tol=${(tolPct * 100).toFixed(3)}%): ` +
    `${touchCount} touches in last ${windowMin}min (threshold ≥${recycledThreshold} → recycled) ` +
    `→ ${classification}.`;

  return {
    touchCount,
    windowStartMs,
    windowEndMs,
    classification,
    touchTimestamps,
    toleranceBand: { lower, upper },
    reasoning,
  };
}

export function levelFreshnessToPayload(result: LevelFreshnessResult): Record<string, unknown> {
  return {
    kind: "level_freshness.evaluated",
    touchCount: result.touchCount,
    classification: result.classification,
    windowStartMs: result.windowStartMs,
    windowEndMs: result.windowEndMs,
    toleranceBand: {
      lower: Number(result.toleranceBand.lower.toFixed(8)),
      upper: Number(result.toleranceBand.upper.toFixed(8)),
    },
  };
}
