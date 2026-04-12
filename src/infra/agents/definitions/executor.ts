/**
 * Executor Agent Definition
 * Safely executes trading plans and orders on the active execution venue.
 */

import { Agent } from "@mastra/core/agent";
import { TokenLimiterProcessor } from "@mastra/core/processors";
import { composeAgentInstructions } from "../promptSections.ts";
import { getRoutingToolsForAgent } from "../../runtime/routing/manager.ts";
import {
  instrumentedTradingTools,
  instrumentedDiscoveryTools,
  instrumentedOrderbookTools,
  instrumentedAgentKitOnchainTools,
  instrumentedAgentKitDefiTools,
  instrumentedSharedContextTools,
  instrumentedCheckRiskTool,
  instrumentedPositionTrackingTools,
  instrumentedMemoryTools,
  instrumentedRuntimeTools,
  instrumentedAdvancedTools,
  instrumentedPolkadotKitAssetTools,
  instrumentedPolkadotKitStakingTools,
  instrumentedPolkadotKitDefiTools,
  instrumentedSolanaKitTradingTools,
  instrumentedSolanaKitDefiPerpsTools,
  instrumentedSolanaKitDefiLendingTools,
  instrumentedSolanaKitDefiPoolsTools,
  instrumentedSolanaKitDefiBridgeTools,
  instrumentedChainlinkCCIPTools,
  gordonInputGuard,
  gordonOutputSanitizer,
} from "../instrumentedTools.ts";
import { tradingInfraTools } from "../tools/tradingInfra.ts";
import { createSubAgentMemory } from "../memoryFactory.ts";
import { resolveRuntimeModel, registerObservability } from "../agentHelpers.ts";

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
1. Call **classify_trade_risk** with the proposed trade details (11-dimension risk classifier: volatility, correlation, tail risk, drawdown, concentration, liquidity, frequency, DeFi-specific, time-based, circuit breakers, constitution)
2. Check the returned risk tier:
   - "low" → proceed to execution
   - "medium" → warn the user about the top risk factors, then proceed if they confirm
   - "high" → show full risk assessment, require explicit "proceed anyway" from user
   - "critical" → REFUSE to execute. Show the risk assessment and suggest alternatives.
3. Call **check_risk** to verify the order passes the trading constitution (80+ immutable rules)
4. If either check rejects, inform the user and do NOT proceed

This risk gate runs BEFORE every trade, not after.

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
    instructions: composeAgentInstructions("executor", EXECUTOR_INSTRUCTIONS),
    model: resolveRuntimeModel,
    tools: {
      execute_plan: instrumentedTradingTools.execute_plan,
      close_trade: instrumentedTradingTools.close_trade,
      set_permission_mode: instrumentedTradingTools.set_permission_mode,
      list_plans: instrumentedTradingTools.list_plans,
      approve_plan: instrumentedTradingTools.approve_plan,
      set_trailing_stop: instrumentedTradingTools.set_trailing_stop,
      update_trailing_stop: instrumentedTradingTools.update_trailing_stop,
      close_partial_position: instrumentedTradingTools.close_partial_position,
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
      agentkit_native_transfer: instrumentedAgentKitOnchainTools.agentkit_native_transfer,
      agentkit_erc20_transfer: instrumentedAgentKitOnchainTools.agentkit_erc20_transfer,
      agentkit_wrap_eth: instrumentedAgentKitOnchainTools.agentkit_wrap_eth,
      agentkit_request_faucet: instrumentedAgentKitOnchainTools.agentkit_request_faucet,
      agentkit_swap: instrumentedAgentKitOnchainTools.agentkit_swap,
      agentkit_get_swap_price: instrumentedAgentKitOnchainTools.agentkit_get_swap_price,
      moonwell_deposit: instrumentedAgentKitDefiTools.moonwell_deposit,
      moonwell_withdraw: instrumentedAgentKitDefiTools.moonwell_withdraw,
      basenames_register: instrumentedAgentKitDefiTools.basenames_register,
      ...instrumentedSharedContextTools,
      ...instrumentedCheckRiskTool,
      // Critic (risk classifier) — MANDATORY pre-execution check
      classify_trade_risk: tradingInfraTools.classify_trade_risk,
      list_active_positions: instrumentedPositionTrackingTools.list_active_positions,
      get_position_detail: instrumentedPositionTrackingTools.get_position_detail,
      search_memory: instrumentedMemoryTools.search_memory,
      approve_strategy_trade: instrumentedRuntimeTools.approve_strategy_trade,
      simulate_order_bundle: instrumentedAdvancedTools.simulate_order_bundle,
      verify_circuit_breaker_proof: instrumentedAdvancedTools.verify_circuit_breaker_proof,
      polkadot_transfer_native: instrumentedPolkadotKitAssetTools.polkadot_transfer_native,
      polkadot_xcm_transfer: instrumentedPolkadotKitAssetTools.polkadot_xcm_transfer,
      polkadot_join_pool: instrumentedPolkadotKitStakingTools.polkadot_join_pool,
      polkadot_bond_extra: instrumentedPolkadotKitStakingTools.polkadot_bond_extra,
      polkadot_unbond: instrumentedPolkadotKitStakingTools.polkadot_unbond,
      polkadot_withdraw_unbonded: instrumentedPolkadotKitStakingTools.polkadot_withdraw_unbonded,
      polkadot_claim_rewards: instrumentedPolkadotKitStakingTools.polkadot_claim_rewards,
      polkadot_swap_tokens: instrumentedPolkadotKitDefiTools.polkadot_swap_tokens,
      polkadot_mint_vdot: instrumentedPolkadotKitDefiTools.polkadot_mint_vdot,
      polkadot_register_identity: instrumentedPolkadotKitDefiTools.polkadot_register_identity,
      solana_trade: instrumentedSolanaKitTradingTools.solana_trade,
      solana_transfer: instrumentedSolanaKitTradingTools.solana_transfer,
      solana_create_limit_order: instrumentedSolanaKitTradingTools.solana_create_limit_order,
      solana_cancel_limit_orders: instrumentedSolanaKitTradingTools.solana_cancel_limit_orders,
      solana_stake_jup: instrumentedSolanaKitTradingTools.solana_stake_jup,
      solana_request_faucet: instrumentedSolanaKitTradingTools.solana_request_faucet,
      solana_launch_pumpfun: instrumentedSolanaKitTradingTools.solana_launch_pumpfun,
      solana_adrena_open_long: instrumentedSolanaKitDefiPerpsTools.solana_adrena_open_long,
      solana_adrena_open_short: instrumentedSolanaKitDefiPerpsTools.solana_adrena_open_short,
      solana_adrena_close_long: instrumentedSolanaKitDefiPerpsTools.solana_adrena_close_long,
      solana_adrena_close_short: instrumentedSolanaKitDefiPerpsTools.solana_adrena_close_short,
      solana_flash_open_trade: instrumentedSolanaKitDefiPerpsTools.solana_flash_open_trade,
      solana_flash_close_trade: instrumentedSolanaKitDefiPerpsTools.solana_flash_close_trade,
      solana_drift_open_perp: instrumentedSolanaKitDefiPerpsTools.solana_drift_open_perp,
      solana_drift_create_account: instrumentedSolanaKitDefiPerpsTools.solana_drift_create_account,
      solana_drift_deposit: instrumentedSolanaKitDefiPerpsTools.solana_drift_deposit,
      solana_drift_withdraw: instrumentedSolanaKitDefiPerpsTools.solana_drift_withdraw,
      solana_drift_spot_swap: instrumentedSolanaKitDefiPerpsTools.solana_drift_spot_swap,
      solana_lulo_lend: instrumentedSolanaKitDefiLendingTools.solana_lulo_lend,
      solana_lulo_withdraw: instrumentedSolanaKitDefiLendingTools.solana_lulo_withdraw,
      solana_drift_insurance_stake: instrumentedSolanaKitDefiLendingTools.solana_drift_insurance_stake,
      solana_drift_insurance_request_unstake: instrumentedSolanaKitDefiLendingTools.solana_drift_insurance_request_unstake,
      solana_drift_insurance_unstake: instrumentedSolanaKitDefiLendingTools.solana_drift_insurance_unstake,
      solana_sanctum_swap_lst: instrumentedSolanaKitDefiLendingTools.solana_sanctum_swap_lst,
      solana_sanctum_add_liquidity: instrumentedSolanaKitDefiLendingTools.solana_sanctum_add_liquidity,
      solana_sanctum_remove_liquidity: instrumentedSolanaKitDefiLendingTools.solana_sanctum_remove_liquidity,
      solana_solayer_stake: instrumentedSolanaKitDefiLendingTools.solana_solayer_stake,
      solana_voltr_deposit: instrumentedSolanaKitDefiLendingTools.solana_voltr_deposit,
      solana_voltr_withdraw: instrumentedSolanaKitDefiLendingTools.solana_voltr_withdraw,
      solana_drift_vault_deposit: instrumentedSolanaKitDefiLendingTools.solana_drift_vault_deposit,
      solana_drift_vault_request_withdraw: instrumentedSolanaKitDefiLendingTools.solana_drift_vault_request_withdraw,
      solana_drift_vault_withdraw: instrumentedSolanaKitDefiLendingTools.solana_drift_vault_withdraw,
      solana_orca_open_centered: instrumentedSolanaKitDefiPoolsTools.solana_orca_open_centered,
      solana_orca_open_single_sided: instrumentedSolanaKitDefiPoolsTools.solana_orca_open_single_sided,
      solana_orca_close_position: instrumentedSolanaKitDefiPoolsTools.solana_orca_close_position,
      solana_orca_create_clmm: instrumentedSolanaKitDefiPoolsTools.solana_orca_create_clmm,
      solana_orca_create_whirlpool: instrumentedSolanaKitDefiPoolsTools.solana_orca_create_whirlpool,
      solana_raydium_create_clmm: instrumentedSolanaKitDefiPoolsTools.solana_raydium_create_clmm,
      solana_raydium_create_cpmm: instrumentedSolanaKitDefiPoolsTools.solana_raydium_create_cpmm,
      solana_meteora_create_dlmm: instrumentedSolanaKitDefiPoolsTools.solana_meteora_create_dlmm,
      solana_manifest_limit_order: instrumentedSolanaKitDefiPoolsTools.solana_manifest_limit_order,
      solana_manifest_cancel_orders: instrumentedSolanaKitDefiPoolsTools.solana_manifest_cancel_orders,
      solana_manifest_withdraw: instrumentedSolanaKitDefiPoolsTools.solana_manifest_withdraw,
      solana_debridge_create_order: instrumentedSolanaKitDefiBridgeTools.solana_debridge_create_order,
      solana_debridge_execute: instrumentedSolanaKitDefiBridgeTools.solana_debridge_execute,
      solana_okx_swap: instrumentedSolanaKitDefiBridgeTools.solana_okx_swap,
      chainlink_ccip_transfer: instrumentedChainlinkCCIPTools.chainlink_ccip_transfer,
      ...getRoutingToolsForAgent("Executor"),
    },
    memory: createSubAgentMemory("executor"),
    inputProcessors: [gordonInputGuard, new TokenLimiterProcessor({ limit: 32000 })],
    outputProcessors: [gordonOutputSanitizer],
  });
  registerObservability(agent);
  return agent;
}
