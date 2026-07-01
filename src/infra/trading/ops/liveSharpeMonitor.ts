/**
 * Live-Sharpe degradation monitor triad (A4, GORDON_LIVE_SHARPE_MONITOR).
 *
 * A strategy that backtested well can quietly rot in production. This is the
 * triad that routes that rot to a human gate BEFORE the drawdown does it for
 * you:
 *
 *   (a) Sharpe degradation — the realized live Sharpe z-scored against the
 *       backtest Sharpe (Lo 2002 asymptotic SE). A materially-negative z means
 *       live is underperforming its own backtest beyond sampling noise.
 *   (b) Signal health — is the strategy still trading like itself? Trade
 *       frequency and the long/short/flat mix vs the expected profile. A
 *       strategy that stops taking shorts, or fires 3x as often, has drifted.
 *   (c) Data health — are the inputs fresh and complete? Staleness, missing
 *       fraction, and an upstream input-drift score (e.g. PSI).
 *
 * Any leg breaching escalates to {@link LiveSharpeStatus} `HUMAN_REVIEW`.
 *
 * This COMPOSES with, and does not duplicate, the two shipped monitors:
 *   - `tui/services/evals/modelDriftMonitor` tracks rolling prediction accuracy
 *     + rolling Sharpe sign for a HALT/CAUTION — no backtest reference, no
 *     signal-distribution or data-freshness legs.
 *   - `infra/trading/ops/edgeDecayMonitor` tracks per-setup expectancy RATIO vs
 *     an earlier baseline window — a within-live decay signal, not a
 *     live-vs-backtest comparison.
 * A4 is specifically: is live diverging from the BACKTEST, and are the signal +
 * data pipelines still healthy? Pure; injected; never throws.
 */

export const LIVE_SHARPE_FLAG_ENV = "GORDON_LIVE_SHARPE_MONITOR";

export function isLiveSharpeMonitorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[LIVE_SHARPE_FLAG_ENV] === "1" || env[LIVE_SHARPE_FLAG_ENV] === "true";
}

export type LiveSharpeStatus = "HEALTHY" | "WATCH" | "HUMAN_REVIEW" | "WARMING_UP";

export interface SignalHealthInput {
  /** Observed trade-direction counts over the window. */
  observed: { long: number; short: number; flat: number };
  /** Expected direction fractions (each 0..1, should sum ~1). */
  expected: { long: number; short: number; flat: number };
  /** Observed vs expected trade frequency (trades per period), optional. */
  observedTradesPerPeriod?: number;
  expectedTradesPerPeriod?: number;
  /** Max acceptable absolute deviation in any distribution bucket. Default 0.25. */
  maxDistributionDrift?: number;
  /** Max acceptable relative deviation in trade frequency. Default 0.5. */
  maxFrequencyDrift?: number;
}

export interface DataHealthInput {
  /** Age of the freshest input bar in ms. */
  lastBarAgeMs?: number;
  /** Max acceptable staleness in ms. Default 15 minutes. */
  maxStalenessMs?: number;
  /** Fraction of inputs missing/NaN this window (0..1). */
  missingFraction?: number;
  /** Max acceptable missing fraction. Default 0.1. */
  maxMissingFraction?: number;
  /** Upstream input feature-drift score (e.g. PSI). */
  inputDriftScore?: number;
  /** Threshold above which input drift flags. Default 0.2 (PSI "moderate"). */
  maxInputDrift?: number;
}

export interface LiveSharpeInput {
  strategyId: string;
  /** Backtest (reference) annualized Sharpe. */
  backtestSharpe: number;
  /** Realized per-period returns, most-recent last. */
  liveReturns: ReadonlyArray<number>;
  /** Periods per year for annualization (e.g. 252 daily). Default 252. */
  periodsPerYear?: number;
  /** Minimum live samples before scoring. Default 20. */
  minSamples?: number;
  /** Z magnitude beyond which Sharpe degradation flags HUMAN_REVIEW. Default 2. */
  degradationZ?: number;
  /** Optional signal-health leg. Omitted -> assumed healthy. */
  signal?: SignalHealthInput;
  /** Optional data-health leg. Omitted -> assumed healthy. */
  data?: DataHealthInput;
}

export interface LiveSharpeReport {
  strategyId: string;
  status: LiveSharpeStatus;
  /** Realized live annualized Sharpe. */
  liveSharpe: number;
  backtestSharpe: number;
  /** Live-vs-backtest Sharpe z-score (negative = live below backtest). */
  sharpeZScore: number;
  sharpeDegraded: boolean;
  signalHealthy: boolean;
  dataHealthy: boolean;
  sampleSize: number;
  action: string;
  reasons: string[];
}

const DEFAULT_PPY = 252;
const DEFAULT_MIN_SAMPLES = 20;
const DEFAULT_DEGRADATION_Z = 2;
const DEFAULT_MAX_DIST_DRIFT = 0.25;
const DEFAULT_MAX_FREQ_DRIFT = 0.5;
const DEFAULT_MAX_STALENESS_MS = 15 * 60 * 1000;
const DEFAULT_MAX_MISSING = 0.1;
const DEFAULT_MAX_INPUT_DRIFT = 0.2;

function mean(xs: ReadonlyArray<number>): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function sampleStd(xs: ReadonlyArray<number>): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let ss = 0;
  for (const x of xs) ss += (x - m) ** 2;
  return Math.sqrt(ss / (xs.length - 1));
}

/** Lo (2002) asymptotic standard error of a per-period Sharpe ratio. */
function sharpeStdError(perPeriodSharpe: number, n: number): number {
  if (n <= 0) return Infinity;
  return Math.sqrt((1 + 0.5 * perPeriodSharpe * perPeriodSharpe) / n);
}

interface SignalEval {
  healthy: boolean;
  reasons: string[];
}

function evaluateSignalHealth(input: SignalHealthInput): SignalEval {
  const reasons: string[] = [];
  const maxDist = input.maxDistributionDrift ?? DEFAULT_MAX_DIST_DRIFT;
  const maxFreq = input.maxFrequencyDrift ?? DEFAULT_MAX_FREQ_DRIFT;

  const total = input.observed.long + input.observed.short + input.observed.flat;
  if (total > 0) {
    const obs = {
      long: input.observed.long / total,
      short: input.observed.short / total,
      flat: input.observed.flat / total,
    };
    const drifts = [
      Math.abs(obs.long - input.expected.long),
      Math.abs(obs.short - input.expected.short),
      Math.abs(obs.flat - input.expected.flat),
    ];
    const worst = Math.max(...drifts);
    if (worst > maxDist) {
      reasons.push(
        `direction mix drift ${(worst * 100).toFixed(0)}% exceeds ${(maxDist * 100).toFixed(0)}% ` +
          `(long ${(obs.long * 100).toFixed(0)}% short ${(obs.short * 100).toFixed(0)}% flat ${(obs.flat * 100).toFixed(0)}%)`,
      );
    }
  }

  if (
    input.observedTradesPerPeriod !== undefined &&
    input.expectedTradesPerPeriod !== undefined &&
    input.expectedTradesPerPeriod > 0
  ) {
    const freqDrift =
      Math.abs(input.observedTradesPerPeriod - input.expectedTradesPerPeriod) /
      input.expectedTradesPerPeriod;
    if (freqDrift > maxFreq) {
      reasons.push(
        `trade frequency ${input.observedTradesPerPeriod.toFixed(2)}/period drifted ` +
          `${(freqDrift * 100).toFixed(0)}% from expected ${input.expectedTradesPerPeriod.toFixed(2)}`,
      );
    }
  }

  return { healthy: reasons.length === 0, reasons };
}

function evaluateDataHealth(input: DataHealthInput): SignalEval {
  const reasons: string[] = [];
  const maxStale = input.maxStalenessMs ?? DEFAULT_MAX_STALENESS_MS;
  const maxMissing = input.maxMissingFraction ?? DEFAULT_MAX_MISSING;
  const maxDrift = input.maxInputDrift ?? DEFAULT_MAX_INPUT_DRIFT;

  if (input.lastBarAgeMs !== undefined && input.lastBarAgeMs > maxStale) {
    reasons.push(
      `input stale by ${(input.lastBarAgeMs / 1000).toFixed(0)}s (max ${(maxStale / 1000).toFixed(0)}s)`,
    );
  }
  if (input.missingFraction !== undefined && input.missingFraction > maxMissing) {
    reasons.push(
      `missing inputs ${(input.missingFraction * 100).toFixed(0)}% exceed ${(maxMissing * 100).toFixed(0)}%`,
    );
  }
  if (input.inputDriftScore !== undefined && input.inputDriftScore > maxDrift) {
    reasons.push(
      `input drift ${input.inputDriftScore.toFixed(2)} exceeds ${maxDrift.toFixed(2)}`,
    );
  }

  return { healthy: reasons.length === 0, reasons };
}

/**
 * Evaluate the live-Sharpe degradation triad for a strategy. Returns a
 * `HUMAN_REVIEW` status when any leg breaches, `WATCH` on mild Sharpe
 * underperformance, `HEALTHY` otherwise (or `WARMING_UP` under min samples).
 */
export function evaluateLiveSharpe(input: LiveSharpeInput): LiveSharpeReport {
  const ppy = input.periodsPerYear ?? DEFAULT_PPY;
  const minSamples = input.minSamples ?? DEFAULT_MIN_SAMPLES;
  const degradationZ = input.degradationZ ?? DEFAULT_DEGRADATION_Z;
  const n = input.liveReturns.length;

  const annualize = Math.sqrt(ppy);
  const btPerPeriod = input.backtestSharpe / annualize;

  if (n < minSamples) {
    return {
      strategyId: input.strategyId,
      status: "WARMING_UP",
      liveSharpe: 0,
      backtestSharpe: input.backtestSharpe,
      sharpeZScore: 0,
      sharpeDegraded: false,
      signalHealthy: true,
      dataHealthy: true,
      sampleSize: n,
      action: `Collecting live data (${n}/${minSamples})`,
      reasons: [],
    };
  }

  const liveMean = mean(input.liveReturns);
  const liveStd = sampleStd(input.liveReturns);
  const livePerPeriod = liveStd > 0 ? liveMean / liveStd : 0;
  const liveSharpe = livePerPeriod * annualize;

  const se = sharpeStdError(btPerPeriod, n);
  const sharpeZScore = se > 0 && Number.isFinite(se) ? (livePerPeriod - btPerPeriod) / se : 0;
  const sharpeDegraded = sharpeZScore <= -degradationZ;

  const signalEval = input.signal
    ? evaluateSignalHealth(input.signal)
    : { healthy: true, reasons: [] };
  const dataEval = input.data
    ? evaluateDataHealth(input.data)
    : { healthy: true, reasons: [] };

  const reasons: string[] = [];
  if (sharpeDegraded) {
    reasons.push(
      `live Sharpe ${liveSharpe.toFixed(2)} vs backtest ${input.backtestSharpe.toFixed(2)} ` +
        `(z ${sharpeZScore.toFixed(2)} <= -${degradationZ})`,
    );
  }
  reasons.push(...signalEval.reasons, ...dataEval.reasons);

  let status: LiveSharpeStatus;
  let action: string;
  if (sharpeDegraded || !signalEval.healthy || !dataEval.healthy) {
    status = "HUMAN_REVIEW";
    action = "Escalate to human review; pause autonomous execution for this strategy.";
  } else if (sharpeZScore <= -1) {
    status = "WATCH";
    action = "Live Sharpe drifting below backtest; monitor and reduce size on further slippage.";
  } else {
    status = "HEALTHY";
    action = "Live performance tracking backtest; continue.";
  }

  return {
    strategyId: input.strategyId,
    status,
    liveSharpe,
    backtestSharpe: input.backtestSharpe,
    sharpeZScore,
    sharpeDegraded,
    signalHealthy: signalEval.healthy,
    dataHealthy: dataEval.healthy,
    sampleSize: n,
    action,
    reasons,
  };
}

export function liveSharpeToPayload(report: LiveSharpeReport): Record<string, unknown> {
  return {
    kind: "live_sharpe.evaluated",
    strategyId: report.strategyId,
    status: report.status,
    liveSharpe: Number(report.liveSharpe.toFixed(3)),
    backtestSharpe: Number(report.backtestSharpe.toFixed(3)),
    sharpeZScore: Number(report.sharpeZScore.toFixed(3)),
    sharpeDegraded: report.sharpeDegraded,
    signalHealthy: report.signalHealthy,
    dataHealthy: report.dataHealthy,
    sampleSize: report.sampleSize,
  };
}

/** True when the triad recommends a human gate. */
export function requiresHumanReview(report: LiveSharpeReport): boolean {
  return report.status === "HUMAN_REVIEW";
}
