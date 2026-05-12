/**
 * Strategy Recipes — Mastra tool surface.
 *
 * Exposes the pure recipe primitives (regime-RSI, bounce counter,
 * signal gate, max-exposure timeout) and a composer that chains them.
 * The LLM passes recipe state in, gets new state out, so a multi-turn
 * back-and-forth can run an actual sequence of evaluations across
 * candles without the tool needing to own state.
 */
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  DEFAULT_REGIME_RSI_SETTINGS,
  evaluateRecipes,
  newRecipePipelineState,
  regimeRsiSignal,
  applyBounceCounter,
  applySignalGate,
  applyMaxExposure,
  type RegimeRsiSettings,
} from "../../../../../core/strategies/recipes/index.ts";
import { MarketRegimeSchema } from "../../../../../core/regime/types.ts";

const sideSchema = z.enum(["long", "short", "none"]);
const zoneSchema = z.enum(["high", "low", "neutral"]);

const regimeRsiSettingsSchema = z.object({
  bull: z.object({
    rsiHigh: z.number(),
    rsiLow: z.number(),
    modHigh: z.number(),
    modLow: z.number(),
  }),
  bear: z.object({
    rsiHigh: z.number(),
    rsiLow: z.number(),
    modHigh: z.number(),
    modLow: z.number(),
  }),
  idle: z
    .object({
      rsiHigh: z.number(),
      rsiLow: z.number(),
      modHigh: z.number(),
      modLow: z.number(),
    })
    .optional(),
  adx: z.object({ high: z.number(), low: z.number() }),
});

const bounceCounterStateSchema = z.object({
  zone: zoneSchema,
  duration: z.number(),
  bounces: z.number(),
  willBounce: z.boolean(),
  flats: z.number(),
  fired: z.boolean(),
});

const signalGateStateSchema = z.object({
  pendingSignal: sideSchema,
  pendingPrice: z.number(),
  benefits: z.array(z.number()),
});

const maxExposureStateSchema = z.object({
  side: sideSchema,
  entryPrice: z.number(),
  candlesHeld: z.number(),
});

const pipelineStateSchema = z.object({
  bounceCounter: bounceCounterStateSchema,
  signalGate: signalGateStateSchema,
  maxExposure: maxExposureStateSchema,
});

// ============================================================================
// Tool: evaluate_strategy_recipes — full pipeline in one call
// ============================================================================

export const evaluateStrategyRecipesTool = createTool({
  id: "evaluate_strategy_recipes",
  description:
    "Run the full strategy-recipe pipeline (regime-modulated RSI → " +
    "bounce counter → signal gate → max-exposure timeout) for one " +
    "candle and return the staged decision plus updated state. Pass " +
    "the returned state back in on the next call to advance the " +
    "pipeline candle-by-candle. Use when you have indicator readings " +
    "(rsi/adx/fastMa/slowMa) plus a regime classification and want a " +
    "concrete trade action with a full reasoning trace.",
  inputSchema: z.object({
    regime: MarketRegimeSchema,
    rsi: z.number(),
    adx: z.number(),
    fastMa: z.number(),
    slowMa: z.number(),
    price: z.number(),
    state: pipelineStateSchema.optional().describe(
      "Pipeline state from a prior call. Omit on the first candle.",
    ),
    regimeRsiSettings: regimeRsiSettingsSchema.optional(),
    bounceCounter: z
      .object({
        persistence: z.number().int().positive(),
        requiredBounces: z.number().int().nonnegative(),
        resetAfterFlats: z.number().int().positive().optional(),
      })
      .optional(),
    maxExposureCandles: z.number().int().positive().optional(),
  }),
  outputSchema: z.object({
    action: sideSchema,
    forceExit: z.boolean(),
    trace: z.object({
      regimeRsi: z.object({
        signal: sideSchema,
        appliedBucket: z.enum(["bull", "bear", "idle"]),
        effectiveHigh: z.number(),
        effectiveLow: z.number(),
        reason: z.string(),
      }),
      bounceCounter: z.object({ input: sideSchema, gated: sideSchema }),
      signalGate: z.object({ execute: sideSchema, status: z.string() }),
      maxExposure: z.object({ action: sideSchema, reason: z.string() }),
    }),
    state: pipelineStateSchema,
  }),
  execute: async (params: {
    regime: z.infer<typeof MarketRegimeSchema>;
    rsi: number;
    adx: number;
    fastMa: number;
    slowMa: number;
    price: number;
    state?: z.infer<typeof pipelineStateSchema>;
    regimeRsiSettings?: RegimeRsiSettings;
    bounceCounter?: {
      persistence: number;
      requiredBounces: number;
      resetAfterFlats?: number;
    };
    maxExposureCandles?: number;
  }) => {
    const result = evaluateRecipes({
      state: params.state ?? newRecipePipelineState(),
      regime: params.regime,
      rsi: params.rsi,
      adx: params.adx,
      fastMa: params.fastMa,
      slowMa: params.slowMa,
      price: params.price,
      regimeRsiSettings: params.regimeRsiSettings ?? DEFAULT_REGIME_RSI_SETTINGS,
      bounceCounter: params.bounceCounter ?? { persistence: 1, requiredBounces: 0 },
      maxExposureCandles: params.maxExposureCandles ?? 24,
    });
    return result;
  },
});

// ============================================================================
// Individual primitives — exposed too so the LLM can call one in
// isolation (e.g. just the regime-RSI band lookup for a one-shot
// "should I be looking at long or short here?" question).
// ============================================================================

export const regimeRsiTool = createTool({
  id: "regime_rsi_signal",
  description:
    "Compute a long/short/none signal from RSI + ADX, with bands " +
    "modulated by the current market regime (bull / bear / idle). " +
    "Lightweight stateless lookup — useful for 'given regime X and " +
    "current RSI Y, is this an entry?' style questions.",
  inputSchema: z.object({
    regime: MarketRegimeSchema,
    rsi: z.number(),
    adx: z.number(),
    settings: regimeRsiSettingsSchema.optional(),
  }),
  outputSchema: z.object({
    signal: sideSchema,
    appliedBucket: z.enum(["bull", "bear", "idle"]),
    effectiveHigh: z.number(),
    effectiveLow: z.number(),
    reason: z.string(),
  }),
  execute: async (params: {
    regime: z.infer<typeof MarketRegimeSchema>;
    rsi: number;
    adx: number;
    settings?: RegimeRsiSettings;
  }) =>
    regimeRsiSignal({
      regime: params.regime,
      rsi: params.rsi,
      adx: params.adx,
      settings: params.settings ?? DEFAULT_REGIME_RSI_SETTINGS,
    }),
});

export const bounceCounterTool = createTool({
  id: "bounce_counter_step",
  description:
    "Advance the bounce-counter state machine by one candle. Counts " +
    "RSI re-entries into OB/OS zones; only fires when both persistence " +
    "and required-bounces thresholds are met. Pass the returned state " +
    "back in on the next call.",
  inputSchema: z.object({
    state: bounceCounterStateSchema,
    rsi: z.number(),
    high: z.number(),
    low: z.number(),
    persistence: z.number().int().positive(),
    requiredBounces: z.number().int().nonnegative(),
    resetAfterFlats: z.number().int().positive().optional(),
  }),
  outputSchema: z.object({
    signal: sideSchema,
    state: bounceCounterStateSchema,
  }),
  execute: async (params: z.infer<typeof bounceCounterStateSchema> extends infer _
    ? {
        state: z.infer<typeof bounceCounterStateSchema>;
        rsi: number;
        high: number;
        low: number;
        persistence: number;
        requiredBounces: number;
        resetAfterFlats?: number;
      }
    : never) => applyBounceCounter(params),
});

export const signalGateTool = createTool({
  id: "signal_gate_step",
  description:
    "Advance the signal-vs-execution gate by one candle. Holds raw " +
    "signals until the moving-average pair confirms direction; cancels " +
    "stale pendings if a new opposing signal arrives.",
  inputSchema: z.object({
    state: signalGateStateSchema,
    rawSignal: sideSchema,
    fastMa: z.number(),
    slowMa: z.number(),
    price: z.number(),
    benefitsCap: z.number().int().positive().optional(),
  }),
  outputSchema: z.object({
    execute: sideSchema,
    status: z.enum([
      "executed-immediately",
      "executed-after-confirmation",
      "pending",
      "passthrough",
      "cancelled",
    ]),
    state: signalGateStateSchema,
    benefit: z.number().optional(),
  }),
  execute: async (params: {
    state: z.infer<typeof signalGateStateSchema>;
    rawSignal: z.infer<typeof sideSchema>;
    fastMa: number;
    slowMa: number;
    price: number;
    benefitsCap?: number;
  }) => applySignalGate(params),
});

export const maxExposureTool = createTool({
  id: "max_exposure_step",
  description:
    "Advance the max-exposure timeout by one candle. Force-exits a " +
    "position after maxCandles candles regardless of P&L; honours " +
    "opposing external signals as natural exits.",
  inputSchema: z.object({
    state: maxExposureStateSchema,
    externalSignal: sideSchema,
    currentPrice: z.number(),
    maxCandles: z.number().int().positive(),
  }),
  outputSchema: z.object({
    action: sideSchema,
    forceExit: z.boolean(),
    state: maxExposureStateSchema,
    reason: z.string(),
  }),
  execute: async (params: {
    state: z.infer<typeof maxExposureStateSchema>;
    externalSignal: z.infer<typeof sideSchema>;
    currentPrice: number;
    maxCandles: number;
  }) => applyMaxExposure(params),
});

export const strategyRecipeTools = {
  evaluate_strategy_recipes: evaluateStrategyRecipesTool,
  regime_rsi_signal: regimeRsiTool,
  bounce_counter_step: bounceCounterTool,
  signal_gate_step: signalGateTool,
  max_exposure_step: maxExposureTool,
} as const;
