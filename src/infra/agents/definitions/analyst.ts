/**
 * Analyst Agent Definition
 * Deep market analysis and technical indicators specialist.
 */

import { Agent } from "@mastra/core/agent";
import { TokenLimiterProcessor } from "@mastra/core/processors";
import { composeAgentInstructions } from "../promptSections.ts";
import { getRoutingToolsForAgent } from "../../runtime/routing/manager.ts";
import {
  instrumentedIndicatorTools,
  instrumentedMarketDataTools,
  instrumentedChartTools,
  instrumentedOrderbookTools,
  instrumentedMarketAnalysisTools,
  instrumentedCompositionTools,
  instrumentedParallelAnalysisTools,
  instrumentedMultiModalChartTools,
  instrumentedLiquidationIntelligenceTools,
  instrumentedPairAnalysisTools,
  instrumentedMarketTools,
  instrumentedBaseOnchainTools,
  instrumentedAgentKitOnchainTools,
  instrumentedAgentKitDefiTools,
  instrumentedBaseIndexerTools,
  instrumentedUniswapDataTools,
  instrumentedDefillamaYieldTools,
  instrumentedDexSearchTools,
  instrumentedBaseSignalTools,
  instrumentedSharedContextTools,
  instrumentedEvalTools,
  instrumentedPositionTrackingTools,
  instrumentedMemoryTools,
  instrumentedPlaybookTools,
  instrumentedRegimeTools,
  instrumentedProtocolTools,
  instrumentedPolkadotKitStakingTools,
  instrumentedPolkadotKitDefiTools,
  instrumentedSolanaKitWalletTools,
  instrumentedSolanaKitDefiPerpsTools,
  instrumentedSolanaKitDefiLendingTools,
  instrumentedSolanaKitDefiPoolsTools,
  instrumentedSolanaKitDefiBridgeTools,
  instrumentedChainlinkStreamsTools,
  instrumentedChainlinkFeedsTools,
  instrumentedChainlinkCCIPTools,
  instrumentedSynthDataTools,
  gordonInputGuard,
  gordonOutputSanitizer,
} from "../instrumentedTools.ts";
import { createSubAgentMemory } from "../memoryFactory.ts";
import { resolveRuntimeModel, registerObservability } from "../agentHelpers.ts";

const ANALYST_INSTRUCTIONS = `You are Gordon's technical analyst agent.

Your role is to provide deep analysis of specific markets and tickers.

## Market Coverage
- You can analyze crypto symbols and supported stock tickers
- Keep crypto-native language for onchain, DEX, liquidation, and protocol flows
- When the request is cross-market, prefer symbol or ticker wording over coin-only phrasing

## Your Capabilities
- Analyze any trading pair with multiple timeframes
- Identify support and resistance levels
- Interpret technical indicators (RSI, MACD, Volume)
- Determine trend direction and momentum
- Full technical analysis with bias scoring using get_technical_analysis
- RSI checks for overbought/oversold conditions using get_rsi
- VWAP for intraday fair value analysis using get_vwap
- Stochastic RSI, MFI, and WaveTrend (included in get_rsi response)
- **Comprehensive analysis** combining signals, RSI, whale orders, and orderbook using run_full_analysis

## Learning from Past Performance
Your analysis should be informed by historical trade outcomes:
- Use **get_performance_context** to understand recent performance patterns
- Use **get_market_condition_performance** to see which market conditions favor our trading
- Adjust confidence levels based on historical accuracy in similar conditions
- Note if current market condition historically produces better or worse results

## Cross-Agent Context
If the user's request doesn't specify a symbol (e.g., "check whale activity", "analyze the top one"), read shared context to figure out which symbol they mean:
- read_shared_context("analysis") — check if you already analyzed a symbol this session
- read_shared_context("scanner") — see what coins were found in a recent scan
If neither has context, ask the user which symbol they mean.

Other optional reads (use if available, skip if not):
- read_shared_context("monitor") — know if user already holds this symbol
- read_shared_context("backtest", symbol) — see if this symbol was already backtested

After completing analysis, ALWAYS write_shared_context with:
- contextType: "analysis", symbol: the analyzed symbol
- data: { overallBias, confidence, technicalSignals, supportResistance }
This ensures follow-up requests (like "check whale activity") can find the active symbol.

## When to Use run_full_analysis
Use run_full_analysis when user asks for:
- "deep analysis", "full analysis", "comprehensive analysis"
- "/deep <symbol>" command
- Analysis that should combine multiple data sources

## Important Rules
- Always explain indicators in simple terms
- Mention both bullish and bearish scenarios
- Be honest about uncertainty
- Share your analysis results via write_shared_context for other agents
- Consider historical performance when assessing confidence levels

## Available Visualization Tools
- display_price_chart: ASCII line chart of price action
- display_candlestick_chart: Candlestick chart with volume
- display_comparison_chart: Multi-asset comparison chart
- display_volume_chart: Volume chart

## Advanced Chart Tools (MultiModal)
- generate_chart: Generate visual charts for detailed analysis
- analyze_chart: Use vision to analyze chart patterns and formations
- quick_ta: Quick visual technical analysis summary

## Market Analysis Tools
- scan_breakouts: Detect breakout patterns across markets
- detect_consolidation: Find consolidating assets ready for a move
- score_market: Score overall market conditions

## Available Data Tools
- get_candles: Fetch raw OHLCV candle data at any interval
- get_price: Get current price
- get_order_book: Orderbook depth with walls and liquidity
- get_spread: Bid-ask spread
- get_market_trades: Recent trades with buy/sell flow
- analyze_whale_orders: Detect large orders and smart money positioning
- estimate_market_impact: Estimate slippage for a given order size

## Cross-Pair Analysis Tools
- analyze_pair_correlation: Compute correlation, beta, rolling correlation between two pairs
- analyze_pair_spread: Ratio z-score, half-life, Bollinger bands on the price ratio
- compare_pair_performance: Relative returns, divergence points, Sharpe ratio comparison
Use when user asks about "BTC vs ETH", "pair correlation", "relative strength", or "spread trading".

Always use these native tools. Never generate code or scripts for data fetching.

## Position Tracking
When you complete analysis on a position created by Scanner:
- Call **report_analysis** with positionId, bias, confidence, and key levels
- This transitions the position from "idea" to "analyzed" for Planner

## Persistent Memory
- **search_memory**: Look up past analyses and lessons for this symbol
- **record_insight**: Record significant analytical conclusions
- **get_lessons**: Check lessons learned from previous trades on this symbol
- Use memory to avoid repeating past mistakes

## Playbooks
- **get_playbook_for_agent**: Get analyst-specific validation/invalidation criteria
- Apply playbook criteria when validating setups

## Market Regime Awareness
- **detect_market_regime**: Understand current market conditions before deep analysis
- Use regime context to calibrate confidence levels (e.g., ranging markets = lower trend confidence)

## Playbook Protocol
- **validate_playbook**: Check a playbook's quality and compliance with the protocol
- **compare_playbooks**: Side-by-side comparison of two playbooks' parameters`;

export function getAnalyst(): Agent {
  const agent = new Agent({
    id: "analyst",
    name: "Analyst",
    description:
      "Specialist in deep market analysis and technical indicators. " +
      "Use when user asks about a specific symbol or ticker, wants detailed analysis, " +
      "needs to understand support/resistance levels, wants whale analysis, " +
      "breakout detection, or order book depth analysis.",
    instructions: composeAgentInstructions("analyst", ANALYST_INSTRUCTIONS),
    model: resolveRuntimeModel,
    tools: {
      ...instrumentedIndicatorTools,
      ...instrumentedMarketDataTools,
      ...instrumentedChartTools,
      get_order_book: instrumentedOrderbookTools.get_order_book,
      get_spread: instrumentedOrderbookTools.get_spread,
      get_market_trades: instrumentedOrderbookTools.get_market_trades,
      get_order_status: instrumentedOrderbookTools.get_order_status,
      test_order: instrumentedOrderbookTools.test_order,
      ...instrumentedMarketAnalysisTools,
      ...instrumentedCompositionTools,
      ...instrumentedParallelAnalysisTools,
      ...instrumentedMultiModalChartTools,
      ...instrumentedLiquidationIntelligenceTools,
      ...instrumentedPairAnalysisTools,
      analyze_coin: instrumentedMarketTools.analyze_coin,
      get_base_gas: instrumentedBaseOnchainTools.get_base_gas,
      get_base_balance: instrumentedBaseOnchainTools.get_base_balance,
      agentkit_get_swap_price: instrumentedAgentKitOnchainTools.agentkit_get_swap_price,
      pyth_get_price_feed: instrumentedAgentKitDefiTools.pyth_get_price_feed,
      pyth_fetch_price: instrumentedAgentKitDefiTools.pyth_fetch_price,
      defillama_get_protocol: instrumentedAgentKitDefiTools.defillama_get_protocol,
      defillama_get_token_prices: instrumentedAgentKitDefiTools.defillama_get_token_prices,
      indexer_pool_stats: instrumentedBaseIndexerTools.indexer_pool_stats,
      get_pool_tick_liquidity: instrumentedUniswapDataTools.get_pool_tick_liquidity,
      get_liquidity_events: instrumentedUniswapDataTools.get_liquidity_events,
      get_pool_flash_events: instrumentedUniswapDataTools.get_pool_flash_events,
      get_fee_collections: instrumentedUniswapDataTools.get_fee_collections,
      get_uniswap_protocol_overview: instrumentedUniswapDataTools.get_uniswap_protocol_overview,
      get_uniswap_pool_yields: instrumentedDefillamaYieldTools.get_uniswap_pool_yields,
      get_top_defi_yields: instrumentedDefillamaYieldTools.get_top_defi_yields,
      search_dex_pairs: instrumentedDexSearchTools.search_dex_pairs,
      track_base_wallet: instrumentedBaseSignalTools.track_base_wallet,
      get_base_token_holders: instrumentedBaseSignalTools.get_base_token_holders,
      get_base_dex_pairs: instrumentedBaseSignalTools.get_base_dex_pairs,
      ...instrumentedSharedContextTools,
      get_performance_context: instrumentedEvalTools.get_performance_context,
      get_market_condition_performance: instrumentedEvalTools.get_market_condition_performance,
      get_learning_insights: instrumentedEvalTools.get_learning_insights,
      report_analysis: instrumentedPositionTrackingTools.report_analysis,
      ...instrumentedMemoryTools,
      ...instrumentedPlaybookTools,
      detect_market_regime: instrumentedRegimeTools.detect_market_regime,
      get_regime_history: instrumentedRegimeTools.get_regime_history,
      ...instrumentedProtocolTools,
      polkadot_get_pool_info: instrumentedPolkadotKitStakingTools.polkadot_get_pool_info,
      polkadot_initialize_chain: instrumentedPolkadotKitDefiTools.polkadot_initialize_chain,
      solana_fetch_price: instrumentedSolanaKitWalletTools.solana_fetch_price,
      solana_pyth_price: instrumentedSolanaKitWalletTools.solana_pyth_price,
      solana_get_token_data: instrumentedSolanaKitWalletTools.solana_get_token_data,
      solana_rugcheck: instrumentedSolanaKitWalletTools.solana_rugcheck,
      solana_drift_has_account: instrumentedSolanaKitDefiPerpsTools.solana_drift_has_account,
      solana_drift_account_info: instrumentedSolanaKitDefiPerpsTools.solana_drift_account_info,
      solana_drift_markets: instrumentedSolanaKitDefiPerpsTools.solana_drift_markets,
      solana_drift_funding_rate: instrumentedSolanaKitDefiPerpsTools.solana_drift_funding_rate,
      solana_drift_perp_quote: instrumentedSolanaKitDefiPerpsTools.solana_drift_perp_quote,
      solana_drift_lend_apy: instrumentedSolanaKitDefiLendingTools.solana_drift_lend_apy,
      solana_sanctum_lst_price: instrumentedSolanaKitDefiLendingTools.solana_sanctum_lst_price,
      solana_sanctum_apy: instrumentedSolanaKitDefiLendingTools.solana_sanctum_apy,
      solana_sanctum_tvl: instrumentedSolanaKitDefiLendingTools.solana_sanctum_tvl,
      solana_voltr_positions: instrumentedSolanaKitDefiLendingTools.solana_voltr_positions,
      solana_drift_vault_info: instrumentedSolanaKitDefiLendingTools.solana_drift_vault_info,
      solana_orca_fetch_positions: instrumentedSolanaKitDefiPoolsTools.solana_orca_fetch_positions,
      solana_debridge_chains: instrumentedSolanaKitDefiBridgeTools.solana_debridge_chains,
      solana_debridge_tokens: instrumentedSolanaKitDefiBridgeTools.solana_debridge_tokens,
      solana_debridge_status: instrumentedSolanaKitDefiBridgeTools.solana_debridge_status,
      solana_okx_quote: instrumentedSolanaKitDefiBridgeTools.solana_okx_quote,
      solana_okx_tokens: instrumentedSolanaKitDefiBridgeTools.solana_okx_tokens,
      chainlink_get_price: instrumentedChainlinkStreamsTools.chainlink_get_price,
      chainlink_get_price_at: instrumentedChainlinkStreamsTools.chainlink_get_price_at,
      chainlink_read_feed: instrumentedChainlinkFeedsTools.chainlink_read_feed,
      chainlink_compare_prices: instrumentedChainlinkFeedsTools.chainlink_compare_prices,
      chainlink_ccip_supported_chains: instrumentedChainlinkCCIPTools.chainlink_ccip_supported_chains,
      chainlink_ccip_get_fee: instrumentedChainlinkCCIPTools.chainlink_ccip_get_fee,
      synthdata_prediction_percentiles: instrumentedSynthDataTools.synthdata_prediction_percentiles,
      synthdata_volatility: instrumentedSynthDataTools.synthdata_volatility,
      synthdata_option_pricing: instrumentedSynthDataTools.synthdata_option_pricing,
      ...getRoutingToolsForAgent("Analyst"),
    },
    memory: createSubAgentMemory(),
    inputProcessors: [gordonInputGuard, new TokenLimiterProcessor({ limit: 32000 })],
    outputProcessors: [gordonOutputSanitizer],
  });
  registerObservability(agent);
  return agent;
}
