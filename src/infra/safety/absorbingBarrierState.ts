/**
 * Process-scoped fold for the inception-referenced absorbing barrier.
 *
 * `evaluateAbsorbingBarrier` is a pure fold: it takes a state, one equity
 * observation, and returns the next state. Somebody has to hold that state
 * between observations or the barrier resets every tick and can never trip.
 * This module is that holder, following the same convention as
 * `wipSessionRegistry.ts`: a module-level singleton, seeded lazily, reset only
 * by an explicit test hook.
 *
 * DURABILITY SCOPE, stated plainly: this is memory in one process. It does not
 * survive a restart, and two Gordon processes do not share it. On restart the
 * fold begins again from the equity then observed, so cumulative destroyed
 * capital from earlier runs is forgotten and the barrier is at that moment
 * MORE permissive than a durable one would be. It is never more permissive
 * than today's behaviour, which tracks nothing at all across ticks. A durable
 * store belongs behind an operator-visible reset (an operator who wired a
 * fresh account to a stale ledger would be halted for losses that are not
 * theirs), and that decision is not made here.
 *
 * Reference capital is seeded from GORDON_INCEPTION_EQUITY_USD when the
 * operator has declared it, otherwise from the first equity this process sees.
 */

import {
  createAbsorbingBarrierState,
  evaluateAbsorbingBarrier,
  recordExternalFlow,
  type AbsorbingBarrierConfig,
  type AbsorbingBarrierEvaluation,
  type AbsorbingBarrierState,
} from "./absorbingBarrier.ts";
import { flagEnv } from "../config/flagResolver.ts";

export const INCEPTION_LOSS_FRACTION_ENV = "GORDON_INCEPTION_LOSS_FRACTION";
export const TRAILING_DD_FRACTION_ENV = "GORDON_TRAILING_DD_FRACTION";
export const INCEPTION_EQUITY_ENV = "GORDON_INCEPTION_EQUITY_USD";

let sessionState: AbsorbingBarrierState | null = null;

function readFraction(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  // A limit outside (0, 1] cannot express a fraction of capital destroyed, and
  // silently coercing one would invent a threshold the operator never set.
  if (!Number.isFinite(value) || value <= 0 || value > 1) return undefined;
  return value;
}

/**
 * Absent or unparseable limits leave the returned config empty, which keeps
 * `evaluateAbsorbingBarrier` inactive. An operator who configured nothing sees
 * exactly the behaviour that shipped before this barrier was wired.
 */
export function readAbsorbingBarrierConfigFromEnv(
  env: NodeJS.ProcessEnv = flagEnv(),
): AbsorbingBarrierConfig {
  const config: AbsorbingBarrierConfig = {};
  const inception = readFraction(env[INCEPTION_LOSS_FRACTION_ENV]);
  if (inception !== undefined) config.inceptionLossFraction = inception;
  const trailing = readFraction(env[TRAILING_DD_FRACTION_ENV]);
  if (trailing !== undefined) config.trailingDrawdownFraction = trailing;
  return config;
}

export function hasConfiguredLimit(config: AbsorbingBarrierConfig): boolean {
  return (
    config.inceptionLossFraction !== undefined || config.trailingDrawdownFraction !== undefined
  );
}

function seedEquity(observedEquityUsd: number, env: NodeJS.ProcessEnv): number {
  const declared = Number(env[INCEPTION_EQUITY_ENV] ?? 0);
  return Number.isFinite(declared) && declared > 0 ? declared : observedEquityUsd;
}

/**
 * Folds one equity observation into the process state and returns the reading.
 *
 * Returns null when no limit is configured or the equity is not usable, so the
 * caller has nothing to act on and no state is created. Reference capital of
 * zero would make every loss fraction infinite, so a non-positive equity is
 * refused rather than turned into a spurious halt.
 */
export function observeSessionEquity(
  currentEquityUsd: number,
  config: AbsorbingBarrierConfig = readAbsorbingBarrierConfigFromEnv(),
  env: NodeJS.ProcessEnv = flagEnv(),
): AbsorbingBarrierEvaluation | null {
  if (!hasConfiguredLimit(config)) return null;
  return foldEquity(currentEquityUsd, config, env);
}

function foldEquity(
  currentEquityUsd: number,
  config: AbsorbingBarrierConfig,
  env: NodeJS.ProcessEnv,
): AbsorbingBarrierEvaluation | null {
  if (!Number.isFinite(currentEquityUsd) || currentEquityUsd <= 0) return null;

  if (sessionState === null) {
    const seed = seedEquity(currentEquityUsd, env);
    if (seed <= 0) return null;
    sessionState = createAbsorbingBarrierState(seed);
  }

  const evaluation = evaluateAbsorbingBarrier(sessionState, currentEquityUsd, config);
  sessionState = evaluation.state;
  return evaluation;
}

/**
 * The session equity figures other gates need, taken from the same fold.
 *
 * The give-back stop wants a session start, a session high-water mark and a
 * current equity. All three already exist here, and a second store would
 * disagree with this one the first time an external flow landed. Unlike
 * `observeSessionEquity` this maintains the fold even when no terminal limit
 * is configured, because the figures are useful without one; with no limit the
 * barrier readings stay inactive and `barrier` is null, so nothing can trip.
 *
 * `sessionStartEquityUsd` is the fold's reference capital: the operator's
 * declared GORDON_INCEPTION_EQUITY_USD when set, otherwise the first equity
 * this process observed. An operator who declares an inception figure above
 * where the process starts leaves the give-back rule dormant rather than
 * firing it early, which is the safe direction for a rule that halts trading.
 */
export interface SessionEquityTrack {
  sessionStartEquityUsd: number;
  sessionHighWaterMarkUsd: number;
  currentEquityUsd: number;
  /** Null when the operator configured no terminal limit. */
  barrier: AbsorbingBarrierEvaluation | null;
}

export function trackSessionEquity(
  currentEquityUsd: number,
  config: AbsorbingBarrierConfig = readAbsorbingBarrierConfigFromEnv(),
  env: NodeJS.ProcessEnv = flagEnv(),
): SessionEquityTrack | null {
  const evaluation = foldEquity(currentEquityUsd, config, env);
  if (evaluation === null) return null;
  return {
    sessionStartEquityUsd: evaluation.state.referenceCapitalUsd,
    sessionHighWaterMarkUsd: evaluation.state.highWaterMarkUsd,
    currentEquityUsd,
    barrier: hasConfiguredLimit(config) ? evaluation : null,
  };
}

/**
 * Deposits positive, withdrawals negative. Cash movement is not a trading
 * result and must never reach the barrier as an equity observation.
 *
 * Returns false when no state exists yet: the first observation will seed
 * reference capital from the equity that already includes the flow.
 */
export function recordSessionExternalFlow(flowUsd: number): boolean {
  if (sessionState === null) return false;
  if (!Number.isFinite(flowUsd) || flowUsd === 0) return false;
  sessionState = recordExternalFlow(sessionState, flowUsd);
  return true;
}

export function sessionAbsorbingBarrierState(): AbsorbingBarrierState | null {
  return sessionState;
}

/** Tests only. */
export function resetSessionAbsorbingBarrierForTesting(): void {
  sessionState = null;
}
