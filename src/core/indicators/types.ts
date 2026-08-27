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
    long: number; // Entry - (ATR * multiplier)
    short: number; // Entry + (ATR * multiplier)
    distance: number; // ATR * multiplier
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

// Fibonacci Types
export interface FibonacciLevel {
  ratio: number;
  price: number;
  label: string;
  isSupport: boolean;
  isResistance: boolean;
}

export interface FibonacciResult {
  swingHigh: number | null;
  swingLow: number | null;
  levels: FibonacciLevel[];
  trend: "uptrend" | "downtrend" | "neutral";
  nearestLevel: FibonacciLevel | null;
  interpretation: string;
}

// Volume Profile Types
export interface ProfileBin {
  priceLevel: number;
  volume: number;
  buyVolume: number;
  sellVolume: number;
  percentage: number;
}

export interface VolumeProfileResult {
  poc: number | null;
  valueAreaHigh: number | null;
  valueAreaLow: number | null;
  profileBins: ProfileBin[];
  pricePosition: "above_va" | "in_va" | "below_va";
  interpretation: string;
}

// Kalman Filter Types
export interface KalmanFilterResult {
  values: number[];
  current: number | null;
  slope: number | null;
  deviation: number | null;
  trend: "bullish" | "bearish" | "neutral";
  overextended: boolean;
  interpretation: string;
}

// Nadaraya-Watson Envelope Types
export interface NadarayaWatsonResult {
  values: number[];
  upperBand: number[];
  lowerBand: number[];
  current: number | null;
  currentUpper: number | null;
  currentLower: number | null;
  position: "above_upper" | "upper_zone" | "middle" | "lower_zone" | "below_lower";
  trend: "bullish" | "bearish" | "neutral";
  envelopeWidth: number | null;
  interpretation: string;
}

// Camarilla Pivot Types
export interface CamarillaLevel {
  label: string;
  price: number;
  type: "support" | "resistance";
  role: "reversal" | "breakout" | "intermediate";
}

export interface CamarillaPivotResult {
  levels: CamarillaLevel[];
  prevHigh: number;
  prevLow: number;
  prevClose: number;
  priceZone: string;
  nearestLevel: CamarillaLevel | null;
  signal: "long_reversal" | "short_reversal" | "long_breakout" | "short_breakout" | "neutral";
  interpretation: string;
}

// Markov Chain Regime Types
export interface MarkovRegimeResult {
  regime: number;
  regimeLabel: "bull" | "neutral" | "bear";
  zScore: number | null;
  transitionMatrix: number[][];
  probToBull: number;
  probStaySame: number;
  probToBear: number;
  confidence: number;
  transition: boolean;
  prevRegime: "bull" | "neutral" | "bear";
  interpretation: string;
}

// Supertrend Types
export interface SupertrendResult {
  values: number[];
  direction: number[];
  current: number | null;
  currentDirection: 1 | -1;
  trendChange: boolean;
  signal: "buy" | "sell" | "hold";
  distance: number | null;
  interpretation: string;
}

// WaveTrend Oscillator Types
export interface WaveTrendResult {
  wt1: number[];
  wt2: number[];
  currentWT1: number | null;
  currentWT2: number | null;
  zone: "overbought" | "oversold" | "neutral";
  crossover: "bullish_cross" | "bearish_cross" | "none";
  momentum: "rising" | "falling" | "flat";
  cmf: number | null;
  cmfBias: "bullish" | "bearish" | "neutral";
  interpretation: string;
}

// Ichimoku Cloud Types
export interface IchimokuResult {
  tenkan: number | null;
  kijun: number | null;
  senkouA: number | null;
  senkouB: number | null;
  chikou: number | null;
  cloudTop: number | null;
  cloudBottom: number | null;
  cloudColor: "bullish" | "bearish" | "neutral";
  pricePosition: "above_cloud" | "in_cloud" | "below_cloud";
  tkCross: "bullish_cross" | "bearish_cross" | "none";
  signal: "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell";
  interpretation: string;
}

// FlowScope Types
export type { FlowScopeBin, FlowScopeResult } from "./flowscope.ts";

// Angled Market Structure Types
export type { PivotLine, AMSResult } from "./angled-market-structure.ts";

// Elliott Wave Types
export type { ZigzagPoint, WaveLabel, ElliottWaveResult } from "./elliott-wave.ts";

// False Breakout Types
export type { SRLevel, FalseBreakoutResult } from "./false-breakout.ts";

// ADX Types
export type { ADXResult } from "./adx.ts";

// MFI Types
export type { MFIResult } from "./mfi.ts";

// Divergence Types
export type { DivergenceSignal, DivergenceResult } from "./divergence.ts";

// Supply/Demand Zone Types
export type { SDZone, SDZResult } from "./supply-demand-zones.ts";

// Squeeze Momentum Types
export type { SqueezeMomentumResult } from "./squeeze-momentum.ts";

// Order Block Types
export type { OrderBlock, OrderBlockResult } from "./order-blocks.ts";

// Fair Value Gap Types
export type { FVGap, FVGResult } from "./fvg.ts";

// Parabolic SAR Types
export type { ParabolicSARResult } from "./parabolic-sar.ts";

// Volume Price Trend Types
export type { VPTResult } from "./vpt.ts";

// Awesome Oscillator Types
export type { AOResult } from "./awesome-oscillator.ts";

// Three Mountains & Rivers Types
export type { TMRPattern, TMRResult } from "./three-mountains-rivers.ts";

// Delta Ladder Types
export type { DeltaLevel, DeltaLadderResult } from "./delta-ladder.ts";
