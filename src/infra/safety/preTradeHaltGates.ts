/**
 * Pre-trade halt gates, evaluated at order time.
 *
 * Three gates computed verdicts that nothing ever read: the streak circuit
 * breaker, the give-back stop and the absorbing barrier were all folded into
 * `strategy:plan_ready` as shadow log lines. That event fires when a plan is
 * proposed, not when an order is placed, so nothing on the money path was
 * subject to them.
 *
 * They are enforced here instead, from `evaluateOrderRisk`, and deliberately
 * NOT through `tripKillSwitch`. A kill switch needs a manual reset with a
 * written rationale; the streak breaker is a timed cooldown that expires on
 * its own, and the give-back and barrier readings move with equity. Turning
 * either into a manual-reset halt would strand an operator behind a condition
 * that had already cleared. Every gate here is re-read on the next order and
 * stops blocking as soon as its condition stops holding, with one stated
 * exception: the terminal absorbing barrier is sticky by construction, which
 * is what "terminal" means, and it is inactive until the operator sets a loss
 * fraction.
 *
 * All three exist to stop NEW risk, so an exposure-reducing order skips them.
 * A give-back stop that prevented flattening would keep the operator in the
 * position it was written to get them out of.
 */

import {
  distanceToBarriers,
  isAbsorbingBarrierEnabled,
  shouldBlockNewTrades,
} from "./absorbingBarrier.ts";
import {
  readAbsorbingBarrierConfigFromEnv,
  trackSessionEquity,
  type SessionEquityTrack,
} from "./absorbingBarrierState.ts";
import { flagEnv } from "../config/flagResolver.ts";
import { defaultDebriefPath, readDebriefLog } from "../trading/ops/debriefMatrix.ts";
import { evaluateGiveBack, isGiveBackStopEnabled } from "../trading/ops/giveBackStop.ts";
import {
  evaluateCircuit,
  isStreakCircuitBreakerEnabled,
  shouldBlockTrade,
} from "../trading/ops/streakCircuitBreaker.ts";
import { lastStreakTripAtMs, recordStreakTrip } from "../trading/ops/streakCircuitState.ts";
import { haltStateIntegrityError, readPortfolioHaltState } from "./durableHaltState.ts";

export type HaltGateName =
  | "GORDON_STREAK_CIRCUIT_BREAKER"
  | "GORDON_GIVE_BACK_STOP"
  | "GORDON_ABSORBING_BARRIER";

export interface HaltGateBlock {
  gate: HaltGateName;
  reason: string;
}

export interface HaltGateVerdict {
  blocks: HaltGateBlock[];
  warnings: string[];
}

export interface HaltGateInput {
  currentEquityUsd: number;
  /** True when the order shrinks an existing position rather than adding risk. */
  exposureReducing: boolean;
  nowMs?: number;
  env?: NodeJS.ProcessEnv;
  debriefPath?: string;
  portfolioIdentity?: string;
}

/** Trade results older than this are not part of a "current" streak. */
const STREAK_WINDOW = 20;

function positiveNumber(raw: string | undefined): number {
  const value = Number(raw ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function streakBlock(
  env: NodeJS.ProcessEnv,
  nowMs: number,
  debriefPath: string,
  identity: string,
): HaltGateBlock | null {
  const trippedAt = lastStreakTripAtMs(identity, env);
  // Results banked BEFORE the last trip are what that trip already punished.
  // Counting them again would re-trip the breaker the instant its cooldown
  // expired, turning a 60-minute lockout into a permanent one.
  const recentResults =
    identity === "default"
      ? readDebriefLog(debriefPath)
          // Legacy rows had no identity and cannot be attributed safely.
          // Preserve them only for the explicit fallback identity.
          .filter((entry) => entry.portfolioIdentity === undefined)
          .slice(-STREAK_WINDOW)
          .filter((entry) => trippedAt === null || Date.parse(entry.recordedAt) > trippedAt)
          .reverse()
          .map((entry) =>
            entry.pnlUsd > 0
              ? ("win" as const)
              : entry.pnlUsd < 0
                ? ("loss" as const)
                : ("scratch" as const),
          )
      : readPortfolioHaltState(identity)
          .recentTradeOutcomes.filter(
            (entry) => trippedAt === null || entry.recordedAtMs > trippedAt,
          )
          .slice(-STREAK_WINDOW)
          .reverse()
          .map((entry) => entry.outcome);

  const result = evaluateCircuit({
    recentResults,
    lastTrippedAtMs: trippedAt ?? undefined,
    nowMs,
  });
  if (!shouldBlockTrade(result)) return null;
  if (result.state === "tripped") recordStreakTrip(identity, nowMs);
  return {
    gate: "GORDON_STREAK_CIRCUIT_BREAKER",
    reason: `streak circuit breaker (${result.state}): ${result.reason}`,
  };
}

function giveBackBlock(track: SessionEquityTrack): HaltGateBlock | null {
  const result = evaluateGiveBack({
    sessionStartEquityUsd: track.sessionStartEquityUsd,
    sessionHighWaterMarkUsd: track.sessionHighWaterMarkUsd,
    currentEquityUsd: track.currentEquityUsd,
  });
  if (result.state !== "triggered") return null;
  return {
    gate: "GORDON_GIVE_BACK_STOP",
    reason: `give-back stop: ${result.reason}`,
  };
}

function barrierBlocks(
  env: NodeJS.ProcessEnv,
  currentEquityUsd: number,
  track: SessionEquityTrack | null,
): HaltGateBlock[] {
  const blocks: HaltGateBlock[] = [];

  // R-units are undefined without an R, so the distance barriers stay inactive
  // rather than defaulting to a dollar ladder that reads every distance as ok.
  const baseR = positiveNumber(env.GORDON_BASE_R_PER_TRADE_USD);
  const dayStartEquity = positiveNumber(env.GORDON_DAY_START_EQUITY_USD);
  const dailyLossBudget = positiveNumber(env.GORDON_RISK_DAILY_LOSS_USD);
  const propFirmTrailingDd = positiveNumber(env.GORDON_PROP_FIRM_TRAILING_DD_USD);
  const psychTilt = positiveNumber(env.GORDON_PSYCHOLOGICAL_TILT_USD);
  const equityHwm = positiveNumber(env.GORDON_EQUITY_HIGH_WATER_MARK_USD);

  if (baseR > 0) {
    const barriers = distanceToBarriers({
      currentEquity: currentEquityUsd,
      equityHighWaterMark: equityHwm > 0 ? equityHwm : undefined,
      dailyLoss:
        dailyLossBudget > 0 && dayStartEquity > 0
          ? { windowStartEquityUsd: dayStartEquity, budgetUsd: dailyLossBudget }
          : undefined,
      propFirmTrailingDdUsd: propFirmTrailingDd > 0 ? propFirmTrailingDd : undefined,
      psychologicalTilt:
        psychTilt > 0 && dayStartEquity > 0
          ? { windowStartEquityUsd: dayStartEquity, budgetUsd: psychTilt }
          : undefined,
      baseRiskPerTradeUsd: baseR,
    });
    if (shouldBlockNewTrades(barriers)) {
      const nearest = barriers.barriers.find((b) => b.kind === barriers.nearest);
      blocks.push({
        gate: "GORDON_ABSORBING_BARRIER",
        reason: `absorbing barrier: nearest ${barriers.nearest} barrier is ${barriers.nearestRUnits.toFixed(2)}R away (${nearest?.alertLevel ?? "warn"})`,
      });
    }
  }

  // The trailing barrier forgives a recover-and-lose-again path, so the
  // inception-referenced fold is a separate block rather than a substitute.
  if (track?.barrier?.tripped) {
    blocks.push({
      gate: "GORDON_ABSORBING_BARRIER",
      reason: `absorbing barrier: terminal ${track.barrier.boundBy} limit breached at equity $${track.barrier.state.trippedAtEquityUsd?.toFixed(2) ?? "unknown"}`,
    });
  }

  return blocks;
}

/**
 * Evaluate the three halt gates for one order.
 *
 * Session equity is folded first so the barrier and give-back state stay
 * current even on the orders they do not gate.
 */
export function evaluatePreTradeHaltGates(input: HaltGateInput): HaltGateVerdict {
  const env = input.env ?? flagEnv();
  const nowMs = input.nowMs ?? Date.now();
  const blocks: HaltGateBlock[] = [];
  const warnings: string[] = [];
  const identity = input.portfolioIdentity ?? "default";

  const giveBackOn = isGiveBackStopEnabled(env);
  const barrierOn = isAbsorbingBarrierEnabled(env);
  const track =
    giveBackOn || barrierOn
      ? trackSessionEquity(
          input.currentEquityUsd,
          readAbsorbingBarrierConfigFromEnv(env),
          env,
          identity,
        )
      : null;

  if (input.exposureReducing) {
    warnings.push(
      "Halt gates (streak / give-back / absorbing barrier) skipped: this order reduces existing exposure.",
    );
    return { blocks, warnings };
  }

  const stateError = haltStateIntegrityError();
  if (stateError) {
    blocks.push({
      gate: "GORDON_ABSORBING_BARRIER",
      reason: `authenticated halt state unavailable (${stateError}); refusing new risk`,
    });
    return { blocks, warnings };
  }

  if (isStreakCircuitBreakerEnabled(env)) {
    const block = streakBlock(env, nowMs, input.debriefPath ?? defaultDebriefPath(env), identity);
    if (block) blocks.push(block);
  }

  if (giveBackOn && track) {
    const block = giveBackBlock(track);
    if (block) blocks.push(block);
  }

  if (barrierOn) {
    blocks.push(...barrierBlocks(env, input.currentEquityUsd, track));
  }

  return { blocks, warnings };
}
