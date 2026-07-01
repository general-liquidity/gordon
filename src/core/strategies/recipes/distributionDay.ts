/**
 * Distribution-Day recipe — index top-risk counter.
 *
 * Clean-room re-implementation of O'Neil's distribution-day concept,
 * generalized off equity indices to ANY index-level series (equity
 * index or crypto major used as the market proxy). The pair to
 * `followThroughDay.ts`: FTD confirms bottoms, distribution days count
 * institutional selling near tops. Discrete session-counting, distinct
 * from the statistical regime detector.
 *
 * A distribution day is a heavy-selling session:
 *   - the index closes DOWN at least `downThreshold` (default 0.2%)
 *     versus the prior session, AND
 *   - volume is HIGHER than the prior session.
 *
 * Live distribution days are counted over a rolling `window` (default 25
 * sessions). Two things remove a distribution day from the count:
 *   - EXPIRY: it ages out of the trailing window.
 *   - 5% INVALIDATION: if, on any later session inside the window, the
 *     index closes at least `invalidationGain` (default 5%) above the
 *     distribution day's close, the selling is deemed absorbed.
 *
 * The live count over the last 5 / 15 / 25 sessions gauges clustering,
 * and the trailing-window count maps to a top-risk severity:
 *   0-2 -> NORMAL, 3-4 -> CAUTION, 5 -> HIGH, 6+ -> SEVERE.
 *
 * Pure over OHLCV, index-agnostic, no hardcoded tickers, no fitted
 * parameters — the caller supplies bars and (optionally) thresholds.
 */

export interface DistributionBar {
  close: number;
  volume: number;
}

export interface DistributionDayOptions {
  /** Max close-down fraction (negative) for a distribution day. Default -0.002 (-0.2%). */
  downThreshold?: number;
  /** Trailing session window over which live days are counted. Default 25. */
  window?: number;
  /** Rally-from-close fraction that invalidates a distribution day. Default 0.05 (5%). */
  invalidationGain?: number;
  /** Require higher volume than the prior session. Default true. */
  volumeMustRise?: boolean;
}

export type DistributionSeverity = "NORMAL" | "CAUTION" | "HIGH" | "SEVERE";

export interface DistributionDayDetail {
  /** Bar index of the distribution day within the supplied series. */
  index: number;
  /** How many sessions ago (0 = most recent bar). */
  sessionsAgo: number;
  /** Close-down fraction that qualified the day (negative). */
  change: number;
  /** Day volume / prior-session volume. */
  volumeRatio: number;
  /** Currently counted toward top-risk (in window, not invalidated). */
  live: boolean;
  /** Removed by the 5% rally-from-close rule. */
  invalidated: boolean;
  /** Aged out of the trailing window. */
  expired: boolean;
}

export interface DistributionDayResult {
  /** Live distribution days in the trailing window (== clustersLast25 when window=25). */
  liveCount: number;
  /** Live days that fell in the last 5 / 15 / 25 sessions. */
  clustersLast5: number;
  clustersLast15: number;
  clustersLast25: number;
  severity: DistributionSeverity;
  /** Every detected distribution day with its live/invalidated/expired state. */
  days: DistributionDayDetail[];
  summary: string;
}

const DEFAULT_DOWN_THRESHOLD = -0.002;
const DEFAULT_WINDOW = 25;
const DEFAULT_INVALIDATION_GAIN = 0.05;

function severityFor(count: number): DistributionSeverity {
  if (count >= 6) return "SEVERE";
  if (count === 5) return "HIGH";
  if (count >= 3) return "CAUTION";
  return "NORMAL";
}

export function evaluateDistributionDays(
  bars: ReadonlyArray<DistributionBar>,
  options: DistributionDayOptions = {},
): DistributionDayResult {
  const downThreshold = options.downThreshold ?? DEFAULT_DOWN_THRESHOLD;
  const window = options.window ?? DEFAULT_WINDOW;
  const invalidationGain = options.invalidationGain ?? DEFAULT_INVALIDATION_GAIN;
  const volumeMustRise = options.volumeMustRise ?? true;

  const empty: DistributionDayResult = {
    liveCount: 0,
    clustersLast5: 0,
    clustersLast15: 0,
    clustersLast25: 0,
    severity: "NORMAL",
    days: [],
    summary: "Insufficient bars for a distribution-day evaluation.",
  };
  if (bars.length < 2) return empty;

  const lastIndex = bars.length - 1;
  const days: DistributionDayDetail[] = [];

  for (let i = 1; i < bars.length; i++) {
    const bar = bars[i]!;
    const prev = bars[i - 1]!;
    if (prev.close <= 0) continue;

    const change = (bar.close - prev.close) / prev.close;
    const isDown = change <= downThreshold;
    const volumeRises = !volumeMustRise || bar.volume > prev.volume;
    if (!isDown || !volumeRises) continue;

    const sessionsAgo = lastIndex - i;
    const expired = sessionsAgo >= window;

    // 5% rule: invalidated if any LATER session in the series closes at
    // least invalidationGain above this day's close.
    let invalidated = false;
    const invalidationLevel = bar.close * (1 + invalidationGain);
    for (let j = i + 1; j < bars.length; j++) {
      if (bars[j]!.close >= invalidationLevel) {
        invalidated = true;
        break;
      }
    }

    const live = !expired && !invalidated;
    days.push({
      index: i,
      sessionsAgo,
      change: parseFloat(change.toFixed(6)),
      volumeRatio: parseFloat((bar.volume / prev.volume).toFixed(4)),
      live,
      invalidated,
      expired,
    });
  }

  const liveDays = days.filter((d) => d.live);
  const clustersLast5 = liveDays.filter((d) => d.sessionsAgo < 5).length;
  const clustersLast15 = liveDays.filter((d) => d.sessionsAgo < 15).length;
  const clustersLast25 = liveDays.filter((d) => d.sessionsAgo < 25).length;
  const liveCount = liveDays.length;
  const severity = severityFor(liveCount);

  const summary =
    `${liveCount} live distribution day(s) in the trailing ${window} sessions ` +
    `(${clustersLast5} in last 5, ${clustersLast15} in last 15) -> ${severity}. ` +
    `${days.filter((d) => d.invalidated).length} invalidated by the ${(invalidationGain * 100).toFixed(0)}% rule, ` +
    `${days.filter((d) => d.expired).length} expired.`;

  return {
    liveCount,
    clustersLast5,
    clustersLast15,
    clustersLast25,
    severity,
    days,
    summary,
  };
}

export function formatDistributionDays(result: DistributionDayResult): string {
  return [
    `Distribution Days — ${result.severity}`,
    "",
    `  Live count (window): ${result.liveCount}`,
    `  Last 5 sessions:     ${result.clustersLast5}`,
    `  Last 15 sessions:    ${result.clustersLast15}`,
    `  Last 25 sessions:    ${result.clustersLast25}`,
    "",
    `Summary: ${result.summary}`,
  ].join("\n");
}
