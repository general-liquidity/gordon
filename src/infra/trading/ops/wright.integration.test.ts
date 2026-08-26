/**
 * Wright-port integration test.
 *
 * Verifies that the full pre-trade triad + post-trade close handler
 * compose into a coherent decision chain under realistic inputs. Each
 * module has its own unit tests; this file specifically tests the
 * COMPOSITION across the chain.
 *
 * The chain emulated here (in the order they fire on plan_ready):
 *
 *   1. marginalParticipantClassifier — counterparty regime
 *   2. edgeAttribution — BAIT + 5-min test
 *   3. riskBundleAuditor — 8-category audit
 *   4. confluenceScorer (TM1) — A-star / A / B / C tier
 *   5. convictionCalibrationGate — clamp tier to calibrated/uncalibrated
 *   6. pathDependentSizer — final dollar risk
 *   7. absorbingBarrier — three-barrier check
 *   8. preExecKillList — operator-state gate
 *   9. liquidityMapper — stop-cluster identification
 *   10. streakCircuitBreaker — recent-results check
 *   11. giveBackStop — session HWM check
 *
 * Plus the close-side compositions:
 *
 *   - debriefMatrix — process × outcome → quadrant
 *   - dailyRollup — aggregate of all of the above
 */

import { describe, it, expect } from "bun:test";

import { classifyMarginalParticipant } from "./marginalParticipantClassifier.ts";
import { attributeEdge } from "./edgeAttribution.ts";
import { auditRiskBundle } from "./riskBundleAuditor.ts";
import { scoreConfluences, applyAdversarialDowngrade } from "./confluenceScorer.ts";
import { evaluateCalibration, clampTierToCalibration } from "./convictionCalibrationGate.ts";
import { sizePosition, classifyPerformanceState } from "./pathDependentSizer.ts";
import { distanceToBarriers, shouldBlockNewTrades } from "../../safety/absorbingBarrier.ts";
import { runKillList } from "./preExecKillList.ts";
import { mapLiquidity } from "./liquidityMapper.ts";
import { evaluateCircuit } from "./streakCircuitBreaker.ts";
import { evaluateGiveBack } from "./giveBackStop.ts";
import { classifyDebrief, aggregateQuadrants } from "./debriefMatrix.ts";

describe("Wright chain — clean plan, all gates pass", () => {
  it("opportunity counterparty + valid edge + clean bundle + A* tier + calibrated + no barriers → full size", () => {
    const counterparty = classifyMarginalParticipant({
      drivers: ["margin_call_cascade", "vix_spike", "bid_evaporation"],
    });
    expect(counterparty.marginal).toBe("opportunity");

    const edge = attributeEdge({
      edgeType: "structural",
      counterparty: "leveraged retail hitting stop-loss limits",
      constraint: "margin call cascade — mechanical sell orders",
      edgeArticulation:
        "Forced selling from margin calls creates predictable temporary dislocation; I provide liquidity at the dislocated price and exit on recovery to fair value",
    });
    expect(edge.verdict).toBe("valid_edge");

    const bundle = auditRiskBundle({
      items: [
        { category: "thesis", tag: "yes", reason: "supply tightness identified" },
        { category: "market", tag: "neutral" },
        { category: "sector", tag: "neutral" },
        { category: "liquidity", tag: "yes", reason: "highly liquid futures" },
        { category: "execution", tag: "neutral" },
        { category: "correlation", tag: "neutral" },
        { category: "gap", tag: "no", hedge: "flat before weekend close" },
        { category: "operational", tag: "neutral" },
      ],
    });
    expect(bundle.verdict).toBe("go");

    const confluence = scoreConfluences({
      observations: [
        { kind: "divergence", present: true },
        { kind: "ema_alignment", present: true },
        { kind: "regime_fit", present: true },
        { kind: "key_level_proximity", present: true },
        { kind: "volume_confirmation", present: true },
      ],
    });
    expect(confluence.tier).toBe("A*");

    const downgraded = applyAdversarialDowngrade(confluence.tier, {
      highSeverityFindings: 0,
      criticalFindings: 0,
    });
    expect(downgraded.tier).toBe("A*");

    const calibTrades: Array<{ convictionRating: number; rMultiple: number }> = [];
    for (let i = 0; i < 120; i++) {
      const c = 1 + (i % 5);
      calibTrades.push({ convictionRating: c, rMultiple: c * 0.4 + 0.05 });
    }
    const calibration = evaluateCalibration({ trades: calibTrades });
    expect(calibration.allowsConvictionSizing).toBe(true);
    const allowedTier = clampTierToCalibration("III", calibration);
    expect(allowedTier).toBe("III");

    const performanceState = classifyPerformanceState({
      equityFractionOfPeak: 0.995,
      recentTradeResults: ["win", "win", "win", "loss", "win"],
    });
    expect(performanceState).toBe("hot");

    const sizing = sizePosition({
      initialRiskCapital: 100_000,
      ytdPnL: 30_000,
      tier: allowedTier,
      performanceState,
      entryPrice: 100,
      stopPrice: 99,
    });
    expect(sizing.rejected).toBe(false);
    expect(sizing.finalDollarRisk).toBeGreaterThan(0);

    const barriers = distanceToBarriers({
      currentEquity: 130_000,
      maintenanceMarginEquity: 50_000,
      psychologicalTilt: { windowStartEquityUsd: 130_000, budgetUsd: 50_000 },
      baseRiskPerTradeUsd: sizing.finalDollarRisk,
    });
    expect(shouldBlockNewTrades(barriers)).toBe(false);

    const killList = runKillList({
      bored: false,
      angry: false,
      rushing: false,
      movedStop: false,
      scaredMoney: false,
    });
    expect(killList.pass).toBe(true);

    const liquidity = mapLiquidity({
      currentPrice: 100,
      stopBufferPriceUnits: 0.1,
      levels: [{ price: 99, kind: "support", testCount: 3 }],
    });
    expect(liquidity.nearestBelow).not.toBeNull();

    const streak = evaluateCircuit({
      recentResults: ["win", "win", "loss", "win", "win"],
      nowMs: Date.now(),
    });
    expect(streak.state).toBe("open");

    const giveBack = evaluateGiveBack({
      sessionStartEquityUsd: 100_000,
      sessionHighWaterMarkUsd: 105_000,
      currentEquityUsd: 104_500,
    });
    expect(giveBack.state).toBe("ok");
  });
});

describe("Wright chain — chain reacts coherently when one gate trips", () => {
  it("uncalibrated conviction clamps tier from III to I, sizer applies lower dollar risk", () => {
    const fewTrades: Array<{ convictionRating: number; rMultiple: number }> = [];
    for (let i = 0; i < 50; i++) fewTrades.push({ convictionRating: 3, rMultiple: 0.5 });
    const calibration = evaluateCalibration({ trades: fewTrades });
    expect(calibration.allowsConvictionSizing).toBe(false);

    const clamped = clampTierToCalibration("III", calibration);
    expect(clamped).toBe("I");

    const sized = sizePosition({
      initialRiskCapital: 100_000,
      ytdPnL: 30_000,
      tier: clamped,
      performanceState: "neutral",
      entryPrice: 100,
      stopPrice: 99,
    });
    expect(sized.finalDollarRisk).toBeLessThan(2000);
  });

  it("cold performance state + Type I tier → rejection", () => {
    const sized = sizePosition({
      initialRiskCapital: 100_000,
      ytdPnL: -10_000,
      tier: "I",
      performanceState: "cold",
      entryPrice: 100,
      stopPrice: 99,
    });
    expect(sized.rejected).toBe(true);
    expect(sized.rejectionReason).toBe("cold_state_blocks_type_i");
  });

  it("breached barrier blocks trade regardless of edge quality", () => {
    const barriers = distanceToBarriers({
      currentEquity: 50_000,
      maintenanceMarginEquity: 49_000,
      baseRiskPerTradeUsd: 1000,
    });
    expect(shouldBlockNewTrades(barriers)).toBe(true);
  });

  it("3 consecutive losses → tripped circuit breaker", () => {
    const r = evaluateCircuit({
      recentResults: ["loss", "loss", "loss", "win"],
      nowMs: Date.now(),
    });
    expect(r.state).toBe("tripped");
  });

  it("give-back floor reached → flatten signal", () => {
    const r = evaluateGiveBack({
      sessionStartEquityUsd: 100_000,
      sessionHighWaterMarkUsd: 110_000,
      currentEquityUsd: 104_000,
    });
    expect(r.state).toBe("triggered");
  });
});

describe("Wright chain — adversarial composability", () => {
  it("A* setup downgraded by critical finding → B tier → smaller size", () => {
    const initial = scoreConfluences({
      observations: [
        { kind: "divergence", present: true },
        { kind: "ema_alignment", present: true },
        { kind: "regime_fit", present: true },
        { kind: "key_level_proximity", present: true },
      ],
    });
    expect(initial.tier).toBe("A*");

    const downgraded = applyAdversarialDowngrade(initial.tier, {
      highSeverityFindings: 0,
      criticalFindings: 1,
    });
    expect(downgraded.tier).toBe("B");

    const sized = sizePosition({
      initialRiskCapital: 100_000,
      ytdPnL: 30_000,
      tier: downgraded.tier === "B" ? "II" : "I",
      performanceState: "neutral",
      entryPrice: 100,
      stopPrice: 99,
    });
    expect(sized.tierDollarRisk).toBeLessThan(0.05 * 130_000);
  });
});

describe("Close-side composition", () => {
  it("debrief quadrant + aggregate → toxic-alpha alarm fires when dumb_luck dominates", () => {
    const debriefs = [
      classifyDebrief({ processScore: 8, outcomeScore: 8 }),
      classifyDebrief({ processScore: 8, outcomeScore: 8 }),
      classifyDebrief({ processScore: 3, outcomeScore: 8 }),
    ];
    const entries = debriefs.map((c, i) => ({
      ...c,
      id: `dbr-${i}`,
      recordedAt: "2026-05-17T10:00:00Z",
      tradeId: `t-${i}`,
      symbol: "BTC",
      pnlUsd: 100,
    }));
    const agg = aggregateQuadrants(entries);
    expect(agg.toxicAlphaAlarm).toBe(true);
  });
});

describe("End-to-end Wright scenario — Wright's WTI crude example", () => {
  it("replicates the full Ch 9 trade decision from setup to sized position", () => {
    const counterparty = classifyMarginalParticipant({
      drivers: ["futures_roll"],
      vixZScore: 0,
      correlationZScore: 0,
    });
    expect(counterparty.marginal).toBe("uncertain");

    const edge = attributeEdge({
      edgeType: "analytical",
      counterparty: "speculators chasing the rally near record net long",
      constraint: "sentiment extreme — positioning overcrowded heading into resistance",
      edgeArticulation:
        "Crude testing major three-year resistance cluster while Saudis quietly sell into rally despite OPEC jawboning creates asymmetric short setup at value-area high",
    });
    expect(edge.verdict).toBe("valid_edge");

    const sizing = sizePosition({
      initialRiskCapital: 100_000,
      ytdPnL: 12_000,
      tier: "I",
      performanceState: "neutral",
      entryPrice: 75.82,
      stopPrice: 76.21,
    });
    expect(sizing.adjustedRiskCapital).toBe(112_000);
    expect(sizing.positionUnits).toBeGreaterThan(2000);
    expect(sizing.positionUnits).toBeLessThan(3000);
  });
});
