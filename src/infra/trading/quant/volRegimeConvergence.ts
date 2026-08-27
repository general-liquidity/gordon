/**
 * Vol-Regime Convergence/Divergence Detector
 * (GORDON_VOL_REGIME_CONVERGENCE).
 *
 * Composes two independent regime signals — a volatility-state estimator
 * (Kalman vol, KF2) and a Markov state-transition model (markovRegime) —
 * and surfaces their agreement or disagreement as a first-class trading
 * signal.
 *
 * The two inputs look at fundamentally different information:
 *   - Kalman vol = surface property of one return series, derived from
 *     the autocorrelation of squared residuals. Captures "is volatility
 *     currently elevated relative to its history?"
 *   - Markov regime = structural property of the state-transition
 *     matrix over a (typically richer) state space. Captures "is the
 *     system likely to flip regimes next period?"
 *
 * When they agree, confidence in the joint signal is high. When they
 * disagree, the disagreement IS the signal — usually the regime model
 * is integrating cross-asset, breadth, or correlation information the
 * vol model cannot see.
 *
 * Four verdicts:
 *
 *   aligned_calm       — vol low + regime stable (bull or neutral)
 *                        → risk-on; vol-targeted sizing leans in
 *   aligned_storm      — vol high + regime flipping or bear
 *                        → high-confidence risk-off; cut aggressively
 *   regime_only        — vol calm but regime says flip imminent
 *                        → late-2007 pattern; de-risk BEFORE vol spikes
 *   surface_only       — vol spike but regime stable
 *                        → single-bar shock; OPEX flush or fat finger;
 *                          don't over-react, regime model wins
 *
 * Consumers: shadow chain (risk gate before order placement), regime
 * detector (composite override), proactive radar (volatility producer).
 */

import type { KalmanVolatilityResult } from "./kalmanVolatility.ts";
import type { MarkovRegimeResult, MarkovState } from "./markovRegime.ts";

export type ConvergenceVerdict =
  | "aligned_calm"
  | "aligned_storm"
  | "regime_only"
  | "surface_only"
  | "indeterminate";

export interface VolRegimeConvergenceInput {
  vol: KalmanVolatilityResult;
  regime: MarkovRegimeResult;
  /**
   * Quantile thresholds on the vol distribution.
   * High vol is when `currentAnnualVol` ≥ `meanAnnualVol + highSigmaMul × range/2`.
   * Low vol is when `currentAnnualVol` ≤ `meanAnnualVol − lowSigmaMul × range/2`.
   */
  highSigmaMul?: number;
  lowSigmaMul?: number;
  /**
   * Markov-confidence threshold above which the regime signal is treated
   * as load-bearing (else the regime evidence is weak and we don't lean
   * into the "regime_only" verdict). Default 0.55.
   */
  regimeConfidenceFloor?: number;
}

export interface VolRegimeConvergenceResult {
  verdict: ConvergenceVerdict;
  /** Vol classification used in the verdict logic. */
  volState: "high" | "neutral" | "low";
  /** Markov current + predicted state. */
  regimeCurrent: MarkovState;
  regimePredicted: MarkovState;
  /** Whether the regime model is signaling a probable flip. */
  regimeFlipping: boolean;
  /** Combined confidence: low when the two signals disagree. */
  jointConfidence: number;
  /** Suggested action for the shadow chain / sizer. */
  suggestedAction: "risk_on" | "risk_off" | "hold" | "investigate";
  reasoning: string;
}

const DEFAULT_HIGH_SIGMA = 0.5;
const DEFAULT_LOW_SIGMA = 0.5;
const DEFAULT_CONF_FLOOR = 0.55;

function classifyVol(
  current: number,
  mean: number,
  min: number,
  max: number,
  highMul: number,
  lowMul: number,
): "high" | "neutral" | "low" {
  if (!Number.isFinite(current) || !Number.isFinite(mean)) return "neutral";
  const halfRange = Math.max((max - min) / 2, 1e-9);
  if (current >= mean + highMul * halfRange) return "high";
  if (current <= mean - lowMul * halfRange) return "low";
  return "neutral";
}

function isRegimeFlipping(regime: MarkovRegimeResult, confFloor: number): boolean {
  if (regime.confidence < confFloor) return false;
  return regime.predictedNextState !== regime.currentState && regime.signal !== "stay";
}

function isStormState(state: MarkovState): boolean {
  return state === "bear";
}

function isCalmState(state: MarkovState): boolean {
  return state === "bull" || state === "neutral";
}

export function evaluateVolRegimeConvergence(
  input: VolRegimeConvergenceInput,
): VolRegimeConvergenceResult {
  const { vol, regime } = input;
  const highMul = input.highSigmaMul ?? DEFAULT_HIGH_SIGMA;
  const lowMul = input.lowSigmaMul ?? DEFAULT_LOW_SIGMA;
  const confFloor = input.regimeConfidenceFloor ?? DEFAULT_CONF_FLOOR;

  const volState = classifyVol(
    vol.currentAnnualVol,
    vol.meanAnnualVol,
    vol.minAnnualVol,
    vol.maxAnnualVol,
    highMul,
    lowMul,
  );
  const regimeFlipping = isRegimeFlipping(regime, confFloor);

  let verdict: ConvergenceVerdict;
  let suggestedAction: VolRegimeConvergenceResult["suggestedAction"];
  let reasoning: string;
  let jointConfidence: number;

  const volStorm = volState === "high";
  const volCalm = volState === "low" || volState === "neutral";
  const regimeStorm = regimeFlipping || isStormState(regime.currentState);
  const regimeCalm = !regimeFlipping && isCalmState(regime.currentState);

  if (volStorm && regimeStorm) {
    verdict = "aligned_storm";
    suggestedAction = "risk_off";
    jointConfidence = 0.5 + 0.5 * Math.min(1, regime.confidence);
    reasoning = `Vol elevated (${vol.currentAnnualVol.toFixed(3)} vs mean ${vol.meanAnnualVol.toFixed(3)}) and regime ${regime.currentState}${regimeFlipping ? `→${regime.predictedNextState}` : ""}; aligned risk-off`;
  } else if (volCalm && regimeCalm) {
    verdict = "aligned_calm";
    suggestedAction = "risk_on";
    jointConfidence = 0.5 + 0.5 * Math.min(1, regime.confidence);
    reasoning = `Vol contained (${vol.currentAnnualVol.toFixed(3)}) and regime ${regime.currentState} stable; aligned risk-on`;
  } else if (regimeStorm && !volStorm) {
    verdict = "regime_only";
    suggestedAction = "risk_off";
    jointConfidence = regime.confidence;
    reasoning = `Vol still calm (${vol.currentAnnualVol.toFixed(3)}) but regime ${regime.currentState}${regimeFlipping ? `→${regime.predictedNextState}` : ""}; structural shift not yet visible in returns — de-risk early`;
  } else if (volStorm && !regimeStorm) {
    verdict = "surface_only";
    suggestedAction = "investigate";
    jointConfidence = 0.5 - 0.3 * Math.min(1, regime.confidence);
    reasoning = `Vol spike (${vol.currentAnnualVol.toFixed(3)}) but regime ${regime.currentState} stable; likely single-bar shock — regime model says don't over-react`;
  } else {
    verdict = "indeterminate";
    suggestedAction = "hold";
    jointConfidence = 0.4;
    reasoning = `Vol ${volState}, regime ${regime.currentState}, signals neither agree nor disagree clearly`;
  }

  return {
    verdict,
    volState,
    regimeCurrent: regime.currentState,
    regimePredicted: regime.predictedNextState,
    regimeFlipping,
    jointConfidence,
    suggestedAction,
    reasoning,
  };
}

export function convergenceToPayload(result: VolRegimeConvergenceResult): Record<string, unknown> {
  return {
    kind: "vol_regime_convergence.evaluated",
    verdict: result.verdict,
    volState: result.volState,
    regimeCurrent: result.regimeCurrent,
    regimePredicted: result.regimePredicted,
    regimeFlipping: result.regimeFlipping,
    jointConfidence: Number(result.jointConfidence.toFixed(3)),
    suggestedAction: result.suggestedAction,
  };
}
