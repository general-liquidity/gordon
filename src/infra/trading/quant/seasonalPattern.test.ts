import { describe, it, expect } from "bun:test";
import {
  computeSeasonalPattern,
  computeHolidayEffect,
  seasonalReportToPayload,
  type DailyReturn,
} from "./seasonalPattern.ts";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function build(years: number, biasByMonth: Record<number, number>): DailyReturn[] {
  const out: DailyReturn[] = [];
  const start = Date.UTC(2010, 0, 1);
  for (let y = 0; y < years; y++) {
    for (let day = 0; day < 365; day++) {
      const t = start + y * 365 * ONE_DAY_MS + day * ONE_DAY_MS;
      const month = new Date(t).getUTCMonth();
      const bias = biasByMonth[month] ?? 0;
      out.push({ t, ret: bias });
    }
  }
  return out;
}

describe("computeSeasonalPattern", () => {
  it("detects a constructed January-positive bias", () => {
    const data = build(5, { 0: 0.005 });
    const r = computeSeasonalPattern(data);
    const jan = r.monthly.find((m) => m.bucket === "Jan")!;
    expect(jan.meanReturn).toBeGreaterThan(0.004);
    expect(jan.fractionUp).toBeGreaterThan(0.99);
  });

  it("strongestBias points to the biggest mean magnitude", () => {
    const data = build(3, { 5: -0.01, 11: 0.002 });
    const r = computeSeasonalPattern(data);
    expect(r.strongestBias).not.toBeNull();
    expect(r.strongestBias!.bucket).toBe("Jun");
  });

  it("empty input → no strongest bias, reason mentions samples", () => {
    const r = computeSeasonalPattern([]);
    expect(r.strongestBias).toBeNull();
    expect(r.reasoning).toContain("no bucket");
  });

  it("confidence interval brackets the mean", () => {
    const data = build(5, { 0: 0.003 });
    const r = computeSeasonalPattern(data);
    const jan = r.monthly.find((m) => m.bucket === "Jan")!;
    expect(jan.confidence95Low).toBeLessThanOrEqual(jan.meanReturn);
    expect(jan.confidence95High).toBeGreaterThanOrEqual(jan.meanReturn);
  });
});

describe("computeHolidayEffect", () => {
  it("captures positive bias on the day before a constructed holiday", () => {
    const start = Date.UTC(2024, 0, 1);
    const returns: DailyReturn[] = [];
    for (let day = 0; day < 100; day++) {
      const t = start + day * ONE_DAY_MS;
      const isPreHoliday = day === 9 || day === 19 || day === 29;
      returns.push({ t, ret: isPreHoliday ? 0.01 : 0.0 });
    }
    const holidays = [10, 20, 30].map((d) => start + d * ONE_DAY_MS);
    const r = computeHolidayEffect({ returns, holidayDates: holidays });
    expect(r.preHoliday.count).toBe(3);
    expect(r.preHoliday.meanReturn).toBeGreaterThan(0);
  });
});

describe("seasonalReportToPayload", () => {
  it("emits a stable shape", () => {
    const r = computeSeasonalPattern(build(3, { 6: 0.002 }));
    const p = seasonalReportToPayload(r) as { kind: string; strongestBias: unknown };
    expect(p.kind).toBe("seasonal_pattern.computed");
  });
});
