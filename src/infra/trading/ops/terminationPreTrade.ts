/**
 * Build termination Layer-1 inputs from a live plan + GordonContext.
 */

import type { GordonContext } from "../../agents/types.ts";
import type { Plan } from "../../../types/plan.ts";
import { classifyTradeRisk, type TradeProposal } from "../risk/riskClassifier.ts";
import { buildClassifierPortfolioContext } from "../risk/classifierPortfolio.ts";
import { gateAgainstMandate, gateCoherence, inferAssetClass } from "../../safety/index.ts";
import { checkConstitution } from "../../safety/defense/tradingConstitution.ts";
import type { PreTradeInput } from "./terminationLayers.ts";

export interface TerminationPreTradeOptions {
  constitutionViolations?: string[];
}

export async function buildTerminationPreTradeFromPlan(
  plan: Plan,
  ctx: GordonContext,
  opts: TerminationPreTradeOptions = {},
): Promise<PreTradeInput> {
  const portfolio = await buildClassifierPortfolioContext(ctx);
  const entryPrice = plan.entry.price ?? 1;
  const notionalUsd = plan.allocation.amount;
  const quantity = notionalUsd / entryPrice;
  const proposal: TradeProposal = {
    symbol: plan.symbol,
    side: plan.direction === "short" ? "SELL" : "BUY",
    quantity,
    price: entryPrice,
    notionalUsd,
    orderType: plan.entry.type === "market" ? "MARKET" : "LIMIT",
    venue: ctx.exchange?.exchangeId,
  };

  const assessment = classifyTradeRisk(proposal, portfolio);

  let constitutionViolations = opts.constitutionViolations ?? [];
  if (constitutionViolations.length === 0 && portfolio.totalValueUsd > 0) {
    const violations = checkConstitution({
      positionSizePct: (notionalUsd / portfolio.totalValueUsd) * 100,
      riskPerTradePct: assessment.compositeScore > 50 ? 3 : 1,
      currentDrawdownPct: portfolio.currentDrawdownPct,
      dailyLossPct: Math.abs(portfolio.dailyPnlUsd / portfolio.totalValueUsd) * 100,
      openPositionCount: portfolio.positions.length,
      tradesThisHour: portfolio.recentTradeCount,
      tradesThisDay: portfolio.recentTradeCount * 3,
      consecutiveLosses: 0,
      hasStopLoss: plan.stopLoss.price > 0,
      isCrypto: inferAssetClass(ctx.exchange?.exchangeId, plan.symbol) === "crypto",
    });
    constitutionViolations = violations.map((v) => v.message);
  }

  const assetClass = inferAssetClass(ctx.exchange?.exchangeId, plan.symbol);
  const venue = ctx.exchange?.exchangeId;
  const mandateResult = gateAgainstMandate(
    {
      assetClass: assetClass !== "unknown" ? assetClass : undefined,
      venue,
      strategyTag: plan.strategy,
      proposedPositionPct: plan.allocation.percentOfPortfolio * 100,
    },
    {
      currentOpenPositions: portfolio.positions.length,
      currentAllocationPct: 0,
    },
  );

  const coherenceResult = gateCoherence({
    direction: plan.direction,
    assetClass: assetClass !== "unknown" ? assetClass : undefined,
  });

  const riskClassifierVerdict = assessment.recommendation;

  return {
    riskTier: assessment.tier,
    riskClassifierVerdict,
    constitutionViolations,
    mandateScopeOk: mandateResult.mandate ? mandateResult.ok : null,
    thesisCoherenceOk: coherenceResult.ok,
  };
}