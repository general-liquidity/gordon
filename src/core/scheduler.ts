/**
 * Market Scanner Scheduler
 *
 * Provides background/scheduled market scanning with configurable intervals
 * and opportunity notifications.
 */

import type { Exchange } from "../infra/exchange/index.ts";
import type { ScanOptions } from "./scanner.ts";
import { createModuleLogger } from "../infra/logger/index.ts";
import { emitEvent } from "../events/index.ts";
import type { CoinAnalysis } from "../types/index.ts";
import { runSharedScan } from "./market-data-coordinator.ts";

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
    timeframes: ["1h"],
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
let exchangeClient: Exchange | null = null;
let scanInFlight: Promise<CoinAnalysis[]> | null = null;

function runScheduledScanSafely(trigger: "startup" | "interval" | "manual"): Promise<CoinAnalysis[]> {
  if (scanInFlight) {
    if (trigger !== "manual") {
      logger.debug("Skipping scheduled scan trigger because previous scan is still running", { trigger });
    }
    return scanInFlight;
  }

  const scanPromise = runScheduledScan()
    .catch((error) => {
      logger.error("Scheduled scan failed", error as Error);
      return [];
    })
    .finally(() => {
      if (scanInFlight === scanPromise) {
        scanInFlight = null;
      }
    });

  scanInFlight = scanPromise;
  return scanPromise;
}

/**
 * Run a single scheduled scan
 */
async function runScheduledScan(): Promise<CoinAnalysis[]> {
  if (!exchangeClient) {
    logger.error("Cannot run scheduled scan: Exchange client not set");
    return [];
  }

  logger.info("Running scheduled scan", {
    scanNumber: state.scanCount + 1,
    config: currentConfig.scanOptions,
  });

  try {
    const result = await runSharedScan(exchangeClient, currentConfig.scanOptions);

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
  client: Exchange,
  config?: Partial<SchedulerConfig>
): void {
  if (state.isRunning) {
    logger.warn("Scheduler already running");
    return;
  }

  exchangeClient = client;
  currentConfig = { ...DEFAULT_CONFIG, ...config };

  logger.info("Starting market scanner scheduler", {
    intervalMs: currentConfig.intervalMs,
    intervalHuman: `${currentConfig.intervalMs / 60000} minutes`,
  });

  state.isRunning = true;

  // Run immediately on start
  void runScheduledScanSafely("startup");

  // Set up interval
  state.intervalId = setInterval(() => {
    void runScheduledScanSafely("interval");
  }, currentConfig.intervalMs);

  emitEvent("scheduler:started", {
    intervalMs: currentConfig.intervalMs,
  }).catch((err) => { logger.error("Failed to emit scheduler event", err instanceof Error ? err : { error: String(err) }); });
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
  }).catch((err) => { logger.error("Failed to emit scheduler event", err instanceof Error ? err : { error: String(err) }); });
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
      void runScheduledScanSafely("interval");
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
  if (!exchangeClient) {
    throw new Error("Scheduler not initialized - call startScheduler first");
  }

  logger.info("Triggering immediate scan");
  return runScheduledScanSafely("manual");
}

/**
 * Reset scheduler statistics
 */
export function resetSchedulerStats(): void {
  state.scanCount = 0;
  state.opportunitiesFound = 0;
  logger.info("Scheduler stats reset");
}
