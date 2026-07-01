import { describe, expect, it } from "bun:test";
import {
  evaluateFollowThroughDay,
  formatFollowThroughDay,
  type FtdBar,
} from "./followThroughDay.ts";

// Convenience bar builder — a flat-ish bar around `close`.
const bar = (close: number, volume: number, low = close - 1, high = close + 1): FtdBar => ({
  high,
  low,
  close,
  volume,
});

describe("evaluateFollowThroughDay", () => {
  it("returns no_rally for too-few bars", () => {
    const r = evaluateFollowThroughDay([bar(100, 1000)]);
    expect(r.phase).toBe("no_rally");
    expect(r.followThrough).toBeNull();
  });

  it("confirms an uptrend when a valid FTD fires on day 4+ with rising volume", () => {
    // Decline to a low, then a rally attempt with Day 1 = first up-close,
    // and an FTD on day 4 with a big up-close on higher volume.
    const bars: FtdBar[] = [
      bar(110, 1000),
      bar(105, 1100),
      bar(100, 1200), // fresh low (low=99) — the bottom
      bar(101, 1000), // Day 1: first up-close
      bar(102, 1000), // Day 2
      bar(103, 1000), // Day 3
      bar(107, 1500), // Day 4: +3.9% on higher volume -> FTD
    ];
    const r = evaluateFollowThroughDay(bars);
    expect(r.phase).toBe("confirmed_uptrend");
    expect(r.everConfirmed).toBe(true);
    expect(r.followThrough).not.toBeNull();
    expect(r.followThrough!.index).toBe(6);
    expect(r.followThrough!.rallyDay).toBe(4);
    expect(r.followThrough!.gain).toBeGreaterThan(0.0125);
    expect(r.followThrough!.volumeRatio).toBeGreaterThan(1);
  });

  it("does NOT confirm an FTD before minRallyDay even if the gain qualifies", () => {
    const bars: FtdBar[] = [
      bar(110, 1000),
      bar(100, 1200), // fresh low
      bar(101, 1000), // Day 1
      bar(106, 1500), // Day 2: +4.95% higher volume but too early
    ];
    const r = evaluateFollowThroughDay(bars);
    expect(r.phase).toBe("rally_attempt");
    expect(r.followThrough).toBeNull();
  });

  it("rejects an FTD candidate on LOWER volume", () => {
    const bars: FtdBar[] = [
      bar(110, 2000),
      bar(100, 2000), // fresh low
      bar(101, 1000), // Day 1
      bar(102, 1000), // Day 2
      bar(103, 1000), // Day 3
      bar(107, 800), // Day 4: big gain but volume fell -> not an FTD
    ];
    const r = evaluateFollowThroughDay(bars);
    expect(r.phase).toBe("rally_attempt");
    expect(r.followThrough).toBeNull();
  });

  it("resets the attempt when the rally low is undercut before an FTD", () => {
    const bars: FtdBar[] = [
      bar(110, 1000),
      bar(100, 1200, 99), // low 99
      bar(101, 1000), // Day 1
      bar(102, 1000), // Day 2
      bar(96, 1300, 95), // undercut -> fresh low, attempt resets
      bar(97, 1000), // new Day 1
    ];
    const r = evaluateFollowThroughDay(bars);
    expect(r.phase).toBe("rally_attempt");
    expect(r.rallyStartIndex).toBe(5);
    expect(r.rallyLow).toBe(95);
  });

  it("flags undercut when a confirmed uptrend makes a lower low", () => {
    const bars: FtdBar[] = [
      bar(110, 1000),
      bar(100, 1200, 99), // low 99
      bar(101, 1000), // Day 1
      bar(102, 1000), // Day 2
      bar(103, 1000), // Day 3
      bar(107, 1500), // Day 4 FTD
      bar(90, 2000, 89), // lower low -> undercut kills the uptrend
    ];
    const r = evaluateFollowThroughDay(bars);
    expect(r.everConfirmed).toBe(true);
    expect(r.phase).toBe("undercut");
    expect(r.followThrough).toBeNull();
  });

  it("honors a custom gain threshold", () => {
    const bars: FtdBar[] = [
      bar(110, 1000),
      bar(100, 1200), // fresh low
      bar(101, 1000), // Day 1
      bar(102, 1000), // Day 2
      bar(103, 1000), // Day 3
      bar(104, 1500), // Day 4: +0.97% on higher volume
    ];
    // Default 1.25% -> not an FTD.
    expect(evaluateFollowThroughDay(bars).phase).toBe("rally_attempt");
    // Loosen to 0.5% -> qualifies.
    const loose = evaluateFollowThroughDay(bars, { ftdGainThreshold: 0.005 });
    expect(loose.phase).toBe("confirmed_uptrend");
  });

  it("formats a readable report", () => {
    const bars: FtdBar[] = [
      bar(110, 1000),
      bar(100, 1200),
      bar(101, 1000),
      bar(102, 1000),
      bar(103, 1000),
      bar(107, 1500),
    ];
    const text = formatFollowThroughDay(evaluateFollowThroughDay(bars));
    expect(text).toContain("Follow-Through Day");
    expect(text).toContain("FTD bar");
  });
});
