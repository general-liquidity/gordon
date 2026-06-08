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
  calculateRollingVWAP,
  calculateAnchoredVWAP,
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
  calculateVolumeSignature,
  calculateDonchian,
  calculateHMA,
  calculateEHMA,
  calculateTHMA,
  computeLeledcExhaustion,
  calculateVWMA,
  calculateMomentum,
  calculateROC,
  calculateSupertrendChannel,
  calculateCboeOdds,
  calculateHarrisPattern,
  calculateStochastic,
  calculateCMF,
  calculateRsiFailureSwing,
  calculateRsiMidpoint,
  calculateHiddenDivergence,
  calculateIchimokuSignals,
  calculateRsiTrendline,
  calculateOpenPivot,
  calculateIntradayMomentum,
  calculateDisplacementBreak,
  calculateCandleContinuity,
  calculateVpin,
  calculateVolumeImbalance,
  calculateBreakerBlock,
  calculateStructureBreakConviction,
  calculateRsrs,
  calculateFvgSweepContext,
  calculateFracDiff,
  calculateCusumFilter,
  calculateSadf,
  calculateRollSpread,
  calculateAmihud,
  type CandlestickPatternName,
  type Candle as IndicatorCandle,
} from "../../../../core/indicators/index.ts";
import { conditionalDistributionTest } from "../../../../core/alpha/conditional-distribution-test.ts";
import { runPortfolioEnsemble } from "../../../../core/alpha/pc-method-ensemble.ts";
import { runRegimeAllocationPolicy } from "../../../../core/alpha/regime-policy.ts";
import { computeRegimeFilterValue } from "../../../../core/alpha/regime-filter-value.ts";
import { computeDampedCycleDecomposition } from "../../../trading/quant/dampedCycleDecomposition.ts";
import { computeForensicScores } from "../../../../core/alpha/forensic-accounting.ts";
import { computeDupont } from "../../../../core/alpha/dupont.ts";
import { computeWeightedBookImbalance } from "../../../../core/microstructure/weighted-book-imbalance.ts";
import { computeTimeUnderWater } from "../../../../core/alpha/time-under-water.ts";
import { computeVolResidualCorrelation } from "../../../../core/alpha/vol-residual-correlation.ts";
import { computeTripleBarrier } from "../../../../core/alpha/triple-barrier.ts";
import { computeCodependence } from "../../../../core/alpha/codependence.ts";
import { computeControlChart } from "../../../../core/alpha/control-chart.ts";
import {
  selectByScoreDiscontinuity,
  type AutocutItem,
  type AutocutOptions,
} from "../../../../core/alpha/score-autocut.ts";
import { computeSinglePrints } from "../../../trading/quant/singlePrints.ts";
import { computeMAMA } from "../../../trading/quant/mamaMovingAverage.ts";
import { computeInverseConvexity } from "../../../trading/quant/inverseConvexity.ts";
import { computePriceDiscovery } from "../../../trading/quant/priceDiscovery.ts";
import { computeGeneralizedImpulse } from "../../../trading/quant/generalizedImpulse.ts";
import { computeGeneralizedVariance } from "../../../trading/quant/generalizedVariance.ts";
import { computeFootprintImbalance } from "../../../../core/indicators/footprint-imbalance.ts";
import { computeNakedPoc } from "../../../../core/indicators/naked-poc.ts";
import { computeASIntensityCalibration, computeASStationaryReservation } from "../../../../core/alpha/as-market-making.ts";
import { computeAsymmetricBeta } from "../../../../core/alpha/asymmetric-beta.ts";
import { constructRotationBars } from "../../../../core/indicators/rotation-bars.ts";
import { computeVZO } from "../../../../core/indicators/vzo.ts";
import { computeInventoryOrderSize } from "../../../../core/alpha/inventory-order-size.ts";
import { computeMarketMakingMarkov } from "../../../trading/quant/marketMakingMarkov.ts";
import { computeTlsHedgeRatio } from "../../../trading/quant/tlsHedgeRatio.ts";
import { computeBoxTiaoHedgeRatio } from "../../../trading/quant/boxTiaoHedgeRatio.ts";
import { fitOU } from "../../../trading/quant/ouParameterFit.ts";
import { computeMinHalfLifeHedgeRatio } from "../../../trading/quant/minHalfLifeHedgeRatio.ts";
import { computeAdfOptimalHedgeRatio } from "../../../trading/quant/adfOptimalHedgeRatio.ts";
import { computeOuOptimalThresholds } from "../../../trading/quant/ouOptimalThresholds.ts";
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
import { computeRobustnessMetrics } from "../../../../core/alpha/robustness-metrics.ts";
import { runFeeSensitivitySweep } from "../../../../backtest/analysis/fee-sensitivity.ts";
import {
  computeBlackScholesGreeks,
  blackScholesGreeksToPayload,
  impliedVolatility,
  isBlackScholesGreeksEnabled,
} from "../../../trading/quant/blackScholesGreeks.ts";
import { computeOptionsPayoff } from "../../../../core/alpha/options-payoff.ts";
import { twoSamplePnlTest } from "../../../trading/quant/twoSampleTest.ts";
import { computeOmegaRatio } from "../../../../core/alpha/omega-ratio.ts";
import { optimizePortfolio } from "../../../../core/alpha/portfolio-optimizer.ts";
import { checkPriceDeviation } from "../../../../core/alpha/price-deviation-guard.ts";
import { computeEvolvingR } from "../../../../core/alpha/evolving-r.ts";
import { computeOverthrowStop } from "../../../../core/alpha/overthrow-stop.ts";
import {
  injectGaps,
  injectCrashBlocks,
  injectFlatlineBlocks,
  stretchVolatility,
  reversePath,
  invertTrendWindows,
} from "../../../../core/alpha/syntheticAugmentation.ts";
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
  "volume_signature",
  "donchian",
  "hull_ma",
  "vwma",
  "momentum",
  "roc",
  "supertrend_channel",
  "cboe_odds",
  "harris_pattern",
  "cmf",
  "rsi_failure_swing",
  "rsi_midpoint",
  "hidden_divergence",
  "ichimoku_signals",
  "rsi_trendline",
  "open_pivot",
  "intraday_momentum",
  "displacement_break",
  "candle_continuity",
  "rsrs",
  "vpin",
  "volume_imbalance",
  "breaker_block",
  "structure_break_conviction",
  "fvg_sweep_context",
  "frac_diff",
  "cusum_filter",
  "sadf",
  "roll_spread",
  "amihud",
  "rolling_vwap",
  "anchored_vwap",
  "mama",
  "vzo",
  "leledc_exhaustion",
] as const;

/** Last non-null value of an aligned indicator series (for boxing bare arrays). */
function lastDefined(values: (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] != null) return values[i]!;
  }
  return null;
}

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
    case "rolling_vwap":
      return calculateRollingVWAP(
        candles,
        (params.window as number) ?? 20,
        (params.stdDevMultiplier as number) ?? 1,
      );
    case "anchored_vwap":
      return calculateAnchoredVWAP(
        candles,
        (params.anchor as number | "low" | "high" | "first") ?? "low",
        (params.stdDevMultiplier as number) ?? 1,
      );
    case "mama":
      return computeMAMA({
        // Ehlers' MAMA defaults Price = (H+L)/2 (hl2); allow source: 'close'.
        values:
          (params.source as string) === "close"
            ? closes
            : candles.map((c) => (c.high + c.low) / 2),
        ...(typeof params.fastLimit === "number" && { fastLimit: params.fastLimit }),
        ...(typeof params.slowLimit === "number" && { slowLimit: params.slowLimit }),
      });
    case "vzo":
      return computeVZO({
        closes,
        volumes: candles.map((c) => c.volume),
        ...(typeof params.period === "number" && { period: params.period }),
      });
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
    case "donchian":
      return calculateDonchian(candles, (params.period as number) ?? 20);
    case "hull_ma": {
      const period = (params.period as number) ?? 16;
      const variant = (params.variant as string) ?? "hma";
      const values =
        variant === "ehma"
          ? calculateEHMA(closes, period)
          : variant === "thma"
            ? calculateTHMA(closes, period)
            : calculateHMA(closes, period);
      return { values, current: lastDefined(values), period, variant };
    }
    case "leledc_exhaustion":
      return computeLeledcExhaustion({
        candles: candles.map((c) => ({ open: c.open, high: c.high, low: c.low, close: c.close })),
        ...(typeof params.majQual === "number" && { majQual: params.majQual }),
        ...(typeof params.majLen === "number" && { majLen: params.majLen }),
        ...(typeof params.minQual === "number" && { minQual: params.minQual }),
        ...(typeof params.minLen === "number" && { minLen: params.minLen }),
      });
    case "vwma": {
      const period = (params.period as number) ?? 20;
      const values = calculateVWMA(candles, period);
      return { values, current: lastDefined(values), period };
    }
    case "momentum": {
      const period = (params.period as number) ?? 10;
      const values = calculateMomentum(closes, period);
      return { values, current: lastDefined(values), period };
    }
    case "roc": {
      const period = (params.period as number) ?? 10;
      const values = calculateROC(closes, period);
      return { values, current: lastDefined(values), period };
    }
    case "supertrend_channel":
      return calculateSupertrendChannel(candles, {
        ...(typeof params.atrPeriod === "number" && { atrPeriod: params.atrPeriod }),
        ...(typeof params.multiplier === "number" && { multiplier: params.multiplier }),
      });
    case "cboe_odds":
      return calculateCboeOdds(candles, {
        ...(typeof params.length === "number" && { length: params.length }),
        ...(typeof params.rsiPeriod === "number" && { rsiPeriod: params.rsiPeriod }),
        ...(typeof params.stochPeriod === "number" && { stochPeriod: params.stochPeriod }),
      });
    case "harris_pattern":
      return calculateHarrisPattern(candles);
    case "stochastic":
      return calculateStochastic(candles, {
        ...(typeof params.kPeriod === "number" && { kPeriod: params.kPeriod }),
        ...(typeof params.kSmooth === "number" && { kSmooth: params.kSmooth }),
        ...(typeof params.dPeriod === "number" && { dPeriod: params.dPeriod }),
      });
    case "cmf":
      return calculateCMF(candles, (params.period as number) ?? 20);
    case "rsi_failure_swing":
      return calculateRsiFailureSwing(closes, {
        ...(typeof params.rsiPeriod === "number" && { rsiPeriod: params.rsiPeriod }),
        ...(typeof params.pivotWindow === "number" && { pivotWindow: params.pivotWindow }),
      });
    case "rsi_midpoint":
      return calculateRsiMidpoint(closes, {
        ...(typeof params.rsiPeriod === "number" && { rsiPeriod: params.rsiPeriod }),
        ...(typeof params.lookback === "number" && { lookback: params.lookback }),
      });
    case "hidden_divergence":
      return calculateHiddenDivergence(candles, {
        ...(typeof params.rsiPeriod === "number" && { rsiPeriod: params.rsiPeriod }),
        ...(typeof params.lookback === "number" && { lookback: params.lookback }),
        ...(typeof params.priceTolerance === "number" && { priceTolerance: params.priceTolerance }),
        ...(typeof params.rsiTolerance === "number" && { rsiTolerance: params.rsiTolerance }),
      });
    case "ichimoku_signals":
      return calculateIchimokuSignals(candles, {
        ...(typeof params.tenkanPeriod === "number" && { tenkanPeriod: params.tenkanPeriod }),
        ...(typeof params.kijunPeriod === "number" && { kijunPeriod: params.kijunPeriod }),
        ...(typeof params.senkouBPeriod === "number" && { senkouBPeriod: params.senkouBPeriod }),
        ...(typeof params.displacement === "number" && { displacement: params.displacement }),
      });
    case "rsi_trendline":
      return calculateRsiTrendline(closes, {
        ...(typeof params.rsiPeriod === "number" && { rsiPeriod: params.rsiPeriod }),
        ...(typeof params.pivotWindow === "number" && { pivotWindow: params.pivotWindow }),
      });
    case "open_pivot":
      return calculateOpenPivot(candles, {
        ...(typeof params.wickFracThreshold === "number" && { wickFracThreshold: params.wickFracThreshold }),
      });
    case "intraday_momentum":
      return calculateIntradayMomentum(candles, {
        ...(typeof params.firstWindowBars === "number" && { firstWindowBars: params.firstWindowBars }),
        ...(typeof params.predictWindowBars === "number" && { predictWindowBars: params.predictWindowBars }),
        ...(typeof params.barsPerDay === "number" && { barsPerDay: params.barsPerDay }),
      });
    case "displacement_break":
      return calculateDisplacementBreak(candles, {
        ...(typeof params.pivotWindow === "number" && { pivotWindow: params.pivotWindow }),
        ...(typeof params.minRatio === "number" && { minRatio: params.minRatio }),
      });
    case "candle_continuity":
      return calculateCandleContinuity(candles, {
        ...(typeof params.historyBars === "number" && { historyBars: params.historyBars }),
      });
    case "rsrs":
      return calculateRsrs(candles, {
        ...(typeof params.slopeWindow === "number" && { slopeWindow: params.slopeWindow }),
        ...(typeof params.zWindow === "number" && { zWindow: params.zWindow }),
        ...(typeof params.buyThreshold === "number" && { buyThreshold: params.buyThreshold }),
        ...(typeof params.sellThreshold === "number" && { sellThreshold: params.sellThreshold }),
      });
    case "vpin":
      return calculateVpin(candles, {
        ...(typeof params.bucketVolume === "number" && { bucketVolume: params.bucketVolume }),
        ...(typeof params.numBuckets === "number" && { numBuckets: params.numBuckets }),
        ...(typeof params.window === "number" && { window: params.window }),
        ...(typeof params.sigmaWindow === "number" && { sigmaWindow: params.sigmaWindow }),
      });
    case "volume_imbalance":
      return calculateVolumeImbalance(candles, {
        ...(typeof params.lookback === "number" && { lookback: params.lookback }),
      });
    case "breaker_block":
      return calculateBreakerBlock(candles, {
        ...(typeof params.pivotWindow === "number" && { pivotWindow: params.pivotWindow }),
      });
    case "structure_break_conviction":
      return calculateStructureBreakConviction(candles, {
        ...(typeof params.pivotWindow === "number" && { pivotWindow: params.pivotWindow }),
        ...(typeof params.minLevels === "number" && { minLevels: params.minLevels }),
      });
    case "fvg_sweep_context":
      return calculateFvgSweepContext(candles, {
        ...(typeof params.pivotWindow === "number" && { pivotWindow: params.pivotWindow }),
        ...(typeof params.lookback === "number" && { lookback: params.lookback }),
      });
    case "frac_diff":
      return calculateFracDiff(candles, {
        ...(typeof params.d === "number" && { d: params.d }),
        ...(typeof params.threshold === "number" && { threshold: params.threshold }),
      });
    case "cusum_filter":
      return calculateCusumFilter(candles, {
        ...(typeof params.threshold === "number" && { threshold: params.threshold }),
      });
    case "sadf":
      return calculateSadf(candles, {
        ...(typeof params.minWindow === "number" && { minWindow: params.minWindow }),
        ...(typeof params.lags === "number" && { lags: params.lags }),
      });
    case "roll_spread":
      return calculateRollSpread(candles, {
        ...(typeof params.window === "number" && { window: params.window }),
      });
    case "amihud":
      return calculateAmihud(candles, {
        ...(typeof params.window === "number" && { window: params.window }),
      });
    case "volume_signature":
      return calculateVolumeSignature(candles, {
        ...(typeof params.avgPeriod === "number" && { avgPeriod: params.avgPeriod }),
        ...(typeof params.ppLong === "number" && { ppLong: params.ppLong }),
        ...(typeof params.ppShort === "number" && { ppShort: params.ppShort }),
        ...(typeof params.dryUp1Pct === "number" && { dryUp1Pct: params.dryUp1Pct }),
        ...(typeof params.dryUp2Pct === "number" && { dryUp2Pct: params.dryUp2Pct }),
        ...(typeof params.closeUpperPct === "number" && { closeUpperPct: params.closeUpperPct }),
        ...(typeof params.accVolMult === "number" && { accVolMult: params.accVolMult }),
        ...(typeof params.distVolMult === "number" && { distVolMult: params.distVolMult }),
        ...(typeof params.distCountWindow === "number" && { distCountWindow: params.distCountWindow }),
        ...(typeof params.churnVolMult === "number" && { churnVolMult: params.churnVolMult }),
        ...(typeof params.atrPeriod === "number" && { atrPeriod: params.atrPeriod }),
        ...(typeof params.maxProgressVsAtr === "number" && { maxProgressVsAtr: params.maxProgressVsAtr }),
      });
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
    "Volume signature: volume_signature (Morales-Kacher / CAN SLIM pocket-pivot family — per-bar pocket pivots PP10/PP5, volume dry-up (2 levels), accumulation/distribution days + trailing distribution count & health verdict, churn/stalling; one op over an SMA-volume baseline; pairs with highest_volume_ever / undercut_rally / tight_consolidation for base-building reads)",
    "Channels / MAs: donchian (rolling high/low breakout envelope), hull_ma (low-lag Hull MA; params { period? 16, variant?: 'hma'|'ehma'|'thma' } — ehma=exponential Hull, thma=triple Hull, the Hull Suite variants), vwma (volume-weighted MA), supertrend_channel (Supertrend-pivot running-extreme envelope + midline target, resets on trend flip)",
    "Momentum: momentum (absolute Δ vs N bars ago), roc (percent change vs N bars ago)",
    "Flow regime: cboe_odds (volume-weighted three-state bull/bear/STAGNANT odds oscillator — MFI-style money-flow index re-weighted by Stoch-RSI momentum; the stagnant leg quantifies chop/indecision)",
    "More: stochastic (classic price %K/%D — locates close in the recent high-low range; >80 overbought / <20 oversold; distinct from stochastic-rsi), cmf (Chaikin Money Flow, windowed money-flow-volume/volume in [−1,1]; >0.05 accumulation / <−0.05 distribution)",
    "Patterns: harris_pattern (Michael Harris DAX 4-bar overlapping-extension price pattern — per-bar 0 none / 2 buy / 1 sell from a strict interleaved high/low chain)",
    "RSI suite (beyond plain rsi 70/30): rsi_failure_swing (Welles Wilder top/bottom failure swing — a reversal pivot pattern on the RSI line itself: OB peak → lower peak → break of the intervening trough (and mirror at OS); distinct from divergence), rsi_midpoint (the 50-line as regime gauge — bias from %-of-RSI-above-50, the 50 line as dynamic support/resistance, and consolidation/chop detection; distinct from overbought/oversold), hidden_divergence (continuation counterpart to divergence: hidden bullish = price higher-low while RSI lower-low; hidden bearish = price lower-high while RSI higher-high), rsi_trendline (AMS-style pivot trendlines drawn on the RSI series + break detection — distinct from price trendlines and from divergence)",
    "Ichimoku discrete signals: ichimoku_signals (the five signals beyond ichimoku's TK-cross + cloud-position: kijun cross, kijun bounce/position (dynamic S/R), kumo twist (future-cloud color flip), edge-to-edge (flat-Kumo → opposite-edge target), and TK disequilibrium (tenkan-kijun stretch as an overextension gauge))",
    "Open-based: open_pivot (session open as a dynamic S/R pivot + reclaim/lose bias, plus wickless candle-open drive → mean-reversion-to-open target; distinct from opening-range-breakout and central-pivot-range), intraday_momentum (Gao-Han-Li-Zhou JFE 2018 — sign of the first-window return predicts the last-window return; params { firstWindowBars?, predictWindowBars?, barsPerDay? }; with barsPerDay it reports cross-day hitRate + the live signal; a directional predictor, distinct from the opening-range breakout)",
    "Structure quality: displacement_break (break-of-structure gated on displacement magnitude — the breaking leg must be ≥ minRatio×(default 1.5) the prior swing leg; flags weak one-candle pokes as valid=false; distinct from smc change-of-character/liquidity-sweep which have no leg-ratio gate), candle_continuity (CCT — next-candle bias from the prior↔current two-candle relationship: how the current candle opened vs the prior + whether it closed with strength beyond the prior range → continuation/reversal/neutral; distinct from candlestick_patterns and open_pivot)",
    "Order-flow toxicity: vpin (Volume-Synchronized Probability of Informed Trading, Easley-López de Prado-O'Hara 2012 — volume-clock buckets + bulk-volume classification of buy/sell, then the rolling average bucket order-imbalance ∈ [0,1]; high VPIN = one-sided/informed flow that makes market-makers widen/pull quotes and has historically preceded volatility events; params { bucketVolume?, numBuckets?, window?, sigmaWindow? }; computes from OHLCV — distinct from the depth-snapshot microstructure-toxicity and fill-based adverse-selection detectors)",
    "ICT PD arrays (complement order_blocks / fvg / smc-patterns): volume_imbalance (2-candle BODY gap with overlapping ranges — open[i] vs close[i-1] gap, ranges still overlap; distinct from the 3-candle-wick fvg; returns unfilled VI zones price tends to rebalance), breaker_block (a FAILED/flipped order block confirming a market-structure shift — bullish: SH→SL then close above SH, zone = last down-candle body, acts as support on return; bearish mirror; distinct from plain order_blocks which hold in their original direction)",
    "Regime/timing: rsrs (Resistance-Support Relative Strength — rolling OLS slope β of high-on-low over slopeWindow (default 18); when demand dominates highs extend faster than lows fall so β rises. Standardized = z-score of β over zWindow (default 250) = the canonical timing line (≥+0.7 demand/long, ≤−0.7 supply/exit); modified = standardized×R² (discounts weak-fit windows); right = modified×β. params { slopeWindow?, zWindow?, buyThreshold?, sellThreshold? }. Reads the support/resistance balance from intrabar high-low geometry — distinct from ADX (strength, no direction), efficiency_ratio (path efficiency), and the regime classifier (state labels))",
    "Structure-break conviction: structure_break_conviction (the 'two-breaker-structure' / MSS-trap filter — a real reversal must close through ≥ minLevels (default 2) significant structure-making swing levels: the prevailing uptrend's HIGHER LOWS for a bearish break, the downtrend's LOWER HIGHS for a bullish break; breaking only the most recent/nearest level is flagged conviction='trap' (usually just a retracement to a key level before the trend continues); params { pivotWindow?, minLevels? }; gates on the COUNT of levels taken out — distinct from displacement_break (single break gated on leg magnitude) and smc change-of-character (single close-through))",
    "FVG quality: fvg_sweep_context (grades each unfilled fair-value gap by its liquidity-sweep context — a gap whose displacement came straight out of taking a prior swing low/high is quality='post_sweep' (high-probability, mostly respected); a gap formed in open space with no preceding sweep is quality='pre_sweep' (lower-probability, prone to being disrespected/inverted); params { pivotWindow?, lookback? }; links fvg-detection to liquidity sweeps — distinct from fvg (gap + midpoint-fill state only, no sweep context) and detectLiquiditySweeps (sweep events not tied to a gap))",
    "AFML feature engineering (López de Prado): frac_diff (fixed-width fractional differentiation — stationarity-preserving memory; params { d?, threshold? }; d=1≈first-difference, d=0≈identity, 0<d<1 keeps memory while flattening trend), cusum_filter (symmetric CUSUM event sampler on log-returns — flags change-point bars where cumulative move exceeds a threshold; params { threshold? } default = returns stdev), sadf (supremum ADF — rolling explosiveness/BUBBLE test, right-tailed; distinct from KPSS/Johansen stationarity; params { minWindow?, lags? }; isExplosive flag)",
    "Microstructure liquidity from OHLC (no quotes/tick): roll_spread (Roll 1984 effective spread = 2·sqrt(−serial-cov of price changes) + Corwin-Schultz 2012 high-low spread estimator; params { window? }), amihud (Amihud 2002 illiquidity = mean |return|/dollar-volume; higher = more price impact per dollar; params { window? }; distinct from VPIN/transient-impact)",
    "Rolling VWAP: rolling_vwap (windowed VWAP over the trailing `window` bars — a moving fair-value / mean-reversion anchor that DROPS old bars, unlike vwap which accumulates from the first bar and never resets; params { window? default 20, stdDevMultiplier? default 1 }; returns the aligned series + current + price position + ±σ value-area bands (upper≈VAH, lower≈VAL); for higher-timeframe S/R use a larger window e.g. 90)",
    "Anchored VWAP: anchored_vwap (Brian Shannon — VWAP accumulated from a fixed EVENT anchor with NO reset/window; distinct from vwap (anchors at bar 0) and rolling_vwap (drops old bars). params { anchor? 'low'|'high'|'first'|<barIndex> default 'low' auto-anchors to the swing low/high, stdDevMultiplier? default 1 }; returns series (null before anchor) + current + slope (rising AVWAP=dynamic support, falling=resistance) + signal (reclaim/reject/support/resistance) + volume-weighted ±σ bands. Use an anchor at a swing low/high/gap/cycle-top as a cost-basis line)",
    "Ehlers adaptive: mama (MESA Adaptive Moving Average + FAMA companion — Hilbert homodyne discriminator measures the dominant cycle period and sets an adaptive alpha between slowLimit/fastLimit; params { fastLimit? 0.5, slowLimit? 0.05, source?: 'hl2'|'close' default hl2 per Ehlers }; MAMA above FAMA = bullish, crossover = signal. Distinct from KAMA (efficiency-ratio) / VIDYA (CMO-vol) — alpha here is cycle-phase driven)",
    "Volume momentum: vzo (Volume Zone Oscillator, Waxman — 100×EMA(signed volume)/EMA(volume); whether volume accumulates on up- vs down-closes, ±60 range; params { period? 14 }; ≥40 overbought / ≤−40 oversold. Distinct from MFI/CMF; classic use is RSI-vs-VZO divergence — a 'scam pump' spikes RSI while VZO stays flat)",
    "Exhaustion S/R: leledc_exhaustion (Leledc exhaustion bars → support/resistance — price-action bar-counter: momentum counter (close vs close[4]) + a reversal candle AT a range extreme marks an exhaustion bar whose high=resistance / low=support; params { majQual? 6, majLen? 30, minQual? 5, minLen? 5 } for major/minor tiers. Returns the exhaustion signals + active major/minor S/R levels + whether THIS bar is an exhaustion. Distinct from volume/orderflow/streak exhaustion — pure price action)",
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
  "time_under_water",
  "vol_residual_correlation",
  "tls_hedge_ratio",
  "box_tiao_hedge_ratio",
  "ou_fit",
  "min_half_life_hedge_ratio",
  "adf_optimal_hedge_ratio",
  "ou_optimal_thresholds",
  "triple_barrier",
  "codependence",
  "control_chart",
  "inventory_order_size",
  "mm_markov",
  "signal_informativeness",
  "portfolio_ensemble",
  "regime_policy",
  "regime_filter_value",
  "damped_cycle",
  "forensic_screen",
  "dupont",
  "weighted_book_imbalance",
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
  "robustness_metrics",
  "fee_sensitivity",
  "black_scholes",
  "options_payoff",
  "stress_inject",
  "pnl_significance",
  "omega_ratio",
  "optimize_portfolio",
  "price_deviation_guard",
  "evolving_r",
  "overthrow_stop",
  "score_autocut",
  "single_prints",
  "rotation_bars",
  "inverse_convexity",
  "price_discovery",
  "generalized_impulse",
  "footprint_imbalance",
  "naked_poc",
  "as_intensity",
  "as_stationary_reservation",
  "asymmetric_beta",
  "generalized_variance",
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
    "    - 'time_under_water'   — params: { returns[], initialEquity?, compoundMode?, periodsPerYear? }",
    "                              The drawdown metric backtests ignore: DURATION below a prior peak, not just depth.",
    "                              Returns longest/current underwater spell (periods), % time underwater, episode count,",
    "                              max drawdown, and MAR (CAGR/maxDD when periodsPerYear given). Two equal-depth drawdowns",
    "                              differ by recovery time — this measures it. Distinct from recovery_factor (depth-only).",
    "",
    "    - 'vol_residual_correlation' — params: { returnsBySymbol{}, volFactor?[], highCorrThreshold?, hiddenDelta? }",
    "                              The correlation raw matrices HIDE: strips a common vol factor (provided, or a mean-|return|",
    "                              proxy) from each series and correlates the residuals. Flags 'hidden' pairs where shared",
    "                              vol-timing made raw returns look uncorrelated. Size for the residual matrix, not the raw one.",
    "",
    "    Statistical-arbitrage (pairs / mean-reversion, via arbitragelab scan) — all direct-input:",
    "    - 'tls_hedge_ratio'    — params: { pricesY[], pricesX[] }. Total-least-squares (orthogonal/Deming) hedge ratio — errors-in-variables alternative to OLS; returns both. Use when X has measurement noise.",
    "    - 'box_tiao_hedge_ratio' — params: { pricesBySymbol{} }. Canonical decomposition: the linear combo of N series that is MOST mean-reverting (VAR(1) + smallest-eigenvalue portfolio); returns weights + predictability + halfLife.",
    "    - 'ou_fit'             — params: { series[], dt? }. Fit Ornstein-Uhlenbeck via AR(1): returns theta (speed), mu (mean), sigma, halfLife, isMeanReverting. (optimalPairsTrading ASSUMES these — this estimates them.)",
    "    - 'min_half_life_hedge_ratio' — params: { pricesY[], pricesX[] }. Hedge ratio minimizing the spread's OU half-life (fastest mean reversion) — ranks by speed, not just stationarity.",
    "    - 'adf_optimal_hedge_ratio' — params: { pricesY[], pricesX[], lags? }. Hedge ratio minimizing the spread's ADF stat (max stationarity); reports adfStat vs the ~−2.86 5% level.",
    "    - 'ou_optimal_thresholds' — params: { theta, mu, sigma, transactionCost? }. Bertram (2010) optimal symmetric entry/exit for OU mean-reversion maximizing expected return per unit time net of cost (pair with ou_fit). Distinct from the Cartea-Jaimungal optimalPairsTrading op.",
    "    - 'triple_barrier'     — params: { prices[], entries[], ptPct, slPct, verticalBars, side? }. López de Prado triple-barrier OUTCOME labeler: per entry, which barrier (profit-take / stop-loss / vertical-time) hits first → label +1/−1/0 + touch + return. Pure labeler (NOT ML meta-labeling). Useful for backtest/journal/eval outcome classification.",
    "    - 'codependence'       — params: { x[], y[] } (or { seriesBySymbol } via the matrix helper). Non-linear dependence for pair selection: mutual information + distance correlation (Székely) — catch y=f(x) links Pearson misses (e.g. y=x², pearson≈0 but distanceCorr>0).",
    "",
    "    Market-making (Avellaneda-Stoikov family) — direct-input:",
    "    - 'control_chart'       — params: { values[], baseline? }. Shewhart/Western-Electric statistical process control on a metric stream (R-multiples, slippage, daily PnL, eval scores): separates Deming common-cause noise from assignable SPECIAL-cause breaks. σ via avg moving range (R̄/1.128, outlier-robust). Flags 4 rules (1pt>3σ, 2-of-3>2σ, 4-of-5>1σ, run-of-8 one side). Use to decide whether the latest deviation is noise (don't tamper) or a break to investigate.",
    "    - 'inventory_order_size' — params: { inventory, maxSize, shape? }. Dynamic order-SIZE inventory control (Fushimi et al.): shrinks the side that would grow |inventory| by exp(−shape·|inventory|), keeps the reducing side at maxSize. Complements inventory_adjusted_price (which skews the quote PRICE) — this scales the SIZE.",
    "    - 'mm_markov'          — params: { transitionMatrix?[3][3] | states?[], waitingPeriods? }. Market-making quote-efficiency metrics from the {Quoting,Waiting,Spread} 3-state Markov chain: pMakeSpread + pOneSideFill (inventory-risk path) over a waiting horizon (default 5). Pass a transition matrix or a state sequence (estimated by counts).",
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
    "    - 'damped_cycle'        — direct: { values: number[], options?: { order?(6), minAmplitudeFraction?(0.05), persistenceTolerance?(0.01) } }",
    "                              Prony damped-harmonic decomposition: fits x[n]≈Σ A_k·r_k^n·cos(ω_k n+φ_k) (the e^(λτ)·R(ωτ) family).",
    "                              Per cycle returns period (2π/ω), decay-rate λ=ln|r| and a persistence verdict: PERSISTENT (λ≈0,",
    "                              standing/exploitable cycle), DECAYING (λ<0, dying — reports amplitude half-life, don't fade into it),",
    "                              or GROWING (λ>0, unstable). Plus amplitude, phase, varianceExplained. The per-cycle PERSISTENCE is what",
    "                              MESA (power spectrum) and the Hilbert transform (instantaneous phase) don't give. Noise-sensitive —",
    "                              feed a detrended/lightly-smoothed series; keep order ≈ 2× the cycles you expect to resolve.",
    "    - 'regime_filter_value' — direct: { returns: number[], regimeLabels: string[], options?: { hostileRegimes?, detectionLagBars?(2), flipFraction?(0.15) } }",
    "                              'The Regime Filter Trap': BEFORE building a regime filter for a strategy, price what a wrong",
    "                              switch costs. (1) per-regime expectancy attribution on the strategy's realized returns (is it",
    "                              even regime-sensitive?); (2) re-run with the filter DEGRADED — every switch lagged + a share of",
    "                              calls flipped — and compare degraded-filtered vs unfiltered. Verdict: build_filter (losses",
    "                              concentrate AND edge survives the lag) / complexity_tax (lag+error eat the edge) / regime_insensitive",
    "                              (mushy attribution → filtering is pure cost). Strategy-level. Distinct from regime_policy (allocation)",
    "                              and the regime-detection-lag eval metric (classifier responsiveness vs ground truth).",
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
    "    - 'dupont'              — params: { revenue, netIncome, totalAssets, equity, pretaxIncome?, ebit? }. DuPont ROE",
    "                              decomposition: 3-way (netMargin × assetTurnover × equityMultiplier) always; 5-way",
    "                              (taxBurden × interestBurden × operatingMargin × turnover × leverage) when pretaxIncome+ebit",
    "                              given — isolates OPERATING ROE from financing/tax/leverage. Log-additive driver attribution",
    "                              (% of ln-ROE per factor) when ROE+factors>0; self-consistency drift check. Distinct from",
    "                              forensic_screen (which flags manipulation/distress) — this attributes the return to its sources.",
    "    - 'weighted_book_imbalance' — params: { snapshot: {bids[], asks[]}, depthLevels?, moderateThreshold?, strongThreshold? }.",
    "                              Level-weighted (1/(level+1)) order-book imbalance (WDI) vs flat OBI: weights the touch over",
    "                              deep size. Comparing the two locates WHERE pressure sits — at_touch (|WDI|>|flat|, actionable),",
    "                              in_depth (deep wall, possible spoof), or touch_vs_depth_conflict. Distinct from microprice",
    "                              (touch-only fair price) and flat order-book imbalance (equal-weight depth).",
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
    "    - 'robustness_metrics'  — params: { outcomes: number[], higherIsBetter?: boolean, eps? }",
    "                              Taguchi-style robustness scoring over a DISTRIBUTION of stress outcomes (Sharpe / net-return",
    "                              across parameter sweeps, walk-forward windows, or synthetic_augment runs): normalized percentile",
    "                              spread, downside-robustness loss, survival ratio + robust/moderate/fragile verdict. Complements the",
    "                              best/median overfit score. Needs ≥5 outcomes. Scores a distribution YOU supply — does not run the stress tests.",
    "    - 'fee_sensitivity'     — params: { grossReturns: number[] /* per-round-trip gross return fraction, pre-fee */, schedules: [{ label, roundTripBps? | makerBps?+takerBps? }], periodsPerYear? }",
    "                              Re-score a strategy's per-trade gross returns under multiple fee tiers; flags which schedules flip it",
    "                              from profit to loss + the break-even round-trip bps (= gross mean edge). The Minara/Lighter finding:",
    "                              fee drag, not signal, kills high-frequency strategies. Complement to marketImpact (which sweeps order size).",
    "    - 'black_scholes'       — params: { spot, strike, timeToExpiry (years), riskFreeRate, dividendYield?, optionType: 'call'|'put', sigma?, marketPrice? }",
    "                              European option pricing (Merton continuous-dividend). Pass `sigma` → fair value + full Greeks (delta/gamma/vega/theta/rho).",
    "                              Pass `marketPrice` instead → IMPLIED VOLATILITY (Newton-Raphson + bisection inversion). Gated behind GORDON_BLACK_SCHOLES_GREEKS.",
    "    - 'options_payoff'      — params: { legs: [{ type:'call'|'put', side:'long'|'short', strike, premium, quantity? }], spot?, priceGrid? }",
    "                              Multi-leg expiry payoff: net debit/credit, breakeven(s), max profit, max loss (null=unbounded), downsampled payoff curve.",
    "                              Build straddle/strangle/spread legs directly. Equities options (US side).",
    "    - 'stress_inject'       — params: { method: 'gaps'|'crash_blocks'|'flatline_blocks'|'vol_stretch'|'reverse_path'|'trend_invert', candles: Candle[], params: {…method-specific} }",
    "                              Inject a NAMED market pathology into a historical candle series, then re-run `backtest` on the returned candles and feed both",
    "                              trade-PnL vectors to pnl_significance. A robustness axis distinct from MCPT/vs_random (which test edge-vs-noise): does the",
    "                              strategy SURVIVE structured pathologies? Deterministic (seedable). gaps={magnitudePct,atIndices?|everyN?,direction?};",
    "                              crash_blocks={dropPct,lengthBars,count?}; flatline_blocks={lengthBars,count?}; vol_stretch={factor}; trend_invert={window}.",
    "    - 'pnl_significance'    — params: { baseline: number[], scenario: number[], alpha? }",
    "                              Two-sample test (Mann-Whitney U always + paired t when lengths match) for whether scenario PnL differs from baseline PnL.",
    "                              The verdict layer for stress_inject. Distinct from MCPT (permutation-null) — this is baseline-vs-scenario. Needs ≥5 each.",
    "    - 'omega_ratio'         — params: { returns: number[], threshold? }",
    "                              Omega ratio = Σ gains-above-threshold / Σ losses-below-threshold. Probability-weighted up/down capture; complements the",
    "                              Sharpe/Sortino/Calmar triple (risk_ratio_triple). threshold default 0.",
    "    - 'optimize_portfolio'  — params: { strategyReturns: Record<string, number[]>, objective?: 'min_variance'|'max_sharpe'|'target_return', targetReturn?, riskFreeRate?, longOnly?, maxWeight?, shrinkage?, marketNeutral? }",
    "                              Markowitz optimizer over strategy/asset return series: min-variance / max-Sharpe / target-return, long-only + max-weight",
    "                              cap + Ledoit-Wolf shrinkage, equal-weight fallback (converged flag). marketNeutral:true → dollar-neutral long-short",
    "                              (net Σw=0, gross Σ|w|=1). Return-optimized family; complement to portfolio_ensemble (risk-structured) and hrp_allocation.",
    "    - 'price_deviation_guard' — params: { orderPrice, referencePrice, thresholdPct?, side? }",
    "    - 'evolving_r' — params: { entry, stop, target, currentPrice, side: 'long'|'short' } — dynamic risk-reward (Tom Dante): recomputes RR from the CURRENT price (remaining reward vs risk back to stop), not just at entry; verdict hold|manage|target_reached|stopped",
    "    - 'overthrow_stop' — params: { candles[], brokenLevel, side: 'long'|'short', lookback? } — stop placement from an overthrow/reclaim of a level: returns the furthermost-deviation stop (overshoot extreme, conservative) and the thrust-candle stop (reclaim-bar extreme, tighter) + a caution if the tight stop sits on the level",
    "                              Fat-finger / stale-quote check: % deviation of an intended order price from the live reference (mid/last/mark). Breach in the",
    "                              dangerous direction (buy ABOVE / sell BELOW) → block; benign → warn. Default threshold 2%. Pre-trade sanity gate; also runs",
    "                              automatically as a PreOrderPlacement hook on LIMIT orders. Distinct from slippage (which models market-order cost).",
    "    - 'score_autocut' — params: { items: [{id?, score}] OR scores: number[], jumpRatio? (0.20), dominanceRatio? (1.5), minKeep? (1), maxKeep? }",
    "                              Score-discontinuity selection: cut a ranked list at the largest score CLIFF and return the LEADING CLUSTER (1 candidate when",
    "                              one dominates, several when comparable) instead of an arbitrary top-K. Cuts only when the top gap is ≥ jumpRatio of the spread",
    "                              AND ≥ dominanceRatio× the next gap, else fails OPEN (keeps all, up to maxKeep). Feed a TRUSTWORTHY score (expected edge /",
    "                              calibrated conviction), NOT a mechanical rank. Use for scan / signal / trade-candidate shortlists.",
    "    - 'single_prints' — params: { bars: [{high, low, timestamp}], tpoBlockMs? (30min), tickSize?, valueAreaFraction? (0.7), poorThreshold? (2) }",
    "                              Steidlmayer TPO structure the marketProfile/POC view doesn't surface: SINGLE PRINTS (price levels touched in only one",
    "                              time-bracket — fast one-sided moves). Returns buying/selling TAILS (single-print runs at the low/high = responsive rejection,",
    "                              longer = stronger), mid-range single-print zones (fast-move gaps that tend to get revisited/'filled' → magnet targets), and",
    "                              POOR high/low (extreme touched by ≥ poorThreshold TPOs = unfinished, prone to being exceeded). Pairs with the volume/market",
    "                              profile POC/value-area. Pass intraday bars for one session.",
    "    - 'rotation_bars' — params: { values: number[], method?: 'range'|'renko' (range), size: >0, maxBars? (5000) }",
    "                              DISTANCE-based bars (vs information_bars which SAMPLES by tick/volume/dollar count): a new bar forms only after price travels",
    "                              `size`, so time/observation-count are irrelevant and sub-size noise is filtered out. `values` can be closes OR a cumulative",
    "                              signal like delta ('delta rotations'). Returns the constructed bars + travelRatio (bars/obs = volatility). Feed the bars into",
    "                              other indicators for noise-suppressed signals.",
    "    - 'inverse_convexity' — params: { entryPrice, movePct (0..1), side?: 'long'|'short', contractsUsd? (1) }",
    "                              Inverse/coin-margined perp (XBTUSD-style) BTC-PnL convexity: PnL ∝ (1/entry−1/exit), so a LONG loses MORE BTC on a −x% move",
    "                              than it gains on +x% (negative convexity; asymmetryRatio>1) → longs liquidate faster, inverse-dominated markets dump deeper",
    "                              than they pump. Shorts get the mirror (positive). Quantifies the asymmetry for a ±movePct shock vs a symmetric linear contract.",
    "    - 'price_discovery' — params: { series1: number[], series2: number[], label1?, label2?, applyLog? } (two cointegrated price series of the same asset)",
    "                              Which market LEADS price discovery (two venues, or perp vs spot): Engle-Granger spread → error-correction speeds α → Gonzalo-",
    "                              Granger component share (the market that adjusts LESS leads) + Hasbrouck Information Share with Cholesky upper/lower bounds",
    "                              + Generalized Information Share (Lien-Shrestha, order-INVARIANT single share that collapses the Cholesky bound range; →50/50 as ρ→1).",
    "                              Returns leader + componentShare1/2 + hasbrouckIS1/2 {lower,upper,mid} + generalizedIS1/2 + confidence. ONLY valid if cointegrated — verify with",
    "                              adf_test / johansen_cointegration first; pass log prices. (Hu-Hou-Oxley 2020; static, not the time-varying SPH/Park-Hahn version.)",
    "    - 'generalized_impulse' — params: { series1, series2, label1?, label2?, convergenceFrac? (0.1), maxHorizon? (60), applyLog? } (two cointegrated series)",
    "                              Speed-of-adjustment / lead-lag (Pesaran-Shin GIRF, Alexander-Heck 2020): fits a bivariate VECM(1), traces the order-invariant 1σ shock to",
    "                              each market, and measures bars for the cointegration SPREAD to re-converge. Returns barsToConverge1/2 + fasterAbsorbed (the shock the",
    "                              system absorbs quicker — a directional read complementing price_discovery). Only valid if cointegrated.",
    "    - 'footprint_imbalance' — params: { levels: [{priceLevel, buyVolume, sellVolume}], threshold? (3), minStacked? (3) }",
    "                              DIAGONAL footprint imbalance: buy@P vs sell@(P−1 tick) and sell@P vs buy@(P+1 tick); ≥ threshold× = imbalance; runs of ≥ minStacked",
    "                              consecutive same-side = stacked zone (momentum / reactive shelf). Distinct from delta-ladder (same-level delta). Direct-input footprint.",
    "    - 'naked_poc' — params: { candles[], periodBars? (24), numBins? (24) }",
    "                              Naked/virgin volume-POC tracking: each period's POC that price has NOT traded back through = an unfilled magnet level. Returns nakedPocs +",
    "                              nearestNakedAbove/Below the last close + filledCount. Distinct from single_prints (TPO gaps) — this tracks per-period volume-POC revisits.",
    "    - 'generalized_variance' — params: { returns: number[][] (≥2 aligned return series, e.g. sectors/assets), window? (60) }",
    "                              Gram-volume crash detector (Sudjianto 'geometry of a market crash'): rolling √det(correlation matrix) ∈ [0,1] = ∏λ (generalized variance);",
    "                              →0 = correlations collapse to 1 / rank collapse / crash, →1 = diversified. Catches single-near-dependency rank collapse that avg-ρ (correlation_breakdown),",
    "                              effective_n, and pca_concentration smear out. Returns the volume series + logDet + volumeZ (sharp drop=crash) + regime + trend. Cholesky det.",
    "    - 'asymmetric_beta' — params: { strategyReturns: number[], benchmarkReturns: number[], tThreshold? (2) }",
    "                              Up/down-market beta (Andrew Lo) — 'fake market-neutral' detector: regress R = α + β⁺·max(Λ,0) + β⁻·min(Λ,0) + ε and test β⁺=β⁻. A significant",
    "                              β⁻ > β⁺ with near-zero β⁺ = looks neutral up, heavy beta in selloffs. Returns betaUp/betaDown + betaDiff t-stat + verdict + fakeMarketNeutral flag.",
    "    - 'as_intensity' — params: { dailyVolume, avgOrderSize, sizeExponentAlpha (α≈1.5), impactCoef (κ in Δp=κ·ln(Q)) }",
    "                              Avellaneda-Stoikov fill-intensity calibration: derives A=Λ/α and k=α/κ of λ(δ)=A·exp(−kδ) from order-flow stats (Λ=vol/avg-order-size) so the",
    "                              MM spread runs on measured params, not guesses. Feed A,k into inventory_adjusted_spread / optimalLimitDepth.",
    "    - 'as_stationary_reservation' — params: { midPrice, inventory(q), gamma, sigma, qMax }",
    "                              Avellaneda-Stoikov INFINITE-HORIZON (no terminal T) stationary reservation prices for always-on market-making: r̃ᵃ/ᵇ = s + (1/γ)ln(1 + (±1−2q)γ²σ²/",
    "                              (2ω−γ²σ²q²)), ω=½γ²σ²(qMax+1)². Long q>0 → both quotes shift DOWN to sell; one side diverges (returns null + atCap) at the inventory cap.",
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
      regime_filter_value: {
        execute: async (p: Record<string, unknown>) =>
          computeRegimeFilterValue(p as unknown as Parameters<typeof computeRegimeFilterValue>[0]),
      },
      damped_cycle: {
        execute: async (p: Record<string, unknown>) =>
          computeDampedCycleDecomposition(p as unknown as Parameters<typeof computeDampedCycleDecomposition>[0]),
      },
      forensic_screen: {
        execute: async (p: Record<string, unknown>) =>
          computeForensicScores(p as unknown as Parameters<typeof computeForensicScores>[0]),
      },
      dupont: {
        execute: async (p: Record<string, unknown>) =>
          computeDupont(p as unknown as Parameters<typeof computeDupont>[0]),
      },
      weighted_book_imbalance: {
        execute: async (p: Record<string, unknown>) =>
          computeWeightedBookImbalance(
            (p.snapshot ?? p) as Parameters<typeof computeWeightedBookImbalance>[0],
            p as Parameters<typeof computeWeightedBookImbalance>[1],
          ),
      },
      time_under_water: {
        execute: async (p: Record<string, unknown>) =>
          computeTimeUnderWater(p as unknown as Parameters<typeof computeTimeUnderWater>[0]),
      },
      vol_residual_correlation: {
        execute: async (p: Record<string, unknown>) =>
          computeVolResidualCorrelation(
            p as unknown as Parameters<typeof computeVolResidualCorrelation>[0],
          ),
      },
      tls_hedge_ratio: {
        execute: async (p: Record<string, unknown>) =>
          computeTlsHedgeRatio(p as unknown as Parameters<typeof computeTlsHedgeRatio>[0]),
      },
      box_tiao_hedge_ratio: {
        execute: async (p: Record<string, unknown>) =>
          computeBoxTiaoHedgeRatio(p as unknown as Parameters<typeof computeBoxTiaoHedgeRatio>[0]),
      },
      ou_fit: {
        execute: async (p: Record<string, unknown>) =>
          fitOU(p as unknown as Parameters<typeof fitOU>[0]),
      },
      min_half_life_hedge_ratio: {
        execute: async (p: Record<string, unknown>) =>
          computeMinHalfLifeHedgeRatio(
            p as unknown as Parameters<typeof computeMinHalfLifeHedgeRatio>[0],
          ),
      },
      adf_optimal_hedge_ratio: {
        execute: async (p: Record<string, unknown>) =>
          computeAdfOptimalHedgeRatio(
            p as unknown as Parameters<typeof computeAdfOptimalHedgeRatio>[0],
          ),
      },
      ou_optimal_thresholds: {
        execute: async (p: Record<string, unknown>) =>
          computeOuOptimalThresholds(p as unknown as Parameters<typeof computeOuOptimalThresholds>[0]),
      },
      triple_barrier: {
        execute: async (p: Record<string, unknown>) =>
          computeTripleBarrier(p as unknown as Parameters<typeof computeTripleBarrier>[0]),
      },
      codependence: {
        execute: async (p: Record<string, unknown>) =>
          computeCodependence(p as unknown as Parameters<typeof computeCodependence>[0]),
      },
      control_chart: {
        execute: async (p: Record<string, unknown>) =>
          computeControlChart(p as unknown as Parameters<typeof computeControlChart>[0]),
      },
      score_autocut: {
        execute: async (p: Record<string, unknown>) => {
          const items: AutocutItem[] = Array.isArray(p.items)
            ? (p.items as AutocutItem[])
            : Array.isArray(p.scores)
              ? (p.scores as number[]).map((score) => ({ score }))
              : [];
          if (items.length === 0) {
            return { error: "score_autocut: pass `items` ([{id?, score}]) or `scores` (number[])" };
          }
          return selectByScoreDiscontinuity(items, p as unknown as AutocutOptions);
        },
      },
      single_prints: {
        execute: async (p: Record<string, unknown>) => {
          if (!Array.isArray(p.bars)) {
            return { error: "single_prints: `bars` ([{high, low, timestamp}]) is required" };
          }
          return computeSinglePrints(p as unknown as Parameters<typeof computeSinglePrints>[0]);
        },
      },
      rotation_bars: {
        execute: async (p: Record<string, unknown>) => {
          if (!Array.isArray(p.values)) {
            return { error: "rotation_bars: `values` (number[]) and `size` (>0) are required" };
          }
          return constructRotationBars(p as unknown as Parameters<typeof constructRotationBars>[0]);
        },
      },
      inverse_convexity: {
        execute: async (p: Record<string, unknown>) =>
          computeInverseConvexity(p as unknown as Parameters<typeof computeInverseConvexity>[0]),
      },
      price_discovery: {
        execute: async (p: Record<string, unknown>) => {
          if (!Array.isArray(p.series1) || !Array.isArray(p.series2)) {
            return { error: "price_discovery: `series1` and `series2` (aligned number[] price series) are required" };
          }
          return computePriceDiscovery(p as unknown as Parameters<typeof computePriceDiscovery>[0]);
        },
      },
      generalized_impulse: {
        execute: async (p: Record<string, unknown>) => {
          if (!Array.isArray(p.series1) || !Array.isArray(p.series2)) {
            return { error: "generalized_impulse: `series1` and `series2` (aligned number[] price series) are required" };
          }
          return computeGeneralizedImpulse(p as unknown as Parameters<typeof computeGeneralizedImpulse>[0]);
        },
      },
      footprint_imbalance: {
        execute: async (p: Record<string, unknown>) => {
          if (!Array.isArray(p.levels)) {
            return { error: "footprint_imbalance: `levels` ([{priceLevel, buyVolume, sellVolume}]) is required" };
          }
          return computeFootprintImbalance(p as unknown as Parameters<typeof computeFootprintImbalance>[0]);
        },
      },
      naked_poc: {
        execute: async (p: Record<string, unknown>) => {
          if (!Array.isArray(p.candles)) {
            return { error: "naked_poc: `candles` ([{open,high,low,close,volume}]) is required" };
          }
          return computeNakedPoc(p as unknown as Parameters<typeof computeNakedPoc>[0]);
        },
      },
      as_intensity: {
        execute: async (p: Record<string, unknown>) =>
          computeASIntensityCalibration(p as unknown as Parameters<typeof computeASIntensityCalibration>[0]),
      },
      as_stationary_reservation: {
        execute: async (p: Record<string, unknown>) =>
          computeASStationaryReservation(p as unknown as Parameters<typeof computeASStationaryReservation>[0]),
      },
      asymmetric_beta: {
        execute: async (p: Record<string, unknown>) => {
          if (!Array.isArray(p.strategyReturns) || !Array.isArray(p.benchmarkReturns)) {
            return { error: "asymmetric_beta: `strategyReturns` and `benchmarkReturns` (aligned number[]) are required" };
          }
          return computeAsymmetricBeta(p as unknown as Parameters<typeof computeAsymmetricBeta>[0]);
        },
      },
      generalized_variance: {
        execute: async (p: Record<string, unknown>) => {
          if (!Array.isArray(p.returns) || !Array.isArray(p.returns[0])) {
            return { error: "generalized_variance: `returns` (≥2 aligned number[][] return series) is required" };
          }
          return computeGeneralizedVariance(p as unknown as Parameters<typeof computeGeneralizedVariance>[0]);
        },
      },
      inventory_order_size: {
        execute: async (p: Record<string, unknown>) =>
          computeInventoryOrderSize(p as unknown as Parameters<typeof computeInventoryOrderSize>[0]),
      },
      mm_markov: {
        execute: async (p: Record<string, unknown>) =>
          computeMarketMakingMarkov(p as unknown as Parameters<typeof computeMarketMakingMarkov>[0]),
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
      robustness_metrics: {
        execute: async (p: Record<string, unknown>) => {
          const outcomes = Array.isArray(p.outcomes) ? (p.outcomes as number[]) : [];
          const r = computeRobustnessMetrics(outcomes, {
            ...(typeof p.higherIsBetter === "boolean" && { higherIsBetter: p.higherIsBetter }),
            ...(typeof p.eps === "number" && { eps: p.eps }),
          });
          return r ?? { error: "robustness_metrics: need ≥ 5 finite outcomes (a distribution of stress-test results)." };
        },
      },
      fee_sensitivity: {
        execute: async (p: Record<string, unknown>) => {
          const r = runFeeSensitivitySweep(p as unknown as Parameters<typeof runFeeSensitivitySweep>[0]);
          return r ?? { error: "fee_sensitivity: need `grossReturns` (per-round-trip gross return fractions) and at least one fee `schedule`." };
        },
      },
      black_scholes: {
        execute: async (p: Record<string, unknown>) => {
          if (!isBlackScholesGreeksEnabled()) {
            return { error: "black_scholes: module disabled. Set GORDON_BLACK_SCHOLES_GREEKS=1 to enable." };
          }
          const num = (k: string): number | null => (typeof p[k] === "number" ? (p[k] as number) : null);
          const spot = num("spot");
          const strike = num("strike");
          const timeToExpiry = num("timeToExpiry");
          const riskFreeRate = num("riskFreeRate");
          if (spot == null || strike == null || timeToExpiry == null || riskFreeRate == null) {
            return { error: "black_scholes: spot, strike, timeToExpiry (years), riskFreeRate are required numbers." };
          }
          const optionType = p.optionType === "put" ? ("put" as const) : ("call" as const);
          const q = num("dividendYield");
          const marketPrice = num("marketPrice");
          const sigma = num("sigma");
          if (marketPrice != null) {
            return impliedVolatility({
              marketPrice,
              spot,
              strike,
              timeToExpiry,
              riskFreeRate,
              ...(q != null && { dividendYield: q }),
              optionType,
            });
          }
          if (sigma != null) {
            return blackScholesGreeksToPayload(
              computeBlackScholesGreeks({
                spot,
                strike,
                timeYears: timeToExpiry,
                rate: riskFreeRate,
                volatility: sigma,
                ...(q != null && { dividendYield: q }),
                optionType,
              }),
              optionType,
            );
          }
          return { error: "black_scholes: provide `sigma` (→ price + Greeks) or `marketPrice` (→ implied volatility)." };
        },
      },
      options_payoff: {
        execute: async (p: Record<string, unknown>) => {
          const r = computeOptionsPayoff(p as unknown as Parameters<typeof computeOptionsPayoff>[0]);
          // Downsample the (potentially ~200-point) payoff curve; the model
          // wants breakevens / max-P / max-L, not the raw grid.
          const { payoffCurve, ...rest } = r;
          const step = payoffCurve.length > 40 ? Math.ceil(payoffCurve.length / 40) : 1;
          return {
            ...rest,
            payoffCurve: payoffCurve.filter((_, i) => i % step === 0),
            payoffCurvePoints: payoffCurve.length,
          };
        },
      },
      stress_inject: {
        execute: async (p: Record<string, unknown>) => {
          const candles = Array.isArray(p.candles)
            ? (p.candles as Parameters<typeof injectGaps>[0])
            : null;
          if (!candles) return { error: "stress_inject: `candles` array required." };
          const sp = (typeof p.params === "object" && p.params !== null ? p.params : {}) as Record<string, unknown>;
          let perturbed: typeof candles;
          switch (p.method) {
            case "gaps":
              perturbed = injectGaps(candles, sp as unknown as Parameters<typeof injectGaps>[1]);
              break;
            case "crash_blocks":
              perturbed = injectCrashBlocks(candles, sp as unknown as Parameters<typeof injectCrashBlocks>[1]);
              break;
            case "flatline_blocks":
              perturbed = injectFlatlineBlocks(candles, sp as unknown as Parameters<typeof injectFlatlineBlocks>[1]);
              break;
            case "vol_stretch":
              perturbed = stretchVolatility(candles, sp as unknown as Parameters<typeof stretchVolatility>[1]);
              break;
            case "reverse_path":
              perturbed = reversePath(candles);
              break;
            case "trend_invert":
              perturbed = invertTrendWindows(candles, sp as unknown as Parameters<typeof invertTrendWindows>[1]);
              break;
            default:
              return { error: `stress_inject: unknown method '${String(p.method)}'. Use gaps | crash_blocks | flatline_blocks | vol_stretch | reverse_path | trend_invert.` };
          }
          return {
            method: p.method,
            barCount: perturbed.length,
            candles: perturbed,
            summary: `Injected '${String(p.method)}' pathology over ${perturbed.length} bars. Re-run backtest on these candles, then pnl_significance vs the baseline trade-PnL.`,
          };
        },
      },
      pnl_significance: {
        execute: async (p: Record<string, unknown>) => {
          const baseline = Array.isArray(p.baseline) ? (p.baseline as number[]) : [];
          const scenario = Array.isArray(p.scenario) ? (p.scenario as number[]) : [];
          const r = twoSamplePnlTest({
            baseline,
            scenario,
            ...(typeof p.alpha === "number" && { alpha: p.alpha }),
          });
          return r ?? { error: "pnl_significance: need ≥ 5 finite values in each of `baseline` and `scenario`." };
        },
      },
      omega_ratio: {
        execute: async (p: Record<string, unknown>) => {
          const returns = Array.isArray(p.returns) ? (p.returns as number[]) : [];
          const threshold = typeof p.threshold === "number" ? p.threshold : 0;
          const r = computeOmegaRatio(returns, threshold);
          return r ?? { error: "omega_ratio: need ≥ 2 returns." };
        },
      },
      optimize_portfolio: {
        execute: async (p: Record<string, unknown>) =>
          optimizePortfolio(p as unknown as Parameters<typeof optimizePortfolio>[0]),
      },
      price_deviation_guard: {
        execute: async (p: Record<string, unknown>) => {
          const r = checkPriceDeviation(p as unknown as Parameters<typeof checkPriceDeviation>[0]);
          return r ?? { error: "price_deviation_guard: orderPrice and referencePrice must be positive finite numbers." };
        },
      },
      evolving_r: {
        execute: async (p: Record<string, unknown>) => {
          const r = computeEvolvingR(p as unknown as Parameters<typeof computeEvolvingR>[0]);
          return r ?? { error: "evolving_r: need finite entry/stop/target/currentPrice and valid geometry (long: stop<entry<target; short: target<entry<stop)." };
        },
      },
      overthrow_stop: {
        execute: async (p: Record<string, unknown>) => {
          const r = computeOverthrowStop(p as unknown as Parameters<typeof computeOverthrowStop>[0]);
          return r ?? { error: "overthrow_stop: need candles[], a finite positive brokenLevel, side long|short, and a detectable overshoot+reclaim of the level." };
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
