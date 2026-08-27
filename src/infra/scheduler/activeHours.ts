/**
 * Active Hours: Timezone-aware market-hours gating for scheduled jobs.
 *
 * Prevents cron-style tasks from firing outside a configured window — e.g.
 * a "check portfolio" job that should only run 09:30-16:00 ET on weekdays.
 * Handles timezones properly via Intl.DateTimeFormat (IANA zones).
 */

export interface ActiveHours {
  /** "HH:MM" 24h format (e.g. "09:30"). Local to timezone. */
  start: string;
  /** "HH:MM" 24h format (e.g. "16:00"). Local to timezone. */
  end: string;
  /** IANA timezone identifier (default "America/New_York"). */
  timezone?: string;
  /** Days of week: 0=Sunday..6=Saturday. Default [1,2,3,4,5] (Mon–Fri). */
  daysOfWeek?: number[];
}

/** Standard US equity market hours (NYSE / Nasdaq). */
export const US_EQUITY_MARKET_HOURS: ActiveHours = {
  start: "09:30",
  end: "16:00",
  timezone: "America/New_York",
  daysOfWeek: [1, 2, 3, 4, 5],
};

/** US equity extended hours (pre-market + after-hours). */
export const US_EQUITY_EXTENDED_HOURS: ActiveHours = {
  start: "04:00",
  end: "20:00",
  timezone: "America/New_York",
  daysOfWeek: [1, 2, 3, 4, 5],
};

/** 24/7 window — crypto exchanges never close. */
export const CRYPTO_ALWAYS_ACTIVE: ActiveHours = {
  start: "00:00",
  end: "23:59",
  timezone: "UTC",
  daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
};

/** CME futures approximate hours (Sun 18:00 ET → Fri 17:00 ET). */
export const CME_FUTURES_HOURS: ActiveHours = {
  start: "18:00",
  end: "17:00", // overnight (start > end handled specially)
  timezone: "America/New_York",
  daysOfWeek: [0, 1, 2, 3, 4], // Sun–Thu (continues into Fri)
};

function parseHHMM(s: string): { hour: number; minute: number } | null {
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hour = parseInt(m[1]!, 10);
  const minute = parseInt(m[2]!, 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/** Returns the local-to-timezone time-of-day components for a given instant. */
function localTimeParts(
  ms: number,
  timezone: string,
): { year: number; month: number; day: number; hour: number; minute: number; dayOfWeek: number } {
  const date = new Date(ms);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  const year = parseInt(get("year"), 10);
  const month = parseInt(get("month"), 10);
  const day = parseInt(get("day"), 10);
  const hour24 = parseInt(get("hour"), 10) % 24; // handle "24:MM"
  const minute = parseInt(get("minute"), 10);
  const weekdayStr = get("weekday");
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dayOfWeek = dowMap[weekdayStr] ?? 0;
  return { year, month, day, hour: hour24, minute, dayOfWeek };
}

/**
 * Check whether a given instant falls within the active-hours window.
 * Handles overnight windows (start > end) by treating them as spanning midnight.
 */
export function isWithinActiveHours(nowMs: number, hours: ActiveHours): boolean {
  const timezone = hours.timezone ?? "America/New_York";
  const allowedDays = hours.daysOfWeek ?? [1, 2, 3, 4, 5];

  const start = parseHHMM(hours.start);
  const end = parseHHMM(hours.end);
  if (!start || !end) return false;

  const local = localTimeParts(nowMs, timezone);
  const nowMinutes = local.hour * 60 + local.minute;
  const startMinutes = start.hour * 60 + start.minute;
  const endMinutes = end.hour * 60 + end.minute;

  const isOvernight = startMinutes > endMinutes;

  if (!isOvernight) {
    // Simple case: start < end, same day
    if (!allowedDays.includes(local.dayOfWeek)) return false;
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }

  // Overnight: window is [start, 24:00) on day D, + [00:00, end) on day D+1
  if (nowMinutes >= startMinutes) {
    // In the post-start portion — today must be in allowedDays
    return allowedDays.includes(local.dayOfWeek);
  }
  if (nowMinutes < endMinutes) {
    // In the pre-end portion — YESTERDAY must have been in allowedDays
    const yesterdayDow = (local.dayOfWeek + 6) % 7;
    return allowedDays.includes(yesterdayDow);
  }
  return false;
}

/**
 * Given a target time, compute the next instant at which an active-hours
 * window starts. Returns null if something is misconfigured.
 */
export function nextActiveHoursStart(nowMs: number, hours: ActiveHours): number | null {
  const timezone = hours.timezone ?? "America/New_York";
  const allowedDays = hours.daysOfWeek ?? [1, 2, 3, 4, 5];
  const start = parseHHMM(hours.start);
  if (!start) return null;

  // Walk forward up to 14 days to find the next allowed day+time.
  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const candidate = nowMs + dayOffset * 24 * 60 * 60 * 1000;
    const local = localTimeParts(candidate, timezone);
    if (!allowedDays.includes(local.dayOfWeek)) continue;

    const startMinutes = start.hour * 60 + start.minute;
    const localNowMinutes = local.hour * 60 + local.minute;

    if (dayOffset === 0 && localNowMinutes >= startMinutes) continue;

    // Construct an ISO-ish time string for the start in the target timezone.
    // Intl doesn't let us construct by TZ directly, so we approximate by
    // adjusting from UTC until the local time matches.
    const targetIso = `${local.year}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}T${hours.start}:00`;
    // Parse as if it were UTC, then adjust for timezone offset.
    const asUtc = Date.parse(`${targetIso}Z`);
    // Find the actual UTC ms by iterating: compute what Intl says this is in tz, adjust.
    // Good-enough approximation: compute the offset of midnight at that date in tz.
    const midnightLocal = localTimeParts(asUtc, timezone);
    const diffMinutes =
      midnightLocal.hour * 60 + midnightLocal.minute - (start.hour * 60 + start.minute);
    const corrected = asUtc - diffMinutes * 60 * 1000;
    return corrected;
  }

  return null;
}

/**
 * Utility: sleep until the next active-hours window opens (approximately).
 * Returns immediately if currently active.
 */
export async function waitUntilActive(
  hours: ActiveHours,
  options: { maxWaitMs?: number; checkIntervalMs?: number } = {},
): Promise<void> {
  const maxWait = options.maxWaitMs ?? 7 * 24 * 60 * 60 * 1000; // 7 days cap
  const check = options.checkIntervalMs ?? 60 * 1000;
  const startWait = Date.now();
  while (!isWithinActiveHours(Date.now(), hours)) {
    if (Date.now() - startWait > maxWait) return;
    await new Promise((r) => setTimeout(r, check));
  }
}
