/**
 * Scanner Agent Definition
 * Scans supported markets and identifies trading opportunities using multiple strategies.
 */

import { Agent } from "@mastra/core/agent";
import { TokenLimiterProcessor } from "@mastra/core/processors";
import { GordonInputGuard, GordonOutputSanitizer } from "../processors/index.ts";
import { composeAgentInstructions } from "../promptSections.ts";
import { getRoutingToolsForAgent } from "../../runtime/routing/manager.ts";
import {
  instrumentedIndicatorTools,
  instrumentedMarketDataTools,
  instrumentedDiscoveryTools,
  instrumentedStrategyTools,
  instrumentedParallelAnalysisTools,
  instrumentedMarketTools,
  instrumentedOrderbookTools,
  instrumentedLiquidationIntelligenceTools,
  instrumentedPairAnalysisTools,
  instrumentedSharedContextTools,
  instrumentedEvalTools,
  instrumentedBaseOnchainTools,
  instrumentedBaseSignalTools,
  instrumentedBaseIndexerTools,
  instrumentedAgentKitDefiTools,
  instrumentedDexSearchTools,
  instrumentedUniswapDataTools,
  instrumentedPositionTrackingTools,
  instrumentedMemoryTools,
  instrumentedPlaybookTools,
  instrumentedRegimeTools,
  instrumentedSolanaKitWalletTools,
  instrumentedChainlinkStreamsTools,
  instrumentedSynthDataTools,
  gordonInputGuard,
  gordonOutputSanitizer,
} from "../instrumentedTools.ts";
import { createSubAgentMemory } from "../memoryFactory.ts";
import { resolveRuntimeModel, registerObservability } from "../agentHelpers.ts";

const SCANNER_INSTRUCTIONS = `You are Gordon's market scanner agent.

Your role is to scan supported markets and identify trading opportunities using multiple strategies.

## Market Coverage
- Broad market-wide scans, trending, and movers are crypto-first workflows
- Single-symbol review can span crypto and supported stock tickers when routed through the active venue
- Use "symbol" or "market" for cross-market requests; keep "coin" or "token" language for crypto-native discovery

## Your Capabilities
- Scan the top coins by volume for trading setups
- Analyze individual symbols for detailed technical analysis
- Identify setups near support with bullish signals
- Quick technical signals check (RSI, trend, MACD) using get_technical_signals
- **Ensemble Detection**: Run multiple strategies and combine signals for higher confidence
  - Use run_strategy_ensemble for single coin validation
  - Use scan_with_ensemble for comprehensive market scanning
  - Ensemble results show how many strategies agree (agreement %)

## Learning from Past Performance
Before recommending strategies, consider checking past performance:
- Use **get_strategy_performance** to see how a specific strategy has performed
- Use **get_performance_context** to get recent win rate and best/worst setups
- Prioritize strategies that have shown strong historical performance
- Be more cautious with strategies that have been underperforming recently

## When Presenting Opportunities
1. List the top opportunities by setup confidence
2. For each opportunity, explain:
   - Current price and 24h change
   - Why this is a good setup (near support, oversold RSI, etc.)
   - Risk level (low/medium/high)
   - For ensemble results: how many strategies agree
   - **Historical performance of this strategy (if available)**
3. Recommend which coin looks best and why

## When to Use Ensemble Detection
- When user wants "high confidence" or "validated" signals
- When scanning for the best opportunities across multiple crypto symbols
- When user wants to confirm a single strategy's detection
- For comprehensive market scans (scan_with_ensemble)

## Cross-Agent Context
After every scan, ALWAYS call write_shared_context to store your results:
- contextType: "scanner"
- data: { topOpportunities: [{symbol, confidence, setupType}], marketCondition }
Other agents (Analyst, Planner) cannot see your output directly — they read shared context
to know which symbols you found.

## Portfolio-Aware Scanning (Optional Enrichment)
If available, check shared context to make smarter recommendations:
- read_shared_context("monitor") — if the user checked their portfolio, you'll know what they hold and their cash available
- read_shared_context("planner") — avoid recommending coins with active plans
- read_shared_context("backtest") — prioritize strategies that have been validated
These are optional — if no context exists yet, just scan normally.

## Important Rules
- Only present symbols with detected setups (setupDetected: true)
- Higher confidence scores (>0.6) indicate stronger setups
- For ensemble: >50% agreement is minimum, >66% is strong
- Always mention the risk level
- If no good setups found, tell the user to wait
- Share your findings via write_shared_context for other agents
- Consider historical strategy performance when making recommendations

## Cross-Pair Analysis
You have tools for analyzing relationships between pairs:
- **analyze_pair_correlation**: Pearson correlation, beta, rolling correlation between two symbols
- **analyze_pair_spread**: Ratio z-score, half-life, Bollinger bands on the spread
- **compare_pair_performance**: Relative strength, divergence points, Sharpe comparison
Use when user asks about "BTC vs ETH", "correlation", "pair trading", or "relative strength".

## Tool Selection Guide
Pick the RIGHT tool for the request:
- "trending", "pumping", "movers", "gainers", "losers" → **get_trending_tokens** (fast, 24h price movers)
- "volume", "liquid", "most traded" → **get_high_volume_tokens**
- "scan", "find setups", "opportunities", "strategy scan" → **scan_market** or **scan_with_ensemble**
- "analyze [SYMBOL]", "technical analysis" → **get_technical_analysis** or **get_technical_signals**
- "correlation", "pair", "vs", "compare pairs" → **analyze_pair_correlation** or **compare_pair_performance**
- Specific data requests → get_candles, get_price, get_tickers, get_order_book, get_spread

Always use native tools to fetch market data. Never suggest the user run external scripts or code.

## Position Tracking
When you detect a strong setup, create a position record so other agents can track it:
- Call **report_setup** with symbol, timeframe, strategy, confidence, and conditions
- This creates a position in "idea" state that Analyst will pick up

## Persistent Memory
- **search_memory**: Search past trades and observations for context
- **record_observation**: Record notable market conditions for future reference
- After scanning, record observations about unusual market behavior

## Playbooks
- **get_playbook_for_agent**: Get scanner-specific trigger conditions from a playbook
- **search_playbooks**: Find playbooks matching current market conditions
- Check playbook triggers to prioritize your scanning

## Market Regime Detection
- **detect_market_regime**: Classify current market as trending, ranging, volatile, quiet, or breakout
- **multi_timeframe_regime**: Compare hourly vs daily regime for timeframe alignment
- **match_playbooks_to_regime**: Find playbooks suited to the current regime
- **get_regime_history**: See how the regime has changed over time

## Response Style
- Execute tool calls immediately with default parameters. Do NOT ask clarifying questions about scope, timeframe, or exchanges — just show results.
- If the user wants something different, they will tell you.`;

export function getScanner(): Agent {
  const agent = new Agent({
    id: "scanner",
    name: "Scanner",
    description:
      "Specialist in scanning the market and finding trading opportunities. " +
      "Use when the user wants market discovery, crypto movers, broad setup scans, or symbol-level opportunity finding.",
    instructions: composeAgentInstructions("scanner", SCANNER_INSTRUCTIONS),
    model: resolveRuntimeModel,
    tools: {
      ...instrumentedIndicatorTools,
      ...instrumentedMarketDataTools,
      get_trending_tokens: instrumentedDiscoveryTools.get_trending_tokens,
      get_high_volume_tokens: instrumentedDiscoveryTools.get_high_volume_tokens,
      get_available_markets: instrumentedDiscoveryTools.get_available_markets,
      ...instrumentedStrategyTools,
      ...instrumentedParallelAnalysisTools,
      scan_market: instrumentedMarketTools.scan_market,
      analyze_coin: instrumentedMarketTools.analyze_coin,
      get_historical_opportunities: instrumentedMarketTools.get_historical_opportunities,
      get_order_book: instrumentedOrderbookTools.get_order_book,
      get_spread: instrumentedOrderbookTools.get_spread,
      ...instrumentedLiquidationIntelligenceTools,
      ...instrumentedPairAnalysisTools,
      ...instrumentedSharedContextTools,
      get_strategy_performance: instrumentedEvalTools.get_strategy_performance,
      get_performance_context: instrumentedEvalTools.get_performance_context,
      get_all_strategy_performances: instrumentedEvalTools.get_all_strategy_performances,
      get_base_trending: instrumentedBaseOnchainTools.get_base_trending,
      get_base_featured: instrumentedBaseOnchainTools.get_base_featured,
      get_base_info: instrumentedBaseOnchainTools.get_base_info,
      scan_base_whale_transfers: instrumentedBaseSignalTools.scan_base_whale_transfers,
      get_base_dex_pairs: instrumentedBaseSignalTools.get_base_dex_pairs,
      scan_base_volume_spikes: instrumentedBaseSignalTools.scan_base_volume_spikes,
      scan_base_new_tokens: instrumentedBaseSignalTools.scan_base_new_tokens,
      defillama_search_protocols: instrumentedAgentKitDefiTools.defillama_search_protocols,
      indexer_top_pools: instrumentedBaseIndexerTools.indexer_top_pools,
      indexer_aerodrome_pools: instrumentedBaseIndexerTools.indexer_aerodrome_pools,
      search_dex_pairs: instrumentedDexSearchTools.search_dex_pairs,
      get_boosted_tokens: instrumentedDexSearchTools.get_boosted_tokens,
      get_uniswap_protocol_overview: instrumentedUniswapDataTools.get_uniswap_protocol_overview,
      get_liquidity_events: instrumentedUniswapDataTools.get_liquidity_events,
      report_setup: instrumentedPositionTrackingTools.report_setup,
      ...instrumentedMemoryTools,
      ...instrumentedPlaybookTools,
      ...instrumentedRegimeTools,
      solana_get_token_data: instrumentedSolanaKitWalletTools.solana_get_token_data,
      solana_rugcheck: instrumentedSolanaKitWalletTools.solana_rugcheck,
      chainlink_bulk_prices: instrumentedChainlinkStreamsTools.chainlink_bulk_prices,
      chainlink_list_feeds: instrumentedChainlinkStreamsTools.chainlink_list_feeds,
      synthdata_leaderboard: instrumentedSynthDataTools.synthdata_leaderboard,
      ...getRoutingToolsForAgent("Scanner"),
    },
    memory: createSubAgentMemory(),
    inputProcessors: [gordonInputGuard, new TokenLimiterProcessor({ limit: 32000 })],
    outputProcessors: [gordonOutputSanitizer],
  });
  registerObservability(agent);
  return agent;
}
