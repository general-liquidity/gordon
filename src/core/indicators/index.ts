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
export { calculateVWAP, calculateVWAPBands, calculateRollingVWAP, calculateAnchoredVWAP } from "./vwap.ts";
export type { RollingVWAPResult, AnchoredVWAPResult } from "./vwap.ts";
export { calculateGMMA } from "./gmma.ts";
export type { GmmaResult } from "./gmma.ts";
export { calculateTSI } from "./tsi.ts";
export type { TSIResult } from "./tsi.ts";

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

// Hull Moving Average (+ Hull Suite variants: EHMA, THMA)
export { calculateHMA, calculateEHMA, calculateTHMA } from "./hull-ma.ts";
// Leledc exhaustion bars → S/R levels
export { computeLeledcExhaustion } from "./leledc-exhaustion.ts";

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

// Michael Harris DAX 4-bar overlapping-extension pattern
export { calculateHarrisPattern } from "./harris-pattern.ts";
export type { HarrisPatternResult } from "./harris-pattern.ts";

// Classic price-based Stochastic Oscillator (%K/%D)
export { calculateStochastic } from "./stochastic.ts";
export type { StochasticResult } from "./stochastic.ts";

// Chaikin Money Flow (standalone)
export { calculateCMF } from "./cmf.ts";
export type { CMFResult } from "./cmf.ts";

// RSI failure swing (Welles Wilder — pivot pattern on the RSI line; distinct from divergence)
export { calculateRsiFailureSwing } from "./rsi-failure-swing.ts";
export type { RsiFailureSwingResult } from "./rsi-failure-swing.ts";

// RSI 50-midpoint regime suite (bias / dynamic S-R / consolidation-chop)
export { calculateRsiMidpoint } from "./rsi-midpoint.ts";
export type { RsiMidpointResult } from "./rsi-midpoint.ts";

// Hidden divergence (continuation counterpart to regular RSI divergence)
export { calculateHiddenDivergence } from "./hidden-divergence.ts";
export type { HiddenDivergenceSignal, HiddenDivergenceResult } from "./hidden-divergence.ts";

// Ichimoku discrete signals (edge-to-edge / kijun bounce+cross / kumo twist / TK disequilibrium — complements ichimoku.ts)
export { calculateIchimokuSignals } from "./ichimoku-signals.ts";
export type { IchimokuSignalsResult } from "./ichimoku-signals.ts";

// RSI trendlines (AMS-style pivot trendlines + breaks on the RSI series)
export { calculateRsiTrendline } from "./rsi-trendline.ts";
export type { RsiTrendlineResult } from "./rsi-trendline.ts";

// Session-open pivot + wickless candle-open drive (mean-reversion-to-open)
export { calculateOpenPivot } from "./open-pivot.ts";
export type { OpenPivotResult } from "./open-pivot.ts";

// Market intraday momentum (Gao-Han-Li-Zhou JFE 2018 — first-window return predicts last-window return)
export { calculateIntradayMomentum } from "./intraday-momentum.ts";
export type { IntradayMomentumResult } from "./intraday-momentum.ts";

// Displacement-validated break of structure (break leg must be ≥ minRatio × the prior swing leg)
export { calculateDisplacementBreak } from "./displacement-break.ts";
export type { DisplacementBreakResult } from "./displacement-break.ts";

// Candle Continuity Theory (next-candle bias from the prior↔current two-candle relationship)
export { calculateCandleContinuity } from "./candle-continuity.ts";
export type { CandleContinuityResult } from "./candle-continuity.ts";

// VPIN — Volume-Synchronized Probability of Informed Trading (order-flow toxicity; Easley-López de Prado-O'Hara 2012)
export { calculateVpin } from "./vpin.ts";
export type { VpinResult } from "./vpin.ts";

// Volume Imbalance (ICT — 2-candle body gap with overlapping ranges; distinct from the 3-candle FVG)
export { calculateVolumeImbalance } from "./volume-imbalance.ts";
export type { VolumeImbalance, VolumeImbalanceResult } from "./volume-imbalance.ts";

// Breaker Block (ICT — failed/flipped order block confirming a market-structure shift)
export { calculateBreakerBlock } from "./breaker-block.ts";
export type { BreakerBlockResult } from "./breaker-block.ts";

// Structure-Break Conviction (two-breaker-structure / MSS-trap filter)
export { calculateStructureBreakConviction } from "./structure-break-conviction.ts";
export type { StructureBreakConvictionResult } from "./structure-break-conviction.ts";
export { calculateRsrs } from "./rsrs.ts";
export type { RsrsResult } from "./rsrs.ts";

// FVG Sweep Context (grades fair-value gaps by pre-sweep vs post-sweep quality)
export { calculateFvgSweepContext } from "./fvg-sweep-context.ts";
export type { FvgSweepContextResult, ClassifiedFvg, FvgQuality } from "./fvg-sweep-context.ts";

// AFML feature primitives (López de Prado, via mlfinlab parity scan)
export { calculateFracDiff } from "./frac-diff.ts";
export type { FracDiffResult } from "./frac-diff.ts";
export { calculateCusumFilter } from "./cusum-filter.ts";
export type { CusumFilterResult } from "./cusum-filter.ts";
export { calculateSadf } from "./sadf.ts";
export type { SadfResult } from "./sadf.ts";
export { calculateRollSpread } from "./roll-spread.ts";
export type { RollSpreadResult } from "./roll-spread.ts";
export { calculateAmihud } from "./amihud-illiquidity.ts";
export type { AmihudResult } from "./amihud-illiquidity.ts";
