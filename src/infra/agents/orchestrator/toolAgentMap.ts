/**
 * Tool-to-Agent Mapping
 *
 * Extracted from orchestrator.ts — maps tool names to their owning sub-agent
 * and provides routing helpers for handoff detection.
 */

import { getDynamicToolAgentMap } from "../../runtime/routing/manager.ts";
import { createModuleLogger } from "../../logger/index.ts";
import { getExecutionReadiness } from "../runtimeHarness.ts";
import type { GordonContext } from "../types.ts";

const logger = createModuleLogger("orchestrator-tool-map");

// ============================================================================
// Tool-to-Agent Mapping
// ============================================================================

/**
 * Map tool names to their owning sub-agent
 * Used to detect which agent is responding during streaming
 */
export const TOOL_AGENT_MAP: Record<string, string> = {
  // ---- Scanner tools ----
  // marketTools cherry-picks
  scan_market: "Scanner",
  get_historical_opportunities: "Scanner",
  // discoveryTools cherry-picks
  get_trending_tokens: "Scanner",
  get_high_volume_tokens: "Scanner",
  get_available_markets: "Scanner",
  // indicatorTools spread (Scanner is primary for shared indicator tools)
  get_technical_analysis: "Scanner",
  get_technical_signals: "Scanner",
  get_rsi: "Scanner",
  get_stop_loss_levels: "Scanner",
  get_position_size: "Scanner",
  get_vwap: "Scanner",
  get_camarilla_pivots: "Scanner",
  get_markov_regime: "Scanner",
  get_supertrend: "Scanner",
  get_ichimoku: "Scanner",
  get_flowscope: "Scanner",
  get_angled_market_structure: "Scanner",
  get_false_breakout: "Scanner",
  get_adx: "Scanner",
  get_divergence: "Scanner",
  get_supply_demand_zones: "Scanner",
  get_squeeze_momentum: "Scanner",
  get_fvg: "Scanner",
  get_parabolic_sar: "Scanner",
  get_atr_rope: "Scanner",
  get_linear_regression: "Scanner",
  get_wae: "Scanner",
  // marketDataTools spread (Scanner is primary for raw market data)
  get_candles: "Scanner",
  get_price: "Scanner",
  get_tickers: "Scanner",
  get_book_ticker: "Scanner",
  // strategyTools spread
  list_strategies: "Scanner",
  get_strategy_details: "Scanner",
  detect_strategy: "Scanner",
  scan_for_strategy: "Scanner",
  suggest_strategy: "Scanner",
  run_strategy_ensemble: "Scanner",
  scan_with_ensemble: "Scanner",
  // parallelAnalysisTools spread (Scanner is primary)
  parallel_scan_analyze: "Scanner",
  parallel_multi_coin: "Scanner",
  parallel_deep_analysis: "Scanner",
  parallel_timeframe: "Scanner",
  // evalTools cherry-picks on Scanner
  get_strategy_performance: "Scanner",
  get_performance_context: "Scanner",
  get_all_strategy_performances: "Scanner",
  // baseOnchainTools cherry-picks (Scanner: discovery/info)
  get_base_trending: "Scanner",
  get_base_featured: "Scanner",
  get_base_info: "Scanner",

  // ---- Analyst tools ----
  // marketTools cherry-pick
  analyze_coin: "Analyst",
  // chartTools spread
  display_price_chart: "Analyst",
  display_candlestick_chart: "Analyst",
  display_comparison_chart: "Analyst",
  display_volume_chart: "Analyst",
  // orderbookTools spread (Analyst has full spread)
  get_order_book: "Analyst",
  get_spread: "Analyst",
  get_market_trades: "Analyst",
  get_order_status: "Analyst",
  // tradingTools cherry-picks
  modify_order: "Analyst",
  test_order: "Analyst",
  // marketAnalysisTools spread
  analyze_whale_orders: "Analyst",
  estimate_market_impact: "Analyst",
  scan_breakouts: "Analyst",
  detect_consolidation: "Analyst",
  score_market: "Analyst",
  // compositionTools spread
  run_full_analysis: "Analyst",
  // multiModalChartTools spread
  generate_chart: "Analyst",
  analyze_chart: "Analyst",
  quick_ta: "Analyst",
  // evalTools cherry-picks on Analyst
  get_market_condition_performance: "Analyst",
  get_learning_insights: "Analyst",
  // liquidationIntelligenceTools (on Scanner + Analyst)
  get_cascade_risk: "Scanner",
  get_liquidation_pressure: "Scanner",
  get_crowding_analysis: "Scanner",
  get_squeeze_candidates: "Scanner",
  // pairAnalysisTools (on Scanner + Analyst)
  analyze_pair_correlation: "Analyst",
  analyze_pair_spread: "Analyst",
  compare_pair_performance: "Analyst",
  // baseOnchainTools cherry-picks (Analyst: gas/balance analysis)
  get_base_gas: "Analyst",
  get_base_balance: "Analyst",
  // Native agent rails
  get_agent_rails_status: "Analyst",
  helius_wallet_overview: "Analyst",
  helius_recent_transactions: "Analyst",
  helius_token_metadata: "Analyst",
  moonpay_currency_limits: "Analyst",
  moonpay_quote: "Analyst",
  moonpay_swap_pairs: "Analyst",
  moonpay_transactions: "Analyst",
  moonpay_customer_limits: "Analyst",
  moonpay_virtual_accounts: "Analyst",
  moonpay_virtual_account_transactions: "Analyst",
  moonpay_verify_webhook: "Analyst",

  // ---- Planner tools ----
  // tradingTools cherry-picks
  create_plan: "Planner",
  create_grid_plan: "Planner",
  list_plans: "Planner",
  // strategyGenerationTools cherry-picks
  strategy_generate: "Planner",
  strategy_iterate: "Planner",
  list_generated_strategies: "Planner",
  delete_generated_strategy: "Planner",
  // riskManagementTools cherry-picks
  calculate_kelly_size: "Planner",
  calculate_volatility_adjusted_size: "Planner",
  assess_trade_risk: "Planner",
  // evalTools cherry-picks on Planner
  get_risk_reward_analysis: "Planner",
  track_recommendation: "Planner",
  preview_market_order: "Planner",

  // ---- Executor tools ----
  // tradingTools cherry-picks
  execute_plan: "Executor",
  close_trade: "Executor",
  set_permission_mode: "Executor",
  approve_plan: "Executor",
  set_trailing_stop: "Executor",
  update_trailing_stop: "Executor",
  close_partial_position: "Executor",
  // discoveryTools cherry-picks
  place_bracket_order: "Executor",
  place_market_order: "Executor",
  // orderbookTools cherry-picks
  place_limit_order: "Executor",
  place_oco_order: "Executor",
  cancel_all_orders: "Executor",
  cancel_order: "Executor",
  cancel_replace_order: "Executor",
  cancel_order_list: "Executor",
  // agentKitOnchainTools cherry-picks (Executor: mutations)
  agentkit_native_transfer: "Executor",
  agentkit_erc20_transfer: "Executor",
  agentkit_wrap_eth: "Executor",
  agentkit_request_faucet: "Executor",
  // advancedTools cherry-picks
  verify_circuit_breaker_proof: "Executor",

  // ---- Trading Infrastructure tools ----
  // Sandbox → Planner (strategy testing, not execution)
  create_sandbox: "Planner",
  sandbox_trade: "Planner",
  compare_sandboxes: "Planner",
  list_sandboxes: "Planner",
  // Risk classifier → Planner (pre-trade assessment)
  classify_trade_risk: "Planner",
  // Checkpoints → Monitor (portfolio state management)
  save_checkpoint: "Monitor",
  list_checkpoints: "Monitor",
  // Market context → Analyst (data lookup)
  get_symbol_context: "Analyst",
  // Drift detection → Monitor (portfolio health)
  detect_portfolio_drift: "Monitor",

  // ---- Monitor tools ----
  // positionTools spread
  check_positions: "Monitor",
  // accountTools spread
  get_portfolio: "Monitor",
  get_account_details: "Monitor",
  get_account_snapshot: "Monitor",
  // earnTools spread
  get_flexible_earn_products: "Monitor",
  get_locked_earn_products: "Monitor",
  get_all_earn_positions: "Monitor",
  subscribe_flexible_earn: "Monitor",
  redeem_flexible_earn: "Monitor",
  subscribe_locked_earn: "Monitor",
  get_earn_history: "Monitor",
  // walletTools spread
  get_dustable_assets: "Monitor",
  convert_dust: "Monitor",
  transfer_funds: "Monitor",
  get_coin_info: "Monitor",
  get_trade_fees: "Monitor",
  get_asset_dividends: "Monitor",
  get_deposit_address: "Monitor",
  get_user_assets: "Monitor",
  get_wallet_balances: "Monitor",
  get_dust_log: "Monitor",
  preview_withdrawal: "Monitor",
  withdraw_to_external: "Monitor",
  get_withdrawal_status: "Monitor",
  // historyTools spread
  get_trade_history: "Monitor",
  get_transfer_history: "Monitor",
  get_order_history: "Monitor",
  get_open_orders: "Monitor",
  get_open_order_lists: "Monitor",
  // metricsTools spread
  get_performance_metrics: "Monitor",
  get_trade_statistics: "Monitor",
  get_risk_analysis: "Monitor",
  // riskManagementTools cherry-picks
  check_exit_conditions: "Monitor",
  check_drawdown_status: "Monitor",
  check_daily_limit: "Monitor",
  // advancedTools cherry-picks
  query_regime_scoped_memory: "Monitor",
  // evalTools cherry-picks on Monitor
  record_trade_outcome: "Monitor",
  get_performance_report: "Monitor",
  process_unrecorded_trades: "Monitor",
  get_win_rate_analysis: "Monitor",
  // autonomousTools cherry-pick on Monitor
  get_autonomous_status: "Monitor",
  // agentKitOnchainTools cherry-picks (Monitor: reads)
  agentkit_get_wallet: "Monitor",
  agentkit_get_balance: "Monitor",
  agentkit_erc20_balance: "Monitor",
  // agentKitOnchainTools cherry-picks (Executor: DEX swaps)
  agentkit_swap: "Executor",
  agentkit_get_swap_price: "Analyst",

  // ---- AgentKit DeFi tools ----
  // Pyth oracle price feeds (read-only, Analyst)
  pyth_get_price_feed: "Analyst",
  pyth_fetch_price: "Analyst",
  // DeFiLlama protocol data (read-only, Scanner + Analyst)
  defillama_search_protocols: "Scanner",
  defillama_get_protocol: "Analyst",
  defillama_get_token_prices: "Analyst",
  // Moonwell lending (state-changing, Executor)
  moonwell_deposit: "Executor",
  moonwell_withdraw: "Executor",
  // Basenames registration (state-changing, Executor)
  basenames_register: "Executor",

  // ---- Polkadot Agent Kit tools ----
  // Asset tools (Monitor: balance reads)
  polkadot_check_balance: "Monitor",
  // Asset tools (Executor: state-changing transfers)
  polkadot_transfer_native: "Executor",
  polkadot_xcm_transfer: "Executor",
  // Staking tools (Analyst: read-only pool info)
  polkadot_get_pool_info: "Analyst",
  // Staking tools (Executor: state-changing staking operations)
  polkadot_join_pool: "Executor",
  polkadot_bond_extra: "Executor",
  polkadot_unbond: "Executor",
  polkadot_withdraw_unbonded: "Executor",
  polkadot_claim_rewards: "Executor",
  // DeFi tools (Executor: state-changing swaps and liquid staking)
  polkadot_swap_tokens: "Executor",
  polkadot_mint_vdot: "Executor",
  polkadot_register_identity: "Executor",
  // Utility tools (Analyst: chain initialization)
  polkadot_initialize_chain: "Analyst",

  // ---- Solana Agent Kit tools (native adapter) ----
  // Wallet & monitoring tools (Monitor: read-only)
  solana_wallet_address: "Monitor",
  solana_balance: "Monitor",
  solana_token_balances: "Monitor",
  solana_get_tps: "Monitor",
  solana_get_open_limit_orders: "Monitor",
  solana_get_limit_order_history: "Monitor",
  // Price & data tools (Analyst: analysis)
  solana_fetch_price: "Analyst",
  solana_pyth_price: "Analyst",
  solana_get_token_data: "Analyst",
  solana_rugcheck: "Analyst",
  // Execution tools (Executor: state-changing)
  solana_trade: "Executor",
  solana_transfer: "Executor",
  solana_create_limit_order: "Executor",
  solana_cancel_limit_orders: "Executor",
  solana_stake_jup: "Executor",
  solana_request_faucet: "Executor",
  solana_launch_pumpfun: "Executor",

  // ---- Solana Agent Kit DeFi tools (native adapter — plugin-defi) ----
  // Perpetuals — read-only (Analyst)
  solana_drift_has_account: "Analyst",
  solana_drift_account_info: "Analyst",
  solana_drift_markets: "Analyst",
  solana_drift_funding_rate: "Analyst",
  solana_drift_perp_quote: "Analyst",
  // Perpetuals — state-changing (Executor)
  solana_adrena_open_long: "Executor",
  solana_adrena_open_short: "Executor",
  solana_adrena_close_long: "Executor",
  solana_adrena_close_short: "Executor",
  solana_flash_open_trade: "Executor",
  solana_flash_close_trade: "Executor",
  solana_drift_open_perp: "Executor",
  solana_drift_create_account: "Executor",
  solana_drift_deposit: "Executor",
  solana_drift_withdraw: "Executor",
  solana_drift_spot_swap: "Executor",
  // Lending & Staking — read-only (Analyst)
  solana_drift_lend_apy: "Analyst",
  solana_sanctum_lst_price: "Analyst",
  solana_sanctum_apy: "Analyst",
  solana_sanctum_tvl: "Analyst",
  solana_sanctum_owned_lst: "Monitor",
  solana_voltr_positions: "Analyst",
  solana_drift_vault_info: "Analyst",
  // Lending & Staking — state-changing (Executor)
  solana_lulo_lend: "Executor",
  solana_lulo_withdraw: "Executor",
  solana_drift_insurance_stake: "Executor",
  solana_drift_insurance_request_unstake: "Executor",
  solana_drift_insurance_unstake: "Executor",
  solana_sanctum_swap_lst: "Executor",
  solana_sanctum_add_liquidity: "Executor",
  solana_sanctum_remove_liquidity: "Executor",
  solana_solayer_stake: "Executor",
  solana_voltr_deposit: "Executor",
  solana_voltr_withdraw: "Executor",
  solana_drift_vault_deposit: "Executor",
  solana_drift_vault_request_withdraw: "Executor",
  solana_drift_vault_withdraw: "Executor",
  // Liquidity Pools — read-only (Analyst)
  solana_orca_fetch_positions: "Analyst",
  // Liquidity Pools — state-changing (Executor)
  solana_orca_open_centered: "Executor",
  solana_orca_open_single_sided: "Executor",
  solana_orca_close_position: "Executor",
  solana_orca_create_clmm: "Executor",
  solana_orca_create_whirlpool: "Executor",
  solana_raydium_create_clmm: "Executor",
  solana_raydium_create_cpmm: "Executor",
  solana_meteora_create_dlmm: "Executor",
  solana_manifest_limit_order: "Executor",
  solana_manifest_cancel_orders: "Executor",
  solana_manifest_withdraw: "Executor",
  // Cross-Chain Bridge — read-only (Analyst)
  solana_debridge_chains: "Analyst",
  solana_debridge_tokens: "Analyst",
  solana_debridge_status: "Analyst",
  solana_okx_quote: "Analyst",
  solana_okx_tokens: "Analyst",
  // Cross-Chain Bridge — state-changing (Executor)
  solana_debridge_create_order: "Executor",
  solana_debridge_execute: "Executor",
  solana_okx_swap: "Executor",
  moonpay_funding_link: "Executor",
  moonpay_swap_link: "Executor",
  polygon_payment_intent: "Executor",

  // ---- Base L2 indexer tools (The Graph) ----
  indexer_top_pools: "Scanner",
  indexer_pool_stats: "Analyst",
  indexer_aerodrome_pools: "Scanner",

  // ---- Uniswap V3 subgraph tools ----
  get_pool_tick_liquidity: "Analyst",
  get_liquidity_events: "Scanner",
  get_pool_flash_events: "Analyst",
  get_lp_positions: "Monitor",
  get_uniswap_protocol_overview: "Scanner",
  get_fee_collections: "Monitor",

  // ---- Multi-chain DEX search tools ----
  search_dex_pairs: "Scanner",
  get_boosted_tokens: "Scanner",

  // ---- DefiLlama yield tools ----
  get_uniswap_pool_yields: "Analyst",
  get_top_defi_yields: "Analyst",

  // ---- Base L2 signal tools ----
  // baseSignalTools cherry-picks (Scanner: discovery + scanning)
  scan_base_whale_transfers: "Scanner",
  scan_base_volume_spikes: "Scanner",
  scan_base_new_tokens: "Scanner",
  // baseSignalTools cherry-picks (Analyst: analysis + tracking)
  track_base_wallet: "Analyst",
  get_base_token_holders: "Analyst",
  get_base_dex_pairs: "Scanner",

  // ---- Teacher tools ----
  explain: "Teacher",
  strategy_explain: "Teacher",

  // ---- Backtester tools ----
  // backtestTools spread
  run_backtest: "Backtester",
  optimize_strategy: "Backtester",
  compare_backtests: "Backtester",
  get_backtest_summary: "Backtester",
  analyze_backtest_results: "Backtester",
  compare_backtest_results: "Backtester",
  rank_strategies_by_metric: "Backtester",
  find_best_strategy: "Backtester",
  export_results_json: "Backtester",
  export_results_csv: "Backtester",
  generate_html_report: "Backtester",
  filter_exclude_months: "Backtester",
  filter_market_hours: "Backtester",
  filter_first_last_hour: "Backtester",
  analyze_alpha_decay: "Backtester",
  generate_backtest_chart: "Backtester",
  grid_search_optimization: "Backtester",
  random_search_optimization: "Backtester",
  run_walk_forward_test: "Backtester",
  run_monte_carlo: "Backtester",
  get_backtest_history: "Backtester",
  save_backtest_result: "Backtester",
  load_backtest_result: "Backtester",

  // ---- Position Tracking tools (v0.7) ----
  report_setup: "Scanner",
  report_analysis: "Analyst",
  report_plan: "Planner",
  approve_position: "Planner",
  reject_position: "Planner",
  list_active_positions: "Monitor",
  get_position_detail: "Monitor",
  update_position_live: "Monitor",
  close_position_tracking: "Executor",
  review_position: "Teacher",

  // ---- Risk Gate tools (v0.7) ----
  check_risk: "Planner",

  // ---- Memory tools (v0.7) ----
  search_memory: "Analyst",
  record_observation: "Scanner",
  record_insight: "Analyst",
  get_lessons: "Teacher",
  get_memory_context: "Analyst",

  // ---- Playbook tools (v0.7) ----
  list_playbooks: "Teacher",
  get_playbook: "Teacher",
  search_playbooks: "Scanner",
  get_playbook_for_agent: "Scanner",

  // ---- Playbook Backtest tools (v0.7) ----
  backtest_playbook: "Backtester",
  get_backtest_results: "Backtester",
  get_best_strategy: "Backtester",

  // ---- Systematic research tools ----
  get_systematic_strategy_status: "Backtester",
  list_systematic_datasets: "Backtester",
  list_dataset_snapshots: "Backtester",
  get_dataset_snapshot: "Backtester",
  list_research_experiments: "Backtester",
  analyze_systematic_portfolio: "Monitor",
  diagnose_strategy_bias: "Backtester",
  get_strategy_decay_report: "Monitor",
  list_systematic_lifecycle: "Backtester",
  export_systematic_artifact: "Backtester",

  // ---- Audit tools (v0.7) ----
  query_audit_trail: "Monitor",
  get_decision_path: "Monitor",
  get_agent_activity: "Monitor",
  get_audit_stats: "Monitor",

  // ---- Regime tools (v0.7) ----
  detect_market_regime: "Scanner",
  get_regime_history: "Scanner",
  match_playbooks_to_regime: "Scanner",
  multi_timeframe_regime: "Scanner",

  // ---- Protocol tools (v0.7) ----
  validate_playbook: "Analyst",
  export_playbook: "Analyst",
  import_playbook: "Analyst",
  compare_playbooks: "Analyst",

  // ---- Runtime tools (v0.7) ----
  deploy_strategy: "Planner",
  list_running_strategies: "Planner",
  pause_strategy: "Planner",
  resume_strategy: "Planner",
  stop_strategy: "Planner",
  get_portfolio_state: "Monitor",
  rebalance_portfolio: "Planner",
  check_portfolio_health: "Monitor",
  get_runtime_health_report: "Monitor",
  compare_live_vs_backtest: "Monitor",
  approve_strategy_trade: "Executor",

  // ---- Chainlink tools ----
  // Data Streams (Scanner: bulk, Analyst: individual)
  chainlink_get_price: "Analyst",
  chainlink_get_price_at: "Analyst",
  chainlink_bulk_prices: "Scanner",
  chainlink_list_feeds: "Scanner",
  // Data Feeds (Analyst: on-chain reads)
  chainlink_read_feed: "Analyst",
  chainlink_compare_prices: "Analyst",
  // CCIP (Analyst: info/fees, Executor: transfers, Monitor: status)
  chainlink_ccip_supported_chains: "Analyst",
  chainlink_ccip_get_fee: "Analyst",
  chainlink_ccip_transfer: "Executor",
  chainlink_ccip_status: "Monitor",

  // ---- SynthData tools ----
  synthdata_prediction_percentiles: "Analyst",
  synthdata_volatility: "Analyst",
  synthdata_option_pricing: "Analyst",
  synthdata_leaderboard: "Scanner",
  synthdata_liquidation: "Monitor",
  synthdata_lp_bounds: "Planner",
  synthdata_lp_probabilities: "Planner",

  // ---- Cross-cutting tools (NOT mapped to any agent) ----
  // sharedContextTools and systemTools are used by ALL agents.
  // Mapping them to "Gordon" causes spurious self-handoff detections,
  // so they are intentionally omitted from TOOL_AGENT_MAP.
};

// ============================================================================
// Tool Routing Helpers
// ============================================================================

/**
 * Get the agent name that owns a specific tool
 */
export function getAgentForTool(toolName: string): string | undefined {
  // Dynamic skill-based map first (MCP/skill tools)
  const dynamicAgent = getDynamicToolAgentMap()[toolName];
  if (dynamicAgent) return dynamicAgent;

  // Static map (built-in tools)
  const agent = TOOL_AGENT_MAP[toolName];
  if (!agent) {
    logger.debug("Unmapped tool called, staying with current agent", { toolName });
  }
  return agent;
}

/**
 * Build the default executor handoff budget from context and risk config
 */
export function buildDefaultExecutorHandoffBudget(
  context: GordonContext,
  toolArgs?: Record<string, unknown>,
): Record<string, unknown> {
  const maxPositionPct = context.config?.riskManagement?.maxPositionSizePercent ?? 10;
  const maxNotionalUsd = Math.max(25, (context.portfolioValue || 0) * (maxPositionPct / 100));
  const symbol =
    typeof toolArgs?.symbol === "string"
      ? toolArgs.symbol.toUpperCase()
      : undefined;

  return {
    maxNotionalUsd,
    maxDrawdownPercent: context.config?.riskManagement?.maxDrawdownPercent ?? 15,
    allowedSymbols: symbol ? [symbol] : undefined,
    reason: "Default executor handoff budget derived from risk config.",
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  };
}

/**
 * Check if a tool name produces planning artifacts
 */
export function isPlanningArtifactTool(toolName?: string): boolean {
  return toolName === "preview_market_order" || toolName === "create_plan";
}

/**
 * Check if a tool requires a planning artifact before execution
 */
export function requiresPlanningArtifact(toolName?: string): boolean {
  return toolName === "place_market_order" || toolName === "execute_plan" || toolName === "place_bracket_order";
}
