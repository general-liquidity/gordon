/**
 * Gordon Agent Definition
 * Main orchestrator agent that coordinates all specialist sub-agents.
 */

import { Agent } from "@mastra/core/agent";
import { TokenLimiterProcessor } from "@mastra/core/processors";
import { composeAgentInstructions } from "../promptSections.ts";
import { createModuleLogger } from "../../logger/logger.ts";
import { getScopedMCPTools } from "../../ai/mcp/client.ts";
import { getRoutingToolsForAgent } from "../../runtime/routing/manager.ts";
import {
  formatCapabilityTruthSummary,
  GORDON_PRODUCT_TRUTH,
} from "../capabilityTruth.ts";
import {
  instrumentedSystemTools,
  instrumentedSchedulerTools,
  instrumentedAutonomousTools,
  instrumentedIndicatorTools,
  instrumentedMarketDataTools,
  instrumentedMarketTools,
  instrumentedDiscoveryTools,
  instrumentedStrategyTools,
  instrumentedParallelAnalysisTools,
  instrumentedChartTools,
  instrumentedMarketAnalysisTools,
  instrumentedCompositionTools,
  instrumentedMultiModalChartTools,
  instrumentedLiquidationIntelligenceTools,
  instrumentedPairAnalysisTools,
  instrumentedOrderbookTools,
  instrumentedAccountTools,
  instrumentedPositionTools,
  instrumentedHistoryTools,
  instrumentedWalletTools,
  instrumentedEarnTools,
  instrumentedPositionTrackingTools,
  instrumentedRiskManagementTools,
  instrumentedCheckRiskTool,
  instrumentedTradingTools,
  instrumentedBacktestTools,
  instrumentedEvalTools,
  instrumentedStrategyGenerationTools,
  instrumentedPlaybookTools,
  instrumentedProtocolTools,
  instrumentedMemoryTools,
  instrumentedSharedContextTools,
  instrumentedRegimeTools,
  instrumentedBaseOnchainTools,
  instrumentedBaseSignalTools,
  instrumentedBaseIndexerTools,
  instrumentedUniswapDataTools,
  instrumentedDexSearchTools,
  instrumentedXSocialTools,
  instrumentedCdpWebhookTools,
  instrumentedCdpSqlTools,
  instrumentedCdpPolicyTools,
  instrumentedCdpOnrampTools,
  instrumentedCdpEvmMultichainTools,
  instrumentedCdpWebhookReceiverTools,
  instrumentedDefillamaYieldTools,
  instrumentedChainlinkStreamsTools,
  instrumentedChainlinkFeedsTools,
  instrumentedSynthDataTools,
  instrumentedAgentKitOnchainTools,
  instrumentedSolanaKitWalletTools,
  instrumentedPolkadotKitAssetTools,
  instrumentedPolkadotKitStakingTools,
  instrumentedPolkadotKitDefiTools,
  instrumentedAdvancedTools,
  instrumentedSystematicTools,
  instrumentedAuditTools,
  instrumentedMetricsTools,
  gordonInputGuard,
  gordonOutputSanitizer,
} from "../instrumentedTools.ts";
import { createMemory } from "../memoryFactory.ts";
import { resolveRuntimeModel, formatModelLabel, registerObservability } from "../agentHelpers.ts";
import { getExecutor } from "./executor.ts";
import { getResearcher } from "./researcher.ts";

const logger = createModuleLogger("agents");

const GORDON_INSTRUCTIONS = `You are Gordon, an AI trading assistant for crypto and stocks, built by General Liquidity, Inc.

## Identity
- Friendly, knowledgeable, like a sharp trading desk colleague
- Occasionally reference Gordon Gekko from Wall Street (but as a joke — you're the good guy)
- Use trading slang naturally when appropriate

## Market Coverage
${formatCapabilityTruthSummary()}

## Tools Available Directly
**Market data**: prices, candles, tickers, orderbook, spread, trades
**Scanning**: market scans, trending tokens, volume movers, breakout detection, whale tracking
**Technicals**: RSI, MACD, Ichimoku, VWAP, Supertrend, ATR, ADX, Bollinger, divergence, supply/demand zones, FVG
**Charts**: price, candlestick, volume, comparison charts
**Risk**: classify_trade_risk (11 dims), position sizing (vol-adjusted), correlation limits, tail risk, drawdown overlay
**Planning**: trade plans, order previews, strategy generation
**Backtesting**: backtests, walk-forward, Monte Carlo, compare, optimize
**Portfolio**: positions, balances, P&L, account details, trade history, earn
**Strategies**: generate, iterate, deploy, playbooks, strategy runtime
**Regime**: Markov regime, market efficiency, Hurst exponent, trend/range/volatile
**Memory**: trade journal, lessons, observations, session memory
**Audit**: decision paths, agent activity, runtime health
**DeFi**: DeFi Llama, Uniswap, on-chain data, Base/Solana discovery
**Solana**: Jupiter, Drift, Orca, Sanctum, Adrena, deBridge, PumpFun (when SOLANA_PRIVATE_KEY set)
**Polkadot**: balances, transfers, staking, XCM, Hydration, Bifrost (when POLKADOT_PRIVATE_KEY set)
**Chainlink**: data streams, price feeds, CCIP transfers (when keys set)
**Stocks**: broker-linked quotes, analysis, plans, positions, orders (when broker configured)

## Builtin Workflows (Skills)
Users can invoke these with slash commands. Suggest them when relevant:
- **/quick-scan**: rapid market scan for opportunities
- **/dd [symbol]**: deep due diligence research
- **/risk-check**: run risk assessment on current portfolio or a trade idea
- **/morning-brief**: market overview and overnight summary
- **/swing-entry**: set up a swing trade with proper sizing
- **/scalp**: quick scalp trade workflow
- **/pairs-trade**: pairs/spread trading setup
- **/rebalance**: portfolio rebalancing workflow
- **/close-losers**: batch close losing positions
- **/dca-setup**: dollar-cost averaging plan
- **/earnings-play**: earnings event trade setup
- **/exit-review**: review exit decisions on recent trades
- **/weekend-review**: weekly performance review
- **/market-make**: market making workflow
- **/arb-funding**: funding rate arbitrage
- **/liquidity-provide**: LP position setup
- **/auto-optimize**: run the auto-optimizer on strategies
- **/tutorial**: onboarding tutorial for new users
- **/learn-risk**, **/learn-skills**, **/learn-mcp**, etc.: educational walkthroughs

## Portfolio Runtime & Strategy Slots
When strategies are deployed, they operate within a portfolio runtime:
- Each strategy gets a **capital slot** — a budget ceiling it cannot exceed
- **approve_strategy_trade** checks: capital limits, total exposure, per-strategy drawdown, portfolio-level drawdown
- If a strategy hits its drawdown limit, its slot is frozen — no new trades until reset
- Multiple strategies can run concurrently, each with independent capital budgets
- The runtime enforces portfolio-level constraints even when individual strategies are healthy

## Circuit Breakers & Halt Conditions
The trading constitution enforces automatic halts:
- **Daily loss halt**: 3% daily loss triggers trading pause for the rest of the day
- **Drawdown halt**: 10% drawdown from peak freezes all new positions
- **Emergency liquidation**: 15% drawdown triggers position reduction
- **Consecutive loss halt**: 5 consecutive losing trades triggers 24h cooldown
- **Flash crash protection**: 2% loss within 15 minutes halts trading immediately
- During halts, explain to the user what triggered it and when trading will resume
- Drawdown also triggers position size reduction: at 5% drawdown, new positions cap at 50% of normal size

## Autonomous Trading
- **create_swing_mandate**: constraints (symbols, risk, timeframe, duration)
- **start_autonomous_mode**: start loop (requires permissionMode='auto')
- **stop/pause/resume_autonomous_mode**: control loop
- **get_autonomous_status**: check mandate progress
- Mandates have their own circuit breakers: consecutive-loss halt, drawdown pause, capital lockup
- When a mandate pauses automatically, explain why and offer to resume or adjust`;

export function getGordon(): Agent {
  const model = resolveRuntimeModel();
  const modelLabel = formatModelLabel(model);
  logger.info("Initializing agent", { model: modelLabel });

  const agent = new Agent({
    id: "gordon",
    name: "Gordon",
    description: GORDON_PRODUCT_TRUTH.headline,
    instructions: composeAgentInstructions("gordon", GORDON_INSTRUCTIONS),
    model,

    // 4-agent architecture: Gordon routes to Executor for trades, Researcher for parallel work
    agents: {
      executor: getExecutor(),
      researcher: getResearcher(),
    },

    // Gordon has ALL read-only tools directly (no routing overhead for 90% of requests)
    // Only trade execution tools are on Executor (isolated for safety)
    tools: {
      // System & scheduling
      ...instrumentedSystemTools,
      ...instrumentedSchedulerTools,
      ...instrumentedAutonomousTools,

      // Market data & scanning (was Scanner)
      ...instrumentedIndicatorTools,
      ...instrumentedMarketDataTools,
      ...instrumentedMarketTools,
      ...instrumentedDiscoveryTools,
      ...instrumentedStrategyTools,
      ...instrumentedParallelAnalysisTools,

      // Analysis & charting (was Analyst)
      ...instrumentedChartTools,
      ...instrumentedMarketAnalysisTools,
      ...instrumentedCompositionTools,
      ...instrumentedMultiModalChartTools,
      ...instrumentedLiquidationIntelligenceTools,
      ...instrumentedPairAnalysisTools,

      // Orderbook reads (non-execution)
      get_order_book: instrumentedOrderbookTools.get_order_book,
      get_spread: instrumentedOrderbookTools.get_spread,
      get_market_trades: instrumentedOrderbookTools.get_market_trades,
      get_order_status: instrumentedOrderbookTools.get_order_status,
      test_order: instrumentedOrderbookTools.test_order,

      // Portfolio, account, history (was Monitor)
      ...instrumentedAccountTools,
      ...instrumentedPositionTools,
      ...instrumentedHistoryTools,
      ...instrumentedWalletTools,
      ...instrumentedEarnTools,
      ...instrumentedPositionTrackingTools,

      // Risk assessment (was Critic — now a tool, not a separate agent)
      ...instrumentedRiskManagementTools,
      ...instrumentedCheckRiskTool,

      // Planning & preview (was Planner)
      list_plans: instrumentedTradingTools.list_plans,
      preview_market_order: instrumentedDiscoveryTools.preview_market_order,
      preview_withdrawal: instrumentedWalletTools.preview_withdrawal,

      // Backtesting (was Backtester — heavy work spawns Researcher)
      ...instrumentedBacktestTools,
      ...instrumentedEvalTools,

      // Strategy & playbooks (was Teacher + Planner)
      ...instrumentedStrategyGenerationTools,
      ...instrumentedPlaybookTools,
      ...instrumentedProtocolTools,

      // Memory & context
      ...instrumentedMemoryTools,
      ...instrumentedSharedContextTools,

      // Market regime
      ...instrumentedRegimeTools,

      // On-chain reads (non-execution)
      ...instrumentedBaseOnchainTools,
      ...instrumentedBaseSignalTools,
      ...instrumentedBaseIndexerTools,
      ...instrumentedUniswapDataTools,
      ...instrumentedDexSearchTools,
      ...instrumentedXSocialTools,
      ...instrumentedCdpWebhookTools,
      ...instrumentedCdpSqlTools,
      ...instrumentedCdpPolicyTools,
      ...instrumentedCdpOnrampTools,
      ...instrumentedCdpEvmMultichainTools,
      ...instrumentedCdpWebhookReceiverTools,
      ...instrumentedDefillamaYieldTools,
      ...instrumentedChainlinkStreamsTools,
      ...instrumentedChainlinkFeedsTools,
      ...instrumentedSynthDataTools,

      // AgentKit reads
      agentkit_get_balance: instrumentedAgentKitOnchainTools.agentkit_get_balance,
      agentkit_get_wallet: instrumentedAgentKitOnchainTools.agentkit_get_wallet,
      agentkit_get_swap_price: instrumentedAgentKitOnchainTools.agentkit_get_swap_price,

      // Solana reads
      ...instrumentedSolanaKitWalletTools,

      // Polkadot reads
      polkadot_check_balance: instrumentedPolkadotKitAssetTools.polkadot_check_balance,
      polkadot_get_pool_info: instrumentedPolkadotKitStakingTools.polkadot_get_pool_info,
      polkadot_initialize_chain: instrumentedPolkadotKitDefiTools.polkadot_initialize_chain,

      // Advanced & audit (was Auditor — now just tools on Gordon)
      ...instrumentedAdvancedTools,
      ...instrumentedSystematicTools,
      ...instrumentedAuditTools,
      ...instrumentedMetricsTools,

      // MCP plugin tools
      ...getScopedMCPTools({
        categories: ["data-provider", "analytics", "research", "portfolio", "utility", "infrastructure"],
      }),
    },

    // Memory for full conversation context
    memory: createMemory(),

    // Token limiter to prevent context window overflow in long sessions
    inputProcessors: [gordonInputGuard, new TokenLimiterProcessor({ limit: 64000 })],
    outputProcessors: [gordonOutputSanitizer],
  });
  registerObservability(agent);
  return agent;
}
