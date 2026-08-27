import { describe, expect, test } from "bun:test";
import {
  calibrateMaeStop,
  formatMaeStopCalibrator,
  type CalibratorTrade,
} from "./mae-stop-calibrator.ts";

function winnerTrade(id: string, mae: number, gainPct = 0.05): CalibratorTrade {
  return {
    tradeId: id,
    side: "LONG",
    entryPrice: 100,
    exitPrice: 100 * (1 + gainPct),
    maxAdverseExcursionPct: mae,
    maxFavorableExcursionPct: gainPct,
  };
}

function loserTrade(id: string, mae: number, lossPct = 0.05): CalibratorTrade {
  return {
    tradeId: id,
    side: "LONG",
    entryPrice: 100,
    exitPrice: 100 * (1 - lossPct),
    maxAdverseExcursionPct: mae,
    maxFavorableExcursionPct: 0,
  };
}

describe("calibrateMaeStop", () => {
  test("too few winners → insufficient_data", () => {
    const trades = [winnerTrade("w1", 0.01), winnerTrade("w2", 0.015), loserTrade("l1", 0.05)];
    const r = calibrateMaeStop(trades);
    expect(r.verdict).toBe("insufficient_data");
  });

  test("Jaimin scenario: winners' MAE never exceeds 2.5%, current stop 5% → tighten", () => {
    const trades: CalibratorTrade[] = [];
    for (let i = 0; i < 20; i++) {
      trades.push(winnerTrade(`w${i}`, 0.005 + (i % 5) * 0.004));
    }
    for (let i = 0; i < 10; i++) {
      trades.push(loserTrade(`l${i}`, 0.05));
    }
    const r = calibrateMaeStop(trades, { currentStopPct: 0.05 });
    expect(r.verdict).toBe("tighten_stop_recommended");
    expect(r.recommendedTightStopPct!).toBeLessThan(0.05);
    expect(r.counterfactual).not.toBeNull();
    expect(r.counterfactual!.winnersPreservedAtNewStop).toBeGreaterThanOrEqual(19);
  });

  test("current stop within tolerance → current_stop_is_appropriate", () => {
    const trades: CalibratorTrade[] = [];
    for (let i = 0; i < 20; i++) {
      trades.push(winnerTrade(`w${i}`, 0.02 + (i % 5) * 0.001));
    }
    for (let i = 0; i < 10; i++) trades.push(loserTrade(`l${i}`, 0.025));
    const r = calibrateMaeStop(trades, {
      currentStopPct: 0.025,
      appropriateToleranceFraction: 0.2,
    });
    expect(r.verdict).toBe("current_stop_is_appropriate");
  });

  test("widen_stop_needed: stop is tighter than P95 winner MAE", () => {
    const trades: CalibratorTrade[] = [];
    for (let i = 0; i < 20; i++) {
      trades.push(winnerTrade(`w${i}`, 0.03 + (i % 5) * 0.002));
    }
    for (let i = 0; i < 10; i++) trades.push(loserTrade(`l${i}`, 0.05));
    const r = calibrateMaeStop(trades, { currentStopPct: 0.015 });
    expect(r.verdict).toBe("widen_stop_needed");
  });

  test("no currentStopPct supplied → defaults to tighten recommendation", () => {
    const trades: CalibratorTrade[] = [];
    for (let i = 0; i < 20; i++) trades.push(winnerTrade(`w${i}`, 0.01));
    for (let i = 0; i < 10; i++) trades.push(loserTrade(`l${i}`, 0.05));
    const r = calibrateMaeStop(trades);
    expect(r.verdict).toBe("tighten_stop_recommended");
    expect(r.counterfactual).toBeNull();
  });

  test("computes MAE from high/low when not pre-computed", () => {
    const trades: CalibratorTrade[] = [];
    for (let i = 0; i < 15; i++) {
      trades.push({
        tradeId: `w${i}`,
        side: "LONG",
        entryPrice: 100,
        exitPrice: 105,
        highWhileOpen: 106,
        lowWhileOpen: 98,
      });
    }
    const r = calibrateMaeStop(trades);
    expect(r.perTrade[0]!.mae).toBeCloseTo(0.02, 4); // (100-98)/100
    expect(r.perTrade[0]!.mfe).toBeCloseTo(0.06, 4); // (106-100)/100
  });

  test("SHORT trades: MAE/MFE inverted correctly", () => {
    const trades: CalibratorTrade[] = [];
    for (let i = 0; i < 15; i++) {
      trades.push({
        tradeId: `s${i}`,
        side: "SHORT",
        entryPrice: 100,
        exitPrice: 95,
        highWhileOpen: 102, // adverse for SHORT
        lowWhileOpen: 93, // favorable for SHORT
      });
    }
    const r = calibrateMaeStop(trades);
    expect(r.perTrade[0]!.mae).toBeCloseTo(0.02, 4);
    expect(r.perTrade[0]!.mfe).toBeCloseTo(0.07, 4);
  });

  test("explicit outcome label is respected over computed", () => {
    const trades: CalibratorTrade[] = [];
    // A losing-by-PnL trade flagged as breakeven should be excluded from loser stats
    for (let i = 0; i < 15; i++) {
      trades.push(winnerTrade(`w${i}`, 0.01));
    }
    trades.push({
      tradeId: "be1",
      side: "LONG",
      entryPrice: 100,
      exitPrice: 95, // looks like a loser
      maxAdverseExcursionPct: 0.05,
      maxFavorableExcursionPct: 0.01,
      outcome: "breakeven",
    });
    const r = calibrateMaeStop(trades);
    expect(r.breakevens).toBe(1);
    expect(r.losers).toBe(0);
  });

  test("percentile quantile is monotonic with tightStopPercentile", () => {
    const trades: CalibratorTrade[] = [];
    for (let i = 0; i < 100; i++) {
      trades.push(winnerTrade(`w${i}`, 0.005 + i * 0.0003));
    }
    const p75 = calibrateMaeStop(trades, { tightStopPercentile: 0.75 });
    const p95 = calibrateMaeStop(trades, { tightStopPercentile: 0.95 });
    const p99 = calibrateMaeStop(trades, { tightStopPercentile: 0.99 });
    expect(p75.recommendedTightStopPct!).toBeLessThanOrEqual(p95.recommendedTightStopPct!);
    expect(p95.recommendedTightStopPct!).toBeLessThanOrEqual(p99.recommendedTightStopPct!);
  });

  test("counterfactual saved fraction accumulates loser excess loss", () => {
    const trades: CalibratorTrade[] = [];
    for (let i = 0; i < 15; i++) trades.push(winnerTrade(`w${i}`, 0.01));
    // 5 losers at 5% loss with 5% MAE → with 1.5% recommended stop, each would
    // have been cut at 1.5%, saving 3.5% per trade × 5 trades = 17.5% total.
    for (let i = 0; i < 5; i++) trades.push(loserTrade(`l${i}`, 0.05, 0.05));
    const r = calibrateMaeStop(trades, { currentStopPct: 0.05 });
    expect(r.counterfactual).not.toBeNull();
    // Recommended stop should be near the winners' P95 (~0.01)
    expect(r.recommendedTightStopPct!).toBeLessThan(0.02);
    expect(r.counterfactual!.losersCutEarlierAtNewStop).toBe(5);
    expect(r.counterfactual!.estimatedSavedFractionOnLosers).toBeGreaterThan(0.15);
  });

  test("distribution percentiles satisfy P75 ≤ P95 ≤ P99", () => {
    const trades: CalibratorTrade[] = [];
    for (let i = 0; i < 30; i++) trades.push(winnerTrade(`w${i}`, 0.005 + i * 0.001));
    for (let i = 0; i < 15; i++) trades.push(loserTrade(`l${i}`, 0.03 + i * 0.002));
    const r = calibrateMaeStop(trades);
    expect(r.winnerMae!.p75).toBeLessThanOrEqual(r.winnerMae!.p95);
    expect(r.winnerMae!.p95).toBeLessThanOrEqual(r.winnerMae!.p99);
    expect(r.loserMae!.p75).toBeLessThanOrEqual(r.loserMae!.p95);
  });

  test("perTrade echoes every input trade with computed excursions", () => {
    const trades: CalibratorTrade[] = [];
    for (let i = 0; i < 12; i++) trades.push(winnerTrade(`w${i}`, 0.01));
    for (let i = 0; i < 6; i++) trades.push(loserTrade(`l${i}`, 0.04));
    const r = calibrateMaeStop(trades);
    expect(r.perTrade.length).toBe(trades.length);
    for (const p of r.perTrade) {
      expect(typeof p.mae).toBe("number");
      expect(typeof p.mfe).toBe("number");
    }
  });
});

describe("formatMaeStopCalibrator", () => {
  test("renders verdict, distributions, and counterfactual", () => {
    const trades: CalibratorTrade[] = [];
    for (let i = 0; i < 15; i++) trades.push(winnerTrade(`w${i}`, 0.01));
    for (let i = 0; i < 5; i++) trades.push(loserTrade(`l${i}`, 0.05));
    const r = calibrateMaeStop(trades, { currentStopPct: 0.05 });
    const text = formatMaeStopCalibrator(r);
    expect(text).toContain("MAE Stop Calibrator");
    expect(text).toContain("Winner MAE distribution");
    expect(text).toContain("Counterfactual");
  });
});
