import { describe, expect, it } from "bun:test";
import { detectGoalStall } from "./goal-progress-stall.ts";

describe("detectGoalStall", () => {
  it("monotonic improvement is never stalled", () => {
    const r = detectGoalStall([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7], { patience: 6 });
    expect(r.stalled).toBe(false);
    expect(r.recommendation).toBe("continue");
  });

  it("plateau after a jump → halt", () => {
    const r = detectGoalStall([0, 0.2, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], {
      patience: 6,
      minDelta: 0.01,
    });
    expect(r.stalled).toBe(true);
    expect(r.recommendation).toBe("halt");
    expect(r.cyclesSinceImprovement).toBeGreaterThanOrEqual(6);
  });

  it("slow-but-real progress (creeping below per-step delta) is NOT flagged", () => {
    // +0.005/cycle: each step < minDelta(0.01), but the window gain accumulates past it.
    const h = Array.from({ length: 12 }, (_, i) => i * 0.005);
    const r = detectGoalStall(h, { patience: 6, minDelta: 0.01 });
    expect(r.stalled).toBe(false); // 6 cycles × 0.005 = 0.03 best-gain ≥ 0.01
  });

  it("truly flat progress → halt", () => {
    const r = detectGoalStall([0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3], { patience: 5 });
    expect(r.stalled).toBe(true);
  });

  it("near-complete progress is not stalled even if flat", () => {
    const r = detectGoalStall([0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999, 0.999], {
      patience: 5,
    });
    expect(r.stalled).toBe(false);
    expect(r.recommendation).toBe("continue");
  });

  it("too little history → continue (too early to judge)", () => {
    const r = detectGoalStall([0.1, 0.1, 0.1], { patience: 6 });
    expect(r.recommendation).toBe("continue");
    expect(r.stalled).toBe(false);
  });

  it("warns before halting as the high goes stale", () => {
    // n=7 > patience=6; new high (0.4) at index 2, then flat — a new high landed inside the
    // window (so not yet a full stall), but it's been 4 cycles since → warning.
    const r = detectGoalStall([0, 0.2, 0.4, 0.4, 0.4, 0.4, 0.4], { patience: 6 });
    expect(r.recommendation).toBe("stall_warning");
    expect(r.stalled).toBe(false);
  });
});
