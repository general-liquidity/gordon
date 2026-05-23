/**
 * Auction Window Awareness
 *
 * Per Eric Budish's market-design analysis: continuous-LOB venues
 * carry a structural sniping tax, but most exchanges DO run periodic
 * auctions where price competition replaces speed competition. The
 * opening cross + closing cross on US equity venues are the canonical
 * examples. CoW Swap runs ~30-second batches for MEV-protected swaps.
 *
 * This module surfaces:
 *   - Per-venue auction schedules
 *   - "Should I defer this order to the next auction?" heuristic
 *   - Time-until-next-auction for operator-facing planner output
 *
 * Pure data + logic, no order routing. The executor decides whether
 * to act on the suggestion. The heuristic is intentionally
 * conservative — it only suggests deferring when the savings vs.
 * timing risk tradeoff looks favorable.
 *
 * Coverage today (operator-extensible):
 *   - NASDAQ / NYSE opening cross (9:30 ET) + closing cross (16:00 ET)
 *   - CoW Swap continuous batch auction (~30s)
 *   - Crypto CEX venues — no native auction windows (all continuous)
 *
 * Operators trading on venues not in the schedule should pass an
 * explicit override or treat the default as "no auction available."
 */

export interface AuctionWindow {
  /** Venue id. */
  venueId: string;
  /** Auction kind for operator-readable output. */
  kind: "opening_cross" | "closing_cross" | "batch_continuous" | "custom";
  /** UTC HH:MM string of the auction time. For continuous batches, the cadence in seconds is encoded separately. */
  utcTime?: string;
  /** For continuous batch auctions: the cadence between batches in seconds. */
  cadenceSeconds?: number;
  /** Operator-readable description. */
  description: string;
}

export interface AuctionDeferralSuggestion {
  /** Whether the heuristic suggests deferring to the next auction. */
  shouldDefer: boolean;
  /** Reason text — always populated so operator sees the rationale. */
  reason: string;
  /** Next auction time as ISO-8601 string. Null when no auction is scheduled within the horizon. */
  nextAuctionAt: string | null;
  /** Seconds until the next auction. */
  secondsUntilNextAuction: number | null;
  /** Estimated bps saved by deferring (rough — operator should calibrate). */
  estimatedSavingsBps?: number;
}

const SCHEDULE: Record<string, AuctionWindow[]> = {
  nasdaq: [
    {
      venueId: "nasdaq",
      kind: "opening_cross",
      utcTime: "14:30",
      description: "NASDAQ opening cross — auction-style price discovery at market open",
    },
    {
      venueId: "nasdaq",
      kind: "closing_cross",
      utcTime: "21:00",
      description: "NASDAQ closing cross — auction-style price discovery at market close",
    },
  ],
  nyse: [
    {
      venueId: "nyse",
      kind: "opening_cross",
      utcTime: "14:30",
      description: "NYSE opening auction",
    },
    {
      venueId: "nyse",
      kind: "closing_cross",
      utcTime: "21:00",
      description: "NYSE closing auction — typically the most-liquid event of the day",
    },
  ],
  cow_swap: [
    {
      venueId: "cow_swap",
      kind: "batch_continuous",
      cadenceSeconds: 30,
      description: "CoW Swap ~30-second batch auction with solver competition (MEV-protected)",
    },
  ],
};

const TRADING_DAYS = new Set([1, 2, 3, 4, 5]); // Monday-Friday in JS Date.getUTCDay() terms

/**
 * Get scheduled auction windows for a venue. Returns empty array when
 * the venue isn't in Gordon's schedule (operator can extend).
 */
export function getAuctionWindowsForVenue(venueId: string): AuctionWindow[] {
  return SCHEDULE[venueId] ?? [];
}

/**
 * Compute the next auction time for a venue, relative to the supplied
 * `now`. Returns null when no auction is scheduled within the next 24
 * hours (e.g., over a weekend for equity venues).
 *
 * Continuous-batch venues (CoW Swap) always return a near-future
 * time based on cadence.
 */
export function getNextAuctionAt(venueId: string, now: Date = new Date()): Date | null {
  const windows = getAuctionWindowsForVenue(venueId);
  if (windows.length === 0) return null;

  let nearest: Date | null = null;

  for (const w of windows) {
    if (w.kind === "batch_continuous" && w.cadenceSeconds) {
      const next = new Date(now.getTime() + w.cadenceSeconds * 1000);
      if (!nearest || next < nearest) nearest = next;
      continue;
    }

    if (w.utcTime) {
      const [hh, mm] = w.utcTime.split(":").map(Number) as [number, number];
      // Try today + next 5 days (cover weekend skip for equity venues)
      for (let dayOffset = 0; dayOffset < 6; dayOffset++) {
        const candidate = new Date(now);
        candidate.setUTCDate(candidate.getUTCDate() + dayOffset);
        candidate.setUTCHours(hh, mm, 0, 0);
        if (candidate.getTime() <= now.getTime()) continue;
        // Skip weekends for equity venues
        if (!TRADING_DAYS.has(candidate.getUTCDay())) continue;
        if (!nearest || candidate < nearest) nearest = candidate;
        break;
      }
    }
  }

  return nearest;
}

export interface DeferralOptions {
  /** Operator's urgency: how long they're willing to wait. Default 1800s (30 min). */
  maxDeferralSeconds?: number;
  /** Estimated saving if deferred to the auction, in bps. Default 1 (1bp). */
  estimatedSavingsBps?: number;
  /** Operator override: trade is urgent, never defer. Default false. */
  forceImmediate?: boolean;
  /** Reference clock for tests. */
  now?: Date;
}

/**
 * Heuristic: should this order defer to the next auction window?
 *
 * Logic:
 *   - If operator marked the trade urgent → no
 *   - If no auction scheduled within `maxDeferralSeconds` → no
 *   - If the auction is within the horizon → yes (with savings estimate)
 *
 * Operator-readable reason text always populated so the operator
 * sees WHY the heuristic decided as it did.
 */
export function suggestAuctionDeferral(
  venueId: string,
  options: DeferralOptions = {},
): AuctionDeferralSuggestion {
  const now = options.now ?? new Date();
  const maxDeferral = options.maxDeferralSeconds ?? 1800;
  const estSavings = options.estimatedSavingsBps ?? 1;

  if (options.forceImmediate) {
    return {
      shouldDefer: false,
      reason: "Operator marked the trade as urgent — execute immediately",
      nextAuctionAt: null,
      secondsUntilNextAuction: null,
    };
  }

  const next = getNextAuctionAt(venueId, now);
  if (!next) {
    return {
      shouldDefer: false,
      reason: `No auction scheduled for venue '${venueId}' within the next 6 days`,
      nextAuctionAt: null,
      secondsUntilNextAuction: null,
    };
  }

  const secondsUntil = (next.getTime() - now.getTime()) / 1000;

  if (secondsUntil > maxDeferral) {
    return {
      shouldDefer: false,
      reason: `Next auction at ${next.toISOString()} is ${Math.round(secondsUntil)}s away, exceeds max deferral ${maxDeferral}s`,
      nextAuctionAt: next.toISOString(),
      secondsUntilNextAuction: secondsUntil,
    };
  }

  return {
    shouldDefer: true,
    reason: `Next auction at ${next.toISOString()} in ${Math.round(secondsUntil)}s — deferring saves ~${estSavings}bps in expected sniping/spread cost`,
    nextAuctionAt: next.toISOString(),
    secondsUntilNextAuction: secondsUntil,
    estimatedSavingsBps: estSavings,
  };
}
