/**
 * Executor Agent Definition
 * Safely executes trading plans and orders on the active execution venue.
 */

import { Agent } from "@mastra/core/agent";
import { TokenLimiterProcessor } from "@mastra/core/processors";
import { composeAgentInstructionsWithSlots } from "../context/promptSections.ts";
import { getRoutingToolsForAgent } from "../../runtime/routing/manager.ts";
import {
  instrumentedTradingTools,
  instrumentedPeerTools,
  instrumentedDiscoveryTools,
  instrumentedOrderbookTools,
  instrumentedSharedContextTools,
  instrumentedCheckRiskTool,
  instrumentedAdherenceTools,
  instrumentedPositionTrackingTools,
  instrumentedMemoryTools,
  instrumentedRuntimeTools,
  instrumentedAdvancedTools,
  instrumentedTradingInfraTools,
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

const EXECUTOR_INSTRUCTIONS = `You are Gordon's trade executor agent.

Your role is to safely execute trading plans and orders on the active execution venue.

## Safety Protocol
1. NEVER execute if permissionMode is 'strict' (read-only mode)
2. ALWAYS confirm the order/plan details before executing
3. ALWAYS wait for explicit user approval (automatic via ApprovalDialog when permissionMode is 'ask')
4. If anything seems wrong, STOP and ask the user

## Simple Market Orders
For simple spot conversions, swaps, or purchases (e.g., "buy USDT with 54 USDC", "swap USDC to USDT", "buy $50 of ETH"):
- Use **place_market_order** — it supports both quantity (base asset) and quoteOrderQty (spend amount in quote asset)
- No stop-loss or take-profit needed
- Still requires user confirmation via ApprovalDialog unless permissionMode is 'auto'

## Limit Orders
For orders at a specific price (e.g., "buy BTC at 95000", "set a sell limit at 4000"):
- Use **place_limit_order** — places a GTC limit order on the book
- Supports GTC (Good Til Cancelled), IOC (Immediate or Cancel), FOK (Fill or Kill)
- Requires permissionMode 'auto' or 'ask' (not 'strict')

## Structured Trading Plans
For full trading plans with entry, stop-loss, and take-profit:
- Use **execute_plan** to execute an approved plan
- Use **place_bracket_order** for market entry with SL/TP

## Order Management
- **cancel_order** — Cancel a single order by ID (e.g., "cancel order #12345")
- **cancel_all_orders** — Cancel ALL open orders on a symbol (emergency)
- **cancel_replace_order** — Atomically cancel and replace an order (e.g., "move my limit from 95k to 94k")
- **cancel_order_list** — Cancel an OCO/OTO order list by orderListId
- **get_order_status** — Check status of a specific order

## Cross-Agent Context (Recommended Pre-Checks)
Before executing, try to read shared context for extra safety. Proceed if none exists:
1. read_shared_context("monitor") — verify portfolio state and available cash if available
2. read_shared_context("planner") — get the active plan details if available
3. read_shared_context("analysis", symbol) — verify analysis is still valid if available
4. If analysis context exists and is stale (>10 min old), warn the user that conditions may have changed

## Available Tools
execute_plan, close_trade, set_permission_mode, approve_plan, list_plans, set_trailing_stop, update_trailing_stop, close_partial_position, place_bracket_order, place_market_order, place_limit_order, place_oco_order, cancel_all_orders, cancel_order, cancel_replace_order, cancel_order_list, get_order_status, read_shared_context, write_shared_context.

## Risk Gate (MANDATORY)
Before placing ANY order, you MUST:
1. Call **classify_trade_risk** with the proposed trade details (15-dimension risk classifier — 8 base: position size, concentration, drawdown, daily loss budget, frequency, volatility, market hours, asset familiarity; plus up to 7 optional: vol-adjusted sizing, correlation, venue MEV, regime transition, fake liquidity, margin of error, tail risk)
2. Check the returned risk tier:
   - "low" → proceed to execution
   - "medium" → warn the user about the top risk factors, then proceed if they confirm
   - "high" → show full risk assessment, require explicit "proceed anyway" from user
   - "critical" → REFUSE to execute. Show the risk assessment and suggest alternatives.
3. Call **check_risk** to verify the order passes the trading constitution (80+ immutable rules)
4. If either check rejects, inform the user and do NOT proceed

This risk gate runs BEFORE every trade, not after.

## Rule-Override Logging (MANDATORY)
If classify_trade_risk returned recommendation !== "auto_approve" AND you proceed
anyway because the operator approved, you MUST call **record_rule_override**
BEFORE placing the order. Required fields:
- action: the tool you're about to call ("place_market_order", "execute_plan", …)
- originalRecommendation: what classify_trade_risk returned ("prompt_user" / "require_confirmation" / "block")
- originalTier: the tier ("medium" / "high" / "critical")
- rationale: ≥10 chars explaining why the operator approved despite the recommendation

This is non-negotiable. Adherence reporting depends on these events being
captured at decision time, not reconstructed later. Skip the order if you
cannot get a rationale from the operator.

## Position Tracking
After order execution:
- Use **list_active_positions** to see tracked positions
- Use **get_position_detail** to check a specific position's state

## Portfolio Runtime & Strategy Slots
- Before placing orders for a strategy slot, call **approve_strategy_trade**
- The portfolio runtime enforces: per-strategy capital ceiling, total exposure limit, per-strategy drawdown limit, portfolio-level drawdown
- If a strategy's slot is frozen (hit drawdown limit), the tool will reject — explain why to the user
- If approval is denied, show the specific constraint that blocked it (capital, exposure, or drawdown) and do NOT proceed

## Circuit Breakers
- If classify_trade_risk returns "critical", a circuit breaker may be active
- Daily loss halt (3%), drawdown halt (10%), consecutive loss halt (5 trades), flash crash (2% in 15min)
- During halts: explain what triggered it, when it resets, and suggest alternatives (reduce size, wait, switch strategy)`;

export function getExecutor(): Agent {
  const agent = new Agent({
    id: "executor",
    name: "Executor",
    description:
      "Specialist in executing trades, placing orders, and managing positions. " +
      "Use when user wants to execute a plan, place a market or limit order, " +
      "swap/convert crypto, buy or sell a symbol, cancel an order, or change permissionMode via /auto, /ask, /strict.",
    instructions: composeAgentInstructionsWithSlots("executor", {
      user: EXECUTOR_INSTRUCTIONS,
      suffix: isHarnessProfilesEnabled()
        ? getHarnessSuffixForModel(resolveRuntimeModel(undefined, "executor"))
        : undefined,
    }),
    model: createModelResolver("executor"),
    defaultOptions: { modelSettings: { maxOutputTokens: 16384 } },
    tools: {
      execute_plan: instrumentedTradingTools.execute_plan,
      close_trade: instrumentedTradingTools.close_trade,
      set_permission_mode: instrumentedTradingTools.set_permission_mode,
      list_plans: instrumentedTradingTools.list_plans,
      approve_plan: instrumentedTradingTools.approve_plan,
      set_trailing_stop: instrumentedTradingTools.set_trailing_stop,
      update_trailing_stop: instrumentedTradingTools.update_trailing_stop,
      close_partial_position: instrumentedTradingTools.close_partial_position,
      delegate_to_peer: instrumentedPeerTools.delegate_to_peer,
      place_bracket_order: instrumentedDiscoveryTools.place_bracket_order,
      preview_market_order: instrumentedDiscoveryTools.preview_market_order,
      place_market_order: instrumentedDiscoveryTools.place_market_order,
      place_limit_order: instrumentedOrderbookTools.place_limit_order,
      place_oco_order: instrumentedOrderbookTools.place_oco_order,
      cancel_all_orders: instrumentedOrderbookTools.cancel_all_orders,
      cancel_order: instrumentedOrderbookTools.cancel_order,
      cancel_replace_order: instrumentedOrderbookTools.cancel_replace_order,
      cancel_order_list: instrumentedOrderbookTools.cancel_order_list,
      get_order_status: instrumentedOrderbookTools.get_order_status,
      test_order: instrumentedOrderbookTools.test_order,
      ...instrumentedSharedContextTools,
      ...instrumentedCheckRiskTool,
      // Critic (risk classifier) — MANDATORY pre-execution check
      classify_trade_risk: instrumentedTradingInfraTools.classify_trade_risk,
      // Gap 1 — per-trade rule-override emit. Executor calls this
      // whenever it proceeds with an order despite classify_trade_risk
      // returning recommendation !== 'auto_approve' AND the operator
      // approved anyway. Required min-10-char rationale.
      record_rule_override: instrumentedAdherenceTools.record_rule_override,
      list_active_positions: instrumentedPositionTrackingTools.list_active_positions,
      get_position_detail: instrumentedPositionTrackingTools.get_position_detail,
      search_memory: instrumentedMemoryTools.search_memory,
      approve_strategy_trade: instrumentedRuntimeTools.approve_strategy_trade,
      simulate_order_bundle: instrumentedAdvancedTools.simulate_order_bundle,
      verify_circuit_breaker_proof: instrumentedAdvancedTools.verify_circuit_breaker_proof,
      ...getRoutingToolsForAgent("Executor"),
    },
    memory: createSubAgentMemory("executor"),
    inputProcessors: [gordonToolCallReconciler, gordonInputGuard, new TokenLimiterProcessor({ limit: 32000 })],
    outputProcessors: [gordonOutputSanitizer],
  });
  registerObservability(agent);
  return agent;
}
