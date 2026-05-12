// ============================================================================
// Trading Signal — Structured output schema for all analysis outputs
//
// Every LLM-generated trading signal conforms to this schema. Provides
// type-safe parsing + helpers for position sizing and stop-loss calculation.
// ============================================================================

import { z } from "zod";

export const TradingSignalSchema = z.object({
  signal: z.enum(["BULLISH", "BEARISH", "NEUTRAL"]),
  confidence: z.number().min(1).max(10),
  reasoning: z.string(),
  key_factors: z.array(z.string()).min(1).max(5),
  symbol: z.string().optional(),
  timeframe: z.enum(["1h", "4h", "1d", "1w"]).optional(),
  risk_reward_ratio: z.number().optional(),
  suggested_stop_loss_pct: z.number().optional(),
  suggested_take_profit_pct: z.number().optional(),
});

export type TradingSignal = z.infer<typeof TradingSignalSchema>;

export function parseSignal(raw: string | object): TradingSignal | null {
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    return TradingSignalSchema.parse(obj);
  } catch {
    return null;
  }
}

export function isActionableSignal(signal: TradingSignal, minConfidence = 6): boolean {
  return signal.signal !== "NEUTRAL" && signal.confidence >= minConfidence;
}

export function confidenceToPositionSize(confidence: number, maxPositionPct: number = 0.05): number {
  return maxPositionPct * (confidence / 10);
}

export function confidenceToStopLoss(confidence: number): number {
  return 0.02 + (0.01 * (10 - confidence)) / 10;
}

export function stopLossToTakeProfit(stopLossPct: number, rrRatio: number = 2.5): number {
  return stopLossPct * rrRatio;
}
