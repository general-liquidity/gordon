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
  type Candle as IndicatorCandle,
} from "../../../../core/indicators/index.ts";
import { RegimeDetector } from "../../../../core/regime/index.ts";
import { checkRiskTool as legacyCheckRisk } from "../trading/risk-gate.ts";
import { computeMicropriceTool as legacyMicroprice, computeInventoryAdjustedPriceTool as legacyInventoryAdjusted } from "../runtime/microstructure.ts";
import {
  detectCorrelationBreakdownTool as legacyCorrelationBreakdown,
  getVolForecastCalibrationTool as legacyVolForecast,
  getPnlDistributionShapeTool as legacyPnlShape,
} from "../runtime/diagnostics.ts";
import {
  validateEarningsSignalTool as legacyEarningsSignal,
  getDisciplineAuditTool as legacyDisciplineAudit,
  computeCrowdPositioningVerdictTool as legacyCrowdPositioning,
} from "../runtime/institutionalAi.ts";
import { getAdherenceReportTool as legacyAdherenceReport } from "../runtime/adherence.ts";

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
    },
    execContext?: MastraExecutionContext,
  ) => {
    const ctx = getGordonContext(execContext);
    const exchange = ctx?.exchange;
    let price = 1;
    try {
      if (exchange) price = await exchange.getPrice(args.symbol);
    } catch {
      // fall through with price=1 — risk-gate's sizing logic handles this.
    }
    const quantity = args.notionalUsd / Math.max(price, 1e-9);

    const result = (await (legacyCheckRisk.execute as any)(
      {
        symbol: args.symbol,
        side: args.side === "buy" ? "BUY" : "SELL",
        type: "MARKET",
        quantity,
        price,
      },
      execContext,
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
  "adherence_report",
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
    "operation values:",
    "  - 'microprice'                 — fair-value estimator (needs book history)",
    "  - 'inventory_adjusted_price'   — AS reservation price for sizing bias",
    "  - 'correlation_breakdown'      — cross-symbol correlation z-score",
    "  - 'vol_forecast_calibration'   — bias/MAE/RMSE on past vol forecasts",
    "  - 'pnl_distribution_shape'     — convexity verdict over trade P&Ls",
    "  - 'crowd_positioning'          — Shapiro framing on funding/OI/sentiment",
    "  - 'earnings_signal'            — validate structured earnings signal",
    "  - 'discipline_audit'           — score behavior against 7 failure modes",
    "  - 'adherence_report'           — trades-followed vs rule-overridden",
    "",
    "Inputs are operation-specific; pass them via the `params` field. See the",
    "per-operation handler module for exact schema.",
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
      microprice: legacyMicroprice,
      inventory_adjusted_price: legacyInventoryAdjusted,
      correlation_breakdown: legacyCorrelationBreakdown,
      vol_forecast_calibration: legacyVolForecast,
      pnl_distribution_shape: legacyPnlShape,
      crowd_positioning: legacyCrowdPositioning,
      earnings_signal: legacyEarningsSignal,
      discipline_audit: legacyDisciplineAudit,
      adherence_report: legacyAdherenceReport,
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
      const r = (await (handler.execute as any)(args.params, execContext)) as unknown;
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

export const v4AnalyticsTools = {
  compute_indicator: computeIndicatorTool,
  compute_regime: computeRegimeTool,
  compute_risk: computeRiskTool,
  compute_microstructure: computeMicrostructureTool,
};
