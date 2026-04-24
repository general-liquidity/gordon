import React, { useState, useEffect, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { useAnimationClock } from "../hooks/useAnimationClock.js";
import { ToolExecutionDetailDialog } from "./ToolExecutionDetailDialog.js";

// ============================================================================
// ToolCallInline — Inline tool execution display (Claude Code pattern)
//
// While running:  ● get_price  BTC/USDT
// On success:     ⎿  $68,432.50
// On error:       ⎿  ✗ Exchange timeout
//
// Trading-adapted: tool names map to user-friendly labels.
// ============================================================================

export type ToolCallStatus = "running" | "success" | "error";

export interface ToolCallState {
  id: string;
  toolName: string;
  args?: Record<string, unknown>;
  status: ToolCallStatus;
  result?: string;
  startedAt: number;
  duration?: number;
}

interface Props {
  calls: ToolCallState[];
}

// Trading-friendly tool name display — covers all ~300 tools via pattern matching
function getToolLabel(toolName: string): string {
  // Price & data
  if (/get_price|fetch_price|pyth.*price|chainlink.*price/i.test(toolName)) return "Price";
  if (/get_candles/i.test(toolName)) return "Candles";
  if (/order_book/i.test(toolName)) return "Orderbook";
  if (/get_spread/i.test(toolName)) return "Spread";
  if (/market_trades/i.test(toolName)) return "Trades";
  if (/get_tickers/i.test(toolName)) return "Tickers";
  if (/trending/i.test(toolName)) return "Trending";

  // Indicators
  if (/rsi/i.test(toolName)) return "RSI";
  if (/macd/i.test(toolName)) return "MACD";
  if (/ichimoku/i.test(toolName)) return "Ichimoku";
  if (/vwap/i.test(toolName)) return "VWAP";
  if (/supertrend/i.test(toolName)) return "Supertrend";
  if (/bollinger|squeeze/i.test(toolName)) return "Squeeze";
  if (/atr/i.test(toolName)) return "ATR";
  if (/adx/i.test(toolName)) return "ADX";
  if (/technical/i.test(toolName)) return "Technicals";
  if (/divergence/i.test(toolName)) return "Divergence";
  if (/fvg/i.test(toolName)) return "FVG";
  if (/supply_demand/i.test(toolName)) return "S/D Zones";
  if (/indicator/i.test(toolName)) return "Indicators";

  // Scanning
  if (/scan_market|scan_breakout|scan_for_strategy/i.test(toolName)) return "Scan";
  if (/scan_base|scan_.*volume|scan_.*whale/i.test(toolName)) return "On-chain Scan";
  if (/parallel_scan/i.test(toolName)) return "Parallel Scan";
  if (/score_market/i.test(toolName)) return "Score";

  // Risk
  if (/classify.*risk|assess.*risk|check_risk|get_risk/i.test(toolName)) return "Risk Check";
  if (/position_size|kelly_size|volatility_adjusted/i.test(toolName)) return "Sizing";
  if (/drawdown|cascade_risk/i.test(toolName)) return "Drawdown";
  if (/daily_limit|exit_condition/i.test(toolName)) return "Limits";
  if (/portfolio_health|portfolio_drift/i.test(toolName)) return "Health Check";
  if (/liquidation/i.test(toolName)) return "Liquidation Risk";
  if (/stop_loss/i.test(toolName)) return "Stop Levels";

  // Execution
  if (/execute_plan/i.test(toolName)) return "Execute";
  if (/place_market_order|place_order/i.test(toolName)) return "Market Order";
  if (/place_limit_order|create_limit_order/i.test(toolName)) return "Limit Order";
  if (/place_bracket/i.test(toolName)) return "Bracket Order";
  if (/place_oco/i.test(toolName)) return "OCO Order";
  if (/cancel_order|cancel_all/i.test(toolName)) return "Cancel";
  if (/close_trade|close_position|close_partial/i.test(toolName)) return "Close";
  if (/preview/i.test(toolName)) return "Preview";
  if (/trailing_stop/i.test(toolName)) return "Trailing Stop";
  if (/rebalance/i.test(toolName)) return "Rebalance";
  if (/grid/i.test(toolName)) return "Grid Strategy";

  // Portfolio
  if (/get_portfolio|portfolio_state/i.test(toolName)) return "Portfolio";
  if (/get_balance|get_base_balance|get_user_assets/i.test(toolName)) return "Balance";
  if (/get_account/i.test(toolName)) return "Account";
  if (/get_positions|list_active_positions|check_positions/i.test(toolName)) return "Positions";
  if (/trade_history|order_history/i.test(toolName)) return "History";
  if (/wallet_balance|token_balance/i.test(toolName)) return "Wallet";

  // Backtest & strategy
  if (/backtest|walk_forward/i.test(toolName)) return "Backtest";
  if (/monte_carlo/i.test(toolName)) return "Monte Carlo";
  if (/optimize/i.test(toolName)) return "Optimize";
  if (/strategy_generate|suggest_strategy|suggest_mutation/i.test(toolName)) return "Generate Strategy";
  if (/strategy_iterate/i.test(toolName)) return "Iterate Strategy";
  if (/find_best|get_best|rank_strategies/i.test(toolName)) return "Rank";
  if (/deploy_strategy/i.test(toolName)) return "Deploy";
  if (/sandbox/i.test(toolName)) return "Sandbox";
  if (/playbook/i.test(toolName)) return "Playbook";
  if (/checkpoint/i.test(toolName)) return "Checkpoint";

  // Regime
  if (/regime|markov/i.test(toolName)) return "Regime";
  if (/alpha_decay|strategy_decay/i.test(toolName)) return "Alpha Decay";

  // Analysis
  if (/analyze_coin|full_analysis|deep_analysis/i.test(toolName)) return "Analysis";
  if (/analyze_pair|correlation/i.test(toolName)) return "Pair Analysis";
  if (/whale|flowscope/i.test(toolName)) return "Whale Flow";
  if (/market_impact/i.test(toolName)) return "Impact";

  // X (Twitter) social intelligence
  if (/search_x_sentiment|x_sentiment/i.test(toolName)) return "X Sentiment";
  if (/x_trending_cashtag|trending_cashtag/i.test(toolName)) return "X Trending";
  if (/x_user_timeline/i.test(toolName)) return "X Timeline";
  if (/watch_x_account/i.test(toolName)) return "X Watch";
  if (/analyze_x_narrative|x_narrative/i.test(toolName)) return "X Narrative";
  if (/search_x_by_entity/i.test(toolName)) return "X Entity";
  if (/list_x_trading_entities/i.test(toolName)) return "X Entities";

  // CDP (Coinbase Developer Platform)
  if (/list_cdp_webhooks/i.test(toolName)) return "CDP Webhooks";
  if (/create_cdp_webhook/i.test(toolName)) return "CDP Webhook Create";
  if (/delete_cdp_webhook/i.test(toolName)) return "CDP Webhook Delete";
  if (/describe_cdp_webhook_setup/i.test(toolName)) return "Webhook Setup";
  if (/query_base_sql/i.test(toolName)) return "Base SQL";
  if (/get_base_top_holders/i.test(toolName)) return "Top Holders";
  if (/get_base_whale_accumulation/i.test(toolName)) return "Whale Accumulation";
  if (/describe_base_sql_schema/i.test(toolName)) return "SQL Schema";
  if (/list_cdp_policies|get_cdp_policy|create_cdp_policy|delete_cdp_policy/i.test(toolName)) return "CDP Policy";
  if (/get_onramp_config|get_onramp_options/i.test(toolName)) return "Onramp Config";
  if (/get_onramp_quote/i.test(toolName)) return "Onramp Quote";
  if (/create_onramp_session_url/i.test(toolName)) return "Onramp Session";
  if (/get_onramp_transactions/i.test(toolName)) return "Onramp History";
  if (/list_cdp_evm_accounts|list_cdp_smart_accounts/i.test(toolName)) return "CDP Accounts";
  if (/create_cdp_evm_account|create_cdp_smart_account/i.test(toolName)) return "CDP Account Create";
  if (/list_cdp_token_balances/i.test(toolName)) return "CDP Balances";
  if (/get_cdp_swap_price/i.test(toolName)) return "CDP Swap Quote";
  if (/start_cdp_webhook_listener|stop_cdp_webhook_listener|get_cdp_webhook_listener_status/i.test(toolName)) return "Webhook Listener";
  if (/get_recent_cdp_webhook_events/i.test(toolName)) return "Webhook Events";
  if (/clear_cdp_webhook_buffer/i.test(toolName)) return "Webhook Buffer";

  // Proactive mode
  if (/start_proactive_mode|stop_proactive_mode|get_proactive_status/i.test(toolName)) return "Proactive Mode";
  if (/list_proactive_suggestions/i.test(toolName)) return "Suggestions";
  if (/accept_proactive_suggestion/i.test(toolName)) return "Accept";
  if (/dismiss_proactive_suggestion/i.test(toolName)) return "Dismiss";
  if (/suppress_proactive_category|unsuppress_proactive_category/i.test(toolName)) return "Suppression";
  if (/get_proactive_stats/i.test(toolName)) return "Proactive Stats";
  if (/fire_proactive_suggestion/i.test(toolName)) return "Fire Suggestion";
  if (/configure_proactive_category|list_proactive_categories/i.test(toolName)) return "Proactive Policy";
  if (/record_proactive_outcome/i.test(toolName)) return "Outcome";

  // Backtest verdict screening
  if (/check_backtest_preconditions/i.test(toolName)) return "Pre-Run Gate";
  if (/screen_backtest_result/i.test(toolName)) return "Verdict";
  if (/record_backtest_experiment/i.test(toolName)) return "Experiment Log";
  if (/list_backtest_experiments/i.test(toolName)) return "Experiments";
  if (/get_backtest_journal_stats/i.test(toolName)) return "Journal Stats";

  // Finnhub
  if (/get_upcoming_earnings/i.test(toolName)) return "Earnings Calendar";
  if (/get_earnings_estimates/i.test(toolName)) return "Earnings Estimates";
  if (/get_revenue_estimates/i.test(toolName)) return "Revenue Estimates";
  if (/get_earnings_surprises/i.test(toolName)) return "Earnings Surprises";
  if (/get_economic_calendar/i.test(toolName)) return "Macro Calendar";
  if (/get_ipo_calendar/i.test(toolName)) return "IPO Calendar";
  if (/get_insider_transactions/i.test(toolName)) return "Insider Trades";
  if (/get_insider_sentiment/i.test(toolName)) return "Insider Sentiment";
  if (/get_congressional_trading/i.test(toolName)) return "Congress Trades";
  if (/get_analyst_ratings/i.test(toolName)) return "Analyst Ratings";
  if (/get_price_target/i.test(toolName)) return "Price Target";
  if (/get_upgrade_downgrade/i.test(toolName)) return "Rating Changes";
  if (/get_sec_filings/i.test(toolName)) return "SEC Filings";
  if (/get_news_sentiment/i.test(toolName)) return "News Sentiment";
  if (/get_social_sentiment/i.test(toolName)) return "Social Sentiment";
  if (/get_etf_holdings/i.test(toolName)) return "ETF Holdings";
  if (/get_etf_profile/i.test(toolName)) return "ETF Profile";
  if (/get_etf_country_exposure/i.test(toolName)) return "ETF Country";
  if (/get_etf_sector_exposure/i.test(toolName)) return "ETF Sector";
  if (/get_mutual_fund_profile/i.test(toolName)) return "Fund Profile";
  if (/get_mutual_fund_holdings/i.test(toolName)) return "Fund Holdings";
  if (/get_mutual_fund_country_exposure/i.test(toolName)) return "Fund Country";
  if (/get_mutual_fund_sector_exposure/i.test(toolName)) return "Fund Sector";
  if (/get_company_profile/i.test(toolName)) return "Company Profile";
  if (/get_basic_financials/i.test(toolName)) return "Financials";
  if (/get_financials_reported/i.test(toolName)) return "Reported Financials";
  if (/get_peer_companies/i.test(toolName)) return "Peer Companies";
  if (/get_dividends/i.test(toolName)) return "Dividends";
  if (/get_stock_splits/i.test(toolName)) return "Splits";
  if (/get_fund_ownership/i.test(toolName)) return "Fund Ownership";
  if (/get_institutional_ownership/i.test(toolName)) return "13F Ownership";
  if (/get_lobbying/i.test(toolName)) return "Lobbying";
  if (/get_usa_spending/i.test(toolName)) return "Gov Contracts";
  if (/get_uspto_patents/i.test(toolName)) return "USPTO Patents";
  if (/get_visa_applications/i.test(toolName)) return "H-1B Applications";
  if (/get_supply_chain/i.test(toolName)) return "Supply Chain";
  if (/get_esg_score/i.test(toolName)) return "ESG Score";
  if (/list_earnings_transcripts/i.test(toolName)) return "Transcript List";
  if (/get_earnings_transcript/i.test(toolName)) return "Transcript";
  if (/get_stock_quote/i.test(toolName)) return "Stock Quote";
  if (/get_stock_candles/i.test(toolName)) return "Stock Candles";
  if (/get_stock_symbols/i.test(toolName)) return "Symbol List";
  if (/symbol_lookup/i.test(toolName)) return "Symbol Search";
  if (/get_market_status/i.test(toolName)) return "Market Status";
  if (/get_company_news/i.test(toolName)) return "Company News";
  if (/get_market_news/i.test(toolName)) return "Market News";
  if (/get_pattern_recognition/i.test(toolName)) return "Chart Patterns";
  if (/get_support_resistance/i.test(toolName)) return "S/R Levels";
  if (/get_aggregate_signal/i.test(toolName)) return "Aggregate Signal";
  if (/get_index_constituents/i.test(toolName)) return "Index Members";
  if (/get_bond_yield_curve/i.test(toolName)) return "Yield Curve";
  if (/get_bond_profile/i.test(toolName)) return "Bond Profile";
  if (/get_finnhub_crypto_exchanges/i.test(toolName)) return "Crypto Exchanges";
  if (/get_finnhub_crypto_symbols/i.test(toolName)) return "Crypto Symbols";
  if (/get_finnhub_crypto_candles/i.test(toolName)) return "Crypto Candles";
  if (/get_finnhub_crypto_profile/i.test(toolName)) return "Crypto Profile";
  if (/get_forex_rates/i.test(toolName)) return "Forex Rates";
  if (/list_economic_codes/i.test(toolName)) return "Economic Codes";
  if (/get_economic_data/i.test(toolName)) return "Economic Data";

  // SMC patterns
  if (/detect_smc_patterns|detect_smc_single_pattern/i.test(toolName)) return "SMC Patterns";

  // Calibration
  if (/record_confident_decision/i.test(toolName)) return "Record Decision";
  if (/record_decision_outcome/i.test(toolName)) return "Record Outcome";
  if (/get_calibration_stats/i.test(toolName)) return "Calibration";
  if (/list_recent_decisions/i.test(toolName)) return "Decisions";

  // Skills
  if (/list_skills|load_skill/i.test(toolName)) return "Skill";

  // Producer health
  if (/get_producer_health/i.test(toolName)) return "Producer Health";

  // DeFi
  if (/defillama/i.test(toolName)) return "DeFi Llama";
  if (/chainlink/i.test(toolName)) return "Chainlink";
  if (/uniswap/i.test(toolName)) return "Uniswap";
  if (/moonwell/i.test(toolName)) return "Moonwell";
  if (/dex_pair|search_dex/i.test(toolName)) return "DEX Search";
  if (/defi_yield|top_defi/i.test(toolName)) return "DeFi Yields";
  if (/lp_position|fee_collection/i.test(toolName)) return "LP Position";

  // Solana protocols
  if (/solana_drift/i.test(toolName)) return "Drift";
  if (/solana_orca/i.test(toolName)) return "Orca";
  if (/solana_raydium/i.test(toolName)) return "Raydium";
  if (/solana_meteora/i.test(toolName)) return "Meteora";
  if (/solana_sanctum/i.test(toolName)) return "Sanctum";
  if (/solana_adrena/i.test(toolName)) return "Adrena";
  if (/solana_lulo/i.test(toolName)) return "Lulo";
  if (/solana_debridge/i.test(toolName)) return "deBridge";
  if (/solana_flash/i.test(toolName)) return "Flash Trade";
  if (/solana_manifest/i.test(toolName)) return "Manifest";
  if (/solana_voltr/i.test(toolName)) return "Voltr";
  if (/solana_rugcheck/i.test(toolName)) return "Rug Check";
  if (/solana_pumpfun/i.test(toolName)) return "PumpFun";
  if (/solana_trade|solana_swap|solana_okx/i.test(toolName)) return "Solana Swap";
  if (/solana_balance|solana_wallet|solana_token/i.test(toolName)) return "Solana Wallet";
  if (/solana_stake|solana_solayer/i.test(toolName)) return "SOL Staking";
  if (/solana/i.test(toolName)) return "Solana";

  // Polkadot
  if (/polkadot/i.test(toolName)) return "Polkadot";

  // AgentKit
  if (/agentkit_swap/i.test(toolName)) return "On-chain Swap";
  if (/agentkit.*transfer/i.test(toolName)) return "Transfer";
  if (/agentkit.*balance|agentkit.*wallet/i.test(toolName)) return "On-chain Wallet";
  if (/agentkit/i.test(toolName)) return "AgentKit";

  // MoonPay
  if (/moonpay/i.test(toolName)) return "MoonPay";

  // SynthData
  if (/synthdata/i.test(toolName)) return "SynthData";

  // System & memory
  if (/memory|record_insight|search_memory/i.test(toolName)) return "Memory";
  if (/audit|decision_path/i.test(toolName)) return "Audit";
  if (/autonomous/i.test(toolName)) return "Autonomous";
  if (/circuit_breaker/i.test(toolName)) return "Circuit Breaker";
  if (/permission_mode/i.test(toolName)) return "Permissions";
  if (/explain/i.test(toolName)) return "Explain";

  // Reports
  if (/report_|export_|generate_html/i.test(toolName)) return "Report";
  if (/display_.*chart|generate.*chart/i.test(toolName)) return "Chart";

  // Earn
  if (/earn/i.test(toolName)) return "Earn";
  if (/basenames/i.test(toolName)) return "Basenames";

  // Approvals
  if (/approve_plan|approve_position/i.test(toolName)) return "Approval";

  // Fallback: clean snake_case to Title Case
  return toolName.replace(/^(get_|set_|list_|check_|create_|update_)/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function getToolArgs(args?: Record<string, unknown>): string {
  if (!args) return "";
  // Show the most relevant arg (symbol, pair, etc.)
  const symbol = args.symbol ?? args.pair ?? args.asset ?? args.coin;
  if (symbol) return `  ${String(symbol)}`;
  const query = args.query ?? args.input ?? args.prompt;
  if (query) return `  ${String(query).slice(0, 30)}`;
  return "";
}

const BlinkingDot = React.memo(function BlinkingDot({ active }: { active: boolean }) {
  // Only subscribe to clock when actively running — idle dots do not need to animate
  const clockFrame = useAnimationClock(active ? 16 : 0);
  // Toggle every ~600ms (37 frames at 16ms)
  const visible = active && Math.floor(clockFrame / 37) % 2 === 0;
  return <Text color="cyanBright">{visible ? "\u25CF" : " "}</Text>;
});

// Cache tool labels — regex only runs once per unique tool name
const _toolLabelCache = new Map<string, string>();
function getCachedToolLabel(toolName: string): string {
  let label = _toolLabelCache.get(toolName);
  if (!label) {
    label = getToolLabel(toolName);
    _toolLabelCache.set(toolName, label);
  }
  return label;
}

const ToolCallRow = React.memo(function ToolCallRow({ call }: { call: ToolCallState }) {
  return (
    <Box flexDirection="column">
      <Box paddingLeft={2}>
        {call.status === "running" ? (
          <BlinkingDot active={true} />
        ) : call.status === "success" ? (
          <Text color="green">{"\u25CF"}</Text>
        ) : (
          <Text color="red">{"\u25CF"}</Text>
        )}
        <Text bold dimColor={call.status !== "running"}>
          {" "}{getCachedToolLabel(call.toolName)}
        </Text>
        <Text dimColor>{getToolArgs(call.args)}</Text>
        {call.duration != null && (
          <Text dimColor> {call.duration < 1000 ? `${call.duration}ms` : `${(call.duration / 1000).toFixed(1)}s`}</Text>
        )}
      </Box>
      {call.status !== "running" && call.result && (
        <Box paddingLeft={2}>
          <Text dimColor>{"\u231F  "}</Text>
          <Text color={call.status === "error" ? "red" : undefined} dimColor={call.status === "success"}>
            {call.status === "error" ? "\u2717 " : ""}
            {call.result.length > 120 ? call.result.slice(0, 120) + "\u2026" : call.result}
          </Text>
        </Box>
      )}
    </Box>
  );
});

export function ToolCallInline({ calls }: Props) {
  // Group completed calls when 4+ are done — collapse into summary
  const [expanded, setExpanded] = useState(false);
  // Drill-down detail dialog for the most recent tool call
  const [showDetail, setShowDetail] = useState(false);
  const completed = calls.filter((c) => c.status !== "running");
  const running = calls.filter((c) => c.status === "running");
  const shouldCollapse = completed.length >= 4 && !expanded;
  const latest = calls[calls.length - 1];

  useInput((input, key) => {
    if (key.ctrl && input === "o" && completed.length >= 4) {
      setExpanded((e) => !e);
      return;
    }
    if ((input === "d" || input === "D") && latest && !showDetail) {
      setShowDetail(true);
    }
  });

  if (calls.length === 0) return null;

  // Drill-down dialog takes over the render when opened
  if (showDetail && latest) {
    return (
      <ToolExecutionDetailDialog
        execution={{
          id: latest.id,
          toolName: latest.toolName,
          args: latest.args ?? {},
          result: latest.result,
          status: latest.status,
          startedAt: latest.startedAt,
          endedAt: latest.duration != null ? latest.startedAt + latest.duration : undefined,
        }}
        onClose={() => setShowDetail(false)}
      />
    );
  }

  if (shouldCollapse) {
    const totalDuration = completed.reduce((sum, c) => sum + (c.duration ?? 0), 0);
    const errors = completed.filter((c) => c.status === "error").length;
    return (
      <Box flexDirection="column">
        <Box paddingLeft={2}>
          <Text color={errors > 0 ? "yellow" : "green"}>●</Text>
          <Text dimColor> {completed.length} tools completed</Text>
          {errors > 0 && <Text color="red"> ({errors} failed)</Text>}
          <Text dimColor> · {totalDuration < 1000 ? `${totalDuration}ms` : `${(totalDuration / 1000).toFixed(1)}s`}</Text>
          <Text dimColor> · Ctrl+O expand · d details</Text>
        </Box>
        {running.map((call) => (
          <ToolCallRow key={call.id} call={call} />
        ))}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {calls.map((call) => (
        <ToolCallRow key={call.id} call={call} />
      ))}
      {latest && (
        <Box paddingLeft={2}>
          <Text dimColor>[press d for details]</Text>
        </Box>
      )}
    </Box>
  );
}
