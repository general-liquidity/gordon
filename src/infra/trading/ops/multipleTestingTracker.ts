/**
 * Multiple-Testing Burden Tracker (GORDON_MULTIPLE_TESTING_TRACKER).
 *
 * The centerpiece insight from the AI-Quant article:
 *
 *   "Tested 10,000 strategies with zero edge → best in-sample Sharpe > 3.5
 *    by pure luck."
 *
 * Per-strategy Deflated Sharpe (`backtestCredibility.ts`) is necessary but
 * not sufficient: each invocation must know HOW MANY attempts preceded it.
 * Otherwise the same Sharpe at attempt #1 and attempt #10,000 look
 * identical, when in fact #10,000 has a vastly higher probability of being
 * lucky-noise.
 *
 * This tracker persists every attempt — pass or fail — to a JSONL log,
 * exposes the running count, and derives the expected-max-Sharpe under
 * the null for N trials. Pair with `deflatedSharpe()` to use the
 * dynamic threshold instead of a hard-coded `n_trials` constant.
 *
 * The module is per-strategy-family scoped (e.g. "momentum/equities"),
 * so testing 1000 momentum strategies does not inflate the bar for an
 * unrelated mean-reversion family. The scope is the caller's choice.
 *
 * Persistence at `~/.gordon/strategy-attempts.jsonl` (override via
 * `GORDON_ATTEMPTS_LOG_PATH`).
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { normalCdf } from "../../../core/numerics/index.ts";

export const ATTEMPTS_LOG_PATH_ENV = "GORDON_ATTEMPTS_LOG_PATH";

export type AttemptVerdict = "accepted" | "rejected" | "errored";

export interface StrategyAttempt {
  /** Auto-assigned monotonic id within the persisted log. */
  attemptId: string;
  /** Scope tag — e.g. "momentum/equities", "mean-reversion/crypto". */
  family: string;
  /**
   * Stable hash of the strategy code or spec. Used to detect re-tests of
   * the same logic — those should NOT inflate the multiple-testing count.
   */
  codeHash: string;
  /** Observed (in-sample) Sharpe of this attempt. */
  observedSharpe: number;
  /** OOS Sharpe if walk-forward was run. */
  oosSharpe: number | null;
  verdict: AttemptVerdict;
  /** ISO timestamp. */
  capturedAt: string;
  /** Optional free-form note. */
  notes?: string;
}

export interface RecordAttemptInput {
  family: string;
  codeHash: string;
  observedSharpe: number;
  oosSharpe?: number | null;
  verdict: AttemptVerdict;
  notes?: string;
  /** Override for tests. */
  now?: string;
}

export interface TrialCount {
  family: string;
  /** Distinct codeHashes seen — the right metric for multiple-testing. */
  distinctCount: number;
  /** Total attempts including duplicates. */
  totalCount: number;
}

export function defaultAttemptsLogPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[ATTEMPTS_LOG_PATH_ENV];
  if (override && override.length > 0) return override;
  return join(homedir(), ".gordon", "strategy-attempts.jsonl");
}

function ensureParentDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

let _attemptCounter = 0;
function nextAttemptId(): string {
  _attemptCounter += 1;
  return `${Date.now().toString(36)}-${_attemptCounter.toString(36)}`;
}

/** Reset the in-memory counter — tests only. */
export function resetAttemptCounterForTesting(): void {
  _attemptCounter = 0;
}

export function recordAttempt(
  input: RecordAttemptInput,
  path?: string,
): StrategyAttempt {
  const attempt: StrategyAttempt = {
    attemptId: nextAttemptId(),
    family: input.family,
    codeHash: input.codeHash,
    observedSharpe: input.observedSharpe,
    oosSharpe: input.oosSharpe ?? null,
    verdict: input.verdict,
    capturedAt: input.now ?? new Date().toISOString(),
    notes: input.notes,
  };
  const target = path ?? defaultAttemptsLogPath();
  ensureParentDir(target);
  appendFileSync(target, JSON.stringify(attempt) + "\n", "utf8");
  return attempt;
}

export interface ReadAttemptsOptions {
  family?: string;
  sinceMs?: number;
  limit?: number;
}

export function readAttempts(
  opts: ReadAttemptsOptions = {},
  path?: string,
): StrategyAttempt[] {
  const target = path ?? defaultAttemptsLogPath();
  if (!existsSync(target)) return [];

  const lines = readFileSync(target, "utf8").split("\n").filter((l) => l.trim().length > 0);
  const attempts: StrategyAttempt[] = [];
  for (const line of lines) {
    try {
      const a = JSON.parse(line) as StrategyAttempt;
      if (typeof a.attemptId === "string" && typeof a.family === "string") {
        attempts.push(a);
      }
    } catch {
      // skip malformed
    }
  }

  let filtered = attempts;
  if (opts.family) filtered = filtered.filter((a) => a.family === opts.family);
  if (opts.sinceMs !== undefined) {
    const since = opts.sinceMs;
    filtered = filtered.filter((a) => Date.parse(a.capturedAt) >= since);
  }
  filtered.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  if (opts.limit !== undefined) filtered = filtered.slice(0, opts.limit);
  return filtered;
}

/**
 * Count distinct (and total) attempts for a strategy family. Distinct
 * count is the correct denominator for multiple-testing — re-running the
 * same code does not consume an additional null trial.
 */
export function countTrials(family: string, path?: string): TrialCount {
  const attempts = readAttempts({ family }, path);
  const distinctHashes = new Set(attempts.map((a) => a.codeHash));
  return {
    family,
    distinctCount: distinctHashes.size,
    totalCount: attempts.length,
  };
}

/**
 * Expected maximum Sharpe ratio under the null (no skill) for N independent
 * trials. Approximation from Bailey & López de Prado (2014).
 *
 * Returned value is DIMENSIONLESS: the expected max of N draws from N(0, 1),
 * i.e. a z-score, not a Sharpe in any time unit. To turn it into a per-period
 * Sharpe benchmark, divide by `sqrt(numPeriods)`: under the null, per-period
 * trial Sharpes have standard deviation ~1/sqrt(n) over n observations. It does
 * NOT scale with the annualization factor.
 *
 * Use this to derive a dynamic threshold for DSR: as N grows, so does the
 * Sharpe a chance-only researcher would observe.
 */
export function expectedMaxSharpeUnderNull(numTrials: number): number {
  if (numTrials <= 1) return 0;
  const n = numTrials;
  // Inverse normal CDF approximations
  const invNorm = (p: number): number => {
    // Abramowitz & Stegun 26.2.23 rational approximation
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    if (p === 0.5) return 0;
    const t = p < 0.5 ? Math.sqrt(-2 * Math.log(p)) : Math.sqrt(-2 * Math.log(1 - p));
    const c0 = 2.515517, c1 = 0.802853, c2 = 0.010328;
    const d1 = 1.432788, d2 = 0.189269, d3 = 0.001308;
    const result = t - (c0 + c1 * t + c2 * t ** 2) / (1 + d1 * t + d2 * t ** 2 + d3 * t ** 3);
    return p < 0.5 ? -result : result;
  };
  const gamma = 0.5772156649;
  const eZ =
    (1 - gamma) * invNorm(1 - 1 / n) + gamma * invNorm(1 - 1 / (n * Math.E));
  return eZ;
}

export interface DynamicThresholdInput {
  family: string;
  /** Annualized Sharpe of the candidate. */
  observedSharpeAnnualized: number;
  /** Track-record length in periods (e.g. daily bars). */
  periods: number;
  /** Periods per year for annualization conversion. Default 252. */
  annualization?: number;
  /** Skewness of the strategy's returns (default 0). */
  skewness?: number;
  /**
   * EXCESS kurtosis (gamma4 - 3), so 0 means normal. The Bailey & Lopez de
   * Prado denominator is stated on RAW kurtosis as (gamma4 - 1)/4, which is
   * (excessKurtosis + 2)/4 here, so it is 0.5 for a normal, NOT 0. Keep the
   * convention straight: passing raw kurtosis into this field understates the
   * standard error and inflates the p-value.
   */
  excessKurtosis?: number;
  /** Override trial count (e.g. for ablation). Defaults to readAttempts(family). */
  trialCountOverride?: number;
  /** Override log path. */
  attemptsLogPath?: string;
}

export interface DynamicThresholdResult {
  trialCount: number;
  /**
   * Expected-max Sharpe under the null, in ANNUALIZED units. Derived from the
   * dimensionless E[max Z] by scaling to per-period (1/sqrt(periods)) and then
   * annualizing (sqrt(annualization)), so it shrinks as the track lengthens.
   */
  expectedMaxSharpeNullAnnualized: number;
  observedSharpeAnnualized: number;
  /**
   * DSR-style p-value: probability that observed Sharpe exceeds what
   * chance alone would produce given trialCount trials.
   */
  dsrPValue: number;
  /** Verdict at 0.95 significance. */
  passes: boolean;
}

/**
 * Compute the DSR p-value for an observed Sharpe given the multiple-testing
 * burden in this family. This is the article's "no human override" gate.
 *
 * Returns `passes = true` if p-value > 0.95 (Sharpe is significantly above
 * what N null trials would produce).
 */
export function dynamicDeflatedThreshold(input: DynamicThresholdInput): DynamicThresholdResult {
  const n = input.periods;
  const ann = input.annualization ?? 252;
  const trialCount =
    input.trialCountOverride ??
    countTrials(input.family, input.attemptsLogPath).distinctCount;

  if (n < 30) {
    return {
      trialCount,
      expectedMaxSharpeNullAnnualized: 0,
      observedSharpeAnnualized: input.observedSharpeAnnualized,
      dsrPValue: 0,
      passes: false,
    };
  }

  // +1 because the current attempt is itself a trial
  const effectiveTrials = Math.max(trialCount + 1, 2);
  const eMaxZ = expectedMaxSharpeUnderNull(effectiveTrials);

  // `eMaxZ` is a dimensionless z-score. Under the null, per-period trial
  // Sharpes have standard deviation ~1/sqrt(n) over n observations, so the
  // per-period null benchmark is eMaxZ / sqrt(n), NOT eMaxZ / sqrt(ann).
  // Dividing by the annualization factor left the bar independent of track
  // length, so the gate was most permissive where the evidence was weakest.
  // Matches `backtestCredibility.expectedMaxSharpe`, which scales by
  // sqrt(variance / numPeriods) with unit null variance.
  const sr_per = input.observedSharpeAnnualized / Math.sqrt(ann);
  const sr0_per = eMaxZ / Math.sqrt(n);
  const skew = input.skewness ?? 0;
  const exKurt = input.excessKurtosis ?? 0;
  // Bailey & Lopez de Prado use RAW kurtosis as (gamma4 - 1)/4, which is 0.5
  // for a normal. In excess-kurtosis units that is (exKurt + 2)/4.
  const kurtTerm = (exKurt + 2) / 4;

  const num = (sr_per - sr0_per) * Math.sqrt(n - 1);
  const den = Math.sqrt(Math.max(1 - skew * sr_per + kurtTerm * sr_per * sr_per, 1e-9));
  const dsr = normalCdf(num / den);

  return {
    trialCount,
    expectedMaxSharpeNullAnnualized: (eMaxZ / Math.sqrt(n)) * Math.sqrt(ann),
    observedSharpeAnnualized: input.observedSharpeAnnualized,
    dsrPValue: dsr,
    passes: dsr > 0.95,
  };
}

export function attemptToPayload(attempt: StrategyAttempt): Record<string, unknown> {
  return {
    kind: "multiple_testing.attempt_recorded",
    attemptId: attempt.attemptId,
    family: attempt.family,
    codeHash: attempt.codeHash,
    verdict: attempt.verdict,
    observedSharpe: attempt.observedSharpe,
    oosSharpe: attempt.oosSharpe,
    capturedAt: attempt.capturedAt,
  };
}
