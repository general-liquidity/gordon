/**
 * Technical Indicators Module
 * Core indicator calculations for trading analysis
 */

// Type exports
export type {
  Candle,
  RSIResult,
  EMAResult,
  MultiEMAResult,
  MACDResult,
  ATRResult,
  BollingerResult,
  TechnicalAnalysis,
  TechnicalSignals,
  VWAPResult,
  StochasticRSIResult,
  FibonacciLevel,
  FibonacciResult,
  ProfileBin,
  VolumeProfileResult,
  KalmanFilterResult,
  NadarayaWatsonResult,
  CamarillaLevel,
  CamarillaPivotResult,
  MarkovRegimeResult,
  SupertrendResult,
  WaveTrendResult,
  IchimokuResult,
} from "./types.ts";

// RSI
export { calculateRSI, interpretRSI } from "./rsi.ts";

// EMA/SMA
export { calculateEMA, calculateSMA, calculateMultiEMA } from "./ema.ts";

// MACD
export { calculateMACD } from "./macd.ts";

// ATR
export { calculateATR, calculatePositionSize } from "./atr.ts";

// Bollinger Bands
export { calculateBollingerBands } from "./bollinger.ts";

// Composite analysis
export {
  calculateTechnicalAnalysis,
  calculateTechnicalSignals,
  getBias,
} from "./analysis.ts";

// VWAP
export { calculateVWAP, calculateVWAPBands } from "./vwap.ts";

// Stochastic RSI
export { calculateStochasticRSI } from "./stochastic-rsi.ts";

// Fibonacci
export { calculateFibonacci, calculateFibonacciExtensions } from "./fibonacci.ts";

// Volume Profile
export { calculateVolumeProfile } from "./volume-profile.ts";

// Kalman Filter
export { calculateKalmanFilter } from "./kalman.ts";

// Nadaraya-Watson Envelope
export { calculateNadarayaWatson } from "./nadaraya-watson.ts";

// Camarilla Pivot Points
export { calculateCamarillaPivots } from "./camarilla.ts";

// Markov Chain Regime Detection
export { calculateMarkovRegime } from "./markov-regime.ts";

// Supertrend
export { calculateSupertrend } from "./supertrend.ts";

// WaveTrend Oscillator
export { calculateWaveTrend } from "./wavetrend.ts";

// Ichimoku Cloud
export { calculateIchimoku } from "./ichimoku.ts";
