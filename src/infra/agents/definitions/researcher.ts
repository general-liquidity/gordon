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
import { composeAgentInstructionsWithSlots } from "../context/promptSections.ts";
import {
  instrumentedQuoteVerifyTools,
  instrumentedProducerHealthTools,
  instrumentedXSocialTools,
  instrumentedFinnhubTools,
  instrumentedFinnhubFundamentalsTools,
  instrumentedFinnhubMarketsTools,
  instrumentedOffloadedResultTools,
  instrumentedSecFilingTools,
  instrumentedWebTools,
  instrumentedRecursiveDecomposeTools,
  instrumentedSelfHistoryTools,
  gordonInputGuard,
  gordonOutputSanitizer,
  gordonToolCallReconciler,
} from "../tooling/instrumentedTools.ts";
import {
  researcherContextFilter,
  isResearcherLeastContextEnabled,
} from "../processors/researcher-context-filter.ts";
import { createSubAgentMemory } from "../memory/memoryFactory.ts";
import {
  createModelResolver,
  registerObservability,
  resolveRuntimeModel,
} from "../agentHelpers.ts";
import { instrumentedAgentTools } from "../tooling/instrumentedTools.ts";
import { getHarnessSuffixForModel, isHarnessProfilesEnabled } from "../profiles/harnessProfile.ts";
import { applyNativeApprovalMarkers } from "../harness/nativeToolApproval.ts";
import { nativeInputProcessorsForAgent, nativeOutputProcessorsForAgent } from "../nativeWiring.ts";

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

/** Cold-tier gate — excluded when the operator pins GORDON_TOOL_TIER=hot. */
function isHotTierOnly(): boolean {
  return process.env.GORDON_TOOL_TIER === "hot";
}

export function getResearcher(): Agent {
  // Researcher = read-only inheritor of the agent surface.
  // The canonical 22-tool set + integration data feeds + quote-verify +
  // producer health. Mastra's runtime tool-filtering enforces read-only
  // at the subagent boundary (execute_plan / approve_plan / cancel
  // surface through but get rejected by the permission engine for this
  // subagent profile). Extracted so native tool-approval markers apply.
  const tools = {
    // Anti-hallucination quote verification.
    ...instrumentedQuoteVerifyTools,
    // Producer health observability.
    ...instrumentedProducerHealthTools,

    // INTEGRATION tier — venue + social + research feeds.
    ...instrumentedXSocialTools,
    ...instrumentedFinnhubTools,
    ...instrumentedFinnhubFundamentalsTools,
    ...instrumentedFinnhubMarketsTools,
    // Recovering a spilled tool result: cold tier, and only reachable after
    // an offload has already happened.
    ...(isHotTierOnly() ? {} : instrumentedOffloadedResultTools),
    ...(isHotTierOnly() ? {} : instrumentedSecFilingTools),
    // Open-web reach (web_fetch / web_search) — gated allowlist + injection-
    // sanitized, COLD tier (DD/discovery, not the hot scan path).
    ...(isHotTierOnly() ? {} : instrumentedWebTools),

    // Canonical 22-tool agent surface.
    ...instrumentedAgentTools,

    // RLM recursive decomposition for oversized inputs (10-K, trade
    // ledger, news history). COLD tier — deep-research path, not hot scan.
    ...(isHotTierOnly() ? {} : instrumentedRecursiveDecomposeTools),

    // Self-history recall (search_session_history) — ranked, provenance-
    // carrying search over Gordon's OWN past chat sessions. COLD tier —
    // deep-recall path ("what did I conclude last time"), not hot scan.
    ...(isHotTierOnly() ? {} : instrumentedSelfHistoryTools),
  };

  // Native tool-approval (GORDON_NATIVE_TOOL_APPROVAL): mark any execute_plan /
  // cancel_* that surface through the shared agent surface. No-op when the flag
  // is unset. The researcher is read-only regardless — the permission engine
  // rejects execution here — so this is defense-in-depth, never a widening.
  applyNativeApprovalMarkers(tools as Record<string, { id?: string; requireApproval?: unknown }>);

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
    tools,
    memory: createSubAgentMemory("researcher"),
    inputProcessors: [
      gordonToolCallReconciler,
      // Least-context: scrub account financials + secrets before the researcher
      // (no execution perms) sees them. On by default; GORDON_LEAST_CONTEXT_RESEARCHER=0 to disable.
      ...(isResearcherLeastContextEnabled() ? [researcherContextFilter] : []),
      gordonInputGuard,
      new TokenLimiterProcessor({ limit: 32000 }),
      // Native processors (GORDON_MASTRA_PROCESSORS) append last; empty off.
      ...nativeInputProcessorsForAgent(),
    ],
    outputProcessors: [gordonOutputSanitizer, ...nativeOutputProcessorsForAgent()],
  });
  registerObservability(agent);
  return agent;
}
