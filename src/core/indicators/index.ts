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

// LMW geometric chart patterns (kernel-extrema HS/triangle/rectangle/double)
export { detectLmwPatterns, detectLmwPatternsFromCandles } from "./lmw-patterns.ts";
export type { LmwPattern, PatternMatch, LmwPatternResult } from "./lmw-patterns.ts";

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

// Trim-state — coach for the momentum-swing trim ladder (8/21/50 EMA trail)
export { calculateTrimState } from "./trim-state.ts";
export type { TrimStateResult, TrimStateParams } from "./trim-state.ts";

// Resistance-tests — count how many times a level has rejected price
export { calculateResistanceTests } from "./resistance-tests.ts";
export type { ResistanceTestsResult, ResistanceTestsParams } from "./resistance-tests.ts";

// Candlestick patterns — 12 canonical 1/2/3-bar shapes
export {
  detectCandlestickPatterns,
  ALL_CANDLESTICK_PATTERNS,
} from "./candlestick-patterns.ts";
export type {
  CandlestickPatternName,
  CandlestickMatch,
  CandlestickPatternsResult,
  CandlestickPatternsParams,
} from "./candlestick-patterns.ts";

// Linear regression — least-squares fit (single + rolling)
export { linearRegression, rollingLinearRegression } from "./linearRegression.ts";
export type {
  LinearRegressionResult,
  RollingLinearRegressionResult,
} from "./linearRegression.ts";

// Standard Error Bands — regression centerline + ± k × SE
export { calculateStandardErrorBands } from "./standardErrorBands.ts";
export type {
  StandardErrorBandsResult,
  StandardErrorBandsParams,
  SebTrendVerdict,
} from "./standardErrorBands.ts";

// Highest Volume Ever — institutional-urgency volume-record detector
export { calculateHighestVolumeEver } from "./highestVolumeEver.ts";
export type {
  HighestVolumeEverResult,
  HighestVolumeEverParams,
} from "./highestVolumeEver.ts";

// CCI (Commodity Channel Index)
export { calculateCCI } from "./cci.ts";
export type { CCIResult } from "./cci.ts";

// Williams %R
export { calculateWilliamsR } from "./williams-r.ts";
export type { WilliamsRResult } from "./williams-r.ts";

// Ultimate Oscillator
export { calculateUltimateOscillator } from "./ultimate-oscillator.ts";
export type { UltimateOscResult } from "./ultimate-oscillator.ts";

// Aroon + Aroon Oscillator
export { calculateAroon } from "./aroon.ts";
export type { AroonResult } from "./aroon.ts";

// ADXR (ADX Rating)
export { calculateADXR } from "./adxr.ts";
export type { ADXRResult } from "./adxr.ts";

// NATR (Normalized ATR)
export { calculateNATR } from "./natr.ts";
export type { NATRResult } from "./natr.ts";

// CMO (Chande Momentum Oscillator)
export { calculateCMO } from "./cmo.ts";
export type { CMOResult } from "./cmo.ts";

// APO / PPO (Absolute / Percentage Price Oscillator)
export { calculateAPO, calculatePPO } from "./price-oscillator.ts";
export type { PriceOscResult } from "./price-oscillator.ts";

// Chaikin A/D line + Chaikin Oscillator
export { calculateChaikinAD, calculateChaikinOscillator } from "./chaikin.ts";
export type { ChaikinADResult, ChaikinOscResult } from "./chaikin.ts";

// Moving-average family: WMA / DEMA / TEMA / TRIMA
export {
  calculateWMA,
  calculateDEMA,
  calculateTEMA,
  calculateTRIMA,
} from "./moving-averages.ts";

// Information-driven bars (volume / dollar / tick)
export {
  buildInformationBars,
  buildInformationBarsFromOHLCV,
} from "./information-bars.ts";
export type {
  Tick,
  InformationBar,
  InformationBarKind,
  InformationBarsResult,
  OHLCVInput,
} from "./information-bars.ts";

// Volume-signature suite (Morales-Kacher / CAN SLIM pocket-pivot family)
export { calculateVolumeSignature } from "./volume-signature.ts";
export type {
  VolumeSignatureParams,
  VolumeSignatureResult,
  VolumeSignatureLatest,
} from "./volume-signature.ts";

// Donchian Channel
export { calculateDonchian } from "./donchian.ts";
export type { DonchianResult } from "./donchian.ts";

// Hull Moving Average
export { calculateHMA } from "./hull-ma.ts";

// Volume-Weighted Moving Average
export { calculateVWMA } from "./vwma.ts";

// Momentum + Rate of Change
export { calculateMomentum, calculateROC } from "./momentum-roc.ts";

// Supertrend channel envelope
export { calculateSupertrendChannel } from "./supertrend-channel.ts";
export type { SupertrendChannelResult } from "./supertrend-channel.ts";

// CBOE volume-weighted bull/bear/stagnant odds oscillator
export { calculateCboeOdds } from "./cboe-odds-oscillator.ts";
export type { CboeOddsResult } from "./cboe-odds-oscillator.ts";
