/**
 * Autonomous Execution Loop
 * Runs Scanner→Analyst pipeline on schedule within mandate constraints
 */

import { createModuleLogger } from "../../infra/logger/index.ts";
import { emitEvent } from "../../events/index.ts";
import type { Exchange } from "../../infra/exchange/index.ts";
import type { MandateTimeframe, SwingMandate } from "../safety/swing-mandate.ts";
import {
  saveSessionState,
  updateHeartbeat,
  saveMandateState,
  clearMandateState,
  type PersistedSessionState,
} from "../lifecycle/session-persistence.ts";
import {
  isMandateExpired,
  isMandateBreached,
  validateMandate,
} from "../safety/swing-mandate.ts";
import type { ScanOptions } from "./scanner.ts";
import type { CoinAnalysis } from "../../types/index.ts";
import { runSharedScan } from "../lifecycle/market-data-coordinator.ts";

const logger = createModuleLogger("autonomous-loop");

// ============================================================================
// Types
// ============================================================================

export interface AutonomousLoopConfig {
  exchange: Exchange;
  mandate: SwingMandate;
  onOpportunityFound?: (opportunity: OpportunityReport) => Promise<boolean>;
  onTradeIntent?: (intent: TradeIntent) => void;
  onMandateBreach?: (reason: string) => void;
  onCycleComplete?: (report: CycleReport) => void;
}

export interface OpportunityReport {
  symbol: string;
  direction: "long" | "short";
  confidence: number;
  strategy: string;
  reason: string;
}

export interface TradeIntent {
  symbol: string;
  side: "BUY" | "SELL";
  riskPercent: number;
  mandateId: string;
  strategy: string;
  confidence: number;
}

export interface CycleReport {
  cycleNumber: number;
  timestamp: string;
  scannedSymbols: number;
  opportunitiesFound: number;
  mandateStatus: string;
  nextCycleAt: string;
}

// ============================================================================
// State
// ============================================================================

interface LoopState {
  isRunning: boolean;
  isPaused: boolean;
  intervalId: ReturnType<typeof setInterval> | null;
  heartbeatId: ReturnType<typeof setInterval> | null;
  mandate: SwingMandate | null;
  config: AutonomousLoopConfig | null;
  sessionId: string;
  cycleCount: number;
  lastCycleTime: Date | null;
  totalOpportunities: number;
}

let loopState: LoopState = {
  isRunning: false,
  isPaused: false,
  intervalId: null,
  heartbeatId: null,
  mandate: null,
  config: null,
  sessionId: "",
  cycleCount: 0,
  lastCycleTime: null,
  totalOpportunities: 0,
};
let cycleInFlight: Promise<CycleReport | null> | null = null;

function getMandateScanTimeframes(mandate: SwingMandate): string[] {
  const timeframes: MandateTimeframe[] = [
    mandate.executionTimeframe ?? mandate.timeframe,
    mandate.trendTimeframe,
    mandate.timeframe,
  ].filter((timeframe): timeframe is MandateTimeframe => timeframe !== undefined);

  return Array.from(new Set(timeframes));
}

function resolveOpportunityDirection(
  mandate: SwingMandate,
  opportunity: Pick<CoinAnalysis, "bias" | "trend">,
): "long" | "short" {
  if (mandate.direction !== "both") {
    return mandate.direction;
  }

  const biasText = `${opportunity.bias ?? ""} ${opportunity.trend ?? ""}`.toLowerCase();
  if (biasText.includes("bear") || biasText.includes("short") || biasText.includes("down")) {
    return "short";
  }

  return "long";
}

function runCycleSafely(trigger: "startup" | "interval" | "manual"): Promise<CycleReport | null> {
  if (!loopState.isRunning) {
    return Promise.resolve(null);
  }

  if (cycleInFlight) {
    if (trigger !== "manual") {
      logger.debug("Skipping autonomous cycle because previous cycle is still running", { trigger });
    }
    return cycleInFlight;
  }

  const cyclePromise = runCycle()
    .catch((error) => {
      logger.error("Autonomous cycle failed", error as Error);
      return null;
    })
    .finally(() => {
      if (cycleInFlight === cyclePromise) {
        cycleInFlight = null;
      }
    });

  cycleInFlight = cyclePromise;
  return cyclePromise;
}

// ============================================================================
// Core Loop
// ============================================================================

async function runCycle(): Promise<CycleReport | null> {
  if (!loopState.config || !loopState.mandate) {
    logger.error("Cannot run cycle: no config or mandate");
    return null;
  }

  if (loopState.isPaused) {
    logger.debug("Cycle skipped: loop is paused");
    return null;
  }

  const { exchange, mandate, onOpportunityFound, onMandateBreach, onCycleComplete } = loopState.config;

  // Check mandate expiry
  if (isMandateExpired(mandate)) {
    logger.warn("Mandate expired, stopping autonomous loop");
    loopState.mandate!.status = "completed";
    saveMandateState(loopState.mandate!);
    stopAutonomousLoop("Mandate expired");
    return null;
  }

  // Check mandate breach
  const breach = isMandateBreached(mandate);
  if (breach.breached) {
    logger.warn("Mandate breached", { reason: breach.reason });
    loopState.mandate!.status = "paused";
    saveMandateState(loopState.mandate!);
    onMandateBreach?.(breach.reason!);
    await emitEvent("autonomous:mandate_breached", { reason: breach.reason ?? "Unknown breach", mandateId: mandate.id });
    pauseAutonomousLoop();
    return null;
  }

  loopState.cycleCount++;
  const cycleNum = loopState.cycleCount;

  logger.info(`Running autonomous cycle #${cycleNum}`, {
    mandateId: mandate.id,
    symbols: mandate.symbols.length || "all",
    timeframe: mandate.executionTimeframe ?? mandate.timeframe,
    trendTimeframe: mandate.trendTimeframe,
  });

  try {
    // Run scanner
    const scanOptions: ScanOptions = {
      topN: mandate.symbols.length > 0 ? mandate.symbols.length : 50,
      timeframes: getMandateScanTimeframes(mandate),
    };

    const result = await runSharedScan(exchange, scanOptions);

    // Filter by mandate constraints
    let opportunities = result.coins.filter(
      (c) => c.setupDetected && c.setupConfidence >= mandate.minConfidence
    );

    // Filter by symbols if specified
    if (mandate.symbols.length > 0) {
      const symbolSet = new Set(mandate.symbols.map((s) => s.toUpperCase()));
      opportunities = opportunities.filter((c) => symbolSet.has(c.symbol.toUpperCase()));
    }

    loopState.totalOpportunities += opportunities.length;
    loopState.lastCycleTime = new Date();

    logger.info(`Cycle #${cycleNum} complete`, {
      scanned: result.coins.length,
      opportunities: opportunities.length,
    });

    // Notify on each opportunity
    for (const opp of opportunities) {
      const report: OpportunityReport = {
        symbol: opp.symbol,
        direction: resolveOpportunityDirection(mandate, opp),
        confidence: opp.setupConfidence,
        strategy: opp.bias || "unknown",
        reason: `${opp.trend} trend on ${mandate.executionTimeframe ?? mandate.timeframe}, confidence ${(opp.setupConfidence * 100).toFixed(0)}%`,
      };

      if (onOpportunityFound) {
        const shouldExecute = await onOpportunityFound(report);
        if (shouldExecute) {
          logger.info("Opportunity approved for execution", { symbol: opp.symbol });
        }
      }
    }

    // Emit event
    await emitEvent("autonomous:cycle_completed", {
      cycleNumber: cycleNum,
      opportunities: opportunities.length,
      mandateId: mandate.id,
    });

    // Update session state
    updateHeartbeat(loopState.sessionId);

    // Build cycle report
    const nextCycleAt = new Date(Date.now() + mandate.scanIntervalMinutes * 60 * 1000);
    const report: CycleReport = {
      cycleNumber: cycleNum,
      timestamp: new Date().toISOString(),
      scannedSymbols: result.coins.length,
      opportunitiesFound: opportunities.length,
      mandateStatus: mandate.status,
      nextCycleAt: nextCycleAt.toISOString(),
    };

    onCycleComplete?.(report);

    return report;
  } catch (error) {
    logger.error(`Cycle #${cycleNum} failed`, error as Error);
    await emitEvent("autonomous:cycle_failed", {
      cycleNumber: cycleNum,
      error: (error as Error).message,
    });
    return null;
  }
}

// ============================================================================
// Public API
// ============================================================================

export function startAutonomousLoop(config: AutonomousLoopConfig): { success: boolean; error?: string } {
  if (loopState.isRunning) {
    return { success: false, error: "Autonomous loop is already running" };
  }

  // Validate mandate
  const validation = validateMandate(config.mandate);
  if (!validation.valid) {
    return { success: false, error: `Invalid mandate: ${validation.errors.join(", ")}` };
  }

  loopState.config = config;
  loopState.mandate = config.mandate;
  loopState.sessionId = `session_${Date.now()}`;
  loopState.isRunning = true;
  loopState.isPaused = false;
  loopState.cycleCount = 0;
  loopState.totalOpportunities = 0;

  const intervalMs = config.mandate.scanIntervalMinutes * 60 * 1000;

  logger.info("Starting autonomous loop", {
    mandateId: config.mandate.id,
    intervalMinutes: config.mandate.scanIntervalMinutes,
    symbols: config.mandate.symbols,
    expiresAt: config.mandate.expiresAt,
  });

  // Persist state
  const sessionState: PersistedSessionState = {
    sessionId: loopState.sessionId,
    startedAt: new Date().toISOString(),
    lastHeartbeat: new Date().toISOString(),
    schedulerConfig: {
      intervalMs,
      topN: config.mandate.symbols.length || 50,
      minConfidence: config.mandate.minConfidence,
      timeframes: getMandateScanTimeframes(config.mandate),
    },
    mandateId: config.mandate.id,
    scanCount: 0,
    opportunitiesFound: 0,
    activePlanIds: [],
  };
  saveSessionState(sessionState);
  saveMandateState(config.mandate);

  // Run first cycle immediately
  void runCycleSafely("startup");

  // Set up interval
  loopState.intervalId = setInterval(() => {
    void runCycleSafely("interval");
  }, intervalMs);

  // Set up heartbeat (every 5 minutes)
  loopState.heartbeatId = setInterval(() => {
    updateHeartbeat(loopState.sessionId);
  }, 5 * 60 * 1000);

  emitEvent("autonomous:started", {
    mandateId: config.mandate.id,
    intervalMs,
  }).catch((err) => { logger.error("Failed to emit event", err instanceof Error ? err : { error: String(err) }); });

  return { success: true };
}

export function stopAutonomousLoop(reason?: string): void {
  if (!loopState.isRunning) {
    logger.warn("Autonomous loop not running");
    return;
  }

  if (loopState.intervalId) {
    clearInterval(loopState.intervalId);
    loopState.intervalId = null;
  }
  if (loopState.heartbeatId) {
    clearInterval(loopState.heartbeatId);
    loopState.heartbeatId = null;
  }
  cycleInFlight = null;

  logger.info("Autonomous loop stopped", {
    reason,
    totalCycles: loopState.cycleCount,
    totalOpportunities: loopState.totalOpportunities,
  });

  if (loopState.mandate && loopState.mandate.status !== "completed") {
    loopState.mandate.status = "cancelled";
    saveMandateState(loopState.mandate);
  }

  loopState.isRunning = false;
  loopState.isPaused = false;

  clearMandateState();

  emitEvent("autonomous:stopped", {
    reason,
    totalCycles: loopState.cycleCount,
    totalOpportunities: loopState.totalOpportunities,
  }).catch((err) => { logger.error("Failed to emit event", err instanceof Error ? err : { error: String(err) }); });
}

export function pauseAutonomousLoop(): void {
  if (!loopState.isRunning) return;
  loopState.isPaused = true;
  logger.info("Autonomous loop paused");
  emitEvent("autonomous:paused", { mandateId: loopState.mandate?.id }).catch((err) => { logger.error("Failed to emit event", err instanceof Error ? err : { error: String(err) }); });
}

export function resumeAutonomousLoop(): void {
  if (!loopState.isRunning || !loopState.isPaused) return;
  loopState.isPaused = false;
  logger.info("Autonomous loop resumed");
  emitEvent("autonomous:resumed", { mandateId: loopState.mandate?.id }).catch((err) => { logger.error("Failed to emit event", err instanceof Error ? err : { error: String(err) }); });
}

/**
 * Run a single autonomous cycle on demand (called by the daemon scheduler).
 * Only works if the loop is running and not paused.
 */
export async function runAutonomousCycleOnce(): Promise<CycleReport | null> {
  if (!loopState.isRunning || loopState.isPaused) {
    return null;
  }
  return runCycleSafely("manual");
}

export function getAutonomousLoopStatus(): {
  isRunning: boolean;
  isPaused: boolean;
  mandate: SwingMandate | null;
  sessionId: string;
  cycleCount: number;
  totalOpportunities: number;
  lastCycleTime: string | null;
  nextCycleTime: string | null;
} {
  let nextCycleTime: string | null = null;
  if (loopState.isRunning && !loopState.isPaused && loopState.lastCycleTime && loopState.mandate) {
    const nextTime = new Date(
      loopState.lastCycleTime.getTime() + loopState.mandate.scanIntervalMinutes * 60 * 1000
    );
    nextCycleTime = nextTime.toISOString();
  }

  return {
    isRunning: loopState.isRunning,
    isPaused: loopState.isPaused,
    mandate: loopState.mandate,
    sessionId: loopState.sessionId,
    cycleCount: loopState.cycleCount,
    totalOpportunities: loopState.totalOpportunities,
    lastCycleTime: loopState.lastCycleTime?.toISOString() ?? null,
    nextCycleTime,
  };
}
