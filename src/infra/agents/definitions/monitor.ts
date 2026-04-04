/**
 * Monitor Agent Definition
 * Watches open positions and keeps the user informed across crypto and stocks.
 */

import { Agent } from "@mastra/core/agent";
import { TokenLimiterProcessor } from "@mastra/core/processors";
import { composeAgentInstructions } from "../promptSections.ts";
import { getRoutingToolsForAgent } from "../../routing/manager.ts";
import {
  instrumentedPositionTools,
  instrumentedAccountTools,
  instrumentedWalletTools,
  instrumentedEarnTools,
  instrumentedHistoryTools,
  instrumentedOrderbookTools,
  instrumentedMetricsTools,
  instrumentedRiskManagementTools,
  instrumentedAutonomousTools,
  instrumentedAgentKitOnchainTools,
  instrumentedUniswapDataTools,
  instrumentedSharedContextTools,
  instrumentedEvalTools,
  instrumentedPositionTrackingTools,
  instrumentedMemoryTools,
  instrumentedAuditTools,
  instrumentedRuntimeTools,
  instrumentedAdvancedTools,
  instrumentedPolkadotKitAssetTools,
  instrumentedSolanaKitWalletTools,
  instrumentedSolanaKitTradingTools,
  instrumentedSolanaKitDefiPerpsTools,
  instrumentedSolanaKitDefiPoolsTools,
  instrumentedSolanaKitDefiLendingTools,
  instrumentedChainlinkCCIPTools,
  instrumentedSynthDataTools,
  gordonInputGuard,
  gordonOutputSanitizer,
} from "../instrumentedTools.ts";
import { createSubAgentMemory } from "../memoryFactory.ts";
import { resolveRuntimeModel, registerObservability } from "../agentHelpers.ts";

const MONITOR_INSTRUCTIONS = `You are Gordon's position monitor agent.

Your role is to watch open positions and keep the user informed across crypto and stocks.

## Cross-Agent Context
After checking positions or portfolio, ALWAYS call write_shared_context to store the ground truth:
- contextType: "monitor"
- data: { portfolioValue, cashAvailable, totalExposurePercent, openPositions: [{symbol, side, entryPrice, currentPrice, size, unrealizedPnl, unrealizedPnlPercent}], recentOutcomes: [{symbol, strategy, result, pnlPercent, closedAt}] }
You are the only agent with ground truth about what the user actually owns. Other agents
read this to make better decisions (position sizing, avoiding duplicates, etc.).

Also READ context from other agents when available (optional enrichment):
- read_shared_context("planner") — compare positions against original plan levels (entry/SL/TP)
- read_shared_context("analysis", symbol) — check if analysis still supports holding or suggests exiting
- read_shared_context("backtest", symbol) — compare live performance vs. backtested expectations
If no context exists from other agents, just report portfolio status normally.

## When Reporting Positions
1. Total portfolio value and cash available
2. Number of open trades
3. Total unrealized P&L (in $ and %)
4. For each position: entry price, current price, unrealized P&L
5. Overall portfolio health assessment

## Recording Trade Outcomes for Learning
When a trade closes, record the outcome for the learning system:
- Use **record_trade_outcome** when notified of a closed trade
- Use **process_unrecorded_trades** periodically to catch any missed recordings
- Use **get_performance_report** to show detailed performance analysis

Recording outcomes helps the system learn which strategies and conditions work best.

## Performance Reporting
When user asks about performance or statistics:
- Use get_performance_report for comprehensive analysis
- Include insights about best/worst performing strategies
- Mention any patterns identified from the trade history

## Available Tool Categories
- **Account**: get_portfolio, get_account_details, get_account_snapshot
- **Wallet**: get_dustable_assets, convert_dust, transfer_funds, get_coin_info, get_trade_fees, get_deposit_address, get_user_assets, get_wallet_balances, get_dust_log
- **Withdrawals**: preview_withdrawal (safe preview), withdraw_to_external (requires ARMED + confirm), get_withdrawal_status
- **Earn**: get_flexible_earn_products, get_locked_earn_products, get_all_earn_positions, subscribe_flexible_earn, redeem_flexible_earn, subscribe_locked_earn, get_earn_history
- **History**: get_trade_history, get_transfer_history, get_order_history
- **Risk**: check_exit_conditions, check_drawdown_status, check_daily_limit
- **Metrics**: get_performance_metrics, get_trade_statistics, get_risk_analysis
- **Autonomous**: get_autonomous_status (check if autonomous mode is running)
- **Eval**: get_win_rate_analysis, get_performance_report

## Position Tracking (v0.7)
You have direct access to the position state machine:
- **list_active_positions**: See all tracked positions and their current state
- **get_position_detail**: Full detail on a specific position
- **update_position_live**: Update current price and unrealized PnL on active positions
- Periodically update live data on monitoring-state positions

## Agent Audit Chain
- **query_audit_trail**: Search past agent decisions by agent, outcome, position, or time range
- **get_decision_path**: Inspect the full decision chain for a specific trace or position
- **get_agent_activity**: Review what a specific agent has been doing recently
- **get_audit_stats**: Summary statistics across all agent decisions

## Portfolio Runtime Health
- **check_portfolio_health**: Run health checks across all strategy slots and the portfolio
- **get_portfolio_state**: Get full portfolio view with risk metrics and capital allocation`;

export function getMonitor(): Agent {
  const agent = new Agent({
    id: "monitor",
    name: "Monitor",
    description:
      "Specialist in monitoring open positions, portfolio health, and wallet management. " +
      "Use when user asks about their trades, positions, portfolio status, balances, " +
      "open orders, order history, earn positions, trade history, account snapshots, " +
      "exit conditions, drawdown status, " +
      "or wants to transfer funds between wallets (spot, funding, futures, margin).",
    instructions: composeAgentInstructions("monitor", MONITOR_INSTRUCTIONS),
    model: resolveRuntimeModel,
    tools: {
      check_positions: instrumentedPositionTools.check_positions,
      ...instrumentedAccountTools,
      ...instrumentedWalletTools,
      ...instrumentedEarnTools,
      ...instrumentedHistoryTools,
      get_order_history: instrumentedOrderbookTools.get_order_history,
      get_open_orders: instrumentedOrderbookTools.get_open_orders,
      get_open_order_lists: instrumentedOrderbookTools.get_open_order_lists,
      ...instrumentedMetricsTools,
      check_exit_conditions: instrumentedRiskManagementTools.check_exit_conditions,
      check_drawdown_status: instrumentedRiskManagementTools.check_drawdown_status,
      check_daily_limit: instrumentedRiskManagementTools.check_daily_limit,
      get_autonomous_status: instrumentedAutonomousTools.get_autonomous_status,
      agentkit_get_wallet: instrumentedAgentKitOnchainTools.agentkit_get_wallet,
      agentkit_get_balance: instrumentedAgentKitOnchainTools.agentkit_get_balance,
      agentkit_erc20_balance: instrumentedAgentKitOnchainTools.agentkit_erc20_balance,
      get_lp_positions: instrumentedUniswapDataTools.get_lp_positions,
      get_fee_collections: instrumentedUniswapDataTools.get_fee_collections,
      ...instrumentedSharedContextTools,
      record_trade_outcome: instrumentedEvalTools.record_trade_outcome,
      get_performance_report: instrumentedEvalTools.get_performance_report,
      process_unrecorded_trades: instrumentedEvalTools.process_unrecorded_trades,
      get_win_rate_analysis: instrumentedEvalTools.get_win_rate_analysis,
      list_active_positions: instrumentedPositionTrackingTools.list_active_positions,
      get_position_detail: instrumentedPositionTrackingTools.get_position_detail,
      update_position_live: instrumentedPositionTrackingTools.update_position_live,
      ...instrumentedMemoryTools,
      ...instrumentedAuditTools,
      get_portfolio_state: instrumentedRuntimeTools.get_portfolio_state,
      check_portfolio_health: instrumentedRuntimeTools.check_portfolio_health,
      generate_circuit_breaker_proof: instrumentedAdvancedTools.generate_circuit_breaker_proof,
      query_regime_scoped_memory: instrumentedAdvancedTools.query_regime_scoped_memory,
      polkadot_check_balance: instrumentedPolkadotKitAssetTools.polkadot_check_balance,
      solana_wallet_address: instrumentedSolanaKitWalletTools.solana_wallet_address,
      solana_balance: instrumentedSolanaKitWalletTools.solana_balance,
      solana_token_balances: instrumentedSolanaKitWalletTools.solana_token_balances,
      solana_get_tps: instrumentedSolanaKitWalletTools.solana_get_tps,
      solana_get_open_limit_orders: instrumentedSolanaKitTradingTools.solana_get_open_limit_orders,
      solana_get_limit_order_history: instrumentedSolanaKitTradingTools.solana_get_limit_order_history,
      solana_drift_has_account: instrumentedSolanaKitDefiPerpsTools.solana_drift_has_account,
      solana_drift_account_info: instrumentedSolanaKitDefiPerpsTools.solana_drift_account_info,
      solana_orca_fetch_positions: instrumentedSolanaKitDefiPoolsTools.solana_orca_fetch_positions,
      solana_sanctum_owned_lst: instrumentedSolanaKitDefiLendingTools.solana_sanctum_owned_lst,
      solana_voltr_positions: instrumentedSolanaKitDefiLendingTools.solana_voltr_positions,
      chainlink_ccip_status: instrumentedChainlinkCCIPTools.chainlink_ccip_status,
      synthdata_liquidation: instrumentedSynthDataTools.synthdata_liquidation,
      ...getRoutingToolsForAgent("Monitor"),
    },
    memory: createSubAgentMemory(),
    inputProcessors: [gordonInputGuard, new TokenLimiterProcessor({ limit: 32000 })],
    outputProcessors: [gordonOutputSanitizer],
  });
  registerObservability(agent);
  return agent;
}
