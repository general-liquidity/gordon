/**
 * Shadow Chain — synthetic plan_ready evaluation pipeline.
 *
 * Single orchestration function that runs the full Wright pre-trade
 * chain against a synthetic plan, returning aggregated verdicts +
 * a markdown summary. Same primitives as the live `plan_ready`
 * handler in agent-subscriptions.ts; this lets a human invoke them
 * interactively via `/shadow` without going through the event bus.
 *
 * This is the operator-shadow product layer the harness-assessment
 * doc identified as the realistic interim deliverable. Each invocation
 * emits a structured observation so traces accumulate.
 */

import { classifyMarginalParticipant } from "./marginalParticipantClassifier.ts";
import type {
  MarginalParticipantResult,
  DriverKind,
} from "./marginalParticipantClassifier.ts";
import { attributeEdge } from "./edgeAttribution.ts";
import type { EdgeAttributionResult, EdgeType } from "./edgeAttribution.ts";
import { auditRiskBundle } from "./riskBundleAuditor.ts";
import type { AuditResult, RiskItem } from "./riskBundleAuditor.ts";
import {
  sizePosition,
  classifyPerformanceState,
} from "./pathDependentSizer.ts";
import type {
  SizingResult,
  TradeTier,
  PerformanceState,
} from "./pathDependentSizer.ts";
import {
  distanceToBarriers,
  shouldBlockNewTrades,
} from "../../safety/absorbingBarrier.ts";
import type {
  BarriersResult,
  AbsorbingBarrierEvaluation,
} from "../../safety/absorbingBarrier.ts";
import { observeSessionEquity } from "../../safety/absorbingBarrierState.ts";
import { runKillList } from "./preExecKillList.ts";
import type { KillListResult } from "./preExecKillList.ts";
import { mapLiquidity } from "./liquidityMapper.ts";
import type { LiquidityMapResult } from "./liquidityMapper.ts";
import { evaluateCircuit } from "./streakCircuitBreaker.ts";
import type { StreakResult } from "./streakCircuitBreaker.ts";
import { evaluateGiveBack } from "./giveBackStop.ts";
import type { GiveBackResult } from "./giveBackStop.ts";
import { classifyManipulationContext } from "../signals/manipulationContext.ts";
import type { ManipulationContextResult } from "../signals/manipulationContext.ts";
import type { ToxicityResult } from "../signals/microstructureToxicity.ts";
import { recordStructuredObservation } from "../../platform/observability/structured.ts";

export interface ShadowPlanInput {
  direction: "long" | "short";
  symbol: string;
  entry: number;
  stop: number;
  targets: number[];
  strategy?: string;
  /** Operator-supplied edge articulation for the 5-min test. Optional — falls back to auto. */
  edgeArticulation?: string;
  /** Optional drivers for marginal-participant classifier. */
  drivers?: ReadonlyArray<DriverKind>;
  /** Optional tier hint. Falls back to "I" (most conservative). */
  tier?: TradeTier;
  /** Operator-supplied edge type. Defaults to "structural". */
  edgeType?: EdgeType;
  /**
   * MS7: optional pre-computed microstructure toxicity. When provided,
   * the chain runs manipulationContext and folds the verdict into the
   * blocker set: `refuse` is a hard blocker, `size_down` is a soft
   * warning the markdown surfaces.
   */
  microstructureToxicity?: ToxicityResult;
}

export interface ShadowPlanResult {
  planId: string;
  emittedAt: string;
  input: ShadowPlanInput;
  marginalParticipant: MarginalParticipantResult;
  edgeAttribution: EdgeAttributionResult;
  riskBundle: AuditResult;
  sizer: SizingResult | null;
  barriers: BarriersResult | null;
  /**
   * Inception-referenced barrier, reported alongside the trailing one above.
   * Null when the operator has configured no terminal loss limit.
   */
  terminalBarrier: AbsorbingBarrierEvaluation | null;
  killList: KillListResult;
  liquidity: LiquidityMapResult;
  streak: StreakResult | null;
  giveBack: GiveBackResult | null;
  manipulationContext: ManipulationContextResult | null;
  overallVerdict: "go" | "caution" | "no_go";
  blockers: string[];
  summary: string;
}

function newPlanId(): string {
  return `shadow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function aggregateVerdict(
  edge: EdgeAttributionResult,
  bundle: AuditResult,
  sizer: SizingResult | null,
  barriers: BarriersResult | null,
  terminalBarrier: AbsorbingBarrierEvaluation | null,
  killList: KillListResult,
  streak: StreakResult | null,
  giveBack: GiveBackResult | null,
  manipulation: ManipulationContextResult | null,
): { verdict: "go" | "caution" | "no_go"; blockers: string[] } {
  const blockers: string[] = [];
  if (edge.verdict === "no_edge") blockers.push("No identifiable edge");
  if (bundle.verdict === "no_go") blockers.push("Risk bundle audit failed");
  if (sizer && sizer.rejected) blockers.push(`Sizer rejected: ${sizer.rejectionReason}`);
  if (barriers && shouldBlockNewTrades(barriers)) {
    blockers.push(`Absorbing barrier breach: nearest ${barriers.nearest} at ${barriers.nearestRUnits.toFixed(2)}R`);
  }
  // Separate check, never an else: the two barriers answer different questions
  // and the gate is the union of their blocks.
  if (terminalBarrier && terminalBarrier.tripped) {
    blockers.push(
      `Absorbing barrier terminal: ${terminalBarrier.boundBy} limit breached at ${((terminalBarrier.state.trippedAtLossFraction ?? 0) * 100).toFixed(1)}% of reference capital`,
    );
  }
  if (!killList.pass) blockers.push(`Kill list: ${killList.blockers.join(", ")}`);
  if (streak && (streak.state === "tripped" || streak.state === "cooldown")) {
    blockers.push(`Streak circuit breaker: ${streak.state}`);
  }
  if (giveBack && giveBack.state === "triggered") {
    blockers.push("Give-back stop triggered — flatten the session");
  }
  if (manipulation && manipulation.shouldRefuse) {
    blockers.push(
      `Microstructure manipulation regime: ${manipulation.reasoning}`,
    );
  } else if (manipulation && manipulation.posture === "size_down") {
    blockers.push(
      `Microstructure elevated: ${manipulation.reasoning}`,
    );
  }

  if (blockers.length === 0) return { verdict: "go", blockers };

  const hardBlockers = blockers.filter(
    (b) =>
      b.includes("rejected") ||
      b.includes("Absorbing barrier") ||
      b.includes("Give-back") ||
      b.includes("tripped") ||
      b.includes("No identifiable edge") ||
      b.includes("manipulation regime"),
  );
  return { verdict: hardBlockers.length > 0 ? "no_go" : "caution", blockers };
}

function formatMarkdown(result: ShadowPlanResult): string {
  const lines: string[] = [];
  const i = result.input;
  lines.push(`# Shadow plan: ${i.direction.toUpperCase()} ${i.symbol} @ ${i.entry}`);
  lines.push("");
  lines.push(`**Verdict: ${result.overallVerdict.toUpperCase()}** (${result.blockers.length} blocker(s))`);
  if (result.blockers.length > 0) {
    for (const b of result.blockers) lines.push(`- ❌ ${b}`);
  }
  lines.push("");
  lines.push("## Pre-trade chain");
  lines.push(`- **Marginal participant**: ${result.marginalParticipant.marginal} (confidence ${result.marginalParticipant.confidence.toFixed(2)})`);
  lines.push(`  - ${result.marginalParticipant.reasoning}`);
  lines.push(`- **Edge attribution**: ${result.edgeAttribution.verdict} (${result.edgeAttribution.edgeType})`);
  if (result.edgeAttribution.reasons.length > 0) {
    for (const r of result.edgeAttribution.reasons) lines.push(`  - ${r}`);
  }
  lines.push(`- **Risk bundle**: ${result.riskBundle.verdict} — ${result.riskBundle.paidRisks.length} paid risk(s), ${result.riskBundle.unhedgedNoItems.length} unhedged no(s)`);
  if (result.sizer) {
    if (result.sizer.rejected) {
      lines.push(`- **Sizer**: REJECTED (${result.sizer.rejectionReason})`);
    } else {
      lines.push(`- **Sizer**: $${result.sizer.finalDollarRisk.toFixed(0)} dollar risk → ${result.sizer.positionUnits.toFixed(4)} units (state multiplier ${result.sizer.stateMultiplier})`);
    }
  } else {
    lines.push("- **Sizer**: SKIPPED (account state not configured — set GORDON_INITIAL_RISK_CAPITAL_USD)");
  }
  if (result.barriers) {
    lines.push(`- **Absorbing barriers**: nearest ${result.barriers.nearest ?? "none"} at ${Number.isFinite(result.barriers.nearestRUnits) ? result.barriers.nearestRUnits.toFixed(2) + "R" : "n/a"}`);
  } else {
    lines.push("- **Absorbing barriers**: SKIPPED (account state not configured)");
  }
  if (result.terminalBarrier) {
    const t = result.terminalBarrier;
    lines.push(
      `- **Terminal loss barrier**: ${t.tripped ? `TRIPPED by ${t.boundBy}` : "ok"} (inception ${(t.inception.lossFraction * 100).toFixed(1)}%, trailing ${(t.trailing.lossFraction * 100).toFixed(1)}%)`,
    );
  }
  lines.push(`- **Kill list**: ${result.killList.pass ? "PASS" : `BLOCK (${result.killList.blockers.length})`}`);
  if (result.streak) {
    lines.push(`- **Streak**: ${result.streak.state} (consecutive losses: ${result.streak.consecutiveLosses})`);
  }
  if (result.giveBack) {
    lines.push(`- **Give-back**: ${result.giveBack.state} (session PnL $${result.giveBack.sessionPnlUsd.toFixed(0)})`);
  }
  if (result.manipulationContext) {
    lines.push(
      `- **Microstructure**: ${result.manipulationContext.regime} → ${result.manipulationContext.posture} (score ${result.manipulationContext.toxicityScore.toFixed(2)})`,
    );
  }
  if (result.liquidity.nearestBelow || result.liquidity.nearestAbove) {
    lines.push("- **Liquidity map**:");
    if (result.liquidity.nearestBelow) lines.push(`  - Below: ${result.liquidity.nearestBelow.price} (strength ${result.liquidity.nearestBelow.strength})`);
    if (result.liquidity.nearestAbove) lines.push(`  - Above: ${result.liquidity.nearestAbove.price} (strength ${result.liquidity.nearestAbove.strength})`);
  }
  return lines.join("\n");
}

export function runShadowChain(input: ShadowPlanInput): ShadowPlanResult {
  const planId = newPlanId();
  const emittedAt = new Date().toISOString();

  const marginalParticipant = classifyMarginalParticipant({
    drivers: input.drivers ?? [],
    vixZScore: Number(process.env.GORDON_VIX_ZSCORE ?? "NaN") || undefined,
    correlationZScore: Number(process.env.GORDON_CORRELATION_ZSCORE ?? "NaN") || undefined,
  });

  const edgeAttribution = attributeEdge({
    edgeType: input.edgeType ?? "structural",
    counterparty:
      process.env.GORDON_EDGE_COUNTERPARTY ??
      `${marginalParticipant.marginal === "opportunity" ? "forced flow on the other side" : "consensus on " + input.symbol}`,
    constraint:
      process.env.GORDON_EDGE_CONSTRAINT ??
      (marginalParticipant.marginal === "opportunity"
        ? marginalParticipant.reasoning
        : "no observed constraint; counterparty is the typical HFT-dominated flow"),
    edgeArticulation:
      input.edgeArticulation ??
      `${input.strategy ?? "unspecified strategy"} setup on ${input.symbol} ${input.direction} entry ${input.entry} stop ${input.stop} target ladder ${input.targets.join("/")} relying on identified forced flow or structural inefficiency to generate edge`,
  });

  const stopDistance = Math.abs(input.entry - input.stop);
  const riskBundle = auditRiskBundle({
    items: [
      { category: "thesis", tag: "yes", reason: input.strategy ?? "operator thesis" },
      { category: "market", tag: "neutral" },
      { category: "sector", tag: "neutral" },
      { category: "liquidity", tag: "yes", reason: `${input.symbol} liquid instrument` },
      { category: "execution", tag: "neutral" },
      { category: "correlation", tag: "neutral" },
      {
        category: "gap",
        tag: stopDistance > 0 ? "neutral" : "no",
        hedge: stopDistance > 0 ? undefined : "no stop set",
      },
      { category: "operational", tag: "neutral" },
    ],
  });

  const initialRC = Number(process.env.GORDON_INITIAL_RISK_CAPITAL_USD ?? 0);
  const ytdPnL = Number(process.env.GORDON_YTD_PNL_USD ?? 0);
  const equityFracOfPeak = Number(process.env.GORDON_EQUITY_FRACTION_OF_PEAK ?? 1);
  let sizer: SizingResult | null = null;
  let performanceState: PerformanceState = "neutral";
  if (initialRC > 0) {
    performanceState = classifyPerformanceState({
      equityFractionOfPeak: equityFracOfPeak,
      recentTradeResults: [],
    });
    sizer = sizePosition({
      initialRiskCapital: initialRC,
      ytdPnL,
      tier: input.tier ?? "I",
      performanceState,
      entryPrice: input.entry,
      stopPrice: input.stop,
    });
  }

  const currentEquity = Number(process.env.GORDON_CURRENT_EQUITY_USD ?? 0);
  const dailyLossBudget = Number(process.env.GORDON_RISK_DAILY_LOSS_USD ?? 0);
  const psychTilt = Number(process.env.GORDON_PSYCHOLOGICAL_TILT_USD ?? 0);
  const baseR = sizer?.finalDollarRisk ?? Number(process.env.GORDON_BASE_R_PER_TRADE_USD ?? 0);
  // Both budgets are losses FROM the day's opening equity. Anchoring them to
  // current equity would put the trigger a fixed budget below wherever the
  // account already is, so neither could ever be reached.
  const dayStartEquity = Number(process.env.GORDON_DAY_START_EQUITY_USD ?? 0);
  let barriers: BarriersResult | null = null;
  if (currentEquity > 0 && baseR > 0) {
    barriers = distanceToBarriers({
      currentEquity,
      dailyLoss:
        dailyLossBudget > 0 && dayStartEquity > 0
          ? { windowStartEquityUsd: dayStartEquity, budgetUsd: dailyLossBudget }
          : undefined,
      psychologicalTilt:
        psychTilt > 0 && dayStartEquity > 0
          ? { windowStartEquityUsd: dayStartEquity, budgetUsd: psychTilt }
          : undefined,
      baseRiskPerTradeUsd: baseR,
    });
  }

  // Folded independently of baseR: the inception barrier is measured in
  // fractions of capital and needs no R unit, so a missing R must not silence it.
  const terminalBarrier = observeSessionEquity(currentEquity);

  const killList = runKillList({
    bored: process.env.GORDON_OPERATOR_BORED === "1",
    angry: process.env.GORDON_OPERATOR_ANGRY === "1",
    rushing: process.env.GORDON_OPERATOR_RUSHING === "1",
    movedStop: process.env.GORDON_OPERATOR_MOVED_STOP === "1",
    scaredMoney: process.env.GORDON_OPERATOR_SCARED_MONEY === "1",
  });

  const stopBuffer = stopDistance > 0 ? stopDistance * 0.1 : 0;
  const liquidity = mapLiquidity({
    currentPrice: input.entry,
    stopBufferPriceUnits: stopBuffer,
    levels: [
      {
        price: input.stop,
        kind: input.direction === "long" ? "support" : "resistance",
        testCount: 1,
        label: "plan stop",
      },
      ...input.targets.map((tp, i) => ({
        price: tp,
        kind: (input.direction === "long" ? "resistance" : "support") as
          | "resistance"
          | "support",
        testCount: 1,
        label: `target ${i + 1}`,
      })),
    ],
  });

  let streak: StreakResult | null = null;
  try {
    streak = evaluateCircuit({ recentResults: [], nowMs: Date.now() });
  } catch {
    /* skip */
  }

  const sessionStart = Number(process.env.GORDON_SESSION_START_EQUITY_USD ?? 0);
  const sessionHwm = Number(process.env.GORDON_SESSION_HWM_USD ?? 0);
  let giveBack: GiveBackResult | null = null;
  if (sessionStart > 0 && sessionHwm >= sessionStart && currentEquity > 0) {
    giveBack = evaluateGiveBack({
      sessionStartEquityUsd: sessionStart,
      sessionHighWaterMarkUsd: sessionHwm,
      currentEquityUsd: currentEquity,
    });
  }

  const manipulationContext = input.microstructureToxicity
    ? classifyManipulationContext(input.microstructureToxicity)
    : null;

  const { verdict, blockers } = aggregateVerdict(
    edgeAttribution,
    riskBundle,
    sizer,
    barriers,
    terminalBarrier,
    killList,
    streak,
    giveBack,
    manipulationContext,
  );

  const result: ShadowPlanResult = {
    planId,
    emittedAt,
    input,
    marginalParticipant,
    edgeAttribution,
    riskBundle,
    sizer,
    barriers,
    terminalBarrier,
    killList,
    liquidity,
    streak,
    giveBack,
    manipulationContext,
    overallVerdict: verdict,
    blockers,
    summary: "",
  };
  result.summary = formatMarkdown(result);

  recordStructuredObservation({
    eventType: "shadow_chain.evaluated",
    workflow: "execution",
    source: "agent_tool",
    component: "shadow_chain",
    toolName: "shadow_plan",
    outcome: verdict === "go" ? "success" : verdict === "caution" ? "info" : "failure",
    symbol: input.symbol,
    details: {
      planId,
      direction: input.direction,
      verdict,
      blockerCount: blockers.length,
      marginal: marginalParticipant.marginal,
      edgeVerdict: edgeAttribution.verdict,
      bundleVerdict: riskBundle.verdict,
      sizerRejected: sizer?.rejected ?? null,
      killListPass: killList.pass,
      terminalBarrierTripped: terminalBarrier?.tripped ?? null,
      terminalBarrierBoundBy: terminalBarrier?.boundBy ?? null,
      microstructureRegime: manipulationContext?.regime ?? null,
      microstructurePosture: manipulationContext?.posture ?? null,
    },
  });

  return result;
}
