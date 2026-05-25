/**
 * Volatility-Forecast Calibration Store.
 *
 * The spot-market analog of "implied vol vs realized vol." Gordon
 * makes implicit volatility forecasts every time the risk classifier
 * sizes a position (vol-adjusted), every time the regime detector
 * classifies the tape, every time strategy slots compute drawdown
 * bands. This module records those forecasts and matches them to
 * realized outcomes so the operator can see whether Gordon's
 * volatility expectations are systematically biased.
 *
 * Distinct from `src/infra/calibration/confidenceStore.ts` because:
 *   - confidenceStore tracks CATEGORICAL outcomes (correct / wrong /
 *     partial / unknown) keyed against a confidence number (0..1)
 *   - this module tracks CONTINUOUS outcomes (realized vol value)
 *     keyed against a forecast value (predicted vol)
 *   - the metrics are different: bias / MAE / RMSE / R² rather than
 *     calibration buckets
 *
 * Persistence pattern matches confidenceStore: JSONL at
 * `~/.gordon/vol-calibration.jsonl`, append-only, line-buffered. Two
 * append-only operations (`recordForecast` + `recordRealization`) so
 * forecasts and realizations can land out of order without lock
 * contention.
 *
 * Per-call cost: O(1) append. Calibration query: O(N) line scan,
 * filtered by time window — fine for sub-million forecast volumes.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { GORDON_DIR } from "../../storage/paths.ts";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("vol-calibration");

/**
 * Source of a forecast — lets us segment calibration metrics by
 * which Gordon subsystem produced the forecast. Tells the operator
 * whether riskClassifier is biased differently than regime-based
 * sizing, etc.
 */
export type VolForecastSource =
  | "risk_classifier"
  | "regime_detector"
  | "atr_projection"
  | "strategy_slot_sizing"
  | "manual"
  | "custom";

/** Time horizon the forecast targets. */
export type VolForecastHorizon = "1h" | "4h" | "1d" | "1w" | "custom";

export interface VolForecastRecord {
  /** Unique id correlating forecast → realization. */
  forecastId: string;
  /** ISO timestamp when the forecast was made. */
  forecastedAt: string;
  symbol: string;
  /** Predicted volatility as a decimal (e.g. 0.025 = 2.5%). */
  predicted: number;
  source: VolForecastSource;
  horizon: VolForecastHorizon;
  /** Free-form context (sessionId, modelId, calling tool). */
  context?: Record<string, unknown>;
}

export interface VolRealizationRecord {
  forecastId: string;
  /** ISO timestamp when realization was observed. */
  observedAt: string;
  /** Realized volatility as a decimal over the same horizon. */
  realized: number;
  /** Optional measurement-method note (e.g. "stddev_of_log_returns_1h_bars"). */
  method?: string;
}

const CALIBRATION_FILE = join(GORDON_DIR, "vol-calibration.jsonl");

interface JsonlEntry {
  kind: "forecast" | "realization";
  payload: VolForecastRecord | VolRealizationRecord;
}

function ensureDir(): void {
  const dir = dirname(CALIBRATION_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function append(entry: JsonlEntry): void {
  ensureDir();
  try {
    appendFileSync(CALIBRATION_FILE, JSON.stringify(entry) + "\n");
  } catch (err) {
    logger.warn("Failed to append vol-calibration entry", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Record a volatility forecast. Idempotent in the sense that two
 * forecasts with the same forecastId still both append — callers are
 * responsible for unique-id generation. Use a UUID when in doubt.
 */
export function recordForecast(record: VolForecastRecord): void {
  append({ kind: "forecast", payload: record });
}

/**
 * Record a realization. Should be called after the forecast horizon
 * has elapsed and realized vol has been measured by the caller.
 */
export function recordRealization(record: VolRealizationRecord): void {
  append({ kind: "realization", payload: record });
}

// ============================================================================
// Calibration metrics
// ============================================================================

export interface VolCalibrationWindow {
  /** ISO start of window. Default: 30 days ago. */
  startTime?: string;
  /** ISO end of window. Default: now. */
  endTime?: string;
  /** Filter by source. Default: all. */
  source?: VolForecastSource;
  /** Filter by horizon. Default: all. */
  horizon?: VolForecastHorizon;
  /** Filter by symbol. Default: all. */
  symbol?: string;
}

export interface VolCalibrationMetrics {
  windowStart: string;
  windowEnd: string;
  /** Number of (forecast, realization) pairs in the window. */
  pairCount: number;
  /** Mean signed forecast error (predicted - realized). +ve = over-forecast. */
  bias: number;
  /** Mean absolute error |predicted - realized|. */
  mae: number;
  /** Root mean squared error. Penalizes large misses more. */
  rmse: number;
  /**
   * Coefficient of determination of realized on predicted. 1 = perfect,
   * 0 = no better than mean, <0 = worse than mean. Computed as
   *   1 - SSres / SStot
   * where SStot uses realized's mean as baseline.
   */
  rSquared: number;
  /**
   * Mean realized volatility in the window — useful for contextualizing
   * MAE/RMSE (a 0.005 MAE means very different things at avg vol of
   * 0.01 vs avg vol of 0.10).
   */
  meanRealized: number;
}

function loadEntries(): JsonlEntry[] {
  if (!existsSync(CALIBRATION_FILE)) return [];
  try {
    const raw = readFileSync(CALIBRATION_FILE, "utf-8");
    const out: JsonlEntry[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        // skip malformed line
      }
    }
    return out;
  } catch {
    return [];
  }
}

function defaultStart(): string {
  return new Date(Date.now() - 30 * 86_400_000).toISOString();
}

function defaultEnd(): string {
  return new Date().toISOString();
}

/**
 * Compute calibration metrics for the matched (forecast, realization)
 * pairs in the given window. Forecasts without a matching realization
 * are excluded — they're "open positions" from a calibration POV.
 */
export function getVolCalibration(
  window: VolCalibrationWindow = {},
): VolCalibrationMetrics {
  const startTime = window.startTime ?? defaultStart();
  const endTime = window.endTime ?? defaultEnd();
  const entries = loadEntries();

  const forecasts = new Map<string, VolForecastRecord>();
  const realizations = new Map<string, VolRealizationRecord>();
  for (const e of entries) {
    if (e.kind === "forecast") {
      const f = e.payload as VolForecastRecord;
      forecasts.set(f.forecastId, f);
    } else {
      const r = e.payload as VolRealizationRecord;
      realizations.set(r.forecastId, r);
    }
  }

  const predictedList: number[] = [];
  const realizedList: number[] = [];

  for (const [id, f] of forecasts) {
    const r = realizations.get(id);
    if (!r) continue;
    if (f.forecastedAt < startTime || f.forecastedAt > endTime) continue;
    if (window.source && f.source !== window.source) continue;
    if (window.horizon && f.horizon !== window.horizon) continue;
    if (window.symbol && f.symbol !== window.symbol) continue;
    predictedList.push(f.predicted);
    realizedList.push(r.realized);
  }

  return computeMetrics(predictedList, realizedList, startTime, endTime);
}

function computeMetrics(
  predicted: number[],
  realized: number[],
  startTime: string,
  endTime: string,
): VolCalibrationMetrics {
  const n = predicted.length;
  if (n === 0) {
    return {
      windowStart: startTime,
      windowEnd: endTime,
      pairCount: 0,
      bias: 0,
      mae: 0,
      rmse: 0,
      rSquared: 0,
      meanRealized: 0,
    };
  }

  let sumErr = 0;
  let sumAbs = 0;
  let sumSq = 0;
  let sumRealized = 0;
  for (let i = 0; i < n; i++) {
    const err = predicted[i]! - realized[i]!;
    sumErr += err;
    sumAbs += Math.abs(err);
    sumSq += err * err;
    sumRealized += realized[i]!;
  }
  const meanRealized = sumRealized / n;

  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const d = realized[i]! - meanRealized;
    ssTot += d * d;
  }
  const rSquared = ssTot === 0 ? (sumSq === 0 ? 1 : 0) : 1 - sumSq / ssTot;

  return {
    windowStart: startTime,
    windowEnd: endTime,
    pairCount: n,
    bias: sumErr / n,
    mae: sumAbs / n,
    rmse: Math.sqrt(sumSq / n),
    rSquared,
    meanRealized,
  };
}

/**
 * One-line operator-facing summary, suitable for /weekend-review.
 */
export function summarizeVolCalibration(m: VolCalibrationMetrics): string {
  if (m.pairCount === 0) {
    return `Vol calibration: no matched forecast/realization pairs in window (${m.windowStart} → ${m.windowEnd}).`;
  }
  const biasSign = m.bias >= 0 ? "+" : "";
  const biasDir =
    Math.abs(m.bias) < 0.0005
      ? "near-unbiased"
      : m.bias > 0
        ? "over-forecasting vol"
        : "under-forecasting vol";
  return `Vol calibration: ${m.pairCount} pairs, bias=${biasSign}${(m.bias * 100).toFixed(3)}% (${biasDir}), MAE=${(m.mae * 100).toFixed(3)}%, RMSE=${(m.rmse * 100).toFixed(3)}%, R²=${m.rSquared.toFixed(2)} (mean realized vol ${(m.meanRealized * 100).toFixed(2)}%).`;
}

/** Test helper — exposed for unit tests that need deterministic in-memory state. */
export const _internals = {
  CALIBRATION_FILE,
  loadEntries,
  computeMetrics,
};
