/**
 * Agent Consensus Protocol
 *
 * Multi-factor trade evaluation with weighted scoring.
 * Five deterministic evaluators vote on each trade proposal:
 *   - Risk (0.3):       Risk kernel + circuit breakers
 *   - Regime (0.2):     Market regime alignment
 *   - Portfolio (0.2):  Slot capital + portfolio-level checks
 *   - Technical (0.2):  Entry/SL/TP ratio quality
 *   - Historical (0.1): Backtest track record
 *
 * Consensus rule: weighted score >= 0.6, no critical rejections,
 * and quorum of >= 3 non-ABSTAIN votes.
 */

import { RegimeDetector } from "../regime/detector.ts";
import { StrategyRuntime } from "../runtime/engine.ts";
import { evaluateOrderRisk } from "../../infra/agents/tools/trading/risk-gate.ts";
import type { GordonContext } from "../../infra/agents/types.ts";
import { createModuleLogger } from "../../infra/logger/index.ts";
import { saveConsensusResult } from "./store.ts";

const logger = createModuleLogger("consensus");

// ============================================================================
// Types
// ============================================================================

export interface TradeProposal {
  symbol: string;
  side: "long" | "short";
  size_usd: number;
  playbook_name: string;
  slot_id: string;
  entry_price: number;
  stop_loss: number;
  take_profit: number[];
}

export type VoteDecision = "APPROVE" | "REJECT" | "ABSTAIN";

export interface AgentVote {
  agent: string;
  decision: VoteDecision;
  confidence: number;
  weight: number;
  reason: string;
}

export interface ConsensusResult {
  decision: "APPROVED" | "REJECTED";
  score: number;
  quorum_met: boolean;
  votes: AgentVote[];
  dissenting_agents: string[];
  proposal: TradeProposal;
  timestamp: string;
}

// ============================================================================
// Evaluators
// ============================================================================

async function evaluateRisk(
  proposal: TradeProposal,
  ctx: GordonContext,
): Promise<AgentVote> {
  try {
    const result = await evaluateOrderRisk(
      {
        symbol: proposal.symbol,
        side: proposal.side === "long" ? "BUY" : "SELL",
        type: "MARKET",
        quantity: proposal.size_usd / proposal.entry_price,
        price: proposal.entry_price,
      },
      ctx,
      "consensus-risk",
    );

    return {
      agent: "risk",
      decision: result.approved ? "APPROVE" : "REJECT",
      confidence: result.approved ? 0.8 : 0.9,
      weight: 0.3,
      reason: result.reason,
    };
  } catch (error) {
    return {
      agent: "risk",
      decision: "REJECT",
      confidence: 1.0,
      weight: 0.3,
      reason: `Risk evaluation failed: ${(error as Error).message}`,
    };
  }
}

function evaluateRegime(
  proposal: TradeProposal,
): AgentVote {
  const detector = RegimeDetector.getInstance();
  const signal = detector.getCurrentRegime(proposal.symbol, "1h");

  if (!signal) {
    return {
      agent: "regime",
      decision: "ABSTAIN",
      confidence: 0,
      weight: 0.2,
      reason: "No regime data available",
    };
  }

  const runtime = StrategyRuntime.getInstance();
  const slot = runtime.getSlot(proposal.slot_id);

  if (!slot || slot.allowed_regimes.length === 0) {
    return {
      agent: "regime",
      decision: "APPROVE",
      confidence: 0.5,
      weight: 0.2,
      reason: `No regime filter configured. Current regime: ${signal.regime} (${(signal.confidence * 100).toFixed(0)}% confidence)`,
    };
  }

  const regimeAllowed = slot.allowed_regimes.includes(signal.regime);

  return {
    agent: "regime",
    decision: regimeAllowed ? "APPROVE" : "REJECT",
    confidence: signal.confidence,
    weight: 0.2,
    reason: regimeAllowed
      ? `Regime ${signal.regime} is in allowed set [${slot.allowed_regimes.join(", ")}]`
      : `Regime ${signal.regime} NOT in allowed set [${slot.allowed_regimes.join(", ")}]`,
  };
}

function evaluatePortfolio(
  proposal: TradeProposal,
): AgentVote {
  const runtime = StrategyRuntime.getInstance();
  const result = runtime.approveTradeForSlot(proposal.slot_id, {
    symbol: proposal.symbol,
    side: proposal.side,
    size_usd: proposal.size_usd,
  });

  const slot = runtime.getSlot(proposal.slot_id);
  const capitalRatio = slot
    ? Math.min(1, slot.available_capital / Math.max(1, proposal.size_usd))
    : 0;

  return {
    agent: "portfolio",
    decision: result.approved ? "APPROVE" : "REJECT",
    confidence: result.approved ? Math.min(0.95, capitalRatio) : 0.9,
    weight: 0.2,
    reason: result.approved
      ? `Portfolio checks passed (capital ratio: ${(capitalRatio * 100).toFixed(0)}%)`
      : `Portfolio rejected: ${result.reasons.join("; ")}`,
  };
}

function evaluateTechnical(
  proposal: TradeProposal,
): AgentVote {
  const reasons: string[] = [];
  let score = 0;

  // Check R:R ratio
  const slDistance = Math.abs(proposal.entry_price - proposal.stop_loss);
  const slPercent = (slDistance / proposal.entry_price) * 100;

  if (proposal.take_profit.length > 0) {
    const firstTP = proposal.take_profit[0]!;
    const tpDistance = Math.abs(firstTP - proposal.entry_price);
    const rr = slDistance > 0 ? tpDistance / slDistance : 0;

    if (rr >= 2) {
      score += 0.4;
      reasons.push(`R:R ${rr.toFixed(1)} >= 2.0`);
    } else if (rr >= 1.5) {
      score += 0.2;
      reasons.push(`R:R ${rr.toFixed(1)} >= 1.5 (acceptable)`);
    } else {
      reasons.push(`R:R ${rr.toFixed(1)} < 1.5 (poor)`);
    }
  } else {
    reasons.push("No take-profit levels defined");
  }

  // Check stop-loss distance is reasonable (0.5% to 15%)
  if (slPercent >= 0.5 && slPercent <= 15) {
    score += 0.3;
    reasons.push(`SL distance ${slPercent.toFixed(1)}% is reasonable`);
  } else if (slPercent < 0.5) {
    reasons.push(`SL distance ${slPercent.toFixed(1)}% is too tight (likely stop-hunted)`);
  } else {
    reasons.push(`SL distance ${slPercent.toFixed(1)}% is too wide`);
  }

  // Check position sizing
  if (proposal.size_usd > 0 && proposal.size_usd < 100_000) {
    score += 0.3;
    reasons.push(`Position size $${proposal.size_usd.toFixed(0)} is within bounds`);
  } else {
    reasons.push(`Position size $${proposal.size_usd.toFixed(0)} is unusual`);
  }

  const decision: VoteDecision = score >= 0.5 ? "APPROVE" : "REJECT";

  return {
    agent: "technical",
    decision,
    confidence: Math.min(0.95, score),
    weight: 0.2,
    reason: reasons.join("; "),
  };
}

function evaluateHistorical(
  proposal: TradeProposal,
): AgentVote {
  // Look up backtest results for this playbook. Since we don't have direct
  // access to the backtest store from here without adding a circular dep,
  // we use the genome fitness as a proxy if available.
  try {
    // Best-effort: check if there's a genome with fitness data
    const { GenomeManager } = require("../genome/manager.ts");
    const gm = GenomeManager.getInstance();
    const best = gm.getBestGenome(proposal.playbook_name);

    if (best && best.fitness_score !== undefined) {
      const fitnessNorm = Math.min(1, best.fitness_score / 100);
      return {
        agent: "historical",
        decision: fitnessNorm >= 0.4 ? "APPROVE" : "REJECT",
        confidence: fitnessNorm,
        weight: 0.1,
        reason: `Genome fitness score: ${best.fitness_score.toFixed(1)}/100`,
      };
    }
  } catch {
    // GenomeManager not available — abstain
  }

  return {
    agent: "historical",
    decision: "ABSTAIN",
    confidence: 0,
    weight: 0.1,
    reason: "No historical performance data available",
  };
}

// ============================================================================
// Main Consensus Function
// ============================================================================

/**
 * Evaluate a trade proposal through the multi-factor consensus protocol.
 *
 * Runs 5 evaluators in parallel, aggregates weighted votes,
 * and returns a consensus decision with full audit trail.
 */
export async function evaluateConsensus(
  proposal: TradeProposal,
  ctx: GordonContext,
): Promise<ConsensusResult> {
  const votes: AgentVote[] = [];

  // Run evaluators (risk is async, others are sync)
  const [riskVote] = await Promise.all([evaluateRisk(proposal, ctx)]);

  votes.push(riskVote);
  votes.push(evaluateRegime(proposal));
  votes.push(evaluatePortfolio(proposal));
  votes.push(evaluateTechnical(proposal));
  votes.push(evaluateHistorical(proposal));

  // Calculate weighted score
  let weightedSum = 0;
  let totalWeight = 0;
  let nonAbstainCount = 0;

  for (const vote of votes) {
    if (vote.decision === "ABSTAIN") continue;
    nonAbstainCount++;
    totalWeight += vote.weight;
    const voteScore = vote.decision === "APPROVE" ? vote.confidence : 0;
    weightedSum += voteScore * vote.weight;
  }

  const score = totalWeight > 0 ? weightedSum / totalWeight : 0;
  const quorumMet = nonAbstainCount >= 3;

  // Check for critical rejections (risk or portfolio REJECT blocks everything)
  const criticalRejection = votes.some(
    (v) => (v.agent === "risk" || v.agent === "portfolio") && v.decision === "REJECT",
  );

  const dissenting = votes
    .filter((v) => v.decision === "REJECT")
    .map((v) => v.agent);

  const decision: "APPROVED" | "REJECTED" =
    score >= 0.6 && quorumMet && !criticalRejection ? "APPROVED" : "REJECTED";

  const result: ConsensusResult = {
    decision,
    score,
    quorum_met: quorumMet,
    votes,
    dissenting_agents: dissenting,
    proposal,
    timestamp: new Date().toISOString(),
  };

  // Persist for audit trail
  try {
    saveConsensusResult(result);
  } catch (error) {
    logger.warn("Failed to persist consensus result", {
      error: (error as Error).message,
    });
  }

  logger.info("Consensus evaluated", {
    symbol: proposal.symbol,
    decision,
    score: score.toFixed(2),
    quorumMet,
    criticalRejection,
    dissenting: dissenting.join(", ") || "none",
  });

  return result;
}
