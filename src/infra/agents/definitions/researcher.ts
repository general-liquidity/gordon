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
  instrumentedInstitutionalAiTools,
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
import { getV4Tools, isV4Active } from "../tools/v4/index.ts";
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
    // V4 gating: same pattern as Gordon — legacy analytical surface
    // collapses to V4's 22 tools; integration data feeds + quote-verify
    // stay regardless.
    tools: {
      // Indicators / market / scanning (V4: compute_indicator, get_market_data)
      ...(isV4Active() ? {} : instrumentedIndicatorTools),
      ...(isV4Active() ? {} : instrumentedMarketDataTools),
      ...(isV4Active() ? {} : instrumentedMarketTools),
      ...(isV4Active() ? {} : instrumentedDiscoveryTools),
      ...(isV4Active() ? {} : instrumentedStrategyTools),
      ...(isV4Active() ? {} : instrumentedParallelAnalysisTools),
      // Backtest / eval (V4: backtest)
      ...(isV4Active() ? {} : instrumentedBacktestTools),
      // Charts / analysis (V4: compute_indicator covers most)
      ...(isV4Active() ? {} : instrumentedChartTools),
      ...(isV4Active() ? {} : instrumentedMarketAnalysisTools),
      ...(isV4Active() ? {} : instrumentedCompositionTools),
      ...(isV4Active() ? {} : instrumentedLiquidationIntelligenceTools),
      ...(isV4Active() ? {} : instrumentedPairAnalysisTools),

      // INTEGRATION tier — stays regardless of V4.
      ...instrumentedXSocialTools,
      ...instrumentedCdpWebhookTools,
      ...instrumentedCdpSqlTools,
      ...instrumentedCdpPolicyTools,
      ...instrumentedCdpOnrampTools,
      ...instrumentedCdpEvmMultichainTools,
      ...instrumentedCdpWebhookReceiverTools,

      // Proactive radar (V4: schedule_task)
      ...(isV4Active() ? {} : instrumentedProactiveModeTools),
      ...(isV4Active() ? {} : instrumentedBacktestVerdictTools),

      // Finnhub — INTEGRATION tier.
      ...instrumentedFinnhubTools,
      ...instrumentedFinnhubFundamentalsTools,
      ...instrumentedFinnhubMarketsTools,

      // SMC + calibration (V4: compute_indicator, compute_microstructure)
      ...(isV4Active() ? {} : instrumentedSmcPatternTools),
      ...(isV4Active() ? {} : instrumentedCalibrationTools),
      // Skill loader (V4: skill)
      ...(isV4Active() ? {} : instrumentedSkillLoaderTools),
      // Anti-hallucination quote verification — stays regardless.
      ...instrumentedQuoteVerifyTools,
      // Diagnostic / microstructure / institutional-AI (V4: compute_microstructure)
      ...(isV4Active() ? {} : instrumentedDiagnosticTools),
      ...(isV4Active() ? {} : instrumentedMicrostructureTools),
      ...(isV4Active() ? {} : instrumentedInstitutionalAiTools),
      // Producer health — system observability, stays regardless.
      ...instrumentedProducerHealthTools,
      // Shared context / memory (V4: memory_search, memory_write)
      ...(isV4Active() ? {} : instrumentedSharedContextTools),
      ...(isV4Active() ? {} : instrumentedMemoryTools),
      ...(isV4Active() ? {} : instrumentedEvalTools),
      // Regime detection (V4: compute_regime)
      ...(isV4Active() ? {} : instrumentedRegimeTools),

      // V4 meta-tool surface — researcher inherits the same read-only
      // V4 surface (Gordon's tools minus execute_plan/approve_plan/cancel
      // is conceptually the researcher's natural set; for now the full
      // V4 set is spread and Mastra's runtime tool-filtering enforces
      // read-only at the subagent boundary).
      ...getV4Tools(),
    },
    memory: createSubAgentMemory("researcher"),
    inputProcessors: [gordonToolCallReconciler, gordonInputGuard, new TokenLimiterProcessor({ limit: 32000 })],
    outputProcessors: [gordonOutputSanitizer],
  });
  registerObservability(agent);
  return agent;
}
