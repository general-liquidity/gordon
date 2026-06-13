import { describe, expect, test, beforeEach } from "bun:test";
import { parseEdgeSpec, type EdgeHealth, type EdgeMetrics } from "../../../../core/edge/index.ts";
import type { ProactiveObservation } from "../../engine/proactiveEngine.ts";
import type { ProactiveCandle } from "../candleFetch.ts";
import {
  edgeAssessmentProducer,
  computeEdgeAlerts,
  computeVolumePattern,
  collectEdgeMetrics,
  normalizeInstrument,
  resetEdgeAssessmentProducerState,
} from "./edgeAssessmentProducer.ts";

const LIVE_EDGE = parseEdgeSpec(`---
name: test-live-fade
strategy: mean-reversion
status: live
regime: [ranging, quiet]
instruments: [BTC/USDT]
---
## Hypothesis
Trapped buyers exit into the fade.
## Invariants
| id | metric | comparator | threshold | description |
|---|---|---|---|---|
| ev-net-positive | netEdgeBps | > | 0 | survives cost |
| regime-ranging | regime | in | ranging,quiet | range-bound only |
| liquidity-floor | avgVol1mUsd | >= | 100000 | depth |
## Kill Conditions
| id | metric | comparator | threshold | description |
|---|---|---|---|---|
| regime-flip | regime | not-in | ranging,quiet | regime left the range |
`);

function metricsMap(m: EdgeMetrics): Map<string, EdgeMetrics> {
  return new Map([["BTCUSDT", m]]);
}

function candle(volume: number, close = 100): ProactiveCandle {
  return { timestamp: 0, open: close, high: close, low: close, close, volume };
}

// All measurable invariants hold, no kill fires — isolates the decay verdict.
const HEALTHY: EdgeMetrics = { regime: "ranging", avgVol1mUsd: 250000, volumePattern: "flat" };
// evaluateDecay windows: recent 20 / baseline 40.
const STABLE_R = Array.from({ length: 60 }, () => 0.5); // ratio 1.0 → stable
const DEGRADED_R = [...Array.from({ length: 20 }, () => 0.25), ...Array.from({ length: 40 }, () => 0.5)]; // 0.5 → degraded
const DECAYED_R = [...Array.from({ length: 20 }, () => 0.1), ...Array.from({ length: 40 }, () => 0.5)]; // 0.2 → retire
const rByStrategy = (rs: ReadonlyArray<number>) => new Map([["mean-reversion", rs]]);

describe("normalizeInstrument", () => {
  test("maps pair/dash/bare forms to the candle-fetch key", () => {
    expect(normalizeInstrument("BTC/USDT")).toBe("BTCUSDT");
    expect(normalizeInstrument("eth-usdt")).toBe("ETHUSDT");
    expect(normalizeInstrument("SOL")).toBe("SOLUSDT");
    expect(normalizeInstrument("XAU/USD")).toBe("XAUUSD");
  });
});

describe("computeVolumePattern", () => {
  test("flags increasing when the recent window expands", () => {
    const c = [...Array(18).fill(candle(100)), ...Array(6).fill(candle(200))];
    expect(computeVolumePattern(c)).toBe("increasing");
  });
  test("flags decreasing when the recent window contracts", () => {
    const c = [...Array(18).fill(candle(200)), ...Array(6).fill(candle(100))];
    expect(computeVolumePattern(c)).toBe("decreasing");
  });
  test("flags flat when volume is steady and on too-short history", () => {
    expect(computeVolumePattern(Array(24).fill(candle(100)))).toBe("flat");
    expect(computeVolumePattern(Array(5).fill(candle(100)))).toBe("flat");
  });
});

describe("collectEdgeMetrics", () => {
  test("derives volumePattern + per-minute USD volume, regime when a detector is present", () => {
    const c = Array(30).fill(candle(60, 100)); // close*vol = 6000/bar
    const m = collectEdgeMetrics("BTCUSDT", c, { detectRegime: () => ({ regime: "ranging", confidence: 0.8 }) });
    expect(m.regime).toBe("ranging");
    expect(m.volumePattern).toBe("flat");
    expect(m.avgVol1mUsd).toBeCloseTo(6000 / 60, 5); // hourly 6000 → /60 per-minute
  });
  test("omits regime when no detector is available (fails safe, no throw)", () => {
    const m = collectEdgeMetrics("BTCUSDT", Array(30).fill(candle(60)), null);
    expect(m.regime).toBeUndefined();
  });
});

describe("computeEdgeAlerts", () => {
  let last: Map<string, EdgeHealth>;
  beforeEach(() => {
    last = new Map();
  });

  test("stable: no card when measurable invariants hold and no kill fires", () => {
    const cards = computeEdgeAlerts([LIVE_EDGE], metricsMap({ regime: "ranging", avgVol1mUsd: 250000, volumePattern: "flat" }), last);
    expect(cards).toHaveLength(0);
  });

  test("retire: urgent card when a kill condition fires", () => {
    const cards = computeEdgeAlerts([LIVE_EDGE], metricsMap({ regime: "trending_up", avgVol1mUsd: 250000 }), last);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.category).toBe("edge_health");
    expect(cards[0]!.severity).toBe("urgent");
    expect(cards[0]!.title).toContain("RETIRE");
    expect(cards[0]!.triggers.metadata?.health).toBe("retire");
  });

  test("degraded: normal card when a measurable invariant breaks but no kill fires", () => {
    const cards = computeEdgeAlerts([LIVE_EDGE], metricsMap({ regime: "ranging", avgVol1mUsd: 50000 }), last);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.severity).toBe("normal");
    expect(cards[0]!.triggers.metadata?.health).toBe("degraded");
    expect(cards[0]!.triggers.metadata?.breaks).toContain("liquidity-floor");
  });

  test("transition-only: a persistently degraded edge does not re-alert", () => {
    const m = metricsMap({ regime: "ranging", avgVol1mUsd: 50000 });
    expect(computeEdgeAlerts([LIVE_EDGE], m, last)).toHaveLength(1);
    expect(computeEdgeAlerts([LIVE_EDGE], m, last)).toHaveLength(0); // same level → silent
  });

  test("worsening escalates: degraded → retire fires the retire card", () => {
    expect(computeEdgeAlerts([LIVE_EDGE], metricsMap({ regime: "ranging", avgVol1mUsd: 50000 }), last)).toHaveLength(1);
    const escalated = computeEdgeAlerts([LIVE_EDGE], metricsMap({ regime: "trending_up", avgVol1mUsd: 50000 }), last);
    expect(escalated).toHaveLength(1);
    expect(escalated[0]!.triggers.metadata?.health).toBe("retire");
  });

  test("fails safe: a missing (trade-derived) metric never raises a card", () => {
    // Only volumePattern present — netEdgeBps/regime/avgVol1mUsd all absent.
    const cards = computeEdgeAlerts([LIVE_EDGE], metricsMap({ volumePattern: "flat" }), last);
    expect(cards).toHaveLength(0);
  });

  test("skips instruments with no collected metrics", () => {
    expect(computeEdgeAlerts([LIVE_EDGE], new Map(), last)).toHaveLength(0);
  });
});

describe("computeEdgeAlerts — decay composition (realized R)", () => {
  let last: Map<string, EdgeHealth>;
  beforeEach(() => {
    last = new Map();
  });

  test("invariants healthy + decay stable → no card", () => {
    expect(computeEdgeAlerts([LIVE_EDGE], metricsMap(HEALTHY), last, rByStrategy(STABLE_R))).toHaveLength(0);
  });

  test("invariants healthy + realized R collapsed → retire on decay alone", () => {
    const cards = computeEdgeAlerts([LIVE_EDGE], metricsMap(HEALTHY), last, rByStrategy(DECAYED_R));
    expect(cards).toHaveLength(1);
    expect(cards[0]!.triggers.metadata?.health).toBe("retire");
    expect(cards[0]!.triggers.metadata?.breaks).toContain("decay");
    expect(cards[0]!.body).toContain("realized R decayed");
  });

  test("invariants healthy + realized R eroded → degraded with a scale-down multiplier", () => {
    const cards = computeEdgeAlerts([LIVE_EDGE], metricsMap(HEALTHY), last, rByStrategy(DEGRADED_R));
    expect(cards).toHaveLength(1);
    expect(cards[0]!.severity).toBe("normal");
    expect(cards[0]!.triggers.metadata?.health).toBe("degraded");
    expect(Number(cards[0]!.triggers.metadata?.sizeMultiplier)).toBeLessThan(1);
    expect(cards[0]!.body).toContain("Scale");
  });

  test("kill fired AND decay both → single retire card naming both drivers", () => {
    const cards = computeEdgeAlerts([LIVE_EDGE], metricsMap({ regime: "trending_up", avgVol1mUsd: 250000 }), last, rByStrategy(DECAYED_R));
    expect(cards).toHaveLength(1);
    expect(cards[0]!.triggers.metadata?.health).toBe("retire");
    expect(cards[0]!.triggers.metadata?.breaks).toEqual(expect.arrayContaining(["regime-flip", "decay"]));
  });

  test("no rMultiples for the strategy → behaves exactly as the invariant-only path", () => {
    // Empty map (or unknown strategy) means no decay verdict; healthy market = no card.
    expect(computeEdgeAlerts([LIVE_EDGE], metricsMap(HEALTHY), last, new Map())).toHaveLength(0);
  });
});

describe("edgeAssessmentProducer guard", () => {
  beforeEach(() => resetEdgeAssessmentProducerState());

  test("ignores non-tick observations", async () => {
    const busObs: ProactiveObservation = { source: "event_bus", eventType: "tick_edge_assessment", timestamp: 0 };
    expect(await edgeAssessmentProducer(busObs)).toEqual([]);
  });

  test("ignores the wrong tick eventType", async () => {
    const wrong: ProactiveObservation = { source: "monitor_loop", eventType: "tick_volatility", timestamp: 0 };
    expect(await edgeAssessmentProducer(wrong)).toEqual([]);
  });
});
