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
  type CandlestickPatternName,
  type Candle as IndicatorCandle,
} from "../../../../core/indicators/index.ts";
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
    "Setup detection: tight_consolidation (bull-flag / pennant scorer), undercut_rally (shakeout-and-reclaim)",
    "Exit coaching: trim_state (momentum-swing 8/21/50 EMA trail ladder), resistance_tests (count level rejections + confidence)",
    "Candlestick patterns: candlestick_patterns (harami / engulfing / hammer / shooting_star / doji / morning_star / evening_star / piercing_line / dark_cloud_cover / inside_bar)",
    "Regression-based: linear_regression (slope + R² + standard error of fit), standard_error_bands (regression-line centerline + ± k × SE — distinct from Bollinger which uses SMA + price stddev; SEB is trend-focused vs BB which is mean-reversion focused)",
    "Volume-record: highest_volume_ever (HVE — bars whose volume exceeds all prior bars within a lookback window; institutional-urgency signal used by the /hve-pullback skill; pass lookbackBars omitted for true HVE, or e.g. 252 for 'highest in the last year')",
    "Advanced: elliott_wave, delta_ladder, flowscope",
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
