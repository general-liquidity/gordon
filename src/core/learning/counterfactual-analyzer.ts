/**
 * Counterfactual Analyzer
 *
 * Post-trade "what if" analysis. Takes a closed trade + historical candles,
 * simulates alternative scenarios (different SL, TP, entry timing, position size),
 * and returns actionable insights about what could have been better.
 */

import type { Candle, Trade } from "../../types/index.ts";
import { createModuleLogger } from "../../infra/logger/index.ts";

const logger = createModuleLogger("counterfactual-analyzer");

// ============================================================================
// Types
// ============================================================================

export interface CounterfactualReport {
  tradeId: string;
  symbol: string;
  playbookName?: string;
  actualPnl: number;
  actualPnlPercent: number;
  bestAlternativePnl: number;
  improvementPercent: number;
  insights: CounterfactualInsight[];
  scenariosRun: number;
  analyzedAt: string;
}

export interface CounterfactualInsight {
  category: "stop_loss" | "entry_timing" | "take_profit" | "position_size";
  finding: string;
  actualValue: number;
  optimalValue: number;
  pnlDelta: number;
  confidence: number;
}

interface ScenarioResult {
  category: CounterfactualInsight["category"];
  label: string;
  paramValue: number;
  pnl: number;
  pnlPercent: number;
  maxDrawdown: number;
  durationCandles: number;
}

// ============================================================================
// Analyzer
// ============================================================================

export class CounterfactualAnalyzer {
  /**
   * Analyze a closed trade by simulating alternative scenarios.
   */
  analyzeTrade(trade: Trade, candles: Candle[]): CounterfactualReport {
    if (trade.entries.length === 0 || trade.exits.length === 0) {
      return this.emptyReport(trade);
    }

    const entryPrice = trade.averageEntry;
    const entryTime = new Date(trade.entries[0]!.filledAt).getTime();
    const exitTime = new Date(trade.exits[trade.exits.length - 1]!.filledAt).getTime();
    const totalQty = trade.entries.reduce((sum, e) => sum + e.quantity, 0);
    const isLong = true; // Assume long for spot trading

    // Find candle indices for the trade period
    const entryIdx = this.findCandleIndex(candles, entryTime);
    const exitIdx = this.findCandleIndex(candles, exitTime);

    if (entryIdx < 0 || exitIdx < 0 || exitIdx <= entryIdx) {
      return this.emptyReport(trade);
    }

    const tradeCandles = candles.slice(entryIdx, exitIdx + 10); // include buffer
    const actualPnl = trade.realizedPnl;
    const actualPnlPercent = trade.realizedPnlPercent;

    const scenarios: ScenarioResult[] = [];

    // ---------- Stop-loss variants ----------
    const slPercents = [3, 5, 8, 10, 12, 15];
    for (const slPct of slPercents) {
      const slPrice = isLong
        ? entryPrice * (1 - slPct / 100)
        : entryPrice * (1 + slPct / 100);

      const result = this.simulateWithStopLoss(
        tradeCandles, entryPrice, slPrice, totalQty, isLong,
      );
      scenarios.push({
        category: "stop_loss",
        label: `SL at ${slPct}%`,
        paramValue: slPct,
        ...result,
      });
    }

    // ---------- Take-profit variants ----------
    const tpPercents = [3, 5, 8, 10, 15, 20];
    for (const tpPct of tpPercents) {
      const tpPrice = isLong
        ? entryPrice * (1 + tpPct / 100)
        : entryPrice * (1 - tpPct / 100);

      const result = this.simulateWithTakeProfit(
        tradeCandles, entryPrice, tpPrice, totalQty, isLong,
      );
      scenarios.push({
        category: "take_profit",
        label: `TP at ${tpPct}%`,
        paramValue: tpPct,
        ...result,
      });
    }

    // ---------- Entry timing variants ----------
    for (const offset of [1, 2, 3, 5]) {
      if (entryIdx + offset >= candles.length) continue;

      const laterCandle = candles[entryIdx + offset]!;
      const laterEntry = laterCandle.open;
      const laterCandles = candles.slice(entryIdx + offset, exitIdx + 10);

      if (laterCandles.length < 2) continue;

      const result = this.simulateHoldToEnd(
        laterCandles, laterEntry, totalQty, isLong, exitIdx - entryIdx - offset,
      );
      scenarios.push({
        category: "entry_timing",
        label: `Enter ${offset} candles later`,
        paramValue: offset,
        ...result,
      });
    }

    // ---------- Position size variants ----------
    const sizeMultipliers = [0.5, 0.75, 1.25, 1.5];
    for (const mult of sizeMultipliers) {
      const adjustedQty = totalQty * mult;
      // PnL scales linearly with position size
      scenarios.push({
        category: "position_size",
        label: `${(mult * 100).toFixed(0)}% size`,
        paramValue: mult,
        pnl: actualPnl * mult,
        pnlPercent: actualPnlPercent,
        maxDrawdown: 0, // Same percentage drawdown
        durationCandles: exitIdx - entryIdx,
      });
    }

    // ---------- Extract insights ----------
    const insights = this.extractInsights(scenarios, actualPnl, entryPrice);

    const bestPnl = Math.max(actualPnl, ...scenarios.map((s) => s.pnl));
    const improvement = actualPnl !== 0
      ? ((bestPnl - actualPnl) / Math.abs(actualPnl)) * 100
      : bestPnl > 0 ? 100 : 0;

    const report: CounterfactualReport = {
      tradeId: trade.id,
      symbol: trade.symbol,
      actualPnl,
      actualPnlPercent,
      bestAlternativePnl: bestPnl,
      improvementPercent: improvement,
      insights,
      scenariosRun: scenarios.length,
      analyzedAt: new Date().toISOString(),
    };

    logger.info("Counterfactual analysis complete", {
      tradeId: trade.id,
      actualPnl: actualPnl.toFixed(2),
      bestPnl: bestPnl.toFixed(2),
      insights: insights.length,
      scenarios: scenarios.length,
    });

    return report;
  }

  // ---------- Simulation helpers ----------

  private simulateWithStopLoss(
    candles: Candle[], entryPrice: number, slPrice: number,
    quantity: number, isLong: boolean,
  ): { pnl: number; pnlPercent: number; maxDrawdown: number; durationCandles: number } {
    let maxDrawdown = 0;
    let peakPnl = 0;

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i]!;
      const worstPrice = isLong ? c.low : c.high;
      const pnl = isLong
        ? (worstPrice - entryPrice) * quantity
        : (entryPrice - worstPrice) * quantity;

      if (pnl > peakPnl) peakPnl = pnl;
      const dd = peakPnl - pnl;
      if (dd > maxDrawdown) maxDrawdown = dd;

      // Check if stop hit
      const stopHit = isLong ? c.low <= slPrice : c.high >= slPrice;
      if (stopHit) {
        const exitPnl = (slPrice - entryPrice) * quantity * (isLong ? 1 : -1);
        const exitPercent = ((slPrice - entryPrice) / entryPrice) * 100 * (isLong ? 1 : -1);
        return { pnl: exitPnl, pnlPercent: exitPercent, maxDrawdown, durationCandles: i + 1 };
      }
    }

    // Never hit stop — use last candle close
    const lastClose = candles[candles.length - 1]!.close;
    const finalPnl = (lastClose - entryPrice) * quantity * (isLong ? 1 : -1);
    const finalPercent = ((lastClose - entryPrice) / entryPrice) * 100 * (isLong ? 1 : -1);
    return { pnl: finalPnl, pnlPercent: finalPercent, maxDrawdown, durationCandles: candles.length };
  }

  private simulateWithTakeProfit(
    candles: Candle[], entryPrice: number, tpPrice: number,
    quantity: number, isLong: boolean,
  ): { pnl: number; pnlPercent: number; maxDrawdown: number; durationCandles: number } {
    let maxDrawdown = 0;
    let peakPnl = 0;

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i]!;
      const bestPrice = isLong ? c.high : c.low;
      const worstPrice = isLong ? c.low : c.high;

      const worstPnl = isLong
        ? (worstPrice - entryPrice) * quantity
        : (entryPrice - worstPrice) * quantity;

      if (worstPnl > peakPnl) peakPnl = worstPnl;
      const dd = peakPnl - worstPnl;
      if (dd > maxDrawdown) maxDrawdown = dd;

      // Check if TP hit
      const tpHit = isLong ? bestPrice >= tpPrice : bestPrice <= tpPrice;
      if (tpHit) {
        const exitPnl = (tpPrice - entryPrice) * quantity * (isLong ? 1 : -1);
        const exitPercent = ((tpPrice - entryPrice) / entryPrice) * 100 * (isLong ? 1 : -1);
        return { pnl: exitPnl, pnlPercent: exitPercent, maxDrawdown, durationCandles: i + 1 };
      }
    }

    const lastClose = candles[candles.length - 1]!.close;
    const finalPnl = (lastClose - entryPrice) * quantity * (isLong ? 1 : -1);
    const finalPercent = ((lastClose - entryPrice) / entryPrice) * 100 * (isLong ? 1 : -1);
    return { pnl: finalPnl, pnlPercent: finalPercent, maxDrawdown, durationCandles: candles.length };
  }

  private simulateHoldToEnd(
    candles: Candle[], entryPrice: number, quantity: number,
    isLong: boolean, maxCandles: number,
  ): { pnl: number; pnlPercent: number; maxDrawdown: number; durationCandles: number } {
    const limit = Math.min(candles.length, maxCandles);
    let maxDrawdown = 0;
    let peakPnl = 0;

    for (let i = 0; i < limit; i++) {
      const c = candles[i]!;
      const pnl = (c.close - entryPrice) * quantity * (isLong ? 1 : -1);
      if (pnl > peakPnl) peakPnl = pnl;
      const dd = peakPnl - pnl;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    const exitPrice = candles[Math.min(limit - 1, candles.length - 1)]!.close;
    const finalPnl = (exitPrice - entryPrice) * quantity * (isLong ? 1 : -1);
    const finalPercent = ((exitPrice - entryPrice) / entryPrice) * 100 * (isLong ? 1 : -1);
    return { pnl: finalPnl, pnlPercent: finalPercent, maxDrawdown, durationCandles: limit };
  }

  private findCandleIndex(candles: Candle[], timestamp: number): number {
    for (let i = 0; i < candles.length; i++) {
      if (candles[i]!.openTime >= timestamp) return i;
    }
    return candles.length - 1;
  }

  private extractInsights(
    scenarios: ScenarioResult[], actualPnl: number, entryPrice: number,
  ): CounterfactualInsight[] {
    const insights: CounterfactualInsight[] = [];

    // Best stop-loss
    const slScenarios = scenarios.filter((s) => s.category === "stop_loss");
    const bestSL = slScenarios.reduce((best, s) =>
      s.pnl > best.pnl ? s : best, slScenarios[0]!);
    if (bestSL && bestSL.pnl > actualPnl * 1.1) {
      insights.push({
        category: "stop_loss",
        finding: `A ${bestSL.paramValue}% stop-loss would have yielded $${bestSL.pnl.toFixed(2)} vs actual $${actualPnl.toFixed(2)}`,
        actualValue: 0, // Actual SL % unknown at this level
        optimalValue: bestSL.paramValue,
        pnlDelta: bestSL.pnl - actualPnl,
        confidence: 0.7,
      });
    }

    // Best take-profit
    const tpScenarios = scenarios.filter((s) => s.category === "take_profit");
    const bestTP = tpScenarios.reduce((best, s) =>
      s.pnl > best.pnl ? s : best, tpScenarios[0]!);
    if (bestTP && bestTP.pnl > actualPnl * 1.1) {
      insights.push({
        category: "take_profit",
        finding: `A ${bestTP.paramValue}% take-profit would have yielded $${bestTP.pnl.toFixed(2)} vs actual $${actualPnl.toFixed(2)}`,
        actualValue: 0,
        optimalValue: bestTP.paramValue,
        pnlDelta: bestTP.pnl - actualPnl,
        confidence: 0.7,
      });
    }

    // Best entry timing
    const timingScenarios = scenarios.filter((s) => s.category === "entry_timing");
    const bestTiming = timingScenarios.reduce((best, s) =>
      s.pnl > best.pnl ? s : best, timingScenarios[0]!);
    if (bestTiming && bestTiming.pnl > actualPnl * 1.15) {
      insights.push({
        category: "entry_timing",
        finding: `Entering ${bestTiming.paramValue} candles later would have yielded $${bestTiming.pnl.toFixed(2)} vs actual $${actualPnl.toFixed(2)}`,
        actualValue: 0,
        optimalValue: bestTiming.paramValue,
        pnlDelta: bestTiming.pnl - actualPnl,
        confidence: 0.5,
      });
    }

    return insights;
  }

  private emptyReport(trade: Trade): CounterfactualReport {
    return {
      tradeId: trade.id,
      symbol: trade.symbol,
      actualPnl: trade.realizedPnl,
      actualPnlPercent: trade.realizedPnlPercent,
      bestAlternativePnl: trade.realizedPnl,
      improvementPercent: 0,
      insights: [],
      scenariosRun: 0,
      analyzedAt: new Date().toISOString(),
    };
  }
}
