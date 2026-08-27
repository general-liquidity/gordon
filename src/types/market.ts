import { z } from "zod";

export const CandleSchema = z.object({
  openTime: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
  closeTime: z.number(),
});

export const IndicatorsSchema = z.object({
  rsi: z.number().nullable(),
  macd: z
    .object({
      macd: z.number(),
      signal: z.number(),
      histogram: z.number(),
    })
    .nullable(),
  volumeMA: z.number().nullable(),
  volumeRatio: z.number().nullable(), // current volume / MA
});

export const LevelSchema = z.object({
  price: z.number(),
  type: z.enum(["support", "resistance"]),
  strength: z.number().min(0).max(1), // 0-1 confidence
  touches: z.number(), // how many times price touched this level
});

export const CoinAnalysisSchema = z.object({
  symbol: z.string(),
  price: z.number(),
  change24h: z.number(),
  volume24h: z.number(),

  indicators: IndicatorsSchema,
  levels: z.array(LevelSchema),

  trend: z.enum(["up", "down", "range"]),

  setupDetected: z.boolean(),
  setupConfidence: z.number().min(0).max(1),

  bias: z.enum(["bullish", "bearish", "neutral"]),
  risk: z.enum(["low", "medium", "high"]),
});

export const ScanResultSchema = z.object({
  timestamp: z.string(),
  universe: z.string(), // e.g., "top50"
  timeframes: z.array(z.string()),
  coins: z.array(CoinAnalysisSchema),
});

export type Candle = z.infer<typeof CandleSchema>;
export type Indicators = z.infer<typeof IndicatorsSchema>;
export type Level = z.infer<typeof LevelSchema>;
export type CoinAnalysis = z.infer<typeof CoinAnalysisSchema>;
export type ScanResult = z.infer<typeof ScanResultSchema>;
export type Trend = CoinAnalysis["trend"];
export type Bias = CoinAnalysis["bias"];
export type Risk = CoinAnalysis["risk"];
