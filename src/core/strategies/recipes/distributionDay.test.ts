import { describe, expect, it } from "bun:test";
import {
  evaluateDistributionDays,
  formatDistributionDays,
  type DistributionBar,
} from "./distributionDay.ts";

const bar = (close: number, volume: number): DistributionBar => ({ close, volume });

// Build a steady decline: each session down ~1% on rising volume, so every
// step after the first is a distribution day (no 5% rally ever occurs).
function decline(n: number): DistributionBar[] {
  const bars: DistributionBar[] = [];
  let close = 100;
  let volume = 1000;
  for (let i = 0; i < n; i++) {
    bars.push(bar(parseFloat(close.toFixed(4)), volume));
    close *= 0.99;
    volume += 100;
  }
  return bars;
}

describe("evaluateDistributionDays", () => {
  it("returns NORMAL/empty for too-few bars", () => {
    const r = evaluateDistributionDays([bar(100, 1000)]);
    expect(r.severity).toBe("NORMAL");
    expect(r.liveCount).toBe(0);
    expect(r.days).toHaveLength(0);
  });

  it("flags a single down-on-higher-volume session as one distribution day", () => {
    const r = evaluateDistributionDays([bar(100, 1000), bar(99, 1200)]);
    expect(r.liveCount).toBe(1);
    expect(r.clustersLast5).toBe(1);
    expect(r.severity).toBe("NORMAL");
    expect(r.days[0]!.live).toBe(true);
  });

  it("does NOT count a down day on LOWER volume", () => {
    const r = evaluateDistributionDays([bar(100, 1000), bar(99, 800)]);
    expect(r.liveCount).toBe(0);
    expect(r.days).toHaveLength(0);
  });

  it("does NOT count a shallow down day below the threshold", () => {
    // -0.1% is inside the default -0.2% threshold -> not distribution.
    const shallow = evaluateDistributionDays([bar(100, 1000), bar(99.9, 1200)]);
    expect(shallow.liveCount).toBe(0);
    // Loosen the threshold and it now counts.
    const loose = evaluateDistributionDays([bar(100, 1000), bar(99.9, 1200)], {
      downThreshold: -0.0005,
    });
    expect(loose.liveCount).toBe(1);
  });

  it("invalidates a distribution day when the index later closes 5% above its close", () => {
    // idx1 is a distribution day (close 99); idx3 closes 105 (>99*1.05=103.95).
    const bars = [bar(100, 1000), bar(99, 1200), bar(100, 900), bar(105, 950)];
    const r = evaluateDistributionDays(bars);
    const d = r.days.find((x) => x.index === 1)!;
    expect(d.invalidated).toBe(true);
    expect(d.live).toBe(false);
    expect(r.liveCount).toBe(0);
  });

  it("expires a distribution day once it ages out of the window", () => {
    // window 3: idx1 distribution day, then flat bars push it to sessionsAgo=3.
    const bars = [bar(100, 1000), bar(99, 1200), bar(99, 1000), bar(99, 1000), bar(99, 1000)];
    const r = evaluateDistributionDays(bars, { window: 3 });
    const d = r.days.find((x) => x.index === 1)!;
    expect(d.expired).toBe(true);
    expect(d.live).toBe(false);
    expect(r.liveCount).toBe(0);
  });

  it("maps live counts to severity bands", () => {
    // 3 dist days -> CAUTION.
    expect(evaluateDistributionDays(decline(4)).severity).toBe("CAUTION");
    expect(evaluateDistributionDays(decline(4)).liveCount).toBe(3);
    // 5 dist days -> HIGH.
    expect(evaluateDistributionDays(decline(6)).severity).toBe("HIGH");
    expect(evaluateDistributionDays(decline(6)).liveCount).toBe(5);
    // 6+ dist days -> SEVERE.
    expect(evaluateDistributionDays(decline(7)).severity).toBe("SEVERE");
    expect(evaluateDistributionDays(decline(7)).liveCount).toBe(6);
  });

  it("reports clustering over the 5 / 15 / 25 horizons", () => {
    const r = evaluateDistributionDays(decline(7));
    // 7 bars -> dist days at idx 1..6, sessionsAgo 5..0.
    expect(r.clustersLast5).toBe(5); // sessionsAgo 0..4
    expect(r.clustersLast15).toBe(6);
    expect(r.clustersLast25).toBe(6);
  });

  it("formats a readable report", () => {
    const text = formatDistributionDays(evaluateDistributionDays(decline(7)));
    expect(text).toContain("Distribution Days — SEVERE");
    expect(text).toContain("Live count");
  });
});
