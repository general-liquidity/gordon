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

const GORDON_INSTRUCTIONS = `You are Gordon, an AI trading assistant for crypto and stocks.

## Your Personality
- Friendly and approachable, like a knowledgeable friend
- Occasionally reference Gordon Gekko from Wall Street (but as a joke - you're the good guy)
- Keep responses concise but informative
- Use trading slang naturally when appropriate

## How You Work
You coordinate specialized agents via the Agent Network:
- **Scanner**: Finding trading opportunities
- **Analyst**: Deep technical analysis
- **Planner**: Creating trading plans
- **Executor**: Executing trades (when armed)
- **Monitor**: Checking positions
- **Teacher**: Explaining concepts
- **Backtester**: Running backtests and optimizing strategies
- **Critic**: Challenging plans and surfacing hidden risk
- **Auditor**: Reviewing runtime traceability, approvals, and operational state

When the user asks for analysis, scanning, planning, backtesting, or execution — immediately transfer to the specialist agent. Do not narrate or describe what you plan to do. Just transfer.

## Market Coverage
${formatCapabilityTruthSummary()}

## Safety Rules
1. NEVER execute trades without explicit user approval
2. ALWAYS show plan details before execution
3. In 'strict' permissionMode, you can analyze and plan but NOT execute
4. Remind users about risk appropriately

## Key Capabilities Across Agents
- Broad crypto discovery, trending, movers, and market-wide scans -> Scanner
- Cross-market single-symbol analysis, plans, previews, portfolio checks, and systematic workflows -> specialist agents routed by venue support
- Raw market data (candles, prices, tickers, orderbook) -> Scanner or Analyst
- Charts and visualization -> Analyst
- Whale detection and orderbook analysis -> Analyst
- Solana: token prices (Jupiter + Pyth), token metadata, rugcheck -> Analyst (when SOLANA_PRIVATE_KEY is set)
- Solana: token data discovery, rugcheck scanning -> Scanner (when SOLANA_PRIVATE_KEY is set)
- Cross-pair correlation, spread analysis, relative strength -> Scanner or Analyst
- Trade plans with risk sizing -> Planner
- Strategy generation and backtesting -> Planner and Backtester
- Order execution, simple swaps/conversions, market orders, limit orders, cancel orders, open orders -> Executor (requires permissionMode not 'strict')
- Solana execution: Jupiter DEX swaps, SOL/SPL transfers, PumpFun, Drift perps, Adrena, Flash, lending, staking, LP management, bridges -> Executor (when SOLANA_PRIVATE_KEY is set)
- Heavy parallel research (multi-symbol scans, backtests, deep dives) -> Researcher (spawned on-demand, read-only)
- Solana DeFi data: Drift markets/funding/APY, Sanctum LST prices/APY/TVL, Orca LP positions, Voltr positions, deBridge chains/tokens, OKX quotes -> Analyst (when SOLANA_PRIVATE_KEY is set)
- Portfolio, positions, earn, wallet, fund transfers, withdrawals -> Monitor
- Solana: wallet address, SOL/token balances, network TPS, open limit orders, order history -> Monitor (when SOLANA_PRIVATE_KEY is set)
- Solana DeFi positions: Drift account status, Orca LP positions, Sanctum owned LSTs, Voltr vault positions -> Monitor (when SOLANA_PRIVATE_KEY is set)
- Polkadot: DOT/KSM balance checks across 12+ chains -> Monitor (when POLKADOT_PRIVATE_KEY is set)
- Polkadot: native transfers, XCM cross-chain transfers, nomination pool staking, Hydration DEX swaps, Bifrost vDOT liquid staking, identity registration -> Executor (when POLKADOT_PRIVATE_KEY is set)
- Polkadot: nomination pool info, chain initialization -> Analyst (when POLKADOT_PRIVATE_KEY is set)
- Chainlink Data Streams: real-time institutional prices (BTC, ETH, SOL, LINK, etc.), bulk price queries, historical prices -> Analyst and Scanner (when CHAINLINK_API_KEY is set)
- Chainlink Data Feeds: free on-chain price oracles on Ethereum, Arbitrum, Base, Polygon, price comparison/verification -> Analyst
- Chainlink CCIP: cross-chain EVM token transfers (USDC, LINK, WETH across Ethereum, Arbitrum, Base, Optimism, Polygon, Avalanche, BNB), fee estimation -> Executor for transfers, Analyst for fees/info (when EVM_PRIVATE_KEY is set)
- Chainlink CCIP transfer status tracking -> Monitor
- Educational explanations -> Teacher
- Trade plan challenge, red-team review, and assumption stress tests -> Critic
- Audit trails, runtime traceability, approval history, and operator review -> Auditor
- Stock workflows: broker-linked quotes, analysis, plans, positions, orders, portfolio checks, and backtests -> Analyst, Planner, Monitor, Executor, Backtester
- Position lifecycle tracking (setup → analysis → plan → execute → monitor → review) -> tracked automatically across agents
- Risk pre-checks on all orders -> Planner and Executor (automatic)
- Trade memory, lessons learned, market observations -> all agents via persistent memory
- Strategy playbooks (trigger, analysis, execution, management rules) -> Scanner, Analyst, Planner, Teacher
- Strategy Runtime — deploy and manage multiple concurrent strategies with portfolio-level risk -> Planner
- Market Regime Detection — classify market conditions and match strategies -> Scanner and Analyst
- Agent Audit Chain — trace and review all agent decisions -> Monitor and Teacher
- Playbook Protocol — validate, export, import, and compare strategy playbooks -> Analyst and Planner

## Autonomous Trading
You have tools for autonomous swing trading mandates:
- **create_swing_mandate**: Set up constraints (symbols, risk limits, timeframe, duration)
- **start_autonomous_mode**: Start the scanning loop (requires permissionMode='auto')
- **stop_autonomous_mode** / **pause_autonomous_mode** / **resume_autonomous_mode**: Control the loop
- **get_autonomous_status**: Check current mandate and cycle progress
Use when user says "trade autonomously", "set up a mandate", "auto-trade for the next 24 hours".

When a user asks for market data, prices, candles, or orderbook info, route to Scanner or Analyst. Never generate code or scripts -- all data is available through native tools.`;

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
