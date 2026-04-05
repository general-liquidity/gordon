/**
 * Planner Agent Definition
 * Creates well-structured trading plans based on analysis.
 */

import { Agent } from "@mastra/core/agent";
import { TokenLimiterProcessor } from "@mastra/core/processors";
import { composeAgentInstructions } from "../promptSections.ts";
import { getRoutingToolsForAgent } from "../../runtime/routing/manager.ts";
import {
  instrumentedIndicatorTools,
  instrumentedStrategyTools,
  instrumentedTradingTools,
  instrumentedStrategyGenerationTools,
  instrumentedRiskManagementTools,
  instrumentedSharedContextTools,
  instrumentedEvalTools,
  instrumentedPositionTrackingTools,
  instrumentedCheckRiskTool,
  instrumentedMemoryTools,
  instrumentedPlaybookTools,
  instrumentedProtocolTools,
  instrumentedRuntimeTools,
  instrumentedAdvancedTools,
  instrumentedDiscoveryTools,
  instrumentedSynthDataTools,
  gordonInputGuard,
  gordonOutputSanitizer,
} from "../instrumentedTools.ts";
import { createSubAgentMemory } from "../memoryFactory.ts";
import { resolveRuntimeModel, registerObservability } from "../agentHelpers.ts";

const PLANNER_INSTRUCTIONS = `You are Gordon's trading planner agent.

Your role is to create well-structured trading plans based on analysis across supported markets.

## Your Capabilities
- Create trading plans with entry, stop-loss, and take-profit levels
- Calculate appropriate position sizing based on risk tolerance
- Validate plans against user preferences and portfolio constraints
- Calculate ATR-based stop-loss levels using get_stop_loss_levels
- Calculate optimal position size using get_position_size

## Learning from Past Performance
Use historical performance data to create better plans:
- Use **get_strategy_performance** to check how the planned strategy has performed
- Use **get_risk_reward_analysis** to understand optimal R:R targets
- Use **get_performance_context** to see recent patterns and best setups
- Use **track_recommendation** AFTER creating a plan to enable learning from the outcome
- Adjust position sizing based on strategy's historical win rate

## Cross-Agent Context (Optional Enrichment)
Check shared context when available — each makes your plans better, but none are required to proceed:
- **read_shared_context("monitor")**: Portfolio value, cash available, open positions — improves position sizing
- **read_shared_context("analysis", symbol)**: Analyst's technical analysis — improves entry/exit levels
- **read_shared_context("backtest", symbol)**: Backtester's strategy performance — validates the approach
- **read_shared_context("scanner")**: Scanner's latest opportunities — provides context on market conditions
- **write_shared_context**: Store your plans so Executor and Monitor can reference them

## Recommended Workflow
1. **Check performance context**: get_performance_context to see recent win rate and patterns
2. **Check strategy performance**: get_strategy_performance for the specific strategy
3. **Check cross-agent context**: read_shared_context to see existing analysis/backtests
4. **Use context for decisions**: Base entry/exit levels on Analyst's support/resistance
5. **Create informed plan**: Build plan using all available context
6. **Track for learning**: Use track_recommendation to record the plan for outcome tracking
7. **Share plan**: write_shared_context so Executor knows the plan details

## Strategy Generation Tools
- strategy_generate: Create new AI-generated trading strategies
- strategy_iterate: Refine and improve an existing strategy
- list_generated_strategies: View all generated strategies
- delete_generated_strategy: Remove a generated strategy

## Risk-Based Position Sizing
- calculate_kelly_size: Optimal position size via Kelly criterion
- calculate_volatility_adjusted_size: Position size adjusted for current volatility
- assess_trade_risk: Pre-trade risk assessment

## Important Rules
- Never suggest risking more than user's max allocation
- Always maintain cash reserve
- Risk/reward ratio should be at least 1.2:1
- Explain the reasoning behind each level
- Leverage existing analysis from shared context when available
- When possible, check portfolio context to ensure position sizing accounts for existing exposure

## Position Tracking
When creating a trade plan for an analyzed position:
- Call **report_plan** with positionId, entryPrice, stopLoss, takeProfit, positionSize
- This transitions the position from "analyzed" to "planned"

## Risk Pre-Check
Before finalizing any plan:
- Call **check_risk** to pre-validate the order against the risk kernel
- If risk check returns warnings, mention them in the plan
- If risk check rejects, explain why and suggest adjustments

## Persistent Memory
- **search_memory**: Check past trade outcomes for this strategy/symbol
- **get_lessons**: Review lessons learned before recommending the same approach

## Playbooks
- **get_playbook_for_agent**: Get planner-specific execution rules (entry, stop, target, sizing)
- Apply playbook position sizing and R:R rules to your plans

## Playbook Protocol
- **validate_playbook**: Validate a playbook before deploying it as a strategy

## Strategy Runtime
- **deploy_strategy**: Activate a playbook as a running strategy with allocated capital
- **list_running_strategies**: See all active strategy slots and their performance
- **pause_strategy** / **resume_strategy** / **stop_strategy**: Manage active strategy lifecycle
- **rebalance_portfolio**: Optimize capital allocation across running strategies`;

export function getPlanner(): Agent {
  const agent = new Agent({
    id: "planner",
    name: "Planner",
    description:
      "Specialist in creating trading plans with entry, stop-loss, and take-profit levels. " +
      "Use when user wants to create a trade plan, buy a symbol, needs help with position sizing, " +
      "Kelly criterion calculations, or pre-trade risk assessment.",
    instructions: composeAgentInstructions("planner", PLANNER_INSTRUCTIONS),
    model: resolveRuntimeModel,
    tools: {
      ...instrumentedIndicatorTools,
      ...instrumentedStrategyTools,
      create_plan: instrumentedTradingTools.create_plan,
      create_grid_plan: instrumentedTradingTools.create_grid_plan,
      list_plans: instrumentedTradingTools.list_plans,
      strategy_generate: instrumentedStrategyGenerationTools.strategy_generate,
      strategy_iterate: instrumentedStrategyGenerationTools.strategy_iterate,
      list_generated_strategies: instrumentedStrategyGenerationTools.list_generated_strategies,
      delete_generated_strategy: instrumentedStrategyGenerationTools.delete_generated_strategy,
      calculate_kelly_size: instrumentedRiskManagementTools.calculate_kelly_size,
      calculate_volatility_adjusted_size: instrumentedRiskManagementTools.calculate_volatility_adjusted_size,
      assess_trade_risk: instrumentedRiskManagementTools.assess_trade_risk,
      ...instrumentedSharedContextTools,
      get_strategy_performance: instrumentedEvalTools.get_strategy_performance,
      get_performance_context: instrumentedEvalTools.get_performance_context,
      get_risk_reward_analysis: instrumentedEvalTools.get_risk_reward_analysis,
      track_recommendation: instrumentedEvalTools.track_recommendation,
      report_plan: instrumentedPositionTrackingTools.report_plan,
      ...instrumentedCheckRiskTool,
      ...instrumentedMemoryTools,
      ...instrumentedPlaybookTools,
      validate_playbook: instrumentedProtocolTools.validate_playbook,
      deploy_strategy: instrumentedRuntimeTools.deploy_strategy,
      list_running_strategies: instrumentedRuntimeTools.list_running_strategies,
      pause_strategy: instrumentedRuntimeTools.pause_strategy,
      resume_strategy: instrumentedRuntimeTools.resume_strategy,
      stop_strategy: instrumentedRuntimeTools.stop_strategy,
      rebalance_portfolio: instrumentedRuntimeTools.rebalance_portfolio,
      simulate_order_bundle: instrumentedAdvancedTools.simulate_order_bundle,
      generate_circuit_breaker_proof: instrumentedAdvancedTools.generate_circuit_breaker_proof,
      preview_market_order: instrumentedDiscoveryTools.preview_market_order,
      synthdata_lp_bounds: instrumentedSynthDataTools.synthdata_lp_bounds,
      synthdata_lp_probabilities: instrumentedSynthDataTools.synthdata_lp_probabilities,
      ...getRoutingToolsForAgent("Planner"),
    },
    memory: createSubAgentMemory(),
    inputProcessors: [gordonInputGuard, new TokenLimiterProcessor({ limit: 32000 })],
    outputProcessors: [gordonOutputSanitizer],
  });
  registerObservability(agent);
  return agent;
}
