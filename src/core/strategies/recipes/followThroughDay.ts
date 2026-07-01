/**
 * Follow-Through-Day (FTD) recipe — index bottom-confirmation counter.
 *
 * Clean-room re-implementation of O'Neil's follow-through-day concept,
 * generalized off equity indices to ANY index-level series (an equity
 * index, or a crypto major like BTC/ETH used as the market proxy). The
 * point is discrete rule-based state, distinct from Gordon's statistical
 * regime detector (HMM / Markov): it counts sessions, it does not fit a
 * distribution.
 *
 * The lifecycle:
 *
 *   1. RALLY ATTEMPT. After a decline makes a fresh swing low, the first
 *      up-close session begins an attempted rally ("Day 1"). Sessions are
 *      counted from there.
 *   2. FTD QUALIFY. On Day `minRallyDay` (default 4) or later, if the
 *      index closes up at least `ftdGainThreshold` (default 1.25%) on
 *      volume HIGHER than the prior session, that is a follow-through
 *      day — the rally is confirmed and a new uptrend attempt is sealed.
 *   3. POST-FTD HEALTH. The confirmed uptrend is healthy until the index
 *      undercuts the rally-attempt low (a lower low), which invalidates
 *      the follow-through and drops back to searching for a new bottom.
 *
 * Undercutting the rally low BEFORE an FTD simply resets the attempt to
 * the new low. Pure over OHLCV, index-agnostic, no hardcoded tickers,
 * no fitted parameters — the caller supplies the index bars and (if it
 * wants) the thresholds.
 */

export interface FtdBar {
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface FollowThroughDayOptions {
  /** Earliest rally day on which an FTD can qualify. Default 4. */
  minRallyDay?: number;
  /** Minimum up-close (fraction of prior close) for an FTD. Default 0.0125 (1.25%). */
  ftdGainThreshold?: number;
}

export type FtdPhase =
  | "no_rally" // no active attempt and no live confirmation
  | "rally_attempt" // attempt underway, not yet confirmed
  | "confirmed_uptrend" // an FTD is live and not undercut
  | "undercut"; // a prior confirmed uptrend was undercut

export interface FtdDetail {
  /** Bar index of the follow-through day within the supplied series. */
  index: number;
  /** Rally day number (Day 1 = first up-close of the attempt). */
  rallyDay: number;
  /** Close-up fraction vs the prior session that qualified the FTD. */
  gain: number;
  /** FTD volume / prior-session volume. */
  volumeRatio: number;
}

export interface FollowThroughDayResult {
  phase: FtdPhase;
  /** Bar index that started the current rally attempt (Day 1), or -1. */
  rallyStartIndex: number;
  /** Rally day count of the current attempt at the end of the series. */
  rallyDayCount: number;
  /** Lowest low of the current attempt (the pivot the FTD must hold). */
  rallyLow: number;
  /** The live follow-through day, or null if none is currently confirmed. */
  followThrough: FtdDetail | null;
  /** True if any FTD occurred anywhere in the series (even if later undercut). */
  everConfirmed: boolean;
  summary: string;
}

const DEFAULT_MIN_RALLY_DAY = 4;
const DEFAULT_FTD_GAIN_THRESHOLD = 0.0125;

export function evaluateFollowThroughDay(
  bars: ReadonlyArray<FtdBar>,
  options: FollowThroughDayOptions = {},
): FollowThroughDayResult {
  const minRallyDay = options.minRallyDay ?? DEFAULT_MIN_RALLY_DAY;
  const ftdGainThreshold = options.ftdGainThreshold ?? DEFAULT_FTD_GAIN_THRESHOLD;

  const empty: FollowThroughDayResult = {
    phase: "no_rally",
    rallyStartIndex: -1,
    rallyDayCount: 0,
    rallyLow: NaN,
    followThrough: null,
    everConfirmed: false,
    summary: "Insufficient bars for a follow-through-day evaluation.",
  };
  if (bars.length < 2) return empty;

  let rallyLow = Infinity;
  let rallyLowIndex = -1;
  let inAttempt = false;
  let rallyStartIndex = -1;
  let rallyDay = 0;
  let confirmed = false;
  let followThrough: FtdDetail | null = null;
  let everConfirmed = false;
  let lastEventUndercut = false;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]!;

    if (bar.low < rallyLow) {
      // Fresh low — a new potential bottom. Any active attempt or live
      // confirmation is undercut and reset to search for a new low.
      if (confirmed) lastEventUndercut = true;
      rallyLow = bar.low;
      rallyLowIndex = i;
      inAttempt = false;
      rallyStartIndex = -1;
      rallyDay = 0;
      confirmed = false;
      followThrough = null;
      continue;
    }

    const prev = bars[i - 1]!;
    if (!inAttempt) {
      // Look for Day 1: first up-close strictly after the low bar.
      if (i > rallyLowIndex && bar.close > prev.close) {
        inAttempt = true;
        rallyStartIndex = i;
        rallyDay = 1;
        lastEventUndercut = false;
      }
      continue;
    }

    // In an attempt (and not a fresh low): advance the day counter.
    rallyDay += 1;

    if (!confirmed && rallyDay >= minRallyDay && prev.close > 0) {
      const gain = (bar.close - prev.close) / prev.close;
      const volumeRises = bar.volume > prev.volume;
      if (gain >= ftdGainThreshold && volumeRises) {
        confirmed = true;
        everConfirmed = true;
        lastEventUndercut = false;
        followThrough = {
          index: i,
          rallyDay,
          gain: parseFloat(gain.toFixed(6)),
          volumeRatio: parseFloat((bar.volume / prev.volume).toFixed(4)),
        };
      }
    }
  }

  let phase: FtdPhase;
  if (confirmed) phase = "confirmed_uptrend";
  else if (inAttempt) phase = "rally_attempt";
  else if (everConfirmed && lastEventUndercut) phase = "undercut";
  else phase = "no_rally";

  let summary: string;
  switch (phase) {
    case "confirmed_uptrend":
      summary =
        `Follow-through confirmed on bar ${followThrough!.index} (rally day ${followThrough!.rallyDay}): ` +
        `+${(followThrough!.gain * 100).toFixed(2)}% on ${followThrough!.volumeRatio}x volume. ` +
        `Uptrend healthy while rally low ${rallyLow.toFixed(4)} holds.`;
      break;
    case "rally_attempt":
      summary =
        `Rally attempt on day ${rallyDay} (started bar ${rallyStartIndex}), ` +
        `awaiting a follow-through day (>= day ${minRallyDay}, +${(ftdGainThreshold * 100).toFixed(2)}% on rising volume).`;
      break;
    case "undercut":
      summary = `Prior follow-through undercut — a lower low broke the confirmed uptrend; searching for a new bottom.`;
      break;
    default:
      summary = `No active rally attempt; current pivot low ${rallyLow.toFixed(4)}.`;
  }

  return {
    phase,
    rallyStartIndex,
    rallyDayCount: inAttempt ? rallyDay : 0,
    rallyLow,
    followThrough,
    everConfirmed,
    summary,
  };
}

export function formatFollowThroughDay(result: FollowThroughDayResult): string {
  const lines = [
    `Follow-Through Day — ${result.phase.toUpperCase()}`,
    "",
    `  Rally start bar:   ${result.rallyStartIndex >= 0 ? result.rallyStartIndex : "—"}`,
    `  Rally day count:   ${result.rallyDayCount}`,
    `  Rally (pivot) low: ${Number.isFinite(result.rallyLow) ? result.rallyLow.toFixed(4) : "—"}`,
  ];
  if (result.followThrough) {
    lines.push(
      `  FTD bar:           ${result.followThrough.index} (day ${result.followThrough.rallyDay}, ` +
        `+${(result.followThrough.gain * 100).toFixed(2)}%, ${result.followThrough.volumeRatio}x vol)`,
    );
  }
  lines.push("");
  lines.push(`Summary: ${result.summary}`);
  return lines.join("\n");
}
