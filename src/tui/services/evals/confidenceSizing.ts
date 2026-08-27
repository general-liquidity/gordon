// ============================================================================
// Confidence Sizing — Position size + stop-loss from agent confidence
//
// Convert confidence (1-10) to position size, stop-loss distance,
// and take-profit targets. Higher confidence = larger + tighter stop.
// Based on Kelly Criterion + 2.5:1 reward/risk ratio.
// ============================================================================

export interface SizedOrder {
  positionSizeUsd: number;
  positionSizePct: number;
  stopLossPct: number;
  takeProfitPct: number;
  riskRewardRatio: number;
  reasoning: string;
}

export interface SizingConfig {
  capitalUsd: number;
  maxPositionPct?: number;
  minConfidence?: number;
  baseStopPct?: number;
  rrRatio?: number;
  consensusAdjustment?: number;
}

export function sizePosition(
  confidence: number,
  config: SizingConfig,
  options: {
    consensus?: "AGREE" | "SPLIT" | "DISAGREE";
    riskMode?: "enforce" | "warn" | "paper";
  } = {},
): SizedOrder {
  const {
    capitalUsd,
    maxPositionPct = 0.05,
    minConfidence = 6,
    baseStopPct = 0.02,
    rrRatio = 2.5,
    consensusAdjustment = 0.5,
  } = config;
  const { consensus = "AGREE", riskMode = "enforce" } = options;

  if (confidence < minConfidence) {
    return {
      positionSizeUsd: 0,
      positionSizePct: 0,
      stopLossPct: 0,
      takeProfitPct: 0,
      riskRewardRatio: 0,
      reasoning: `Confidence ${confidence} below threshold ${minConfidence}`,
    };
  }

  let positionPct = maxPositionPct * (confidence / 10);

  if (consensus === "DISAGREE") positionPct *= consensusAdjustment;
  else if (consensus === "SPLIT") positionPct *= 0.75;

  if (riskMode === "warn") positionPct *= 0.75;

  const positionSizeUsd = capitalUsd * positionPct;
  const stopLossPct = baseStopPct + (0.01 * (10 - confidence)) / 10;
  const takeProfitPct = stopLossPct * rrRatio;

  return {
    positionSizeUsd: Math.round(positionSizeUsd * 100) / 100,
    positionSizePct: Math.round(positionPct * 10000) / 10000,
    stopLossPct: Math.round(stopLossPct * 10000) / 10000,
    takeProfitPct: Math.round(takeProfitPct * 10000) / 10000,
    riskRewardRatio: rrRatio,
    reasoning: `Size ${(positionPct * 100).toFixed(2)}% @ conf ${confidence}/10, stop ${(stopLossPct * 100).toFixed(2)}%, target ${(takeProfitPct * 100).toFixed(2)}%`,
  };
}

// Kelly Criterion: f = (p*b - q) / b
// Use fractional Kelly (25%) for safety
export function kellyFraction(confidence: number, rrRatio: number = 2.5): number {
  const p = confidence / 10;
  const q = 1 - p;
  const kelly = (p * rrRatio - q) / rrRatio;
  return Math.max(0, Math.min(kelly * 0.25, 0.1));
}
