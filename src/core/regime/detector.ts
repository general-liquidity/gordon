/**
 * Regime Detector — Singleton Manager
 *
 * High-level interface for market regime detection.
 * Manages caching, SQLite persistence, playbook matching,
 * and multi-timeframe consensus.
 */

import type { Candle } from "../../types/index.ts";
import type { MarketRegime, RegimeSignal, RegimeHistory } from "./types.ts";
import { RegimeClassifier } from "./classifier.ts";
import {
  RegimeHysteresisGate,
  isRegimeHysteresisEnabled,
  regimeHysteresisConfigFromEnv,
} from "./hysteresisGate.ts";
import { getDatabase } from "../../infra/storage/database.ts";
import { playbookRegistry } from "../playbooks/registry.ts";
import { createModuleLogger } from "../../infra/logger/index.ts";

const logger = createModuleLogger("regime-detector");
const REGIME_CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_REGIME_CACHE_ENTRIES = 500;

interface CachedRegimeSignal {
  signal: RegimeSignal;
  cachedAtMs: number;
}

// ============================================================================
// Regime-to-Playbook Tag Mapping
// ============================================================================

/**
 * Maps each MarketRegime to playbook tags that are relevant.
 * A playbook matches a regime if any of its tags overlap with the regime's tags.
 */
const REGIME_TAG_MAP: Record<MarketRegime, string[]> = {
  trending_up: ["trend", "trend-following", "momentum", "ema", "crossover", "breakout"],
  trending_down: ["trend", "trend-following", "short", "ema", "crossover"],
  ranging: ["mean-reversion", "range", "support", "oversold", "overbought"],
  volatile: ["volatility", "scalp", "breakout", "momentum"],
  quiet: ["mean-reversion", "accumulation", "range", "support"],
  breakout: ["breakout", "momentum", "volume", "trend"],
};

// ============================================================================
// SQLite Schema Initialization
// ============================================================================

function ensureRegimeTable(): void {
  const db = getDatabase();
  db.run(`
    CREATE TABLE IF NOT EXISTS regime_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      regime TEXT NOT NULL,
      confidence REAL NOT NULL,
      metrics_json TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      timeframe TEXT NOT NULL
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_regime_history_symbol ON regime_history(symbol)");
  db.run("CREATE INDEX IF NOT EXISTS idx_regime_history_started_at ON regime_history(started_at)");
}

// ============================================================================
// RegimeDetector Class
// ============================================================================

export class RegimeDetector {
  private static instance: RegimeDetector;

  private classifier = new RegimeClassifier();
  private cache = new Map<string, CachedRegimeSignal>();
  private initialized = false;
  /** A5: opt-in dwell-time hysteresis over raw classifications (GORDON_REGIME_HYSTERESIS). */
  private hysteresis = new RegimeHysteresisGate(regimeHysteresisConfigFromEnv());

  private constructor() {}

  static getInstance(): RegimeDetector {
    if (!RegimeDetector.instance) {
      RegimeDetector.instance = new RegimeDetector();
    }
    return RegimeDetector.instance;
  }

  // ---------- Initialization ----------

  private ensureInit(): void {
    if (!this.initialized) {
      try {
        ensureRegimeTable();
        this.initialized = true;
      } catch (err) {
        logger.error(
          "Failed to initialize regime_history table",
          err instanceof Error ? err : undefined,
        );
      }
    }
  }

  // ---------- Detection ----------

  /**
   * Detect the current market regime for a symbol using provided candle data.
   *
   * @param candles   - OHLCV candle array (most recent last)
   * @param symbol    - Trading pair (e.g., "BTCUSDT")
   * @param timeframe - Candle interval (default "1h")
   * @returns RegimeSignal with classification, confidence, and metrics
   */
  detectRegime(candles: Candle[], symbol: string, timeframe = "1h"): RegimeSignal {
    const raw = this.classifier.classify(candles, symbol, timeframe);
    const signal = this.applyHysteresisIfEnabled(raw);

    // Update cache
    this.cache.set(`${symbol}:${timeframe}`, { signal, cachedAtMs: Date.now() });
    this.pruneCache();

    // Persist to DB (non-blocking — don't let DB errors break detection)
    try {
      this.recordRegime(signal);
    } catch (err) {
      logger.warn(
        "Failed to persist regime signal",
        err instanceof Error ? { error: err.message } : undefined,
      );
    }

    logger.debug("Regime detected", {
      symbol,
      timeframe,
      regime: signal.regime,
      confidence: signal.confidence,
    });

    return signal;
  }

  /**
   * A5: opt-in dwell-time hysteresis. When GORDON_REGIME_HYSTERESIS is on, a
   * freshly-classified regime that differs from the accepted one must persist
   * before it is accepted; an unconfirmed boundary flicker holds the prior
   * regime. Only the `regime` label is stabilized — the live metrics/confidence
   * of the current bar are preserved. The underlying classifier is untouched.
   */
  private applyHysteresisIfEnabled(raw: RegimeSignal): RegimeSignal {
    if (!isRegimeHysteresisEnabled()) return raw;
    const key = `${raw.symbol}:${raw.timeframe}`;
    const result = this.hysteresis.accept(key, raw.regime);
    if (result.regime === raw.regime) return raw;
    return { ...raw, regime: result.regime };
  }

  // ---------- Cache ----------

  /**
   * Get the most recently detected regime for a symbol.
   * Returns null if no regime has been detected yet for this symbol.
   */
  getCurrentRegime(symbol: string, timeframe = "1h"): RegimeSignal | null {
    const key = `${symbol}:${timeframe}`;
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.cachedAtMs > REGIME_CACHE_TTL_MS) {
      this.cache.delete(key);
      return null;
    }
    return entry.signal;
  }

  private pruneCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.cachedAtMs > REGIME_CACHE_TTL_MS) {
        this.cache.delete(key);
      }
    }

    if (this.cache.size <= MAX_REGIME_CACHE_ENTRIES) return;

    const excess = this.cache.size - MAX_REGIME_CACHE_ENTRIES;
    const oldestKeys = [...this.cache.entries()]
      .sort(([, a], [, b]) => a.cachedAtMs - b.cachedAtMs)
      .slice(0, excess)
      .map(([key]) => key);

    for (const key of oldestKeys) {
      this.cache.delete(key);
    }
  }

  // ---------- Persistence ----------

  /**
   * Record a regime signal to SQLite history.
   * If the regime is the same as the last recorded one for this symbol+timeframe,
   * it extends the existing record instead of creating a new one.
   */
  recordRegime(signal: RegimeSignal): void {
    this.ensureInit();

    const db = getDatabase();

    // Check the most recent record for this symbol+timeframe
    const lastRow = db
      .query<{ id: number; regime: string; started_at: string }, [string, string]>(
        `SELECT id, regime, started_at FROM regime_history
         WHERE symbol = ? AND timeframe = ?
         ORDER BY started_at DESC LIMIT 1`,
      )
      .get(signal.symbol, signal.timeframe);

    if (lastRow && lastRow.regime === signal.regime) {
      // Same regime — no new row needed (the span continues)
      return;
    }

    // Close the previous regime span
    if (lastRow) {
      db.run(`UPDATE regime_history SET ended_at = ? WHERE id = ?`, [signal.timestamp, lastRow.id]);
    }

    // Insert new regime span
    db.run(
      `INSERT INTO regime_history (symbol, regime, confidence, metrics_json, started_at, timeframe)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        signal.symbol,
        signal.regime,
        signal.confidence,
        JSON.stringify(signal.metrics),
        signal.timestamp,
        signal.timeframe,
      ],
    );
  }

  // ---------- History ----------

  /**
   * Get regime history for a symbol.
   *
   * @param symbol - Trading pair
   * @param limit  - Max records to return (default 20)
   * @returns RegimeHistory with regime spans
   */
  getRegimeHistory(symbol: string, limit = 20): RegimeHistory {
    this.ensureInit();

    const db = getDatabase();
    const rows = db
      .query<
        {
          regime: string;
          confidence: number;
          started_at: string;
          ended_at: string | null;
        },
        [string, number]
      >(
        `SELECT regime, confidence, started_at, ended_at
         FROM regime_history
         WHERE symbol = ?
         ORDER BY started_at DESC
         LIMIT ?`,
      )
      .all(symbol, limit);

    return {
      symbol,
      regimes: rows.map((r) => {
        const startMs = new Date(r.started_at).getTime();
        const endMs = r.ended_at ? new Date(r.ended_at).getTime() : Date.now();
        const durationHours = (endMs - startMs) / (1000 * 60 * 60);
        return {
          regime: r.regime as MarketRegime,
          started_at: r.started_at,
          ended_at: r.ended_at ?? undefined,
          duration_hours: Math.round(durationHours * 10) / 10,
          confidence: r.confidence,
        };
      }),
    };
  }

  // ---------- Playbook Matching ----------

  /**
   * Get playbook names suitable for a given market regime.
   * Matches by comparing regime-associated tags to playbook tags.
   */
  getPlaybooksForRegime(regime: MarketRegime): string[] {
    const regimeTags = REGIME_TAG_MAP[regime];
    if (!regimeTags || regimeTags.length === 0) return [];

    const allPlaybooks = playbookRegistry.getAll();
    const matches: string[] = [];

    for (const pb of allPlaybooks) {
      const pbTagsLower = pb.tags.map((t) => t.toLowerCase());
      const hasMatch = regimeTags.some((rt) =>
        pbTagsLower.some((pt) => pt === rt || pt.includes(rt) || rt.includes(pt)),
      );
      if (hasMatch) {
        matches.push(pb.name);
      }
    }

    return matches;
  }

  // ---------- Multi-Timeframe Analysis ----------

  /**
   * Analyze regime across hourly and daily timeframes.
   *
   * @param hourlyCandles - 1h candle data
   * @param dailyCandles  - 1d candle data
   * @param symbol        - Trading pair
   * @returns Hourly + daily regimes with consensus and conflict flag
   */
  getMultiTimeframeRegime(
    hourlyCandles: Candle[],
    dailyCandles: Candle[],
    symbol: string,
  ): {
    hourly: RegimeSignal;
    daily: RegimeSignal;
    consensus: MarketRegime;
    conflicting: boolean;
  } {
    const hourly = this.detectRegime(hourlyCandles, symbol, "1h");
    const daily = this.detectRegime(dailyCandles, symbol, "1d");

    // Determine consensus and conflict
    const conflicting = hourly.regime !== daily.regime;

    // Consensus logic: prefer the higher-timeframe signal unless
    // the lower timeframe has substantially higher confidence
    let consensus: MarketRegime;
    if (!conflicting) {
      consensus = daily.regime;
    } else if (hourly.confidence > daily.confidence + 0.2) {
      // Hourly is much more confident — it wins
      consensus = hourly.regime;
    } else {
      // Default: trust the daily (higher TF)
      consensus = daily.regime;
    }

    return { hourly, daily, consensus, conflicting };
  }
}
