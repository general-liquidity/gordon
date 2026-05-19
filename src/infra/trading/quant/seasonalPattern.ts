/**
 * Seasonal & Calendar Patterns (GORDON_SEASONAL_PATTERN).
 *
 * From TSaM Ch 10. Aggregates historical returns by calendar bucket
 * (month, weekday, or pre/post-holiday) and reports the observed bias
 * with confidence intervals.
 *
 *   - Monthly bias:   mean return for each calendar month across years.
 *   - Weekday bias:   mean return per weekday (Mon–Fri).
 *   - Holiday effect: returns N days before / N days after a holiday.
 *
 * Useful for filtering trading days in strategies where a known seasonal
 * pattern provides an edge or, more commonly, where contrary timing is
 * a risk-reducing filter. The implementation is intentionally honest
 * about sample-size limits: small N produces wide confidence bands and
 * the operator should treat the result as suggestive rather than
 * conclusive.
 */

export const SEASONAL_PATTERN_FLAG_ENV = "GORDON_SEASONAL_PATTERN";

export function isSeasonalPatternEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[SEASONAL_PATTERN_FLAG_ENV] === "1" || env[SEASONAL_PATTERN_FLAG_ENV] === "true";
}

export interface DailyReturn {
  /** Trading-day timestamp in ms. */
  t: number;
  /** Single-period return (decimal, e.g. 0.012 for +1.2%). */
  ret: number;
}

export interface BucketResult {
  bucket: string;
  count: number;
  meanReturn: number;
  stdDev: number;
  fractionUp: number;
  confidence95Low: number;
  confidence95High: number;
}

export interface SeasonalReport {
  monthly: BucketResult[];
  weekday: BucketResult[];
  /** Most-biased bucket from the union of the two reports (by |meanReturn|). */
  strongestBias: BucketResult | null;
  sampleSize: number;
  reasoning: string;
}

function bucketStats(label: string, returns: number[]): BucketResult {
  const n = returns.length;
  if (n === 0) {
    return {
      bucket: label,
      count: 0,
      meanReturn: 0,
      stdDev: 0,
      fractionUp: 0,
      confidence95Low: 0,
      confidence95High: 0,
    };
  }
  let sum = 0;
  let upCount = 0;
  for (const r of returns) {
    sum += r;
    if (r > 0) upCount++;
  }
  const mean = sum / n;
  let ss = 0;
  for (const r of returns) ss += (r - mean) * (r - mean);
  const variance = n > 1 ? ss / (n - 1) : 0;
  const stdDev = Math.sqrt(variance);
  const se = n > 0 ? stdDev / Math.sqrt(n) : 0;
  return {
    bucket: label,
    count: n,
    meanReturn: mean,
    stdDev,
    fractionUp: upCount / n,
    confidence95Low: mean - 1.96 * se,
    confidence95High: mean + 1.96 * se,
  };
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function computeSeasonalPattern(returns: ReadonlyArray<DailyReturn>): SeasonalReport {
  const byMonth: number[][] = Array.from({ length: 12 }, () => []);
  const byWeekday: number[][] = Array.from({ length: 7 }, () => []);

  for (const r of returns) {
    const d = new Date(r.t);
    byMonth[d.getUTCMonth()]!.push(r.ret);
    byWeekday[d.getUTCDay()]!.push(r.ret);
  }

  const monthly = byMonth.map((arr, i) => bucketStats(MONTH_NAMES[i]!, arr));
  const weekday = byWeekday.map((arr, i) => bucketStats(WEEKDAY_NAMES[i]!, arr));

  const all = [...monthly, ...weekday].filter((b) => b.count >= 5);
  let strongest: BucketResult | null = null;
  for (const b of all) {
    if (!strongest || Math.abs(b.meanReturn) > Math.abs(strongest.meanReturn)) strongest = b;
  }

  return {
    monthly,
    weekday,
    strongestBias: strongest,
    sampleSize: returns.length,
    reasoning:
      strongest === null
        ? `no bucket with ≥5 samples (n=${returns.length})`
        : `strongest bias: ${strongest.bucket} mean ${(strongest.meanReturn * 100).toFixed(3)}% over ${strongest.count} obs`,
  };
}

export interface HolidayEffectInput {
  returns: ReadonlyArray<DailyReturn>;
  holidayDates: ReadonlyArray<number>;
  /** Days to inspect on each side. Default 1. */
  windowDays?: number;
}

export interface HolidayEffectResult {
  preHoliday: BucketResult;
  postHoliday: BucketResult;
  reasoning: string;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function computeHolidayEffect(input: HolidayEffectInput): HolidayEffectResult {
  const window = input.windowDays ?? 1;
  const windowMs = window * ONE_DAY_MS;
  const pre: number[] = [];
  const post: number[] = [];
  const holidaySet = new Set(
    input.holidayDates.map((d) => Math.floor(d / ONE_DAY_MS)),
  );
  for (const r of input.returns) {
    const day = Math.floor(r.t / ONE_DAY_MS);
    for (let offset = 1; offset <= window; offset++) {
      if (holidaySet.has(day + offset)) pre.push(r.ret);
      if (holidaySet.has(day - offset)) post.push(r.ret);
    }
    // Silence the unused-var warning when windowMs is unused.
    void windowMs;
  }
  return {
    preHoliday: bucketStats(`pre-holiday(±${window})`, pre),
    postHoliday: bucketStats(`post-holiday(±${window})`, post),
    reasoning: `pre-holiday n=${pre.length}, post-holiday n=${post.length}`,
  };
}

export function seasonalReportToPayload(report: SeasonalReport): Record<string, unknown> {
  return {
    kind: "seasonal_pattern.computed",
    sampleSize: report.sampleSize,
    strongestBias: report.strongestBias
      ? {
          bucket: report.strongestBias.bucket,
          meanReturn: Number(report.strongestBias.meanReturn.toFixed(6)),
          count: report.strongestBias.count,
        }
      : null,
  };
}
