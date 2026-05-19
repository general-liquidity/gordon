import { describe, it, expect } from "bun:test";

import {
  isTouchDynamicsEnabled,
  evaluateTouchDynamics,
  touchDynamicsToPayload,
  TOUCH_DYNAMICS_FLAG_ENV,
  type TouchSnapshot,
} from "./touchDynamics.ts";

describe("isTouchDynamicsEnabled", () => {
  it("respects the flag", () => {
    expect(isTouchDynamicsEnabled({})).toBe(false);
    expect(isTouchDynamicsEnabled({ [TOUCH_DYNAMICS_FLAG_ENV]: "1" })).toBe(true);
  });
});

function makeSnapshots(specs: Array<{ t: number; bid: number; ask: number; bs: number; as: number }>): TouchSnapshot[] {
  return specs.map((s) => ({ t: s.t, bestBid: s.bid, bestAsk: s.ask, bidSize: s.bs, askSize: s.as }));
}

describe("evaluateTouchDynamics — quiet baseline", () => {
  it("stable touch over 1 second → quiet state", () => {
    const snaps: TouchSnapshot[] = [];
    for (let i = 0; i < 10; i++) {
      snaps.push({ t: i * 100, bestBid: 100, bestAsk: 100.01, bidSize: 50, askSize: 50 });
    }
    const r = evaluateTouchDynamics({ snapshots: snaps });
    expect(r.state).toBe("quiet");
    expect(r.compositeScore).toBeLessThan(0.3);
  });
});

describe("evaluateTouchDynamics — hot regime detection", () => {
  it("high update rate + size flicker + jitter → hot", () => {
    const snaps: TouchSnapshot[] = [];
    for (let i = 0; i < 100; i++) {
      const sizeJitter = 100 + 90 * Math.sin(i * 1.7);
      const midJitter = (i % 2 === 0 ? 100 : 100.05);
      snaps.push({
        t: i * 5,
        bestBid: midJitter - 0.01,
        bestAsk: midJitter + 0.01,
        bidSize: sizeJitter,
        askSize: 200 - sizeJitter * 0.5,
      });
    }
    const r = evaluateTouchDynamics({ snapshots: snaps });
    expect(["elevated", "hot"]).toContain(r.state);
    expect(r.compositeScore).toBeGreaterThan(0.3);
  });
});

describe("evaluateTouchDynamics — sub-metrics", () => {
  it("update rate is computed per second", () => {
    const snaps: TouchSnapshot[] = [];
    for (let i = 0; i < 50; i++) {
      snaps.push({ t: i * 100, bestBid: 100, bestAsk: 100.01, bidSize: 50, askSize: 50 });
    }
    const r = evaluateTouchDynamics({ snapshots: snaps });
    expect(r.updateRatePerSec).toBeCloseTo(50 / 4.9, 1);
  });

  it("mid-jitter increases with reversals", () => {
    const stable = makeSnapshots(
      Array.from({ length: 20 }, (_, i) => ({ t: i * 10, bid: 100 + i * 0.01, ask: 100.01 + i * 0.01, bs: 50, as: 50 })),
    );
    const jittery = makeSnapshots(
      Array.from({ length: 20 }, (_, i) => ({
        t: i * 10,
        bid: i % 2 === 0 ? 100 : 100.01,
        ask: i % 2 === 0 ? 100.02 : 100.03,
        bs: 50,
        as: 50,
      })),
    );
    const a = evaluateTouchDynamics({ snapshots: stable });
    const b = evaluateTouchDynamics({ snapshots: jittery });
    expect(b.midJitter).toBeGreaterThan(a.midJitter);
  });

  it("size flicker CV is zero when sizes are constant", () => {
    const snaps: TouchSnapshot[] = [];
    for (let i = 0; i < 20; i++) {
      snaps.push({ t: i * 50, bestBid: 100, bestAsk: 100.01, bidSize: 100, askSize: 100 });
    }
    const r = evaluateTouchDynamics({ snapshots: snaps });
    expect(r.sizeFlickerCv).toBeLessThan(0.01);
  });
});

describe("evaluateTouchDynamics — boundary cases", () => {
  it("too few snapshots → quiet, insufficient", () => {
    const r = evaluateTouchDynamics({
      snapshots: [
        { t: 0, bestBid: 100, bestAsk: 100.01, bidSize: 50, askSize: 50 },
        { t: 1, bestBid: 100, bestAsk: 100.01, bidSize: 50, askSize: 50 },
      ],
    });
    expect(r.state).toBe("quiet");
    expect(r.reason).toContain("insufficient");
  });

  it("respects custom thresholds", () => {
    const snaps: TouchSnapshot[] = [];
    for (let i = 0; i < 20; i++) {
      snaps.push({ t: i * 10, bestBid: 100 + (i % 2) * 0.1, bestAsk: 100.05 + (i % 2) * 0.1, bidSize: 50, askSize: 100 + i });
    }
    const tight = evaluateTouchDynamics({ snapshots: snaps, hotThreshold: 0.1, elevatedThreshold: 0.05 });
    const lax = evaluateTouchDynamics({ snapshots: snaps, hotThreshold: 0.99, elevatedThreshold: 0.9 });
    expect(tight.state).not.toBe("quiet");
    expect(lax.state).toBe("quiet");
  });
});

describe("touchDynamicsToPayload", () => {
  it("emits stable shape", () => {
    const snaps: TouchSnapshot[] = [];
    for (let i = 0; i < 10; i++) {
      snaps.push({ t: i * 100, bestBid: 100, bestAsk: 100.01, bidSize: 50, askSize: 50 });
    }
    const r = evaluateTouchDynamics({ snapshots: snaps });
    const p = touchDynamicsToPayload(r) as { kind: string; state: string };
    expect(p.kind).toBe("touch_dynamics.evaluated");
    expect(typeof p.state).toBe("string");
  });
});
