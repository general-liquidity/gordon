/**
 * Technical Indicator Types
 */

export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  openTime?: number;
  closeTime?: number;
}

// RSI Types
export interface RSIResult {
  values: (number | null)[];
  current: number | null;
  signal: "oversold" | "neutral" | "overbought";
  action: "potential_buy" | "hold" | "potential_sell";
  period: number;
}

// EMA Types
export interface EMAResult {
  values: (number | null)[];
  current: number | null;
  period: number;
}

export interface MultiEMAResult {
  ema9: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  alignment: "bullish" | "bearish" | "mixed";
  pricePosition: "above_all" | "below_all" | "mixed";
  interpretation: string;
}

// MACD Types
export interface MACDResult {
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
  current: {
    macd: number | null;
    signal: number | null;
    histogram: number | null;
  };
  trend: "bullish" | "bearish" | "neutral";
  crossover: "bullish_cross" | "bearish_cross" | "none";
  interpretation: string;
}

// ATR Types
export interface ATRResult {
  values: (number | null)[];
  current: number | null;
  period: number;
  stopLoss: {
    long: number;      // Entry - (ATR * multiplier)
    short: number;     // Entry + (ATR * multiplier)
    distance: number;  // ATR * multiplier
  };
  interpretation: string;
}

// Bollinger Bands Types
export interface BollingerResult {
  upper: (number | null)[];
  middle: (number | null)[];
  lower: (number | null)[];
  bandwidth: (number | null)[];
  current: {
    upper: number | null;
    middle: number | null;
    lower: number | null;
    bandwidth: number | null;
  };
  position: "above_upper" | "upper" | "middle" | "lower" | "below_lower";
  squeeze: boolean;
  interpretation: string;
}

// Composite Technical Analysis
export interface TechnicalAnalysis {
  symbol: string;
  interval: string;
  timestamp: number;

  rsi: RSIResult;
  ema: MultiEMAResult;
  macd: MACDResult;
  atr: ATRResult;
  bollinger: BollingerResult;

  // Composite signals
  bias: "strongly_bullish" | "bullish" | "neutral" | "bearish" | "strongly_bearish";
  confidence: "high" | "medium" | "low";
  summary: string;

  // Actionable signals
  signals: {
    type: "buy" | "sell" | "hold";
    reasons: string[];
  };
}

// Quick signals for scanner
export interface TechnicalSignals {
  symbol: string;
  rsiSignal: "oversold" | "neutral" | "overbought";
  rsiValue: number | null;
  trendAlignment: "bullish" | "bearish" | "mixed";
  macdTrend: "bullish" | "bearish" | "neutral";
  priceVsEma200: "above" | "below";
  bollingerPosition: string;
  overallBias: "bullish" | "bearish" | "neutral";
  score: number; // -100 to +100
}

// VWAP Types
export interface VWAPResult {
  values: (number | null)[];
  current: number | null;
  pricePosition: "above" | "below" | "at";
  deviation: number | null;
  interpretation: string;
}

// Stochastic RSI Types
export interface StochasticRSIResult {
  k: (number | null)[];
  d: (number | null)[];
  currentK: number | null;
  currentD: number | null;
  signal: "oversold" | "neutral" | "overbought";
  crossover: "bullish_cross" | "bearish_cross" | "none";
  action: "potential_buy" | "hold" | "potential_sell";
  interpretation: string;
}
