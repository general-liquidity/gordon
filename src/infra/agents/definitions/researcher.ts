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
import { composeAgentInstructions } from "../promptSections.ts";
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
  instrumentedSmcPatternTools,
  instrumentedCalibrationTools,
  instrumentedSkillLoaderTools,
  instrumentedProducerHealthTools,
  instrumentedSharedContextTools,
  instrumentedMemoryTools,
  instrumentedEvalTools,
  instrumentedRegimeTools,
  gordonInputGuard,
  gordonOutputSanitizer,
} from "../instrumentedTools.ts";
import { createSubAgentMemory } from "../memoryFactory.ts";
import { resolveRuntimeModel, registerObservability } from "../agentHelpers.ts";

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
    instructions: composeAgentInstructions("researcher" as any, RESEARCHER_INSTRUCTIONS),
    model: resolveRuntimeModel,
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
      ...instrumentedSmcPatternTools,
      ...instrumentedCalibrationTools,
      ...instrumentedSkillLoaderTools,
      ...instrumentedProducerHealthTools,
      ...instrumentedSharedContextTools,
      ...instrumentedMemoryTools,
      ...instrumentedEvalTools,
      ...instrumentedRegimeTools,
    },
    memory: createSubAgentMemory(),
    inputProcessors: [gordonInputGuard, new TokenLimiterProcessor({ limit: 32000 })],
    outputProcessors: [gordonOutputSanitizer],
  });
  registerObservability(agent);
  return agent;
}
