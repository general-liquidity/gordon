/**
 * Regime Watcher
 *
 * Periodically detects the market regime for symbols with active trades
 * and automatically pauses/resumes strategy slots based on their
 * allowed_regimes configuration.
 *
 * Runs via the daemon scheduler at @every 5m.
 */

import type { Exchange } from "../../infra/exchange/types.ts";
import { RegimeDetector } from "./detector.ts";
import type { MarketRegime, RegimeSignal } from "./types.ts";
import { StrategyRuntime } from "../runtime/engine.ts";
import { listTrades } from "../../infra/storage/trades.ts";
import { logEvent } from "../../infra/storage/events.ts";
import { createModuleLogger } from "../../infra/logger/index.ts";

const logger = createModuleLogger("regime-watcher");

// ============================================================================
// Types
// ============================================================================

export interface RegimeWatchResult {
  symbolRegimes: Record<string, { regime: MarketRegime; confidence: number }>;
  slotActions: SlotRegimeAction[];
  errors: string[];
}

export interface SlotRegimeAction {
  slotId: string;
  playbookName: string;
  action: "paused" | "resumed" | "unchanged";
  currentRegime: MarketRegime;
  allowedRegimes: string[];
  reason: string;
}

// ============================================================================
// RegimeWatcher
// ============================================================================

export class RegimeWatcher {
  private static instance: RegimeWatcher;

  private detector: RegimeDetector;

  private constructor() {
    this.detector = RegimeDetector.getInstance();
  }

  static getInstance(): RegimeWatcher {
    if (!RegimeWatcher.instance) {
      RegimeWatcher.instance = new RegimeWatcher();
    }
    return RegimeWatcher.instance;
  }

  /**
   * Main periodic tick — detect regimes and adjust slot statuses.
   *
   * 1. Collect symbols from active trades
   * 2. Detect regime for each symbol
   * 3. Compare against slot allowed_regimes
   * 4. Pause/resume slots accordingly
   */
  async tick(exchange: Exchange): Promise<RegimeWatchResult> {
    const result: RegimeWatchResult = {
      symbolRegimes: {},
      slotActions: [],
      errors: [],
    };

    const runtime = StrategyRuntime.getInstance();
    const allSlots = [
      ...runtime.getActiveSlots(),
    ];

    if (allSlots.length === 0) {
      logger.debug("No active slots to watch");
      return result;
    }

    // Collect unique symbols from open trades
    const openTrades = listTrades({ status: "OPEN" });
    const partialTrades = listTrades({ status: "PARTIAL" });
    const symbols = new Set<string>();

    for (const trade of [...openTrades, ...partialTrades]) {
      symbols.add(trade.symbol);
    }

    // Also check symbols from slot playbook context (slots may have no open trades yet)
    // For now, use the symbols from active trades
    if (symbols.size === 0) {
      logger.debug("No active trade symbols to detect regime for");
      return result;
    }

    // Detect regime for each symbol
    for (const symbol of symbols) {
      try {
        const candles = await exchange.getCandles(symbol, "1h", 100);
        if (candles.length < 30) {
          result.errors.push(`Insufficient candle data for ${symbol} (${candles.length} candles)`);
          continue;
        }

        const signal: RegimeSignal = this.detector.detectRegime(candles, symbol, "1h");
        result.symbolRegimes[symbol] = {
          regime: signal.regime,
          confidence: signal.confidence,
        };

        logger.debug("Regime detected", {
          symbol,
          regime: signal.regime,
          confidence: signal.confidence.toFixed(2),
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        result.errors.push(`Failed to detect regime for ${symbol}: ${msg}`);
        logger.error("Regime detection failed", error as Error, { symbol });
      }
    }

    // Evaluate each slot against detected regimes
    for (const slot of allSlots) {
      // Skip slots with no regime filter
      if (slot.allowed_regimes.length === 0) {
        continue;
      }

      // Find the primary symbol for this slot (from its open trades)
      // Match trades to this specific slot via planId containing the slot's playbook name
      const slotTrades = [...openTrades, ...partialTrades].filter(
        (t) => t.planId && t.planId.includes(slot.playbook_name.slice(0, 8)),
      );
      // Fallback: if no direct match, use the first symbol with a detected regime
      const slotSymbol = slotTrades[0]?.symbol
        ?? Object.keys(result.symbolRegimes)[0];

      if (!slotSymbol || !result.symbolRegimes[slotSymbol]) {
        result.slotActions.push({
          slotId: slot.slot_id,
          playbookName: slot.playbook_name,
          action: "unchanged",
          currentRegime: "quiet" as MarketRegime,
          allowedRegimes: slot.allowed_regimes,
          reason: "No regime data available for slot symbol",
        });
        continue;
      }

      const currentRegime = result.symbolRegimes[slotSymbol].regime;
      const regimeAllowed = slot.allowed_regimes.includes(currentRegime);

      if (slot.status === "active" && !regimeAllowed) {
        // Pause: regime mismatch
        try {
          runtime.pauseStrategy(slot.slot_id, "regime");
          result.slotActions.push({
            slotId: slot.slot_id,
            playbookName: slot.playbook_name,
            action: "paused",
            currentRegime,
            allowedRegimes: slot.allowed_regimes,
            reason: `Regime ${currentRegime} not in allowed regimes [${slot.allowed_regimes.join(", ")}]`,
          });

          logEvent({
            type: "SYSTEM",
            data: {
              action: "REGIME_SLOT_PAUSED",
              slotId: slot.slot_id,
              playbook: slot.playbook_name,
              currentRegime,
              allowedRegimes: slot.allowed_regimes,
            },
          });

          logger.info("Slot paused due to regime mismatch", {
            slotId: slot.slot_id,
            playbook: slot.playbook_name,
            currentRegime,
            allowedRegimes: slot.allowed_regimes.join(", "),
          });
        } catch (error) {
          result.errors.push(`Failed to pause slot ${slot.slot_id}: ${(error as Error).message}`);
        }
      } else if (slot.status === "paused" && slot.paused_reason === "regime" && regimeAllowed) {
        // Resume: regime now matches and was paused by regime watcher
        try {
          runtime.resumeStrategy(slot.slot_id);
          result.slotActions.push({
            slotId: slot.slot_id,
            playbookName: slot.playbook_name,
            action: "resumed",
            currentRegime,
            allowedRegimes: slot.allowed_regimes,
            reason: `Regime ${currentRegime} now in allowed regimes`,
          });

          logEvent({
            type: "SYSTEM",
            data: {
              action: "REGIME_SLOT_RESUMED",
              slotId: slot.slot_id,
              playbook: slot.playbook_name,
              currentRegime,
              allowedRegimes: slot.allowed_regimes,
            },
          });

          logger.info("Slot resumed — regime now matches", {
            slotId: slot.slot_id,
            playbook: slot.playbook_name,
            currentRegime,
          });
        } catch (error) {
          result.errors.push(`Failed to resume slot ${slot.slot_id}: ${(error as Error).message}`);
        }
      } else {
        result.slotActions.push({
          slotId: slot.slot_id,
          playbookName: slot.playbook_name,
          action: "unchanged",
          currentRegime,
          allowedRegimes: slot.allowed_regimes,
          reason: regimeAllowed ? "Regime matches" : "Already paused (not by regime)",
        });
      }
    }

    logger.info("Regime watch tick complete", {
      symbols: symbols.size,
      regimesDetected: Object.keys(result.symbolRegimes).length,
      actions: result.slotActions.filter((a) => a.action !== "unchanged").length,
      errors: result.errors.length,
    });

    return result;
  }

  /**
   * Get the current detected regime for all watched symbols.
   */
  getRegimeMap(): Record<string, RegimeSignal | null> {
    const openTrades = listTrades({ status: "OPEN" });
    const symbols = new Set(openTrades.map((t) => t.symbol));
    const map: Record<string, RegimeSignal | null> = {};

    for (const symbol of symbols) {
      map[symbol] = this.detector.getCurrentRegime(symbol, "1h");
    }

    return map;
  }
}
