import React, { useState, useEffect, useRef, useMemo } from "react";
import { Box, Text } from "ink";
import { ShimmerChar } from "./ShimmerChar.js";
import { useAnimationClock } from "../hooks/useAnimationClock.js";

// ============================================================================
// TradingSpinner — Animated spinner with glimmer shimmer + stall detection
//
// Claude Code-style: rotating characters + sine-wave light trail across text.
// Stall detection: smooth fade to red after 3s of no new tokens.
// Trading-adapted verbs instead of "Brewing" or "Clauding".
// ============================================================================

const FRAMES = ["\u00B7", "\u2722", "\u2733", "\u2736", "\u273B", "\u273D"];
const ALL_FRAMES = [...FRAMES, ...[...FRAMES].reverse()];

const TRADING_VERBS = [
  "Scanning markets", "Analyzing charts", "Computing risk",
  "Building position", "Checking correlation", "Running backtest",
  "Evaluating setup", "Sizing position", "Checking constitution",
  "Classifying risk", "Querying orderbook", "Evaluating momentum",
  "Assessing volatility", "Computing exposure", "Modeling scenarios",
  "Reviewing signals", "Processing data", "Synthesizing analysis",
];

const AGENT_VERBS: Record<string, string> = {
  gordon: "Analyzing",
  executor: "Executing order",
  researcher: "Researching",
  scanner: "Scanning markets",
  analyst: "Analyzing charts",
  planner: "Building trade plan",
  monitor: "Monitoring positions",
  backtester: "Running backtest",
};

interface Props {
  agentName?: string;
  elapsedMs?: number;
  streamLength?: number;
  /** The user's input — used to infer contextual verb */
  userInput?: string;
  /** Currently running tool name — overrides verb when active */
  activeToolName?: string;
}

// Infer verb from user input — what are they actually asking for?
function inferVerbFromInput(input?: string): string | null {
  if (!input) return null;
  const lower = input.toLowerCase();
  if (/scan|trending|pump|opportunity|discover|what.s.*hot/i.test(lower)) return "Scanning markets";
  if (/price|how much|quote|worth/i.test(lower)) return "Fetching price";
  if (/chart|candle|technical|rsi|macd|indicator/i.test(lower)) return "Analyzing charts";
  if (/risk|safe|danger|exposure|position.?siz/i.test(lower)) return "Assessing risk";
  if (/backtest|historical|simulate|test.*strategy/i.test(lower)) return "Running backtest";
  if (/buy|sell|long|short|enter|exit|trade|order|execute/i.test(lower)) return "Preparing trade";
  if (/portfolio|balance|positions?|holdings/i.test(lower)) return "Checking portfolio";
  if (/plan|strategy|setup|thesis/i.test(lower)) return "Building plan";
  if (/news|sentiment|narrative|catalyst/i.test(lower)) return "Researching";
  if (/correlation|pair|spread|hedge/i.test(lower)) return "Analyzing correlation";
  if (/regime|trend|range|volatil/i.test(lower)) return "Detecting regime";
  if (/orderbook|depth|liquidity|bid|ask/i.test(lower)) return "Checking liquidity";
  if (/dd|due.?diligence|research|deep.?dive/i.test(lower)) return "Deep research";
  if (/morning|brief|overview|summary|recap/i.test(lower)) return "Preparing brief";
  return null;
}

// Map tool name patterns to contextual verbs — covers all ~300 tools
function getToolVerb(toolName: string): string | null {
  // Price & market data
  if (/get_price|fetch_price|pyth.*price|chainlink.*price|book_ticker/i.test(toolName)) return "Fetching price";
  if (/get_candles|candlestick/i.test(toolName)) return "Loading charts";
  if (/order_book|tick_liquidity/i.test(toolName)) return "Checking liquidity";
  if (/get_spread/i.test(toolName)) return "Checking spread";
  if (/get_tickers|get_available_markets/i.test(toolName)) return "Loading markets";
  if (/trending|boosted|high_volume/i.test(toolName)) return "Finding trending";
  if (/market_trades/i.test(toolName)) return "Loading trades";

  // Indicators & technicals
  if (/rsi/i.test(toolName)) return "Computing RSI";
  if (/macd/i.test(toolName)) return "Computing MACD";
  if (/ichimoku/i.test(toolName)) return "Computing Ichimoku";
  if (/supertrend/i.test(toolName)) return "Computing Supertrend";
  if (/vwap/i.test(toolName)) return "Computing VWAP";
  if (/atr|adx|parabolic|bollinger|squeeze|linear_regression/i.test(toolName)) return "Computing indicators";
  if (/technical_analysis|technical_signals/i.test(toolName)) return "Running technical analysis";
  if (/divergence|fvg|supply_demand|camarilla|angled_market/i.test(toolName)) return "Analyzing structure";

  // Scanning & discovery
  if (/scan_market|scan_breakout|scan_for_strategy|scan_with_ensemble/i.test(toolName)) return "Scanning markets";
  if (/scan_base|scan_.*volume|scan_.*whale/i.test(toolName)) return "Scanning on-chain";
  if (/parallel_scan|parallel_multi/i.test(toolName)) return "Running parallel scan";
  if (/score_market|detect_consolidation/i.test(toolName)) return "Scoring market";

  // Risk & sizing
  if (/classify.*risk|assess.*risk|check_risk|get_risk/i.test(toolName)) return "Assessing risk";
  if (/position_size|kelly_size|volatility_adjusted/i.test(toolName)) return "Computing position size";
  if (/drawdown|cascade_risk|crowding/i.test(toolName)) return "Checking drawdown risk";
  if (/check_daily_limit|check_exit/i.test(toolName)) return "Checking limits";
  if (/portfolio_health|portfolio_drift/i.test(toolName)) return "Checking portfolio health";
  if (/liquidation_pressure/i.test(toolName)) return "Checking liquidation risk";

  // Execution
  if (/execute_plan|execute_with/i.test(toolName)) return "Executing plan";
  if (/place_market_order|place_order/i.test(toolName)) return "Placing order";
  if (/place_limit_order|create_limit_order/i.test(toolName)) return "Placing limit order";
  if (/place_bracket/i.test(toolName)) return "Placing bracket order";
  if (/place_oco/i.test(toolName)) return "Placing OCO order";
  if (/cancel_order|cancel_all/i.test(toolName)) return "Cancelling orders";
  if (/cancel_replace/i.test(toolName)) return "Replacing order";
  if (/close_trade|close_position|close_partial/i.test(toolName)) return "Closing position";
  if (/preview_market|preview_withdrawal/i.test(toolName)) return "Previewing order";
  if (/trailing_stop/i.test(toolName)) return "Setting trailing stop";
  if (/rebalance/i.test(toolName)) return "Rebalancing portfolio";
  if (/convert_dust/i.test(toolName)) return "Converting dust";
  if (/grid_plan|create_grid/i.test(toolName)) return "Building grid strategy";
  if (/swing_mandate/i.test(toolName)) return "Setting swing mandate";

  // Portfolio & account
  if (/get_portfolio|portfolio_state/i.test(toolName)) return "Loading portfolio";
  if (/get_balance|get_base_balance|get_user_assets/i.test(toolName)) return "Checking balance";
  if (/get_account|account_details|account_snapshot/i.test(toolName)) return "Loading account";
  if (/get_positions|list_active_positions|check_positions/i.test(toolName)) return "Loading positions";
  if (/trade_history|order_history/i.test(toolName)) return "Loading history";
  if (/trade_fees|trade_statistics/i.test(toolName)) return "Loading trade stats";
  if (/wallet_balance|token_balance/i.test(toolName)) return "Checking wallet";
  if (/deposit_address/i.test(toolName)) return "Getting deposit address";
  if (/transfer_funds|withdraw/i.test(toolName)) return "Processing transfer";

  // Backtest & strategy
  if (/backtest|run_backtest|walk_forward/i.test(toolName)) return "Running backtest";
  if (/compare_backtest|compare_live/i.test(toolName)) return "Comparing results";
  if (/monte_carlo/i.test(toolName)) return "Running Monte Carlo";
  if (/optimize_strategy|grid_search|random_search/i.test(toolName)) return "Optimizing strategy";
  if (/strategy_generate|suggest_strategy|suggest_mutation/i.test(toolName)) return "Generating strategy";
  if (/strategy_iterate|strategy_explain/i.test(toolName)) return "Refining strategy";
  if (/find_best_strategy|get_best_strategy|rank_strategies/i.test(toolName)) return "Ranking strategies";
  if (/deploy_strategy|start_.*strategy|resume_strategy/i.test(toolName)) return "Deploying strategy";
  if (/stop_strategy|pause_strategy/i.test(toolName)) return "Stopping strategy";
  if (/sandbox|create_sandbox|compare_sandbox/i.test(toolName)) return "Testing in sandbox";
  if (/playbook|fork_playbook|rank_playbook/i.test(toolName)) return "Loading playbook";
  if (/checkpoint|save_checkpoint|load_checkpoint/i.test(toolName)) return "Saving checkpoint";

  // Regime & analysis
  if (/regime|markov_regime|multi_timeframe_regime/i.test(toolName)) return "Detecting regime";
  if (/analyze_coin|run_full_analysis|parallel_deep/i.test(toolName)) return "Deep analysis";
  if (/analyze_pair|correlation|cointegration/i.test(toolName)) return "Analyzing pairs";
  if (/alpha_decay|strategy_decay/i.test(toolName)) return "Checking alpha decay";
  if (/analyze_whale|whale_orders|flowscope/i.test(toolName)) return "Tracking whale flow";
  if (/market_impact|estimate_market/i.test(toolName)) return "Estimating impact";
  if (/analyze_systematic/i.test(toolName)) return "Systematic analysis";
  if (/false_breakout/i.test(toolName)) return "Detecting false breakout";

  // X (Twitter) social intelligence
  if (/search_x_sentiment|x_sentiment/i.test(toolName)) return "Reading X sentiment";
  if (/x_trending_cashtag|trending_cashtag/i.test(toolName)) return "Finding trending cashtags";
  if (/x_user_timeline/i.test(toolName)) return "Scanning X timeline";
  if (/watch_x_account/i.test(toolName)) return "Watching X accounts";
  if (/analyze_x_narrative|x_narrative/i.test(toolName)) return "Analyzing X narrative";
  if (/search_x_by_entity/i.test(toolName)) return "Filtering X by entity";
  if (/list_x_trading_entities/i.test(toolName)) return "Listing X entities";

  // CDP (Coinbase Developer Platform)
  if (/list_cdp_webhooks/i.test(toolName)) return "Listing CDP webhooks";
  if (/create_cdp_webhook/i.test(toolName)) return "Creating CDP webhook";
  if (/delete_cdp_webhook/i.test(toolName)) return "Deleting CDP webhook";
  if (/describe_cdp_webhook_setup/i.test(toolName)) return "Explaining webhook setup";
  if (/query_base_sql/i.test(toolName)) return "Querying Base SQL";
  if (/get_base_top_holders/i.test(toolName)) return "Ranking Base holders";
  if (/get_base_whale_accumulation/i.test(toolName)) return "Finding Base whales";
  if (/describe_base_sql_schema/i.test(toolName)) return "Reading SQL schema";
  if (/list_cdp_policies/i.test(toolName)) return "Listing CDP policies";
  if (/get_cdp_policy/i.test(toolName)) return "Fetching CDP policy";
  if (/create_cdp_policy/i.test(toolName)) return "Creating CDP policy";
  if (/delete_cdp_policy/i.test(toolName)) return "Deleting CDP policy";
  if (/get_onramp_config/i.test(toolName)) return "Loading onramp config";
  if (/get_onramp_options/i.test(toolName)) return "Loading onramp options";
  if (/get_onramp_quote/i.test(toolName)) return "Quoting onramp purchase";
  if (/create_onramp_session_url/i.test(toolName)) return "Creating onramp session";
  if (/get_onramp_transactions/i.test(toolName)) return "Loading onramp history";
  if (/list_cdp_evm_accounts/i.test(toolName)) return "Listing CDP EVM accounts";
  if (/list_cdp_smart_accounts/i.test(toolName)) return "Listing smart accounts";
  if (/create_cdp_evm_account/i.test(toolName)) return "Creating EVM account";
  if (/create_cdp_smart_account/i.test(toolName)) return "Creating smart account";
  if (/list_cdp_token_balances/i.test(toolName)) return "Loading cross-chain balances";
  if (/get_cdp_swap_price/i.test(toolName)) return "Quoting CDP swap";
  if (/start_cdp_webhook_listener/i.test(toolName)) return "Starting webhook listener";
  if (/stop_cdp_webhook_listener/i.test(toolName)) return "Stopping webhook listener";
  if (/get_cdp_webhook_listener_status/i.test(toolName)) return "Checking listener status";
  if (/get_recent_cdp_webhook_events/i.test(toolName)) return "Reading webhook events";
  if (/clear_cdp_webhook_buffer/i.test(toolName)) return "Clearing webhook buffer";

  // Proactive mode
  if (/start_proactive_mode/i.test(toolName)) return "Starting proactive mode";
  if (/stop_proactive_mode/i.test(toolName)) return "Stopping proactive mode";
  if (/get_proactive_status/i.test(toolName)) return "Checking proactive status";
  if (/list_proactive_suggestions/i.test(toolName)) return "Loading suggestions";
  if (/accept_proactive_suggestion/i.test(toolName)) return "Accepting suggestion";
  if (/dismiss_proactive_suggestion/i.test(toolName)) return "Dismissing suggestion";
  if (/suppress_proactive_category|unsuppress_proactive_category/i.test(toolName)) return "Updating suppression";
  if (/get_proactive_stats/i.test(toolName)) return "Computing proactive stats";
  if (/fire_proactive_suggestion/i.test(toolName)) return "Firing suggestion";
  if (/configure_proactive_category/i.test(toolName)) return "Tuning proactive policy";
  if (/record_proactive_outcome/i.test(toolName)) return "Recording outcome";
  if (/list_proactive_categories/i.test(toolName)) return "Listing proactive categories";

  // Backtest verdict screening
  if (/check_backtest_preconditions/i.test(toolName)) return "Checking backtest preconditions";
  if (/screen_backtest_result/i.test(toolName)) return "Screening backtest result";
  if (/record_backtest_experiment/i.test(toolName)) return "Recording experiment";
  if (/list_backtest_experiments/i.test(toolName)) return "Loading experiments";
  if (/get_backtest_journal_stats/i.test(toolName)) return "Computing journal stats";

  // DeFi & on-chain
  if (/defillama/i.test(toolName)) return "Querying DeFi Llama";
  if (/chainlink/i.test(toolName)) return "Querying Chainlink";
  if (/uniswap/i.test(toolName)) return "Querying Uniswap";
  if (/moonwell/i.test(toolName)) return "Interacting with Moonwell";
  if (/base_dex|dex_pair|search_dex/i.test(toolName)) return "Searching DEX";
  if (/defi_yield|top_defi/i.test(toolName)) return "Finding yields";
  if (/lp_position|fee_collection|pool_flash/i.test(toolName)) return "Checking LP positions";
  if (/base_trending|base_featured|base_new_tokens/i.test(toolName)) return "Browsing Base";
  if (/base_whale|track_base_wallet/i.test(toolName)) return "Tracking Base wallet";

  // Solana
  if (/solana_trade|solana_swap|solana_okx_swap/i.test(toolName)) return "Swapping on Solana";
  if (/solana_balance|solana_token_balance|solana_wallet/i.test(toolName)) return "Checking Solana wallet";
  if (/solana_drift/i.test(toolName)) return "Using Drift protocol";
  if (/solana_orca/i.test(toolName)) return "Using Orca protocol";
  if (/solana_raydium/i.test(toolName)) return "Using Raydium";
  if (/solana_meteora/i.test(toolName)) return "Using Meteora";
  if (/solana_sanctum/i.test(toolName)) return "Using Sanctum";
  if (/solana_adrena/i.test(toolName)) return "Using Adrena";
  if (/solana_lulo/i.test(toolName)) return "Using Lulo";
  if (/solana_debridge/i.test(toolName)) return "Bridging via deBridge";
  if (/solana_flash/i.test(toolName)) return "Flash trading";
  if (/solana_manifest/i.test(toolName)) return "Using Manifest";
  if (/solana_voltr/i.test(toolName)) return "Using Voltr vaults";
  if (/solana_rugcheck/i.test(toolName)) return "Checking for rug";
  if (/solana_pumpfun/i.test(toolName)) return "Launching on PumpFun";
  if (/solana_stake|solana_solayer/i.test(toolName)) return "Staking SOL";
  if (/solana_pyth/i.test(toolName)) return "Fetching Pyth price";
  if (/solana_get_tps/i.test(toolName)) return "Checking Solana TPS";
  if (/solana_faucet/i.test(toolName)) return "Requesting faucet";
  if (/solana_transfer/i.test(toolName)) return "Transferring SOL";

  // Polkadot
  if (/polkadot/i.test(toolName)) return "Using Polkadot";

  // AgentKit
  if (/agentkit_swap|agentkit_get_swap/i.test(toolName)) return "Swapping on-chain";
  if (/agentkit_.*transfer/i.test(toolName)) return "Transferring on-chain";
  if (/agentkit_wrap/i.test(toolName)) return "Wrapping ETH";
  if (/agentkit_faucet/i.test(toolName)) return "Requesting faucet";
  if (/agentkit_balance|agentkit_wallet/i.test(toolName)) return "Checking on-chain wallet";

  // MoonPay
  if (/moonpay/i.test(toolName)) return "Using MoonPay";

  // Memory & system
  if (/memory|record_insight|record_observation|search_memory/i.test(toolName)) return "Searching memory";
  if (/audit|decision_path|agent_activity/i.test(toolName)) return "Querying audit trail";
  if (/explain/i.test(toolName)) return "Explaining";
  if (/autonomous|start_autonomous|stop_autonomous/i.test(toolName)) return "Managing autonomous mode";
  if (/background_scanning/i.test(toolName)) return "Managing scanner";
  if (/circuit_breaker/i.test(toolName)) return "Checking circuit breaker";
  if (/permission_mode/i.test(toolName)) return "Changing permissions";
  if (/runtime_health|cache_stats|model_info/i.test(toolName)) return "Checking system health";
  if (/test_connection|test_order/i.test(toolName)) return "Testing connection";

  // SynthData
  if (/synthdata/i.test(toolName)) return "Fetching synthetic data";

  // Reports & exports
  if (/report_analysis|report_plan|report_setup/i.test(toolName)) return "Generating report";
  if (/export_results|export_systematic|generate_html/i.test(toolName)) return "Exporting results";
  if (/display_.*chart|generate_backtest_chart/i.test(toolName)) return "Rendering chart";

  // Earn & staking
  if (/earn|subscribe_.*earn|redeem_.*earn/i.test(toolName)) return "Managing earn positions";
  if (/basenames_register/i.test(toolName)) return "Registering basename";

  // Plans & approvals
  if (/create_plan|list_plans/i.test(toolName)) return "Managing plan";
  if (/approve_plan|approve_position|approve_strategy/i.test(toolName)) return "Processing approval";
  if (/reject_position|review_position/i.test(toolName)) return "Reviewing position";

  return null;
}

export function TradingSpinner({ agentName, elapsedMs, streamLength = 0, userInput, activeToolName }: Props) {
  // Progressive width gating: hide elements that don't fit
  const cols = process.stdout.columns ?? 80;
  // Token counter (smooth animation via ref)
  const displayedTokensRef = useRef(0);
  const estimatedTokens = Math.floor(streamLength / 4); // ~4 chars per token
  const [frame, setFrame] = useState(0);
  const [glimmerIndex, setGlimmerIndex] = useState(0);

  // Verb priority: active tool > user input inference > agent name > generic
  // Memoized — regex runs only when inputs change, not every 50ms render
  const verb = useMemo(() =>
    (activeToolName && getToolVerb(activeToolName))
    ?? inferVerbFromInput(userInput)
    ?? (agentName && AGENT_VERBS[agentName] ? AGENT_VERBS[agentName]! : "Thinking"),
    [activeToolName, userInput, agentName],
  );

  const reducedMotion = typeof process !== "undefined" && process.env.GORDON_REDUCED_MOTION === "true";

  // Stall detection
  const lastLengthRef = useRef(streamLength);
  const lastGrowthRef = useRef(Date.now());
  const [stallIntensity, setStallIntensity] = useState(0);

  useEffect(() => {
    if (streamLength > lastLengthRef.current) {
      lastLengthRef.current = streamLength;
      lastGrowthRef.current = Date.now();
      setStallIntensity(0);
    }
  }, [streamLength]);

  // Shared animation clock — single timer for all animated components
  const clockFrame = useAnimationClock(reducedMotion ? 1000 : 50);

  // Derive animation state from clock frame (no setInterval needed)
  useEffect(() => {
    if (reducedMotion) {
      setFrame((f) => (f + 1) % 2);
      return;
    }
    setFrame((f) => (f + 1) % ALL_FRAMES.length);
    const verbLen = verb.length + 4;
    setGlimmerIndex((g) => (g + 1) % verbLen);
    const timeSinceGrowth = Date.now() - lastGrowthRef.current;
    if (timeSinceGrowth > 3000) {
      setStallIntensity((prev) => {
        const target = Math.min(1, (timeSinceGrowth - 3000) / 2000);
        return prev + (target - prev) * 0.1;
      });
    }
  }, [clockFrame, verb.length, reducedMotion]);

  const char = reducedMotion
    ? (frame % 2 === 0 ? "\u25CF" : " ")
    : (ALL_FRAMES[Math.floor(frame / 2.4) % ALL_FRAMES.length] ?? "\u00B7");
  const isStalled = stallIntensity > 0.3;
  const elapsedStr = elapsedMs != null && elapsedMs >= 1000
    ? `${(elapsedMs / 1000).toFixed(0)}s`
    : "";

  // Smooth token counter (Claude Code pattern: +3 small, +50 large)
  const tokenGap = estimatedTokens - displayedTokensRef.current;
  if (tokenGap > 0) {
    const increment = tokenGap < 70 ? 3 : tokenGap < 200 ? Math.ceil(tokenGap * 0.15) : 50;
    displayedTokensRef.current = Math.min(estimatedTokens, displayedTokensRef.current + increment);
  }
  const displayedTokens = displayedTokensRef.current;
  const tokenStr = displayedTokens > 0
    ? displayedTokens >= 1000 ? `${(displayedTokens / 1000).toFixed(1)}K tok` : `${displayedTokens} tok`
    : "";

  // Build the shimmer text: "verb..." with light trail
  const verbWithEllipsis = `${verb}\u2026`;
  const chars = verbWithEllipsis.split("");

  // Progressive width gating: hide elements on narrow terminals
  const showElapsed = cols > 50;
  const showTokens = cols > 70;
  const showStall = cols > 40;

  return (
    <Box paddingLeft={2}>
      <Text color={isStalled ? "red" : "rgb(52,238,176)"}>{char} </Text>
      {chars.map((c, i) => (
        <ShimmerChar
          key={i}
          char={c}
          glimmerIndex={isStalled ? -10 : glimmerIndex}
          charIndex={i}
        />
      ))}
      {showElapsed && elapsedStr && (
        <>
          <Text dimColor> {"\u00b7"} </Text>
          <Text dimColor>{elapsedStr}</Text>
        </>
      )}
      {showTokens && tokenStr && (
        <>
          <Text dimColor> {"\u00b7"} </Text>
          <Text dimColor>{tokenStr}</Text>
        </>
      )}
      {showStall && isStalled && (
        <>
          <Text dimColor> {"\u00b7"} </Text>
          <Text color="red" dimColor>slow response</Text>
        </>
      )}
    </Box>
  );
}
