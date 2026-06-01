/**
 * V4 Analytics Tools — 4 compute tools.
 *
 *   - compute_indicator        — dispatcher over ~30 indicator operations
 *   - compute_regime           — market regime classification
 *   - compute_risk             — 11-dim risk classifier
 *   - compute_microstructure   — dispatcher over microprice / inventory /
 *                                correlation / vol-calibration / etc.
 *
 * `compute_indicator` and `compute_microstructure` are the only V4 tools
 * that use the dispatcher-over-discriminator pattern. They're justified
 * because each has a closed, well-named operation namespace.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getGordonContext, type MastraExecutionContext } from "../types.ts";
import {
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateATR,
  calculateEMA,
  calculateSMA,
  calculateIchimoku,
  calculateSupertrend,
  calculateADX,
  calculateVWAP,
  calculateMFI,
  calculateStochasticRSI,
  calculateFibonacci,
  calculateCamarillaPivots,
  calculateParabolicSAR,
  calculateKalmanFilter,
  calculateMarkovRegime,
  calculateElliottWave,
  calculateOrderBlocks,
  calculateFVG,
  calculateSupplyDemandZones,
  calculateNadarayaWatson,
  calculateDivergence,
  calculateFalseBreakout,
  calculateSqueezeMomentum,
  calculateAMS,
  calculateAO,
  calculateDeltaLadder,
  calculateFlowScope,
  calculateTightConsolidation,
  calculateUndercutRally,
  calculateTrimState,
  calculateResistanceTests,
  detectCandlestickPatterns,
  linearRegression,
  calculateStandardErrorBands,
  calculateHighestVolumeEver,
  detectLmwPatterns,
  calculateCCI,
  calculateWilliamsR,
  calculateUltimateOscillator,
  calculateAroon,
  calculateADXR,
  calculateNATR,
  calculateCMO,
  calculateAPO,
  calculatePPO,
  calculateChaikinAD,
  calculateChaikinOscillator,
  calculateWMA,
  calculateDEMA,
  calculateTEMA,
  calculateTRIMA,
  buildInformationBars,
  buildInformationBarsFromOHLCV,
  type CandlestickPatternName,
  type Candle as IndicatorCandle,
} from "../../../../core/indicators/index.ts";
import { conditionalDistributionTest } from "../../../../core/alpha/conditional-distribution-test.ts";
import { runPortfolioEnsemble } from "../../../../core/alpha/pc-method-ensemble.ts";
import { runRegimeAllocationPolicy } from "../../../../core/alpha/regime-policy.ts";
import { computeForensicScores } from "../../../../core/alpha/forensic-accounting.ts";
import { diffFilingSections, diffNamedSection } from "../../../../core/alpha/filing-section-diff.ts";
import { computeTokenUnlockRisk } from "../../../../core/alpha/token-unlock-risk.ts";
import { computeHolderConcentration } from "../../../../core/alpha/holder-concentration.ts";
import { fitGarch } from "../../../../core/alpha/garch.ts";
import { hierarchicalRiskParity } from "../../../../core/alpha/hierarchical-risk-parity.ts";
import {
  computeFormulaicAlpha,
  IMPLEMENTED_ALPHAS,
  type AlphaInputs,
} from "../../../../core/alpha/formulaic-alphas.ts";
import { makePanel, type Cell } from "../../../../core/alpha/formulaic-alpha-operators.ts";
import { runAdfTest, adfToPayload } from "../../../trading/quant/stationarityTest.ts";
import { runKpssTest, kpssToPayload } from "../../../trading/quant/kpssTest.ts";
import { runJohansenTest, johansenToPayload } from "../../../trading/quant/johansenCointegration.ts";
import { acf, pacf } from "../../../trading/quant/autocorrelation.ts";
import { RegimeDetector } from "../../../../core/regime/index.ts";
import { checkRiskTool as implCheckRisk } from "../trading/risk-gate.ts";
import { recordSymbolObservation } from "../../observation/symbolObservationTracker.ts";
import {
  computeMicropriceTool as implMicroprice,
  computeInventoryAdjustedPriceTool as implInventoryAdjusted,
  computeMonteCarloPathTool as implMonteCarloPath,
  computeKellySizeTool as implKellySize,
  computeMarketMemoryTool as implMarketMemory,
  computeDcfTool as implDcf,
  computeVsRandomTool as implVsRandom,
  computeSignalPoolTool as implSignalPool,
  computePortfolioCombineTool as implPortfolioCombine,
  computeSyntheticAugmentTool as implSyntheticAugment,
  computeHmmRegimeTool as implHmmRegime,
  computePieTool as implPie,
  computeFundamentalRatiosTool as implFundamentalRatios,
  computeRuinProbabilityTool as implRuinProbability,
} from "../runtime/microstructure.ts";
import {
  detectCorrelationBreakdownTool as implCorrelationBreakdown,
  getVolForecastCalibrationTool as implVolForecast,
  getPnlDistributionShapeTool as implPnlShape,
} from "../runtime/diagnostics.ts";
import {
  validateEarningsSignalTool as implEarningsSignal,
  getDisciplineAuditTool as implDisciplineAudit,
  getDisciplineTrajectoryTool as implDisciplineTrajectory,
  interpretRiskRatioTripleTool as implRiskRatioTriple,
  computeOrchestrationLoadTool as implOrchestrationLoad,
  classifySurvivorshipRiskTool as implSurvivorshipRisk,
  computeCrowdPositioningVerdictTool as implCrowdPositioning,
} from "../runtime/institutionalAi.ts";
import { getAdherenceReportTool as implAdherenceReport } from "../runtime/adherence.ts";

/** Auto-collect bridge for the three microstructure ops whose direct
 *  inputs (snapshots[], mid+inventory+vol+horizon, ReturnSeries[]) are
 *  too data-heavy for an LLM to assemble in one turn. When the operator
 *  passes a symbol-shaped shortcut, gather the required data from the
 *  exchange first and return the rewritten params object. When the
 *  direct inputs are already present, return them unchanged. */
async function maybeAutoCollect(
  operation: string,
  params: Record<string, unknown>,
  execContext: MastraExecutionContext | undefined,
): Promise<Record<string, unknown> | { error: string }> {
  const ctx = getGordonContext(execContext);
  const exchange = ctx?.exchange;
  // Any auto-collect path that names a symbol counts as an observation —
  // these are the cases where compute_microstructure goes to the exchange
  // for candles or book state on the operator's behalf.
  if (typeof params.symbol === "string") recordSymbolObservation(params.symbol);
  if (Array.isArray(params.symbols)) {
    for (const s of params.symbols) if (typeof s === "string") recordSymbolObservation(s);
  }

  if (operation === "microprice") {
    if (Array.isArray(params.snapshots)) return params;
    const symbol = typeof params.symbol === "string" ? params.symbol : null;
    if (!symbol) return params;
    if (!exchange) return { error: "auto-collect microprice: no exchange connected" };
    const durationSec = typeof params.durationSec === "number" ? params.durationSec : 30;
    const intervalMs = typeof params.intervalMs === "number" ? params.intervalMs : 250;
    const snapshots: Array<{
      mid: number;
      bid: number;
      ask: number;
      bidVolume: number;
      askVolume: number;
      timestamp: number;
    }> = [];
    const start = Date.now();
    const deadline = start + durationSec * 1000;
    let inferredTickSize: number | null = null;
    while (Date.now() < deadline) {
      try {
        const book = await exchange.getOrderBook(symbol, 5);
        const bids = book.bids ?? [];
        const asks = book.asks ?? [];
        const bestBid = bids[0];
        const bestAsk = asks[0];
        if (bestBid && bestAsk) {
          const bid = bestBid.price;
          const ask = bestAsk.price;
          const bidVolume = bestBid.quantity;
          const askVolume = bestAsk.quantity;
          snapshots.push({
            mid: (bid + ask) / 2,
            bid,
            ask,
            bidVolume,
            askVolume,
            timestamp: Date.now(),
          });
          // Infer tick from spread of any snapshot where bid < ask cleanly.
          if (inferredTickSize === null && ask > bid) {
            inferredTickSize = +(ask - bid).toFixed(8);
          }
        }
      } catch {
        // Skip transient failures; keep collecting.
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    if (snapshots.length < 5) {
      return { error: `auto-collect microprice: only ${snapshots.length} snapshots gathered — increase durationSec` };
    }
    const tickSize =
      typeof params.tickSize === "number" && params.tickSize > 0
        ? params.tickSize
        : inferredTickSize ?? 0.01;
    return {
      snapshots,
      tickSize,
      ...(typeof params.imbalanceBuckets === "number" && { imbalanceBuckets: params.imbalanceBuckets }),
      ...(typeof params.maxSpreadTicks === "number" && { maxSpreadTicks: params.maxSpreadTicks }),
      ...(typeof params.iterations === "number" && { iterations: params.iterations }),
    };
  }

  if (operation === "inventory_adjusted_price") {
    if (typeof params.mid === "number" && typeof params.inventory === "number") return params;
    const symbol = typeof params.symbol === "string" ? params.symbol : null;
    if (!symbol) return params;
    if (!exchange) return { error: "auto-collect inventory_adjusted_price: no exchange connected" };
    const price = await exchange.getPrice(symbol);
    // ATR-derived volatility on 1h candles; convert ATR/price to a per-bar
    // fractional vol, then annualize roughly for a normalized horizon unit.
    const candles = await exchange.getCandles(symbol, "1h", 100);
    const closes = candles.map((c) => c.close);
    let atr = 0;
    if (candles.length > 14) {
      let trSum = 0;
      for (let i = 1; i < candles.length; i++) {
        const c = candles[i]!;
        const prev = candles[i - 1]!;
        const tr = Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
        trSum += tr;
      }
      atr = trSum / Math.max(candles.length - 1, 1);
    }
    const lastClose = closes[closes.length - 1] ?? price;
    const volatility = lastClose > 0 ? Math.max(atr / lastClose, 1e-5) : 0.01;
    const positionUsd = typeof params.positionUsd === "number" ? params.positionUsd : 0;
    const portfolioUsd = Math.max(ctx?.portfolioValue ?? 1, 1);
    const inventory = positionUsd / portfolioUsd; // -1..+1
    const horizonHours = typeof params.horizonHours === "number" ? params.horizonHours : 1;
    const horizon = horizonHours / 24; // express in days, matches per-day vol unit
    return {
      mid: price,
      inventory,
      volatility,
      horizon,
      ...(typeof params.riskAversion === "number" && { riskAversion: params.riskAversion }),
      ...(typeof params.intendedSide === "number" && { intendedSide: params.intendedSide }),
    };
  }

  if (operation === "correlation_breakdown") {
    if (Array.isArray(params.series)) return params;
    const symbols = Array.isArray(params.symbols)
      ? (params.symbols.filter((s) => typeof s === "string") as string[])
      : null;
    if (!symbols || symbols.length < 2) return params;
    if (!exchange) return { error: "auto-collect correlation_breakdown: no exchange connected" };
    const timeframe = (typeof params.timeframe === "string" ? params.timeframe : "1h") as string;
    const lookbackBars = typeof params.lookbackBars === "number" ? params.lookbackBars : 200;
    const seriesEntries = await Promise.all(
      symbols.map(async (symbol) => {
        const candles = await exchange.getCandles(symbol, timeframe, lookbackBars);
        const closes = candles.map((c) => c.close);
        const returns: number[] = [];
        for (let i = 1; i < closes.length; i++) {
          const prev = closes[i - 1]!;
          const curr = closes[i]!;
          if (prev > 0 && curr > 0) returns.push(Math.log(curr / prev));
        }
        return { symbol, returns };
      }),
    );
    const minLen = Math.min(...seriesEntries.map((s) => s.returns.length));
    if (minLen < 2) {
      return { error: "auto-collect correlation_breakdown: insufficient aligned returns" };
    }
    // Align to common tail length.
    const aligned = seriesEntries.map((s) => ({
      symbol: s.symbol,
      returns: s.returns.slice(s.returns.length - minLen),
    }));
    return {
      series: aligned,
      ...(typeof params.tailWindow === "number" && { tailWindow: params.tailWindow }),
      ...(typeof params.baselineWindow === "number" && { baselineWindow: params.baselineWindow }),
    };
  }

  if (operation === "regime_policy") {
    if (Array.isArray(params.returns)) return params;
    const symbols = Array.isArray(params.symbols)
      ? (params.symbols.filter((s) => typeof s === "string") as string[])
      : null;
    if (!symbols || symbols.length < 2) return params;
    if (!exchange) return { error: "auto-collect regime_policy: no exchange connected" };
    const timeframe = (typeof params.timeframe === "string" ? params.timeframe : "1d") as string;
    const lookbackBars = typeof params.lookbackBars === "number" ? params.lookbackBars : 400;
    const seriesEntries = await Promise.all(
      symbols.map(async (symbol) => {
        const candles = await exchange.getCandles(symbol, timeframe, lookbackBars);
        const closes = candles.map((c) => c.close);
        const returns: number[] = [];
        for (let i = 1; i < closes.length; i++) {
          const prev = closes[i - 1]!;
          const curr = closes[i]!;
          if (prev > 0 && curr > 0) returns.push(Math.log(curr / prev));
        }
        return { symbol, returns };
      }),
    );
    const minLen = Math.min(...seriesEntries.map((s) => s.returns.length));
    if (minLen < 60) {
      return { error: `auto-collect regime_policy: only ${minLen} aligned returns — need ≥ 60 for a stable HMM fit` };
    }
    // Align to common tail length; returns[asset][t].
    const aligned = seriesEntries.map((s) => s.returns.slice(s.returns.length - minLen));
    return {
      returns: aligned,
      assetNames: symbols,
      ...(typeof params.driverIndex === "number" && { driverIndex: params.driverIndex }),
      ...(typeof params.nStates === "number" && { nStates: params.nStates }),
      ...(typeof params.discount === "number" && { discount: params.discount }),
      ...(typeof params.rewardModel === "string" && { rewardModel: params.rewardModel }),
      ...(typeof params.seed === "number" && { seed: params.seed }),
    };
  }

  if (operation === "monte_carlo_path") {
    if (Array.isArray(params.prices)) return params;
    const symbol = typeof params.symbol === "string" ? params.symbol : null;
    if (!symbol) return params;
    if (!exchange) return { error: "auto-collect monte_carlo_path: no exchange connected" };
    const horizonBars = typeof params.horizonBars === "number" ? params.horizonBars : null;
    if (!horizonBars) return { error: "auto-collect monte_carlo_path: horizonBars is required" };
    const timeframe = (typeof params.timeframe === "string" ? params.timeframe : "1h") as string;
    const lookbackBars = typeof params.lookbackBars === "number" ? params.lookbackBars : 200;
    const candles = await exchange.getCandles(symbol, timeframe, lookbackBars);
    const prices = candles.map((c) => c.close);
    if (prices.length < 20) {
      return { error: `auto-collect monte_carlo_path: only ${prices.length} candles — need ≥ 20` };
    }
    return {
      prices,
      horizonBars,
      ...(typeof params.nSims === "number" && { nSims: params.nSims }),
      ...(typeof params.model === "string" && { model: params.model }),
      ...(typeof params.nStates === "number" && { nStates: params.nStates }),
      ...(Array.isArray(params.exceedanceLevels) && { exceedanceLevels: params.exceedanceLevels }),
    };
  }

  if (operation === "market_memory") {
    if (Array.isArray(params.prices)) return params;
    const symbol = typeof params.symbol === "string" ? params.symbol : null;
    if (!symbol) return params;
    if (!exchange) return { error: "auto-collect market_memory: no exchange connected" };
    const timeframe = (typeof params.timeframe === "string" ? params.timeframe : "1d") as string;
    // ≥ 500 returns recommended for "high" reliability. 600 candles is a
    // reasonable default — enough power, not so much that we slow down
    // a typical scan.
    const lookbackBars = typeof params.lookbackBars === "number" ? params.lookbackBars : 600;
    const candles = await exchange.getCandles(symbol, timeframe, lookbackBars);
    const prices = candles.map((c) => c.close);
    if (prices.length < 60) {
      return { error: `auto-collect market_memory: only ${prices.length} candles — need ≥ 60 for a meaningful Hurst estimate` };
    }
    return {
      prices,
      ...(typeof params.nSurrogates === "number" && { nSurrogates: params.nSurrogates }),
      ...(typeof params.minWindow === "number" && { minWindow: params.minWindow }),
      ...(Array.isArray(params.vrHorizons) && { vrHorizons: params.vrHorizons }),
      ...(typeof params.pValueCutoff === "number" && { pValueCutoff: params.pValueCutoff }),
    };
  }

  return params;
}

/** Wrap an execution context's RequestContext so reads of portfolioValue
 *  / availableCash return the operator-supplied override instead of the
 *  live exchange balance. Used by compute_risk + verify_plan to support
 *  hypothetical-portfolio reasoning without flipping into paper mode. */
function withPortfolioOverride(
  execContext: MastraExecutionContext | undefined,
  overrideUsd: number,
): MastraExecutionContext | undefined {
  if (!execContext?.requestContext) return execContext;
  const original = execContext.requestContext;
  const proxied = new Proxy(original, {
    get(target, prop, receiver) {
      if (prop === "get") {
        return (key: string) => {
          if (key === "portfolioValue" || key === "availableCash") return overrideUsd;
          return Reflect.get(target, "get").call(target, key);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  return { ...execContext, requestContext: proxied };
}

// ============================================================================
// compute_indicator
// ============================================================================

const INDICATOR_NAMES = [
  "rsi",
  "macd",
  "bollinger",
  "atr",
  "ema",
  "sma",
  "ichimoku",
  "supertrend",
  "adx",
  "vwap",
  "mfi",
  "stochastic",
  "fibonacci",
  "camarilla_pivots",
  "parabolic_sar",
  "kalman",
  "markov_regime",
  "elliott_wave",
  "order_blocks",
  "fvg",
  "supply_demand_zones",
  "nadaraya_watson",
  "divergence",
  "false_breakout",
  "squeeze_momentum",
  "angled_market_structure",
  "awesome_oscillator",
  "delta_ladder",
  "flowscope",
  "tight_consolidation",
  "undercut_rally",
  "trim_state",
  "resistance_tests",
  "candlestick_patterns",
  "linear_regression",
  "standard_error_bands",
  "highest_volume_ever",
  "lmw_patterns",
  "cci",
  "williams_r",
  "ultosc",
  "aroon",
  "adxr",
  "natr",
  "cmo",
  "apo",
  "ppo",
  "chaikin_ad",
  "chaikin_osc",
  "wma",
  "dema",
  "tema",
  "trima",
  "garch_forecast",
] as const;

function dispatchIndicator(
  indicator: string,
  candles: IndicatorCandle[],
  params: Record<string, unknown> = {},
): unknown {
  const closes = candles.map((c) => c.close);

  switch (indicator) {
    case "rsi":
      return calculateRSI(closes, (params.period as number) ?? 14);
    case "macd":
      return calculateMACD(
        closes,
        (params.fast as number) ?? 12,
        (params.slow as number) ?? 26,
        (params.signal as number) ?? 9,
      );
    case "bollinger":
      return calculateBollingerBands(
        closes,
        (params.period as number) ?? 20,
        (params.stdDev as number) ?? 2,
      );
    case "atr":
      return calculateATR(candles, (params.period as number) ?? 14);
    case "ema":
      return calculateEMA(closes, (params.period as number) ?? 20);
    case "sma":
      return calculateSMA(closes, (params.period as number) ?? 20);
    case "ichimoku":
      return calculateIchimoku(candles);
    case "supertrend":
      return calculateSupertrend(candles);
    case "adx":
      return calculateADX(candles, (params.period as number) ?? 14);
    case "vwap":
      return calculateVWAP(candles);
    case "mfi":
      return calculateMFI(candles, (params.period as number) ?? 14);
    case "stochastic":
      return calculateStochasticRSI(closes);
    case "fibonacci":
      return calculateFibonacci(candles);
    case "camarilla_pivots":
      return calculateCamarillaPivots(candles);
    case "parabolic_sar":
      return calculateParabolicSAR(candles);
    case "kalman":
      return calculateKalmanFilter(candles);
    case "markov_regime":
      return calculateMarkovRegime(candles);
    case "elliott_wave":
      return calculateElliottWave(candles);
    case "order_blocks":
      return calculateOrderBlocks(candles);
    case "fvg":
      return calculateFVG(candles);
    case "supply_demand_zones":
      return calculateSupplyDemandZones(candles);
    case "nadaraya_watson":
      return calculateNadarayaWatson(candles);
    case "divergence":
      return calculateDivergence(candles);
    case "false_breakout":
      return calculateFalseBreakout(candles);
    case "squeeze_momentum":
      return calculateSqueezeMomentum(candles);
    case "angled_market_structure":
      return calculateAMS(candles);
    case "awesome_oscillator":
      return calculateAO(candles);
    case "delta_ladder":
      return calculateDeltaLadder(candles);
    case "flowscope":
      return calculateFlowScope(candles);
    case "tight_consolidation":
      return calculateTightConsolidation(candles, {
        ...(typeof params.window === "number" && { window: params.window }),
        ...(typeof params.maxRangePct === "number" && { maxRangePct: params.maxRangePct }),
        ...(typeof params.minDays === "number" && { minDays: params.minDays }),
      });
    case "undercut_rally":
      return calculateUndercutRally(candles, {
        ...(typeof params.srLookback === "number" && { srLookback: params.srLookback }),
        ...(typeof params.reclaimWindow === "number" && { reclaimWindow: params.reclaimWindow }),
        ...(typeof params.breakdownThresholdPct === "number" && { breakdownThresholdPct: params.breakdownThresholdPct }),
        ...(typeof params.reclaimMargin === "number" && { reclaimMargin: params.reclaimMargin }),
        ...(typeof params.volumeMult === "number" && { volumeMult: params.volumeMult }),
      });
    case "trim_state":
      return calculateTrimState(candles, {
        ...(typeof params.entryBarIndex === "number" && { entryBarIndex: params.entryBarIndex }),
        ...(typeof params.firstResistanceLevel === "number" && { firstResistanceLevel: params.firstResistanceLevel }),
      });
    case "resistance_tests": {
      const level = typeof params.level === "number" ? params.level : NaN;
      return calculateResistanceTests(candles, level, {
        ...(typeof params.tolerancePct === "number" && { tolerancePct: params.tolerancePct }),
        ...(typeof params.windowBars === "number" && { windowBars: params.windowBars }),
        ...(typeof params.minRejectionPct === "number" && { minRejectionPct: params.minRejectionPct }),
        ...(typeof params.rejectionWindow === "number" && { rejectionWindow: params.rejectionWindow }),
        ...(typeof params.minBarsBetweenTests === "number" && { minBarsBetweenTests: params.minBarsBetweenTests }),
      });
    }
    case "candlestick_patterns":
      return detectCandlestickPatterns(candles, {
        ...(Array.isArray(params.patterns) && {
          patterns: (params.patterns as unknown[]).filter(
            (p): p is CandlestickPatternName => typeof p === "string",
          ) as CandlestickPatternName[],
        }),
        ...(typeof params.windowBars === "number" && { windowBars: params.windowBars }),
        ...(typeof params.dojiBodyThresholdPct === "number" && { dojiBodyThresholdPct: params.dojiBodyThresholdPct }),
        ...(typeof params.shadowToBodyRatio === "number" && { shadowToBodyRatio: params.shadowToBodyRatio }),
      });
    case "linear_regression":
      // Single least-squares fit over the full closes series. Pass a
      // `bars` param upstream to control the lookback. Returns slope,
      // intercept, R², standard error, last-bar projection.
      return linearRegression(closes);
    case "standard_error_bands":
      return calculateStandardErrorBands(closes, {
        ...(typeof params.period === "number" && { period: params.period }),
        ...(typeof params.multiplier === "number" && { multiplier: params.multiplier }),
        ...(typeof params.slopeThreshold === "number" && { slopeThreshold: params.slopeThreshold }),
        ...(typeof params.rSquaredThreshold === "number" && { rSquaredThreshold: params.rSquaredThreshold }),
      });
    case "highest_volume_ever":
      return calculateHighestVolumeEver(candles, {
        ...(typeof params.lookbackBars === "number" && { lookbackBars: params.lookbackBars }),
        ...(typeof params.minBarsBeforeDetection === "number" && { minBarsBeforeDetection: params.minBarsBeforeDetection }),
      });
    case "lmw_patterns": {
      // Lo-Mamaysky-Wang kernel-extrema geometric patterns. Omit the full
      // smoothed series from the result to keep the tool payload tight.
      const r = detectLmwPatterns(closes, {
        ...(typeof params.bandwidth === "number" && { bandwidth: params.bandwidth }),
        ...(typeof params.doubleMinSeparation === "number" && {
          doubleMinSeparation: params.doubleMinSeparation,
        }),
      });
      return {
        matches: r.matches,
        matchCount: r.matches.length,
        extremaCount: r.extrema.length,
        bandwidth: r.bandwidth,
        interpretation: r.interpretation,
      };
    }
    case "cci":
      return calculateCCI(candles, (params.period as number) ?? 20);
    case "williams_r":
      return calculateWilliamsR(candles, (params.period as number) ?? 14);
    case "ultosc":
      return calculateUltimateOscillator(
        candles,
        (params.short as number) ?? 7,
        (params.medium as number) ?? 14,
        (params.long as number) ?? 28,
      );
    case "aroon":
      return calculateAroon(candles, (params.period as number) ?? 25);
    case "adxr":
      return calculateADXR(candles, (params.period as number) ?? 14);
    case "natr":
      return calculateNATR(candles, (params.period as number) ?? 14);
    case "cmo":
      return calculateCMO(closes, (params.period as number) ?? 14);
    case "apo":
      return calculateAPO(closes, (params.fast as number) ?? 12, (params.slow as number) ?? 26);
    case "ppo":
      return calculatePPO(closes, (params.fast as number) ?? 12, (params.slow as number) ?? 26);
    case "chaikin_ad":
      return calculateChaikinAD(candles);
    case "chaikin_osc":
      return calculateChaikinOscillator(candles, (params.fast as number) ?? 3, (params.slow as number) ?? 10);
    case "wma":
    case "dema":
    case "tema":
    case "trima": {
      const period = (params.period as number) ?? 14;
      const fn =
        indicator === "wma"
          ? calculateWMA
          : indicator === "dema"
            ? calculateDEMA
            : indicator === "tema"
              ? calculateTEMA
              : calculateTRIMA;
      const values = fn(closes, period);
      // The MA family returns a bare aligned (number|null)[]; box it to match
      // the object-result shape of the other indicator ops.
      let current: number | null = null;
      for (let i = values.length - 1; i >= 0; i--) {
        if (values[i] !== null) {
          current = values[i]!;
          break;
        }
      }
      return { values, current, period, indicator };
    }
    case "garch_forecast": {
      // Fit GARCH(1,1) on log-returns derived from the fetched closes, then
      // emit the conditional-vol fit + a multi-step variance forecast.
      const returns: number[] = [];
      for (let i = 1; i < closes.length; i++) {
        const prev = closes[i - 1]!;
        const curr = closes[i]!;
        if (prev > 0 && curr > 0) returns.push(Math.log(curr / prev));
      }
      const r = fitGarch(returns, {
        ...(typeof params.demean === "boolean" && { demean: params.demean }),
      });
      if (!r) return { error: "garch_forecast: insufficient returns (need ≥ ~50 bars)" };
      const horizon = typeof params.horizon === "number" ? params.horizon : 10;
      const { forecast, ...rest } = r;
      return { ...rest, horizon, varianceForecast: forecast(horizon) };
    }
    default:
      return { error: `Unknown indicator: ${indicator}` };
  }
}

export const computeIndicatorTool = createTool({
  id: "compute_indicator",
  description: [
    "Compute a technical indicator for a symbol. One tool covers ~30",
    "indicators; pick via the `indicator` field.",
    "",
    "Standard momentum/trend: rsi, macd, bollinger, atr, ema, sma, adx, vwap",
    "Oscillators: stochastic, mfi, awesome_oscillator",
    "Levels: fibonacci, camarilla_pivots, supply_demand_zones, order_blocks, fvg",
    "Trend systems: ichimoku, supertrend, parabolic_sar",
    "Stats: kalman, nadaraya_watson, markov_regime",
    "SMC patterns: divergence, false_breakout, squeeze_momentum, angled_market_structure",
    "Geometric chart patterns: lmw_patterns (Lo-Mamaysky-Wang kernel-extrema detector — head-and-shoulders/inverse, broadening top/bottom, triangle top/bottom, rectangle top/bottom, double top/bottom; params { bandwidth?, doubleMinSeparation? }; pair with compute_microstructure signal_informativeness to test whether a pattern moves returns)",
    "Setup detection: tight_consolidation (bull-flag / pennant scorer), undercut_rally (shakeout-and-reclaim)",
    "Exit coaching: trim_state (momentum-swing 8/21/50 EMA trail ladder), resistance_tests (count level rejections + confidence)",
    "Candlestick patterns: candlestick_patterns (harami / engulfing / hammer / shooting_star / doji / morning_star / evening_star / piercing_line / dark_cloud_cover / inside_bar)",
    "Regression-based: linear_regression (slope + R² + standard error of fit), standard_error_bands (regression-line centerline + ± k × SE — distinct from Bollinger which uses SMA + price stddev; SEB is trend-focused vs BB which is mean-reversion focused)",
    "Volume-record: highest_volume_ever (HVE — bars whose volume exceeds all prior bars within a lookback window; institutional-urgency signal used by the /hve-pullback skill; pass lookbackBars omitted for true HVE, or e.g. 252 for 'highest in the last year')",
    "Advanced: elliott_wave, delta_ladder, flowscope",
    "TA-Lib momentum/oscillators: cci, williams_r, ultosc (Ultimate Osc 7/14/28), aroon (+ oscillator), cmo (Chande), apo / ppo (abs / pct price osc)",
    "TA-Lib trend/volatility: adxr (ADX rating), natr (normalized ATR), chaikin_ad (A/D line), chaikin_osc",
    "Moving averages: wma (weighted), dema (double EMA), tema (triple EMA), trima (triangular) — return { values, current }",
    "Volatility forecast: garch_forecast (GARCH(1,1) MLE fit on log-returns → params, persistence, long-run vol, multi-step varianceForecast; params { horizon?, demean? })",
    "",
    "Internally fetches candles via the connected exchange. Pass `bars` to",
    "control the lookback window (default 200).",
    "",
    "Examples:",
    "  compute_indicator({ indicator: 'rsi', symbol: 'BTC/USDT', timeframe: '1h', params: { period: 14 } })",
    "  compute_indicator({ indicator: 'macd', symbol: 'AAPL', timeframe: '1d' })",
    "",
    "For microstructure-specific computations (microprice, correlation",
    "breakdown, crowd positioning), use compute_microstructure instead.",
  ].join("\n"),
  inputSchema: z.object({
    indicator: z.enum(INDICATOR_NAMES),
    symbol: z.string(),
    timeframe: z
      .enum(["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"])
      .optional()
      .describe("Default '1h'."),
    params: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Per-indicator parameters. E.g. RSI: { period: 14 }; MACD: { fast: 12, slow: 26, signal: 9 }."),
    bars: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Lookback bars. Default 200."),
  }),
  outputSchema: z.object({
    indicator: z.string(),
    symbol: z.string(),
    timeframe: z.string(),
    result: z.unknown(),
    metadata: z.unknown().optional(),
    computedAt: z.string(),
  }),
  execute: async (
    args: {
      indicator: string;
      symbol: string;
      timeframe?: string;
      params?: Record<string, unknown>;
      bars?: number;
    },
    execContext?: MastraExecutionContext,
  ) => {
    recordSymbolObservation(args.symbol);
    const ctx = getGordonContext(execContext);
    const exchange = ctx?.exchange;
    const computedAt = new Date().toISOString();
    if (!exchange) {
      return {
        indicator: args.indicator,
        symbol: args.symbol,
        timeframe: args.timeframe ?? "1h",
        result: { error: "No exchange connected." },
        computedAt,
      };
    }
    try {
      const candles = await exchange.getCandles(
        args.symbol,
        args.timeframe ?? "1h",
        args.bars ?? 200,
      );
      const result = dispatchIndicator(args.indicator, candles as IndicatorCandle[], args.params ?? {});
      return {
        indicator: args.indicator,
        symbol: args.symbol,
        timeframe: args.timeframe ?? "1h",
        result,
        metadata: { barCount: candles.length },
        computedAt,
      };
    } catch (err) {
      return {
        indicator: args.indicator,
        symbol: args.symbol,
        timeframe: args.timeframe ?? "1h",
        result: { error: err instanceof Error ? err.message : String(err) },
        computedAt,
      };
    }
  },
});

// ============================================================================
// compute_regime
// ============================================================================

export const computeRegimeTool = createTool({
  id: "compute_regime",
  description: [
    "Classify the current market regime for a symbol. Returns one of",
    "{trending_up, trending_down, ranging, expansion, contraction,",
    "high_volatility, low_volatility} plus a confidence score and",
    "transition probabilities to other regimes.",
    "",
    "Use BEFORE strategy selection — most strategies have regime-specific",
    "edge windows. Use after a fast move to check if regime has shifted.",
    "",
    "Backed by Markov regime detector + ATR-based volatility classifier.",
  ].join("\n"),
  inputSchema: z.object({
    symbol: z.string(),
    timeframe: z
      .enum(["15m", "30m", "1h", "4h", "1d"])
      .optional()
      .describe("Default '1h'."),
    lookbackBars: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Default 200."),
  }),
  outputSchema: z.object({
    symbol: z.string(),
    regime: z.string(),
    confidence: z.number().min(0).max(1),
    transitionProbabilities: z.record(z.string(), z.number()).optional(),
    metadata: z.unknown().optional(),
  }),
  execute: async (
    args: { symbol: string; timeframe?: string; lookbackBars?: number },
    execContext?: MastraExecutionContext,
  ) => {
    recordSymbolObservation(args.symbol);
    const ctx = getGordonContext(execContext);
    const exchange = ctx?.exchange;
    if (!exchange) {
      return { symbol: args.symbol, regime: "unknown", confidence: 0, metadata: { error: "No exchange connected." } };
    }
    try {
      const candles = await exchange.getCandles(
        args.symbol,
        args.timeframe ?? "1h",
        args.lookbackBars ?? 200,
      );
      const signal = RegimeDetector.getInstance().detectRegime(
        candles as unknown as Parameters<typeof RegimeDetector.prototype.detectRegime>[0],
        args.symbol,
        args.timeframe ?? "1h",
      );
      return {
        symbol: args.symbol,
        regime: signal.regime,
        confidence: signal.confidence,
        metadata: { metrics: signal.metrics, timestamp: signal.timestamp },
      };
    } catch (err) {
      return {
        symbol: args.symbol,
        regime: "unknown",
        confidence: 0,
        metadata: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  },
});

// ============================================================================
// compute_risk
// ============================================================================

export const computeRiskTool = createTool({
  id: "compute_risk",
  description: [
    "Run the 11-dimension risk classifier on a proposed trade or hypothetical.",
    "Returns risk tier (low / medium / high / critical) + dimension scores",
    "+ recommendation (auto_approve / prompt_user / require_confirmation /",
    "block) + constitution violations if any.",
    "",
    "Dimensions: volatility, correlation, tail-risk, drawdown, concentration,",
    "liquidity, frequency, DeFi-specific, time-based, circuit breakers,",
    "trading constitution.",
    "",
    "Use BEFORE creating a Plan for sizing context; use again INSIDE verify_plan",
    "for the formal pre-trade gate. Both invocations write to audit.",
  ].join("\n"),
  inputSchema: z.object({
    symbol: z.string(),
    side: z.enum(["buy", "sell"]),
    notionalUsd: z.number().positive(),
    venue: z.string().optional(),
    leverage: z.number().positive().optional().describe("Default 1 (spot)."),
    timeHorizonHours: z.number().positive().optional(),
    portfolioOverrideUsd: z
      .number()
      .positive()
      .optional()
      .describe(
        "If set, evaluate risk against this hypothetical portfolio value instead of the live exchange balance. Use when the operator asks 'what if I had $X' or for paper-mode reasoning without flipping modes.",
      ),
  }),
  outputSchema: z.object({
    tier: z.enum(["low", "medium", "high", "critical"]),
    recommendation: z.enum(["auto_approve", "prompt_user", "require_confirmation", "block"]),
    compositeScore: z.number(),
    dimensionScores: z.record(z.string(), z.number()).optional(),
    constitutionViolations: z.array(z.unknown()).optional(),
    summary: z.string(),
  }),
  execute: async (
    args: {
      symbol: string;
      side: "buy" | "sell";
      notionalUsd: number;
      venue?: string;
      leverage?: number;
      timeHorizonHours?: number;
      portfolioOverrideUsd?: number;
    },
    execContext?: MastraExecutionContext,
  ) => {
    recordSymbolObservation(args.symbol);
    const ctx = getGordonContext(execContext);
    const exchange = ctx?.exchange;
    let price = 1;
    try {
      if (exchange) price = await exchange.getPrice(args.symbol);
    } catch {
      // fall through with price=1 — risk-gate's sizing logic handles this.
    }
    const quantity = args.notionalUsd / Math.max(price, 1e-9);

    // Synthetic RequestContext: when portfolioOverrideUsd is set, build a
    // shallow proxy that returns the override for portfolioValue/availableCash
    // so the legacy classifier evaluates against the hypothetical, not the
    // live exchange balance.
    const proxiedExecContext = args.portfolioOverrideUsd
      ? withPortfolioOverride(execContext, args.portfolioOverrideUsd)
      : execContext;

    const result = (await (implCheckRisk.execute as any)(
      {
        symbol: args.symbol,
        side: args.side === "buy" ? "BUY" : "SELL",
        type: "MARKET",
        quantity,
        price,
      },
      proxiedExecContext,
    )) as {
      approved?: boolean;
      reason?: string;
      warnings?: string[];
      consensus?: { decision: string; score: number };
      error?: string;
    };

    const approved = result.approved === true;
    const warnings = result.warnings ?? [];
    const hasCritical = warnings.some((w) => /critical|block|forbidden/i.test(w));
    const tier: "low" | "medium" | "high" | "critical" = result.error
      ? "critical"
      : hasCritical
        ? "critical"
        : !approved
          ? "high"
          : warnings.length > 0
            ? "medium"
            : "low";
    const recommendation: "auto_approve" | "prompt_user" | "require_confirmation" | "block" =
      tier === "critical" || result.error
        ? "block"
        : !approved
          ? "require_confirmation"
          : tier === "medium"
            ? "prompt_user"
            : "auto_approve";

    return {
      tier,
      recommendation,
      compositeScore: result.consensus?.score ?? (approved ? 0.7 : 0.3),
      dimensionScores: undefined,
      constitutionViolations: warnings as unknown[],
      summary: result.reason ?? result.error ?? (approved ? "Risk gate passed." : "Risk gate flagged."),
    };
  },
});

// ============================================================================
// compute_microstructure
// ============================================================================

const MICROSTRUCTURE_OPS = [
  "microprice",
  "inventory_adjusted_price",
  "correlation_breakdown",
  "vol_forecast_calibration",
  "pnl_distribution_shape",
  "crowd_positioning",
  "earnings_signal",
  "discipline_audit",
  "discipline_trajectory",
  "risk_ratio_triple",
  "orchestration_load",
  "survivorship_risk",
  "adherence_report",
  "monte_carlo_path",
  "kelly_size",
  "market_memory",
  "dcf",
  "vs_random",
  "signal_pool",
  "portfolio_combine",
  "synthetic_augment",
  "hmm_regime",
  "pie",
  "fundamental_ratios",
  "ruin_probability",
  "signal_informativeness",
  "portfolio_ensemble",
  "regime_policy",
  "forensic_screen",
  "filing_diff",
  "token_unlock_risk",
  "holder_concentration",
  "formulaic_alpha",
  "hrp_allocation",
  "adf_test",
  "kpss_test",
  "acf_pacf",
  "johansen_cointegration",
  "information_bars",
] as const;

export const computeMicrostructureTool = createTool({
  id: "compute_microstructure",
  description: [
    "Run an advanced microstructure / analytics operation. Closed namespace",
    "covering: microprice (Stoikov), inventory-adjusted reference price",
    "(Avellaneda-Stoikov), correlation breakdown, vol forecast calibration,",
    "P&L distribution shape, crowd-positioning verdict (Shapiro), earnings",
    "signal validation, discipline audit, adherence report.",
    "",
    "operation values + their params:",
    "",
    "  With auto-collect shortcut (pass `symbol` and the tool will gather",
    "  required data from the live exchange before running the computation):",
    "    - 'microprice'                — direct: { snapshots[], tickSize }",
    "                                    shortcut: { symbol, durationSec?, intervalMs?, tickSize? }",
    "                                    Shortcut polls the orderbook for ~durationSec",
    "                                    (default 30) at intervalMs cadence (default 250).",
    "                                    Blocks the agent stream while collecting — be",
    "                                    explicit with the operator that it will pause.",
    "    - 'inventory_adjusted_price'  — direct: { mid, inventory, volatility, horizon }",
    "                                    shortcut: { symbol, positionUsd?, horizonHours? }",
    "                                    Auto-derives mid from price + volatility from ATR.",
    "                                    inventory defaults to 0 (no position) unless",
    "                                    positionUsd is set; sign indicates long/short.",
    "    - 'correlation_breakdown'     — direct: { series: ReturnSeries[] }",
    "                                    shortcut: { symbols: string[], timeframe?, lookbackBars? }",
    "                                    Fetches candles for each symbol and builds aligned",
    "                                    log-return series automatically.",
    "",
    "  Direct-input only (no auto-collect):",
    "    - 'vol_forecast_calibration'  — params: { source?, horizon?, symbol?, startTime?, endTime? }",
    "    - 'pnl_distribution_shape'    — params: { pnls: number[] }",
    "    - 'crowd_positioning'         — params: { fundingRateAnnualized?, fundingRateZ?, openInterestChange?, sentimentScore?, recentLiquidationImbalance? }",
    "    - 'earnings_signal'           — params: { candidate, transcript? }",
    "",
    "  Self-contained (LLM can invoke directly):",
    "    - 'discipline_audit'   — params: { startTime?, endTime?, userId?, maxTradesPerDay?, maxDistinctSlots?, emotionalProximityMs? }",
    "    - 'discipline_trajectory' — params: { windowCount?, windowDays?, endTime?, userId?, consistencyScores?: number[], returnDispersions?: number[], maxTradesPerDay?, maxDistinctSlots?, emotionalProximityMs? }",
    "                              Longitudinal 'Hockey Stick' read: runs discipline_audit over N rolling windows and",
    "                              classifies the operator's stage (1 Tinkering / 2 Blade Years / 3 Inflection / 4 Surging).",
    "                              Pass consistencyScores + returnDispersions (one per window, oldest first) for a",
    "                              high-confidence Stage-4 call. Used by /trader-stage. Default 4 windows of 7 days.",
    "    - 'risk_ratio_triple'  — params: { sharpe, sortino, calmar?, symmetricTolerance?, calmarFloor?, sortinoFloor? }",
    "                              Skew read from the Sharpe/Sortino/Calmar triple: Sortino vs √2×Sharpe classifies",
    "                              positive / symmetric / negative skew, flags tail risk not priced into the ratios",
    "                              (Sortino < √2×Sharpe), and checks allocator floors (Calmar>1, Sortino>2). Ratios-only",
    "                              path — when you have the return series, prefer exact skew via strategy-claim-verifier.",
    "    - 'orchestration_load' — params: { pendingReviewItems, reviewCapacityPerHour, producedLastHour?, saturatedThreshold?, overloadedThreshold? }",
    "                              Operator serial-review bottleneck ('orchestration tax'): backlog hours + tier",
    "                              (slack/saturated/overloaded) + backpressure recommendation. Read-only. Used by",
    "                              /orchestration-load. The operator is the single-threaded reviewer — Amdahl's Law.",
    "    - 'survivorship_risk'  — params: { crossSectional, universeConstruction: 'single_symbol'|'liquid_broad'|'current_snapshot'|'point_in_time', universeSize?, windowDays?, assetClass?: 'crypto'|'equity'|'other' }",
    "                              Classifies a backtest's survivorship-bias risk (tier + return haircut + checklist). Single-symbol /",
    "                              liquid-broad / point-in-time are immune; cross-sectional selection from a current snapshot is biased.",
    "                              A RISK FLAG, not a correction (no delisting feed). Run before trusting cross-sectional momentum/trend backtests.",
    "    - 'adherence_report'   — params: { startTime?, endTime?, userId? }",
    "    - 'kelly_size'         — params: { winProbability, bankrollUsd, payoutRatio, mode?: 'rr'|'binary', fractionMultiplier? }",
    "                              Pure math, default quarter-Kelly. Returns fullKelly%, recommended%, positionUsd, edgeBps.",
    "                              For trade plans use mode='rr' with payoutRatio = R-multiple (e.g. 2.0 for 2R target / 1R stop).",
    "                              For prediction-market contracts use mode='binary' with payoutRatio = (1 − price) / price.",
    "",
    "  With auto-collect shortcut (pass `symbol` and the tool fetches candles):",
    "    - 'monte_carlo_path'   — direct: { prices[], horizonBars, nSims?, model?, nStates?, exceedanceLevels? }",
    "                              shortcut: { symbol, horizonBars, timeframe?, lookbackBars?, nSims?, model?, exceedanceLevels? }",
    "                              Simulates N forward price paths. Returns terminal mean/stddev, p05/p25/p50/p75/p95",
    "                              quantiles, and P(terminal ≥ level) for each requested exceedance level. Use for scenario",
    "                              analysis or to derive winProbability inputs for kelly_size.",
    "    - 'dcf'                — params: { fcfProjections: number[], netCash, sharesOutstanding?, base: { wacc, terminalGrowthPct }, bear?, bull? }",
    "                              Two-stage DCF: explicit FCF + Gordon-growth terminal. Returns per-case price-per-share",
    "                              + 5x5 sensitivity grid over WACC and terminal-growth. Operator MUST supply validated",
    "                              FCF projections — Gordon does not forecast cash flows itself.",
    "",
    "    - 'vs_random'          — params: { closes: number[], actualFitness, fitness: 'sharpe'|'profit_factor'|'win_rate'|'total_return', exposureRate, nRandom?, seed? }",
    "                              Woodriff's 'beat best-of-random' filter. Generates N random-signal strategies on the same",
    "                              series, returns actual vs best random + verdict (pass/borderline/fail). Distinct from MCPT.",
    "",
    "    - 'signal_pool'        — params: { signals: Array<boolean[]|number[]>, threshold? }",
    "                              Ensemble voting across N indicator outputs. Per-bar fraction-true + fired flag + aggregate stats.",
    "                              Use for parameter sweeps or context aggregation across different indicator kinds.",
    "",
    "    - 'portfolio_combine'  — params: { equityCurves: number[][], weights?, rebalanceCadence?: 'never'|'daily'|'weekly'|'monthly', txCostBps? }",
    "                              Combine N equity curves + Parrondo/Shannon rebalancing premium test. Reports whether the",
    "                              combined geometric mean beats the weighted-component geometric (the rebalancing premium).",
    "",
    "    - 'synthetic_augment'  — params: { method: 'shift_bars'|'mcp_permute'|'noise_bands', candles: Candle[], params: { ... method-specific ... } }",
    "                              Generate alternate-reality candle series for backtest robustness. Distinct from",
    "                              monte_carlo_path which produces FORWARD paths; this one augments HISTORICAL data.",
    "",
    "    - 'hmm_regime'         — params: { observations: number[], nStates?, nRestarts?, maxIterations?, tolerance?, seed? }",
    "                              Hidden Markov Model regime classifier (Baum-Welch EM + Viterbi). Returns",
    "                              transitions / means / variances / state sequence / labels (bear/sideways/bull for n=3).",
    "                              Descriptive primitive — use HMM labels as a feature inside richer strategies, not as",
    "                              a standalone signal.",
    "",
    "    - 'pie'                — params: { enterpriseValue, baseFcf, wacc?, terminalGrowthPct, horizonYears?, growthRate?, solveFor: 'growth_rate'|'competitive_advantage'|'wacc' }",
    "                              Price-Implied Expectations (Mauboussin reverse DCF). Solves for the variable that",
    "                              makes the DCF-derived EV match the market. Use BEFORE taking a variant view —",
    "                              know what the market already implies. Bisection search; converged=false signals",
    "                              the operator's inputs likely need a sanity check.",
    "",
    "    - 'fundamental_ratios' — params: { ebit?, taxRate?, investedCapital?, deltaNopat?, deltaInvestedCapital?, price?, sharesOutstanding?, eps?, ebitda?, fcf?, bookEquity?, netIncome?, totalDebt?, cashAndEquivalents? }",
    "                              Typed wrapper for ROIC / ROIIC / ROE / P/E / EV/EBITDA / FCF yield + EV + net cash.",
    "                              Missing inputs → null outputs (no false zeros, no Infinity). The interpretation",
    "                              field lists every ratio that was computable. Use for /memo and post-trade reviews.",
    "",
    "    - 'ruin_probability'   — params: { winProbability, payoutRatio, riskFraction, horizonTrades, ruinThresholdPct?, nTrials?, seed? }",
    "                              Monte Carlo gambler's-ruin survival math. Returns probability of breaching a",
    "                              drawdown threshold over a finite horizon + verdict (safe/cautious/risky/ruinous).",
    "                              Complements compute_kelly_size: Kelly is OPTIMAL sizing for log-growth; this is",
    "                              SURVIVAL risk at a CHOSEN sizing over a finite horizon.",
    "",
    "    - 'market_memory'      — direct: { prices[], nSurrogates?, minWindow?, vrHorizons?, pValueCutoff? }",
    "                              shortcut: { symbol, timeframe?, lookbackBars?, nSurrogates?, vrHorizons? }",
    "                              Diagnoses what KIND of memory the series has on this horizon: 'trending',",
    "                              'mean_reverting', or 'random_walk'. Use BEFORE picking a strategy class.",
    "                              Returns Hurst (raw + Anis-Lloyd-corrected), surrogate-test p-value, VR profile",
    "                              with robust z, and a categorical verdict. Complements compute_regime (which",
    "                              classifies current state) by classifying which strategy class can have edge",
    "                              on this instrument at all.",
    "",
    "    - 'signal_informativeness' — params: { conditionalReturns: number[], unconditionalReturns: number[], normalize?, alpha? }",
    "                              Lo-Mamaysky-Wang test: does conditioning on a signal/pattern shift the return",
    "                              distribution? Decile χ² + two-sample Kolmogorov-Smirnov. Feed returns realized AFTER",
    "                              the signal fires (conditional) vs the baseline (unconditional), ≥10 each. Returns",
    "                              {informative, χ² Q+p, KS γ+p}. Informativeness ≠ profitability — the cleaner weak test.",
    "    - 'portfolio_ensemble'  — params: { covariance: number[][], means?: number[], riskFreeRate?, sharpeFloorFraction?, combineScheme? }",
    "                              Self-Driving-Portfolio risk-structured bench (equal-weight, inverse-vol, inverse-variance,",
    "                              risk-parity/ERC, max-diversification) + adversarial diversifier (most orthogonal to consensus",
    "                              under a Sharpe floor) + CIO combine (average / inverse_tracking_error / trimmed_mean). Read-only",
    "                              proposal — does NOT allocate capital. Complements optimize_portfolio (return-optimized family).",
    "    - 'regime_policy'       — direct: { returns: number[][], driverIndex?, nStates?, actions?, rewardModel?, discount? }",
    "                              shortcut: { symbols: string[], timeframe?, lookbackBars?, driverIndex?, nStates?, discount? }",
    "                              Regime→allocation policy (HMM-RL paper): fits a Gaussian HMM on the driver asset's",
    "                              returns, groups every asset's returns by regime, then solves the MDP (state=regime,",
    "                              actions=discrete weight vectors, dynamics=HMM transitions, rewards=state-conditional",
    "                              returns) by policy iteration → π*, an interpretable regime→weights lookup. Shortcut",
    "                              fetches aligned log-returns for the symbols (driverIndex picks the market-proxy, default 0).",
    "                              Returns the policy + regime labels + transition matrix + state-conditional returns.",
    "    - 'forensic_screen'     — params: { current: {sales, cogs, sga, netIncome, cfo, receivables, currentAssets,",
    "                                currentLiabilities, ppeNet, depreciation, totalAssets, totalLiabilities, longTermDebt,",
    "                                retainedEarnings, ebit, marketCap, sharesOutstanding}, prior?: {same fields} }",
    "                              Forensic accounting screen on raw financial-statement line items: Beneish M-Score",
    "                              (earnings-manipulation, >-2.22 flags), Altman Z (distress, <1.81), Piotroski F (strength,",
    "                              0-9, <6 flags), Sloan accruals (earnings quality, |x|>25% flags). Beneish+Piotroski need",
    "                              `prior` (year-over-year); Altman+Sloan need only `current`. Missing inputs → null score",
    "                              (no false flags). Verdict INVESTIGATE/CLEAN/INSUFFICIENT. PROBABILITY FLAGS, NOT PROOF —",
    "                              a bad score means open the filing, never short on the number alone. Source line items via",
    "                              get_fundamentals / Finnhub fundamentals (equities).",
    "    - 'filing_diff'         — params: { prior: string, current: string, section?: 'risk_factors'|'mdna', similarityThreshold? }",
    "                              Year-over-year filing-section diff (equities): surfaces only the NEW and REMOVED",
    "                              language between two filings' sections, ignoring carried-over boilerplate. Pass the",
    "                              two sections' text directly, OR pass full 10-K text + section to auto-extract. 'The",
    "                              single best read' — a quietly-added customer-concentration paragraph or a deleted",
    "                              key-supplier line. Returns {added[], removed[], unchangedCount}; YOU summarize the delta.",
    "    - 'token_unlock_risk'   — params: { events: [{date, amount, recipient?}], circulatingSupply, totalSupply?, now?, cliffThresholdPct? }",
    "                              Crypto supply-schedule risk: classifies shape (cliff/linear/mixed), flags any single",
    "                              unlock > ~5% of circulating, measures overhang + next unlock, weights cliffs into",
    "                              team/investor wallets. Verdict high_risk/moderate/low. recipient ∈ team|investor|",
    "                              community|ecosystem|foundation|public. now injected for the next-unlock read.",
    "    - 'holder_concentration'— params: { holders: [{address, balance, label?}], totalSupply, topN?, insiderFlagPct? }",
    "                              Crypto ownership risk: top-1 / top-N concentration, HHI + effective number of holders,",
    "                              insider-controlled % (team+investor+foundation), exchange %. Flags 'you're the exit",
    "                              liquidity' when insiders dominate. label ∈ team|investor|foundation|exchange|contract|",
    "                              community|unknown. HHI is over the supplied holders (lower bound with only top-N).",
    "    - 'formulaic_alpha'     — params: { name: 'alpha001'|…, close: number[][], open?, high?, low?, volume?, returns?, tickers: string[], dates: string[] }",
    "                              WorldQuant-101 cross-sectional formulaic alpha (Kakushadze) over a date×ticker OHLCV panel.",
    "                              Matrices are row-major [dateIdx][tickerIdx]; cells may be null. 11 alphas implemented",
    "                              (OHLCV/returns only — no vwap/cap/sector/adv). Returns the signal Panel + the latest",
    "                              cross-section. Unknown name → error listing the implemented set.",
    "    - 'hrp_allocation'      — params: { covariance?: number[][], returns?: number[][], correlation?: number[][], labels?: string[] }",
    "                              Hierarchical Risk Parity (López de Prado): correlation-tree single-linkage clustering +",
    "                              quasi-diagonal seriation + recursive bisection by inverse cluster-variance. No matrix",
    "                              inversion (robust to noisy covariance). Sibling of portfolio_ensemble. One of returns/covariance required.",
    "    - 'adf_test'            — params: { series: number[], lagOrder?, alpha?: 0.01|0.05|0.1, regression?: 'c'|'ct' }",
    "                              Augmented Dickey-Fuller unit-root test (null = unit root / non-stationary). 'ct' adds a",
    "                              deterministic trend regressor. Use to confirm a spread / residual is mean-reverting.",
    "    - 'kpss_test'           — params: { series: number[], regression?: 'c'|'ct', lags?, alpha?: 0.1|0.05|0.025|0.01 }",
    "                              KPSS stationarity test — COMPLEMENT to ADF (null = STATIONARY; reject → non-stationary).",
    "                              Run alongside adf_test: both agree → confident; disagree → inconclusive.",
    "    - 'acf_pacf'            — params: { series: number[], maxLag? }",
    "                              Autocorrelation + partial-autocorrelation (Durbin-Levinson) with ±1.96/√n bands. Box-Jenkins",
    "                              lag-order identification for AR/MA structure.",
    "    - 'johansen_cointegration' — params: { series: number[][] /* columns = variables, level prices */, lagOrder?, alpha?: 0.1|0.05|0.01 }",
    "                              Johansen trace test for cointegration RANK across a system of ≥2 series (multivariate —",
    "                              goes beyond pairwise Engle-Granger). Returns eigenvalues, per-rank trace stats, inferred rank.",
    "    - 'information_bars'    — params: { kind: 'volume'|'dollar'|'tick', threshold: number, ticks?: {price,volume,timestamp}[], ohlcv?: {close,volume}[] }",
    "                              López-de-Prado information-driven bars: close a bar when cumulative volume / dollar-value /",
    "                              tick-count crosses the threshold. Better statistical properties than time bars. Prefer ticks; ohlcv is a coarse fallback.",
    "",
    "IMPORTANT: discipline_audit and adherence_report respect startTime+endTime",
    "ISO strings. When the operator asks for 'last 24h' or 'today', YOU must",
    "convert that to absolute ISO timestamps and pass them in params — the tool",
    "does NOT auto-narrow. Without params it defaults to a 7-day window.",
  ].join("\n"),
  inputSchema: z.object({
    operation: z.enum(MICROSTRUCTURE_OPS),
    params: z
      .record(z.string(), z.unknown())
      .describe("Operation-specific arguments."),
  }),
  outputSchema: z.object({
    operation: z.string(),
    result: z.unknown(),
    summary: z.string().optional(),
    computedAt: z.string(),
  }),
  execute: async (
    args: { operation: string; params: Record<string, unknown> },
    execContext?: MastraExecutionContext,
  ) => {
    const computedAt = new Date().toISOString();
    const dispatchTable: Record<string, { execute?: unknown }> = {
      microprice: implMicroprice,
      inventory_adjusted_price: implInventoryAdjusted,
      correlation_breakdown: implCorrelationBreakdown,
      vol_forecast_calibration: implVolForecast,
      pnl_distribution_shape: implPnlShape,
      crowd_positioning: implCrowdPositioning,
      earnings_signal: implEarningsSignal,
      discipline_audit: implDisciplineAudit,
      discipline_trajectory: implDisciplineTrajectory,
      risk_ratio_triple: implRiskRatioTriple,
      orchestration_load: implOrchestrationLoad,
      survivorship_risk: implSurvivorshipRisk,
      adherence_report: implAdherenceReport,
      monte_carlo_path: implMonteCarloPath,
      kelly_size: implKellySize,
      market_memory: implMarketMemory,
      dcf: implDcf,
      vs_random: implVsRandom,
      signal_pool: implSignalPool,
      portfolio_combine: implPortfolioCombine,
      synthetic_augment: implSyntheticAugment,
      hmm_regime: implHmmRegime,
      pie: implPie,
      fundamental_ratios: implFundamentalRatios,
      ruin_probability: implRuinProbability,
      // Direct-input analytics (pure functions — no exchange auto-collect).
      signal_informativeness: {
        execute: async (p: Record<string, unknown>) =>
          conditionalDistributionTest(
            p as unknown as Parameters<typeof conditionalDistributionTest>[0],
          ),
      },
      portfolio_ensemble: {
        execute: async (p: Record<string, unknown>) =>
          runPortfolioEnsemble(p as unknown as Parameters<typeof runPortfolioEnsemble>[0]),
      },
      regime_policy: {
        execute: async (p: Record<string, unknown>) =>
          runRegimeAllocationPolicy(p as unknown as Parameters<typeof runRegimeAllocationPolicy>[0]),
      },
      forensic_screen: {
        execute: async (p: Record<string, unknown>) =>
          computeForensicScores(p as unknown as Parameters<typeof computeForensicScores>[0]),
      },
      filing_diff: {
        execute: async (p: Record<string, unknown>) => {
          const prior = typeof p.prior === "string" ? p.prior : "";
          const current = typeof p.current === "string" ? p.current : "";
          const sim = typeof p.similarityThreshold === "number" ? p.similarityThreshold : undefined;
          if (p.section === "risk_factors" || p.section === "mdna") {
            return diffNamedSection(prior, current, p.section, sim);
          }
          return diffFilingSections({ prior, current, ...(sim !== undefined && { similarityThreshold: sim }) });
        },
      },
      token_unlock_risk: {
        execute: async (p: Record<string, unknown>) =>
          computeTokenUnlockRisk(p as unknown as Parameters<typeof computeTokenUnlockRisk>[0]),
      },
      holder_concentration: {
        execute: async (p: Record<string, unknown>) =>
          computeHolderConcentration(p as unknown as Parameters<typeof computeHolderConcentration>[0]),
      },
      hrp_allocation: {
        execute: async (p: Record<string, unknown>) => {
          const r = hierarchicalRiskParity(p as unknown as Parameters<typeof hierarchicalRiskParity>[0]);
          return r ?? { error: "hrp_allocation: insufficient input — need a returns matrix or a covariance matrix (≥ 2 assets)" };
        },
      },
      formulaic_alpha: {
        execute: async (p: Record<string, unknown>) => {
          const name = typeof p.name === "string" ? p.name : "";
          const dates = Array.isArray(p.dates) ? (p.dates as string[]) : [];
          const tickers = Array.isArray(p.tickers) ? (p.tickers as string[]) : [];
          if (!Array.isArray(p.close)) {
            return { error: "formulaic_alpha: `close` (a date × ticker matrix) is required, alongside `dates` and `tickers`." };
          }
          const toPanel = (m: unknown) =>
            Array.isArray(m) ? makePanel(dates, tickers, m as Cell[][]) : undefined;
          const inputs: AlphaInputs = {
            close: makePanel(dates, tickers, p.close as Cell[][]),
            ...(Array.isArray(p.open) && { open: toPanel(p.open) }),
            ...(Array.isArray(p.high) && { high: toPanel(p.high) }),
            ...(Array.isArray(p.low) && { low: toPanel(p.low) }),
            ...(Array.isArray(p.volume) && { volume: toPanel(p.volume) }),
            ...(Array.isArray(p.returns) && { returns: toPanel(p.returns) }),
          };
          const r = computeFormulaicAlpha(name, inputs);
          if (!r) {
            return {
              error: `formulaic_alpha: unknown/unimplemented alpha '${name}'. Implemented: ${IMPLEMENTED_ALPHAS.join(", ")}`,
            };
          }
          return {
            name,
            dates: r.dates,
            tickers: r.tickers,
            values: r.values,
            latest: r.values[r.values.length - 1] ?? null,
          };
        },
      },
      adf_test: {
        execute: async (p: Record<string, unknown>) =>
          adfToPayload(runAdfTest(p as unknown as Parameters<typeof runAdfTest>[0])),
      },
      kpss_test: {
        execute: async (p: Record<string, unknown>) =>
          kpssToPayload(runKpssTest(p as unknown as Parameters<typeof runKpssTest>[0])),
      },
      johansen_cointegration: {
        execute: async (p: Record<string, unknown>) =>
          johansenToPayload(runJohansenTest(p as unknown as Parameters<typeof runJohansenTest>[0])),
      },
      acf_pacf: {
        execute: async (p: Record<string, unknown>) => {
          const series = Array.isArray(p.series) ? (p.series as number[]) : [];
          const maxLag = typeof p.maxLag === "number" ? p.maxLag : 20;
          const a = acf(series, maxLag);
          const pa = pacf(series, maxLag);
          if (!a || !pa) {
            return { error: `acf_pacf: insufficient series — need n ≥ maxLag + 2 (maxLag=${maxLag})` };
          }
          return {
            acf: a.acf,
            pacf: pa.pacf,
            confidenceBand: a.confidenceBand,
            maxLag,
            sampleSize: a.sampleSize,
          };
        },
      },
      information_bars: {
        execute: async (p: Record<string, unknown>) => {
          const kind = (p.kind === "dollar" || p.kind === "tick" ? p.kind : "volume") as
            | "volume"
            | "dollar"
            | "tick";
          const threshold = typeof p.threshold === "number" ? p.threshold : 0;
          if (!(threshold > 0)) {
            return { error: "information_bars: `threshold` must be a positive number." };
          }
          if (Array.isArray(p.ticks)) {
            return buildInformationBars(
              p.ticks as Parameters<typeof buildInformationBars>[0],
              kind,
              threshold,
            );
          }
          if (Array.isArray(p.ohlcv)) {
            return buildInformationBarsFromOHLCV(
              p.ohlcv as Parameters<typeof buildInformationBarsFromOHLCV>[0],
              kind,
              threshold,
            );
          }
          return { error: "information_bars: pass either `ticks` ({price,volume,timestamp}[]) or `ohlcv` ({close,volume}[])." };
        },
      },
    };
    try {
      const handler = dispatchTable[args.operation];
      if (!handler) {
        return {
          operation: args.operation,
          result: { error: `Unknown microstructure operation: ${args.operation}` },
          computedAt,
        };
      }
      // Auto-collect shortcut: when the LLM passes a symbol-based payload
      // for an op that normally requires pre-collected data, gather what's
      // needed from the live exchange first, then call the underlying tool.
      const params = await maybeAutoCollect(
        args.operation,
        args.params,
        execContext,
      );
      if ("error" in params) {
        return { operation: args.operation, result: params, computedAt };
      }
      const r = (await (handler.execute as any)(params, execContext)) as unknown;
      return { operation: args.operation, result: r, computedAt };
    } catch (err) {
      return {
        operation: args.operation,
        result: { error: err instanceof Error ? err.message : String(err) },
        computedAt,
      };
    }
  },
});

export const analyticsTools = {
  compute_indicator: computeIndicatorTool,
  compute_regime: computeRegimeTool,
  compute_risk: computeRiskTool,
  compute_microstructure: computeMicrostructureTool,
};
