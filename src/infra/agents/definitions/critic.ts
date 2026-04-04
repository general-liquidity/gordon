/**
 * Critic Agent Definition
 * Challenges trade ideas, plans, and execution readiness before capital is committed.
 */

import { Agent } from "@mastra/core/agent";
import { TokenLimiterProcessor } from "@mastra/core/processors";
import { composeAgentInstructions } from "../promptSections.ts";
import { getRoutingToolsForAgent } from "../../routing/manager.ts";
import {
  instrumentedAuditTools,
  instrumentedRuntimeTools,
  instrumentedRiskManagementTools,
  instrumentedStrategyTools,
  instrumentedBacktestTools,
  instrumentedPlaybookTools,
  instrumentedMemoryTools,
  instrumentedSharedContextTools,
  instrumentedMarketTools,
  instrumentedEvalTools,
  instrumentedPositionTrackingTools,
  gordonInputGuard,
  gordonOutputSanitizer,
} from "../instrumentedTools.ts";
import { createSubAgentMemory } from "../memoryFactory.ts";
import { resolveRuntimeModel, registerObservability } from "../agentHelpers.ts";

const CRITIC_INSTRUCTIONS = `You are Gordon's strategy critic agent.

Your role is to challenge trade ideas, plans, and execution readiness before capital is committed.

## Your Capabilities
- Stress-test trade plans for weak assumptions, poor evidence, or hidden risk
- Review audit trail, runtime health, and prior outcomes before endorsing a plan
- Compare live setup logic against playbooks, backtests, and current market conditions
- Flag when a plan is technically valid but operationally weak

## What To Prioritize
1. Missing or weak evidence behind the setup
2. Entry, stop, and target logic that do not match the stated thesis
3. Over-sized risk, unclear invalidation, or weak liquidity
4. Mismatch between current regime and the strategy being proposed
5. Cases where Gordon should stay read-only or request more context

## Available Tools
- Audit chain: query_audit_trail, get_decision_path, get_agent_activity, get_audit_stats
- Runtime state: get_portfolio_state, check_portfolio_health
- Risk: check_risk, check_exit_conditions, check_drawdown_status, check_daily_limit
- Strategy validation: strategy_explain, list_strategies, list_playbooks, get_playbook
- Historical validation: backtest_*, compare_backtest_results, get_best_strategy
- Shared context: read_shared_context, write_shared_context

## Operating Style
- Be direct.
- Do not re-run the same analysis unless it materially changes the verdict.
- Output concrete objections and the shortest path to resolving them.`;

export function getCritic(): Agent {
  const agent = new Agent({
    id: "critic",
    name: "Critic",
    description:
      "Specialist in challenging plans, surfacing hidden risks, and stress-testing execution readiness. " +
      "Use when the user wants a second opinion, red-team review, or a risk-focused challenge to a setup or plan.",
    instructions: composeAgentInstructions("critic", CRITIC_INSTRUCTIONS),
    model: resolveRuntimeModel,
    tools: {
      ...instrumentedAuditTools,
      ...instrumentedRuntimeTools,
      ...instrumentedRiskManagementTools,
      ...instrumentedStrategyTools,
      ...instrumentedBacktestTools,
      ...instrumentedPlaybookTools,
      ...instrumentedMemoryTools,
      ...instrumentedSharedContextTools,
      analyze_coin: instrumentedMarketTools.analyze_coin,
      get_performance_context: instrumentedEvalTools.get_performance_context,
      get_learning_insights: instrumentedEvalTools.get_learning_insights,
      get_performance_report: instrumentedEvalTools.get_performance_report,
      list_active_positions: instrumentedPositionTrackingTools.list_active_positions,
      get_position_detail: instrumentedPositionTrackingTools.get_position_detail,
      review_position: instrumentedPositionTrackingTools.review_position,
      ...getRoutingToolsForAgent("Critic"),
    },
    memory: createSubAgentMemory(),
    inputProcessors: [gordonInputGuard, new TokenLimiterProcessor({ limit: 32000 })],
    outputProcessors: [gordonOutputSanitizer],
  });
  registerObservability(agent);
  return agent;
}
