import React, { useState, useEffect, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { useAnimationClock } from "../hooks/useAnimationClock.js";

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

const BlinkingDot = React.memo(function BlinkingDot() {
  // Shared clock — no per-dot setInterval
  const clockFrame = useAnimationClock(50);
  // Toggle every ~600ms (12 frames at 50ms)
  const visible = Math.floor(clockFrame / 12) % 2 === 0;
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
          <BlinkingDot />
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
  if (calls.length === 0) return null;

  // Group completed calls when 4+ are done — collapse into summary
  const [expanded, setExpanded] = useState(false);
  const completed = calls.filter((c) => c.status !== "running");
  const running = calls.filter((c) => c.status === "running");
  const shouldCollapse = completed.length >= 4 && !expanded;

  useInput((input, key) => {
    if (key.ctrl && input === "o" && completed.length >= 4) {
      setExpanded((e) => !e);
    }
  });

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
          <Text dimColor> · Ctrl+O expand</Text>
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
    </Box>
  );
}
