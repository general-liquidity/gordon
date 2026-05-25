/**
 * Researcher Agent — On-Demand Parallel Work
 *
 * Spawned (not permanent) for genuinely parallel tasks:
 *   - Scan 5 symbols simultaneously
 *   - Backtest 3 strategies at once
 *   - Deep-dive research while user keeps chatting
 *
 * Like Claude Code's AgentTool: temporary clone with read-only tools,
 * runs in isolation, returns results when done.
 */

import { Agent } from "@mastra/core/agent";
import { TokenLimiterProcessor } from "@mastra/core/processors";
import { GordonInputGuard, GordonOutputSanitizer } from "../processors/index.ts";
import { composeAgentInstructionsWithSlots } from "../context/promptSections.ts";
import {
  instrumentedIndicatorTools,
  instrumentedMarketDataTools,
  instrumentedMarketTools,
  instrumentedDiscoveryTools,
  instrumentedStrategyTools,
  instrumentedParallelAnalysisTools,
  instrumentedBacktestTools,
  instrumentedChartTools,
  instrumentedMarketAnalysisTools,
  instrumentedCompositionTools,
  instrumentedLiquidationIntelligenceTools,
  instrumentedPairAnalysisTools,
  instrumentedXSocialTools,
  instrumentedCdpWebhookTools,
  instrumentedCdpSqlTools,
  instrumentedCdpPolicyTools,
  instrumentedCdpOnrampTools,
  instrumentedCdpEvmMultichainTools,
  instrumentedCdpWebhookReceiverTools,
  instrumentedProactiveModeTools,
  instrumentedBacktestVerdictTools,
  instrumentedFinnhubTools,
  instrumentedFinnhubFundamentalsTools,
  instrumentedFinnhubMarketsTools,
  instrumentedSmcPatternTools,
  instrumentedCalibrationTools,
  instrumentedSkillLoaderTools,
  instrumentedQuoteVerifyTools,
  instrumentedDiagnosticTools,
  instrumentedMicrostructureTools,
  instrumentedProducerHealthTools,
  instrumentedSharedContextTools,
  instrumentedMemoryTools,
  instrumentedEvalTools,
  instrumentedRegimeTools,
  gordonInputGuard,
  gordonOutputSanitizer,
  gordonToolCallReconciler,
} from "../tooling/instrumentedTools.ts";
import { createSubAgentMemory } from "../memory/memoryFactory.ts";
import { createModelResolver, registerObservability, resolveRuntimeModel } from "../agentHelpers.ts";
import {
  getHarnessSuffixForModel,
  isHarnessProfilesEnabled,
} from "../profiles/harnessProfile.ts";

const RESEARCHER_INSTRUCTIONS = `You are a Researcher agent within Gordon, a trading CLI.

You are spawned ON-DEMAND for parallel analysis tasks. You run in the background
while the user continues chatting with Gordon.

## Your Role
- Execute the specific research task you were given
- Use tools to gather data, compute analysis, run backtests
- Return a concise, actionable summary when done
- You are READ-ONLY — you cannot place trades, cancel orders, or modify positions

## Guidelines
1. Focus on the assigned task — don't go on tangents
2. Use parallel tool calls when analyzing multiple symbols
3. Be concise in your final response — the user is waiting
4. Include specific numbers, levels, and actionable conclusions
5. If the task is a backtest, include key metrics (return %, win rate, max drawdown)
6. If the task is multi-symbol analysis, rank results by opportunity quality`;

export function getResearcher(): Agent {
  const agent = new Agent({
    id: "researcher",
    name: "Researcher",
    description:
      "On-demand parallel research agent. Spawned for background tasks like " +
      "multi-symbol scans, backtests, deep dives. Read-only — cannot trade.",
    instructions: composeAgentInstructionsWithSlots("researcher" as any, {
      user: RESEARCHER_INSTRUCTIONS,
      suffix: isHarnessProfilesEnabled()
        ? getHarnessSuffixForModel(resolveRuntimeModel(undefined, "researcher"))
        : undefined,
    }),
    model: createModelResolver("researcher"),
    defaultOptions: { modelSettings: { maxOutputTokens: 16384 } },
    tools: {
      ...instrumentedIndicatorTools,
      ...instrumentedMarketDataTools,
      ...instrumentedMarketTools,
      ...instrumentedDiscoveryTools,
      ...instrumentedStrategyTools,
      ...instrumentedParallelAnalysisTools,
      ...instrumentedBacktestTools,
      ...instrumentedChartTools,
      ...instrumentedMarketAnalysisTools,
      ...instrumentedCompositionTools,
      ...instrumentedLiquidationIntelligenceTools,
      ...instrumentedPairAnalysisTools,
      ...instrumentedXSocialTools,
      ...instrumentedCdpWebhookTools,
      ...instrumentedCdpSqlTools,
      ...instrumentedCdpPolicyTools,
      ...instrumentedCdpOnrampTools,
      ...instrumentedCdpEvmMultichainTools,
      ...instrumentedCdpWebhookReceiverTools,
      ...instrumentedProactiveModeTools,
      ...instrumentedBacktestVerdictTools,
      ...instrumentedFinnhubTools,
      ...instrumentedFinnhubFundamentalsTools,
      ...instrumentedFinnhubMarketsTools,
      ...instrumentedSmcPatternTools,
      ...instrumentedCalibrationTools,
      ...instrumentedSkillLoaderTools,
      // Anti-hallucination quote verification (reverse-quant port). The
      // Researcher extracts quoted snippets from external text; this
      // tool lets it self-check before stating quotes as fact.
      ...instrumentedQuoteVerifyTools,
      // Diagnostic primitives — Researcher exposes these so it can
      // analyze P&L distributions, vol calibration, and correlation
      // breakdowns when delegated research tasks request them.
      ...instrumentedDiagnosticTools,
      // Microstructure primitives — Researcher uses these when book-
      // analysis tasks come in (microprice for fair-value estimation,
      // inventory-adjusted price for sizing-bias analysis).
      ...instrumentedMicrostructureTools,
      ...instrumentedProducerHealthTools,
      ...instrumentedSharedContextTools,
      ...instrumentedMemoryTools,
      ...instrumentedEvalTools,
      ...instrumentedRegimeTools,
    },
    memory: createSubAgentMemory("researcher"),
    inputProcessors: [gordonToolCallReconciler, gordonInputGuard, new TokenLimiterProcessor({ limit: 32000 })],
    outputProcessors: [gordonOutputSanitizer],
  });
  registerObservability(agent);
  return agent;
}
