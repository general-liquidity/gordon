import { describe, expect, test } from "bun:test";
import type { Mt5Bar } from "../../broker/mt5/bridgeClient.ts";
import {
  selectPairs,
  pairTargets,
  PAIRS_COMPETITION_CONFIG,
  type SelectedPair,
} from "./pairsCompetitionStrategy.ts";

// ---------------------------------------------------------------------------
// Synthetic cointegrated pair generator.
//
// Two log-price series sharing a common random-walk factor plus a mean-reverting
// (OU) spread → cointegrated by construction. priceB = exp(logFactor); priceA =
// exp(beta·logFactor + ouSpread). The OU spread has a short half-life so it
// passes the tradeable-HL gate; Hurst of the spread sits well below 0.5.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function cointegratedBars(
  n: number,
  seed: number,
  opts: { beta?: number; theta?: number; spreadVol?: number; basePrice?: number } = {},
): { a: Mt5Bar[]; b: Mt5Bar[] } {
  const rng = mulberry32(seed);
  const beta = opts.beta ?? 1.0;
  const theta = opts.theta ?? 0.15; // OU mean-reversion speed (half-life ≈ ln2/θ ≈ 4.6)
  const spreadVol = opts.spreadVol ?? 0.01;
  const base = Math.log(opts.basePrice ?? 100);

  let logFactor = base;
  let spread = 0;
  const a: Mt5Bar[] = [];
  const b: Mt5Bar[] = [];
  for (let i = 0; i < n; i++) {
    logFactor += 0.002 * gauss(rng); // common random-walk driver
    spread = (1 - theta) * spread + spreadVol * gauss(rng); // OU spread
    const logB = logFactor;
    const logA = beta * logFactor + spread;
    const time = 1_700_000_000 + i * 900; // 15-min cadence
    const cA = Math.exp(logA);
    const cB = Math.exp(logB);
    a.push({ time, open: cA, high: cA, low: cA, close: cA, tickVolume: 1, spread: 0, realVolume: 0 });
    b.push({ time, open: cB, high: cB, low: cB, close: cB, tickVolume: 1, spread: 0, realVolume: 0 });
  }
  return { a, b };
}

function randomWalkBars(n: number, seed: number, basePrice = 50): Mt5Bar[] {
  const rng = mulberry32(seed);
  let logP = Math.log(basePrice);
  const out: Mt5Bar[] = [];
  for (let i = 0; i < n; i++) {
    logP += 0.003 * gauss(rng);
    const c = Math.exp(logP);
    out.push({ time: 1_700_000_000 + i * 900, open: c, high: c, low: c, close: c, tickVolume: 1, spread: 0, realVolume: 0 });
  }
  return out;
}

// A cluster-valid metals pair (XAUUSD/XAGUSD is in PAIRS_CLUSTERS).
// beta=1.0 (a clean ratio pair, price-β≈1): the dynamic-hedge Kalman inits at β=1, so
// the OU spread is recovered from bar one. A β≠1 log-construction needs the slow
// competition delta (1e-7) many bars to converge and won't select in 500 — that's a
// fixture/convergence artifact, not a cointegration property. (XAU/XAG ≈ a ratio pair.)
function metalsUniverse(n: number, seed: number) {
  // theta=0.08 → OU half-life ≈ 4.2 bars after the Kalman dynamic-spread whitening,
  // comfortably inside the tradeable band (≥3). theta=0.15 sits right at the floor and
  // the Kalman pushes it just under — a borderline fixture, not a tradeable pair.
  const { a, b } = cointegratedBars(n, seed, { basePrice: 2000, beta: 1.0, theta: 0.08 });
  return { XAUUSD: a, XAGUSD: b };
}

describe("selectPairs", () => {
  test("selects a synthetic cointegrated metals pair", () => {
    const bars = metalsUniverse(500, 42);
    const selected = selectPairs(bars);
    expect(selected.length).toBe(1);
    const p = selected[0]!;
    expect(p.symbolA).toBe("XAUUSD");
    expect(p.symbolB).toBe("XAGUSD");
    expect(p.hurst).toBeLessThan(0.5); // mean-reverting spread
    expect(p.halfLife).toBeGreaterThan(0);
    expect(p.entryZ).toBeGreaterThan(0);
    expect(p.nObs).toBe(500);
  });

  test("rejects a non-cointegrated (independent random-walk) pair", () => {
    const bars = {
      XAUUSD: randomWalkBars(500, 1, 2000),
      XAGUSD: randomWalkBars(500, 999, 25),
    };
    const selected = selectPairs(bars);
    expect(selected.length).toBe(0);
  });

  test("ignores cross-cluster pairs (crypto vs metals never enumerated)", () => {
    const metals = metalsUniverse(500, 7);
    const bars = { ...metals, BTCUSD: randomWalkBars(500, 3, 60000) };
    const selected = selectPairs(bars);
    // Only XAUUSD/XAGUSD is a candidate; BTC has no same-cluster partner present.
    for (const p of selected) {
      const pairSet = new Set([p.symbolA, p.symbolB]);
      expect(pairSet.has("BTCUSD")).toBe(false);
    }
  });

  test("respects maxPairs cap", () => {
    // Three crypto names, all mutually cointegrated against a shared factor → 3
    // candidate pairs; cap at 2.
    const c1 = cointegratedBars(500, 11, { basePrice: 60000 });
    const cfg = { ...PAIRS_COMPETITION_CONFIG, maxPairs: 2 };
    const bars = {
      BTCUSD: c1.a,
      ETHUSD: c1.b,
      // SOL shares the same factor (derived from B) so it co-moves with both.
      SOLUSD: c1.b.map((bar) => ({ ...bar, close: bar.close * 0.5, open: bar.close * 0.5, high: bar.close * 0.5, low: bar.close * 0.5 })),
    };
    const selected = selectPairs(bars, { config: cfg });
    expect(selected.length).toBeLessThanOrEqual(2);
  });

  test("requires minObs aligned observations", () => {
    const bars = metalsUniverse(150, 5); // < default minObs 200
    const selected = selectPairs(bars);
    expect(selected.length).toBe(0);
  });
});

describe("pairTargets", () => {
  const bars = metalsUniverse(500, 42);
  const selected = selectPairs(bars);

  test("returns dollar-neutral per-leg targets (equal notional, opposite sides)", () => {
    expect(selected.length).toBe(1);
    const equity = 1_000_000;
    const targets = pairTargets(bars, selected, equity);
    expect(targets.length).toBe(1);
    const t = targets[0]!;

    if (t.sideA === "flat") {
      // Flat is a valid current state (z inside entry band); notionals must be 0.
      expect(t.notionalA).toBe(0);
      expect(t.notionalB).toBe(0);
      expect(t.sideB).toBe("flat");
    } else {
      // Active: dollar-matched legs, opposite directions.
      expect(t.notionalA).toBeGreaterThan(0);
      expect(t.notionalA).toBeCloseTo(t.notionalB, 6); // dollar-neutral
      expect(t.sideA === "buy" ? "sell" : "buy").toBe(t.sideB);
      // Per-leg notional capped at perPairFraction of equity.
      expect(t.notionalA).toBeLessThanOrEqual(equity * PAIRS_COMPETITION_CONFIG.perPairFraction + 1e-6);
    }
  });

  test("sign convention: long spread → buy A / sell B", () => {
    const equity = 1_000_000;
    const targets = pairTargets(bars, selected, equity);
    const t = targets[0]!;
    if (t.allocation > 1e-9) {
      expect(t.sideA).toBe("buy");
      expect(t.sideB).toBe("sell");
    } else if (t.allocation < -1e-9) {
      expect(t.sideA).toBe("sell");
      expect(t.sideB).toBe("buy");
    }
  });

  test("missing bars for a pair yields a flat target, not a throw", () => {
    const phantom: SelectedPair[] = [
      { symbolA: "FOO", symbolB: "BAR", hedgeRatio: 1, halfLife: 5, hurst: 0.4, entryZ: 2, nObs: 500 },
    ];
    const targets = pairTargets(bars, phantom, 1_000_000);
    expect(targets.length).toBe(1);
    expect(targets[0]!.sideA).toBe("flat");
    expect(targets[0]!.notionalA).toBe(0);
  });

  test("notional scales with equity", () => {
    const small = pairTargets(bars, selected, 100_000);
    const big = pairTargets(bars, selected, 1_000_000);
    const ts = small[0]!;
    const tb = big[0]!;
    if (ts.sideA !== "flat" && tb.sideA !== "flat") {
      expect(tb.notionalA).toBeGreaterThan(ts.notionalA);
      expect(tb.notionalA / ts.notionalA).toBeCloseTo(10, 4);
    }
  });
});
