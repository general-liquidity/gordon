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

// FlowScope (Buy/Sell Volume Profile)
export { calculateFlowScope } from "./flowscope.ts";
export type { FlowScopeBin, FlowScopeResult } from "./flowscope.ts";

// Angled Market Structure
export { calculateAMS } from "./angled-market-structure.ts";
export type { PivotLine, AMSResult } from "./angled-market-structure.ts";

// Elliott Wave Detection
export { calculateElliottWave } from "./elliott-wave.ts";
export type { ZigzagPoint, WaveLabel, ElliottWaveResult } from "./elliott-wave.ts";

// False Breakout Reversal
export { calculateFalseBreakout } from "./false-breakout.ts";
export type { SRLevel, FalseBreakoutResult } from "./false-breakout.ts";

// ADX (Average Directional Index)
export { calculateADX } from "./adx.ts";
export type { ADXResult } from "./adx.ts";

// MFI (Money Flow Index)
export { calculateMFI } from "./mfi.ts";
export type { MFIResult } from "./mfi.ts";

// Divergence Detection
export { calculateDivergence } from "./divergence.ts";
export type { DivergenceSignal, DivergenceResult } from "./divergence.ts";

// Supply/Demand Zones
export { calculateSupplyDemandZones } from "./supply-demand-zones.ts";
export type { SDZone, SDZResult } from "./supply-demand-zones.ts";

// Squeeze Momentum
export { calculateSqueezeMomentum } from "./squeeze-momentum.ts";
export type { SqueezeMomentumResult } from "./squeeze-momentum.ts";

// Order Blocks
export { calculateOrderBlocks } from "./order-blocks.ts";
export type { OrderBlock, OrderBlockResult } from "./order-blocks.ts";

// Fair Value Gaps
export { calculateFVG } from "./fvg.ts";
export type { FVGap, FVGResult } from "./fvg.ts";

// Parabolic SAR
export { calculateParabolicSAR } from "./parabolic-sar.ts";
export type { ParabolicSARResult } from "./parabolic-sar.ts";

// Volume Price Trend
export { calculateVPT } from "./vpt.ts";
export type { VPTResult } from "./vpt.ts";

// Awesome Oscillator
export { calculateAO } from "./awesome-oscillator.ts";
export type { AOResult } from "./awesome-oscillator.ts";

// Three Mountains & Rivers
export { calculateThreeMountainsRivers } from "./three-mountains-rivers.ts";
export type { TMRPattern, TMRResult } from "./three-mountains-rivers.ts";

// Delta Ladder
export { calculateDeltaLadder } from "./delta-ladder.ts";
export type { DeltaLevel, DeltaLadderResult } from "./delta-ladder.ts";

// Tight Consolidation (bull-flag / pennant / wedge)
export { calculateTightConsolidation } from "./tight-consolidation.ts";
export type { TightConsolidationResult, TightConsolidationParams } from "./tight-consolidation.ts";

// Undercut-and-Rally
export { calculateUndercutRally } from "./undercut-rally.ts";
export type { UndercutRallyResult, UndercutRallyParams } from "./undercut-rally.ts";
