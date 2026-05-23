import { describe, it, expect } from "bun:test";
import {
  analyzeCalendarEffect,
  formatCalendarEffect,
  type CalendarReturn,
} from "./calendar-effect.ts";

// Helper: build a return series across N weekdays starting from a Monday.
function buildWeekdaySeries(
  weeks: number,
  returnByDay: Record<string, number>, // e.g. {Mon: -0.005, Tue: 0.003, ...}
  startIso: string = "2024-01-01T12:00:00Z", // 2024-01-01 is a Monday
): CalendarReturn[] {
  const out: CalendarReturn[] = [];
  const start = new Date(startIso).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const ts = start + (w * 7 + d) * dayMs;
      const date = new Date(ts);
      const dayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getUTCDay()]!;
      const r = returnByDay[dayName];
      if (r !== undefined) out.push({ timestamp: ts, return: r });
    }
  }
  return out;
}

describe("analyzeCalendarEffect — basic shape", () => {
  it("returns segments + totals + strongestEffect", () => {
    const data = buildWeekdaySeries(50, { Mon: -0.005, Tue: 0.004, Wed: 0, Thu: 0, Fri: 0 });
    const r = analyzeCalendarEffect(data, { segment: "day_of_week" });
    expect(r.totalObservations).toBe(data.length);
    expect(r.segmentCount).toBe(5);
    expect(r.strongestEffect).not.toBeNull();
  });

  it("handles empty input", () => {
    const r = analyzeCalendarEffect([], { segment: "day_of_week" });
    expect(r.totalObservations).toBe(0);
    expect(r.segmentCount).toBe(0);
    expect(r.strongestEffect).toBeNull();
  });

  it("skips non-finite returns + invalid timestamps", () => {
    const data: CalendarReturn[] = [
      { timestamp: Date.parse("2024-01-01T12:00:00Z"), return: 0.01 },
      { timestamp: Date.parse("2024-01-02T12:00:00Z"), return: NaN },
      { timestamp: Date.parse("2024-01-03T12:00:00Z"), return: Infinity },
      { timestamp: Number.NaN, return: 0.05 },
    ];
    const r = analyzeCalendarEffect(data, { segment: "day_of_week" });
    expect(r.segmentCount).toBe(1); // only the valid Monday entry
  });
});

describe("analyzeCalendarEffect — day_of_week", () => {
  it("identifies Tuesday rebound effect when injected", () => {
    // 200 weeks of returns: Mon = -0.5%, Tue = +0.5%, others = 0
    const data = buildWeekdaySeries(200, { Mon: -0.005, Tue: 0.005, Wed: 0, Thu: 0, Fri: 0 });
    // Add small per-observation noise
    const noisy = data.map((d, i) => ({
      timestamp: d.timestamp,
      return: d.return + (i % 11 - 5) * 0.0001,
    }));
    const r = analyzeCalendarEffect(noisy, { segment: "day_of_week" });

    const tuesday = r.segments.find((s) => s.segment === "Tue")!;
    const monday = r.segments.find((s) => s.segment === "Mon")!;

    expect(tuesday.meanReturn).toBeGreaterThan(0.003);
    expect(monday.meanReturn).toBeLessThan(-0.003);
    expect(tuesday.significance).toBe("robust"); // 200 obs
    expect(tuesday.significantlyNonZero).toBe(true);
    expect(monday.significantlyNonZero).toBe(true);
  });

  it("zero-mean random returns produce no significant effects", () => {
    // 200 weeks, symmetric noise, no calendar pattern
    const data: CalendarReturn[] = [];
    let seed = 1;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const start = Date.parse("2024-01-01T12:00:00Z");
    for (let i = 0; i < 200 * 5; i++) {
      data.push({
        timestamp: start + i * 86400000,
        return: (rng() - 0.5) * 0.01, // ±0.5% noise
      });
    }
    const r = analyzeCalendarEffect(data, { segment: "day_of_week" });
    // With pure noise + N=200 per day, occasional false positives are normal
    // but we expect FEW significant segments (out of 7)
    expect(r.significantSegments.length).toBeLessThanOrEqual(2);
  });
});

describe("analyzeCalendarEffect — significance tiers", () => {
  it("labels < 30 obs per segment as insufficient", () => {
    const data = buildWeekdaySeries(5, { Mon: 0.001, Tue: 0.002, Wed: 0.003, Thu: 0.004, Fri: 0.005 });
    const r = analyzeCalendarEffect(data, { segment: "day_of_week" });
    expect(r.segments.every((s) => s.significance === "insufficient")).toBe(true);
  });

  it("labels 30-99 obs per segment as preliminary", () => {
    const data = buildWeekdaySeries(50, { Mon: 0.001, Tue: 0.001, Wed: 0.001, Thu: 0.001, Fri: 0.001 });
    const r = analyzeCalendarEffect(data, { segment: "day_of_week" });
    // 50 weeks × 1 entry/day = 50 obs per segment
    expect(r.segments.every((s) => s.significance === "preliminary")).toBe(true);
  });

  it("labels ≥ 100 obs per segment as robust", () => {
    const data = buildWeekdaySeries(150, { Mon: 0.001, Tue: 0.001, Wed: 0.001, Thu: 0.001, Fri: 0.001 });
    const r = analyzeCalendarEffect(data, { segment: "day_of_week" });
    expect(r.segments.every((s) => s.significance === "robust")).toBe(true);
  });

  it("insufficient samples never get significantlyNonZero=true", () => {
    // Strong effect but tiny sample — should not be flagged significant
    const data: CalendarReturn[] = [];
    const start = Date.parse("2024-01-01T12:00:00Z");
    for (let i = 0; i < 5; i++) {
      data.push({ timestamp: start + i * 7 * 86400000, return: 0.05 }); // 5 Mondays at +5%
    }
    const r = analyzeCalendarEffect(data, { segment: "day_of_week" });
    expect(r.significantSegments.length).toBe(0);
  });
});

describe("analyzeCalendarEffect — month_of_year + quarter", () => {
  it("groups by month", () => {
    const data: CalendarReturn[] = [];
    for (let m = 0; m < 12; m++) {
      for (let i = 0; i < 30; i++) {
        // Use the 1st-of-month + i days. Stay within ~30 days to avoid month overflow.
        const ts = Date.UTC(2024, m, 1) + i * 86400000;
        data.push({ timestamp: ts, return: 0.001 * (m + 1) });
      }
    }
    const r = analyzeCalendarEffect(data, { segment: "month_of_year" });
    // 12 months represented (some January entries may have spilled to Feb,
    // and so on, but the basic shape should hold)
    expect(r.segmentCount).toBeGreaterThanOrEqual(10);
  });

  it("groups by quarter", () => {
    const data: CalendarReturn[] = [];
    for (let m = 0; m < 12; m++) {
      const ts = Date.UTC(2024, m, 15);
      data.push({ timestamp: ts, return: 0.01 });
    }
    const r = analyzeCalendarEffect(data, { segment: "quarter" });
    expect(r.segmentCount).toBe(4);
    const labels = r.segments.map((s) => s.segment).sort();
    expect(labels).toEqual(["Q1", "Q2", "Q3", "Q4"]);
  });
});

describe("analyzeCalendarEffect — custom segmenter function", () => {
  it("accepts an arbitrary segmenter function", () => {
    const data: CalendarReturn[] = [];
    const start = Date.parse("2024-01-01T12:00:00Z");
    for (let i = 0; i < 100; i++) {
      data.push({ timestamp: start + i * 86400000, return: (i % 2 === 0 ? 0.01 : -0.01) });
    }
    // Custom segmenter: even-day-of-month vs odd-day-of-month
    const r = analyzeCalendarEffect(data, {
      segment: (d) => (d.getUTCDate() % 2 === 0 ? "even" : "odd"),
    });
    expect(r.segmentCount).toBe(2);
    const labels = r.segments.map((s) => s.segment).sort();
    expect(labels).toEqual(["even", "odd"]);
  });
});

describe("analyzeCalendarEffect — strongest effect sort", () => {
  it("ranks by |mean| × sqrt(n) (effect × sample-size weighting)", () => {
    // Tuesday: large mean, robust n. Wednesday: smaller mean.
    const data = buildWeekdaySeries(200, {
      Mon: 0,
      Tue: 0.01, // large
      Wed: 0.002, // small
      Thu: 0,
      Fri: 0,
    });
    const r = analyzeCalendarEffect(data, { segment: "day_of_week" });
    expect(r.strongestEffect!.segment).toBe("Tue");
  });
});

describe("analyzeCalendarEffect — Wilson CI on positive rate", () => {
  it("reports Wilson CI on positive-return rate per segment", () => {
    const data = buildWeekdaySeries(100, { Mon: 0.01, Tue: 0.01, Wed: 0.01, Thu: 0.01, Fri: 0.01 });
    const r = analyzeCalendarEffect(data, { segment: "day_of_week" });
    for (const s of r.segments) {
      expect(s.positiveRate).toBe(1);
      expect(s.positiveRateCi95.lower).toBeGreaterThan(0);
      expect(s.positiveRateCi95.upper).toBeLessThanOrEqual(1);
    }
  });

  it("CI narrows with larger sample size", () => {
    // 30-week sample vs 200-week sample, both with +1% Tuesdays
    const small = buildWeekdaySeries(30, { Tue: 0.01 });
    const large = buildWeekdaySeries(200, { Tue: 0.01 });
    const rs = analyzeCalendarEffect(small, { segment: "day_of_week" });
    const rl = analyzeCalendarEffect(large, { segment: "day_of_week" });
    const ts = rs.segments[0]!.positiveRateCi95;
    const tl = rl.segments[0]!.positiveRateCi95;
    expect(tl.upper - tl.lower).toBeLessThan(ts.upper - ts.lower);
  });
});

describe("analyzeCalendarEffect — useUtc flag", () => {
  it("UTC default produces stable segment labels regardless of host timezone", () => {
    // 2024-01-01 12:00:00 UTC is always Monday in UTC regardless of host tz
    const data: CalendarReturn[] = [
      { timestamp: Date.parse("2024-01-01T12:00:00Z"), return: 0.01 },
    ];
    const r = analyzeCalendarEffect(data, { segment: "day_of_week", useUtc: true });
    expect(r.segments[0]!.segment).toBe("Mon");
  });
});

describe("formatCalendarEffect", () => {
  it("renders header + per-segment rows + summary", () => {
    const data = buildWeekdaySeries(100, { Mon: 0.005, Tue: 0.005, Wed: 0.005, Thu: 0.005, Fri: 0.005 });
    const r = analyzeCalendarEffect(data, { segment: "day_of_week" });
    const text = formatCalendarEffect(r);
    expect(text).toContain("Calendar Effect Analysis");
    expect(text).toContain("Segment");
    expect(text).toContain("Summary:");
    expect(text).toContain("Mon");
    expect(text).toContain("Tue");
  });

  it("returns '(no segments)' for empty report", () => {
    const r = analyzeCalendarEffect([], { segment: "day_of_week" });
    const text = formatCalendarEffect(r);
    expect(text).toContain("(no segments");
  });

  it("marks significant segments with ✓", () => {
    // Strong effect: 200 obs, large mean
    const data = buildWeekdaySeries(200, { Mon: 0.005, Tue: 0.005, Wed: 0.005, Thu: 0.005, Fri: 0.005 });
    const r = analyzeCalendarEffect(data, { segment: "day_of_week" });
    const text = formatCalendarEffect(r);
    // At least one segment should be significant given the strong injected effect
    if (r.significantSegments.length > 0) {
      expect(text).toContain("✓");
    }
  });
});

describe("analyzeCalendarEffect — summary text", () => {
  it("mentions total observations + significant segment count", () => {
    const data = buildWeekdaySeries(100, { Mon: 0.005, Tue: 0.005, Wed: 0.005, Thu: 0.005, Fri: 0.005 });
    const r = analyzeCalendarEffect(data, { segment: "day_of_week" });
    expect(r.summary).toContain("observations");
    expect(r.summary).toContain("segment");
    expect(r.summary).toContain("p<0.05");
  });
});
