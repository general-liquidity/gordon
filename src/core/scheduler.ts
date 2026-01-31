/**
 * Market Scanner Scheduler
 *
 * Provides background/scheduled market scanning with configurable intervals
 * and opportunity notifications.
 */

import { BinanceClient } from "../infra/binance/index.ts";
import { scan, type ScanOptions } from "./scanner.ts";
import { createModuleLogger } from "../infra/logger/index.ts";
import { emitEvent } from "../events/index.ts";
import type { CoinAnalysis } from "../types/index.ts";

const logger = createModuleLogger("scheduler");

/**
 * Callback type for when an opportunity is found
 */
export type OpportunityCallback = (opportunity: CoinAnalysis) => void;

/**
 * Scheduler state
 */
interface SchedulerState {
  isRunning: boolean;
  intervalId: ReturnType<typeof setInterval> | null;
  lastScanTime: Date | null;
  scanCount: number;
  opportunitiesFound: number;
}

/**
 * Scheduler configuration
 */
export interface SchedulerConfig {
  /** Interval between scans in milliseconds (default: 1 hour) */
  intervalMs: number;
  /** Scan options passed to the scanner */
  scanOptions: ScanOptions;
  /** Callback when opportunity is found */
  onOpportunity?: OpportunityCallback;
  /** Callback when scan completes */
  onScanComplete?: (opportunities: CoinAnalysis[]) => void;
  /** Minimum confidence to report (0-1) */
  minConfidence?: number;
}

const DEFAULT_CONFIG: SchedulerConfig = {
  intervalMs: 3600000, // 1 hour
  scanOptions: {
    topN: 50,
    timeframes: ["1h", "4h"],
  },
  minConfidence: 0.5,
};

// Global state
let state: SchedulerState = {
  isRunning: false,
  intervalId: null,
  lastScanTime: null,
  scanCount: 0,
  opportunitiesFound: 0,
};

let currentConfig: SchedulerConfig = { ...DEFAULT_CONFIG };
let binanceClient: BinanceClient | null = null;

/**
 * Run a single scheduled scan
 */
async function runScheduledScan(): Promise<CoinAnalysis[]> {
  if (!binanceClient) {
    logger.error("Cannot run scheduled scan: Binance client not set");
    return [];
  }

  logger.info("Running scheduled scan", {
    scanNumber: state.scanCount + 1,
    config: currentConfig.scanOptions,
  });

  try {
    const result = await scan(binanceClient, currentConfig.scanOptions);

    state.scanCount++;
    state.lastScanTime = new Date();

    // Filter opportunities by confidence threshold
    const opportunities = result.coins.filter(
      (c) => c.setupDetected && c.setupConfidence >= (currentConfig.minConfidence ?? 0.5)
    );

    state.opportunitiesFound += opportunities.length;

    // Emit event
    await emitEvent("scheduler:scan_completed", {
      scanNumber: state.scanCount,
      opportunitiesFound: opportunities.length,
    });

    // Call callbacks
    if (opportunities.length > 0) {
      for (const opp of opportunities) {
        currentConfig.onOpportunity?.(opp);
      }
    }

    currentConfig.onScanComplete?.(opportunities);

    logger.info("Scheduled scan complete", {
      opportunitiesFound: opportunities.length,
      totalScans: state.scanCount,
    });

    return opportunities;
  } catch (error) {
    logger.error("Scheduled scan failed", error as Error);
    await emitEvent("scheduler:scan_failed", {
      error: (error as Error).message,
    });
    return [];
  }
}

/**
 * Start the scheduled scanner
 */
export function startScheduler(
  client: BinanceClient,
  config?: Partial<SchedulerConfig>
): void {
  if (state.isRunning) {
    logger.warn("Scheduler already running");
    return;
  }

  binanceClient = client;
  currentConfig = { ...DEFAULT_CONFIG, ...config };

  logger.info("Starting market scanner scheduler", {
    intervalMs: currentConfig.intervalMs,
    intervalHuman: `${currentConfig.intervalMs / 60000} minutes`,
  });

  state.isRunning = true;

  // Run immediately on start
  runScheduledScan().catch((err) => {
    logger.error("Initial scheduled scan failed", err as Error);
  });

  // Set up interval
  state.intervalId = setInterval(() => {
    runScheduledScan().catch((err) => {
      logger.error("Scheduled scan failed", err as Error);
    });
  }, currentConfig.intervalMs);

  emitEvent("scheduler:started", {
    intervalMs: currentConfig.intervalMs,
  }).catch(() => {});
}

/**
 * Stop the scheduled scanner
 */
export function stopScheduler(): void {
  if (!state.isRunning) {
    logger.warn("Scheduler not running");
    return;
  }

  if (state.intervalId) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }

  state.isRunning = false;

  logger.info("Scheduler stopped", {
    totalScans: state.scanCount,
    totalOpportunities: state.opportunitiesFound,
  });

  emitEvent("scheduler:stopped", {
    totalScans: state.scanCount,
    totalOpportunities: state.opportunitiesFound,
  }).catch(() => {});
}

/**
 * Update scheduler configuration (will take effect on next scan)
 */
export function updateSchedulerConfig(config: Partial<SchedulerConfig>): void {
  currentConfig = { ...currentConfig, ...config };

  // If interval changed, restart the scheduler
  if (config.intervalMs && state.isRunning && state.intervalId) {
    clearInterval(state.intervalId);
    state.intervalId = setInterval(() => {
      runScheduledScan().catch((err) => {
        logger.error("Scheduled scan failed", err as Error);
      });
    }, currentConfig.intervalMs);

    logger.info("Scheduler interval updated", {
      newIntervalMs: currentConfig.intervalMs,
    });
  }
}

/**
 * Get current scheduler status
 */
export function getSchedulerStatus(): {
  isRunning: boolean;
  lastScanTime: string | null;
  nextScanTime: string | null;
  scanCount: number;
  opportunitiesFound: number;
  intervalMs: number;
} {
  let nextScanTime: string | null = null;

  if (state.isRunning && state.lastScanTime) {
    const nextTime = new Date(state.lastScanTime.getTime() + currentConfig.intervalMs);
    nextScanTime = nextTime.toISOString();
  }

  return {
    isRunning: state.isRunning,
    lastScanTime: state.lastScanTime?.toISOString() ?? null,
    nextScanTime,
    scanCount: state.scanCount,
    opportunitiesFound: state.opportunitiesFound,
    intervalMs: currentConfig.intervalMs,
  };
}

/**
 * Trigger an immediate scan (outside of schedule)
 */
export async function triggerImmediateScan(): Promise<CoinAnalysis[]> {
  if (!binanceClient) {
    throw new Error("Scheduler not initialized - call startScheduler first");
  }

  logger.info("Triggering immediate scan");
  return runScheduledScan();
}

/**
 * Reset scheduler statistics
 */
export function resetSchedulerStats(): void {
  state.scanCount = 0;
  state.opportunitiesFound = 0;
  logger.info("Scheduler stats reset");
}
