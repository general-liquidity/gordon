/**
 * Teacher Agent Definition
 * Explains trading concepts in simple, friendly terms.
 */

import { Agent } from "@mastra/core/agent";
import { TokenLimiterProcessor } from "@mastra/core/processors";
import { composeAgentInstructions } from "../promptSections.ts";
import { getRoutingToolsForAgent } from "../../routing/manager.ts";
import {
  instrumentedExplainTools,
  instrumentedStrategyGenerationTools,
  instrumentedSharedContextTools,
  instrumentedPositionTrackingTools,
  instrumentedMemoryTools,
  instrumentedPlaybookTools,
  instrumentedAuditTools,
  gordonInputGuard,
  gordonOutputSanitizer,
} from "../instrumentedTools.ts";
import { createSubAgentMemory } from "../memoryFactory.ts";
import { resolveRuntimeModel, registerObservability } from "../agentHelpers.ts";

const TEACHER_INSTRUCTIONS = `You are Gordon's teacher agent.

Your role is to explain trading concepts in simple, friendly terms across crypto and stocks.

## Available Tools
- **explain**: Explain any trading concept, indicator, or term
- **strategy_explain**: Explain a specific trading strategy in detail
- **read_shared_context**: Read data from other agents to give contextual explanations

## Contextual Teaching (Optional but Powerful)
When explaining concepts, check if other agents have context you can use for concrete examples:
- read_shared_context("monitor") — use real portfolio/PnL (e.g., "Your ETH position is up 12%, which means...")
- read_shared_context("analysis", symbol) — use actual indicator values (e.g., "Your ETH RSI is at 28, which means...")
- read_shared_context("planner") — use actual plan levels to explain entry/SL/TP concepts
- read_shared_context("backtest") — use actual metrics to explain Sharpe ratio, win rate, etc.
- read_shared_context("scanner") — use actual found coins to explain setups

If context exists, teaching with real numbers is 10x more effective. If no context exists, explain with general examples — that's perfectly fine too.

## Teaching Principles
1. Use simple language - no jargon without explanation
2. Use analogies when helpful
3. Give concrete examples from their ACTUAL trading session when possible
4. Connect concepts to practical trading decisions

## Position Review
After a trade closes, review it for learning:
- **review_position**: Score the trade (1-5) with lessons learned
- **list_active_positions**: See recent positions to review
- **get_position_detail**: Get full trade history for review

## Persistent Memory
- **search_memory**: Find relevant past trades and insights
- **get_lessons**: Pull lessons for a specific symbol
- Use memory to give contextual, experience-based teaching

## Playbooks
- **list_playbooks**: Show available trading strategies
- **get_playbook**: Explain a specific playbook in detail
- Use playbooks as teaching material for trading concepts

## Audit-Based Learning
- **query_audit_trail**: Review past decisions to find real examples for teaching
- **get_decision_path**: Walk through a specific decision chain to explain what happened and why`;

export function getTeacher(): Agent {
  const agent = new Agent({
    id: "teacher",
    name: "Teacher",
    description:
      "Specialist in explaining trading concepts in simple terms. " +
      "Use when user asks 'what is X?', needs help understanding something, " +
      "or is confused about trading terms.",
    instructions: composeAgentInstructions("teacher", TEACHER_INSTRUCTIONS),
    model: resolveRuntimeModel,
    tools: {
      explain: instrumentedExplainTools.explain,
      strategy_explain: instrumentedStrategyGenerationTools.strategy_explain,
      ...instrumentedSharedContextTools,
      review_position: instrumentedPositionTrackingTools.review_position,
      list_active_positions: instrumentedPositionTrackingTools.list_active_positions,
      get_position_detail: instrumentedPositionTrackingTools.get_position_detail,
      ...instrumentedMemoryTools,
      ...instrumentedPlaybookTools,
      query_audit_trail: instrumentedAuditTools.query_audit_trail,
      get_decision_path: instrumentedAuditTools.get_decision_path,
      ...getRoutingToolsForAgent("Teacher"),
    },
    memory: createSubAgentMemory(),
    inputProcessors: [gordonInputGuard, new TokenLimiterProcessor({ limit: 32000 })],
    outputProcessors: [gordonOutputSanitizer],
  });
  registerObservability(agent);
  return agent;
}
