/**
 * Gordon Agents
 * Multi-agent orchestration using Mastra's Agent Networks
 *
 * Architecture:
 * - Agent class from @mastra/core for LLM-powered agents
 * - Sub-agents via `agents` object for network routing
 * - Tools as objects: { tool_id: toolInstance }
 * - .network() method for multi-agent orchestration
 * - Memory integration with LibSQL for task tracking
 *
 * IMPORTANT: Agents are lazily initialized to ensure environment
 * variables are loaded before the provider registry is accessed.
 *
 * Memory Management:
 * - Configurable lastMessages via config
 * - Session duration tracking with auto-clear
 * - Memory usage warnings when approaching limits
 */

import { Agent } from "@mastra/core/agent";
import { TokenLimiterProcessor } from "@mastra/core/processors";
import { Memory } from "@mastra/memory";
import { LibSQLStore, LibSQLVector } from "@mastra/libsql";

import { getModel } from "../providers/registry.ts";
import {
  indicatorTools,
  explainTools,
  marketTools,
  marketDataTools,
  positionTools,
  schedulerTools,
  systemTools,
  earnTools,
  chartTools,
  orderbookTools,
  walletTools,
  discoveryTools,
  historyTools,
  accountTools,
  tradingTools,
  marketAnalysisTools,
  riskManagementTools,
  strategyTools,
  strategyGenerationTools,
  metricsTools,
  compositionTools,
  backtestTools,
  sharedContextTools,
  parallelAnalysisTools,
  multiModalChartTools,
  liquidationIntelligenceTools,
  pairAnalysisTools,
  autonomousTools,
  baseOnchainTools,
  agentKitOnchainTools,
  agentKitDefiTools,
  baseSignalTools,
  baseIndexerTools,
  positionTrackingTools,
  checkRiskTool,
  memoryTools,
  playbookTools,
  playbookBacktestTools,
  withToolsMetrics,
} from "./tools/index.ts";
import { getSessionSummary, getMemoryStats, resetSharedMemory } from "./shared-context.ts";
import { evalTools } from "../evals/index.ts";
import { getMCPTools } from "../mcp/client.ts";
import {
  generatePerformanceContext,
  formatPerformanceContextForPrompt,
} from "../evals/feedbackLoop.ts";
import type { MemoryConfig } from "../../types/index.ts";

// ============================================================================
// Memory Configuration & Session Management
// ============================================================================

/** Default memory configuration */
const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  lastMessages: 20,
  maxSessionDurationHours: 24,
  memoryWarningThreshold: 0.8,
};

/** Session tracking state */
interface SessionState {
  startTime: number;
  lastActivity: number;
  messageCount: number;
  warningIssued: boolean;
}

let _sessionState: SessionState | null = null;
let _memoryConfig: MemoryConfig = DEFAULT_MEMORY_CONFIG;

/**
 * Initialize or get session state
 */
function getSessionState(): SessionState {
  if (!_sessionState) {
    _sessionState = {
      startTime: Date.now(),
      lastActivity: Date.now(),
      messageCount: 0,
      warningIssued: false,
    };
  }
  return _sessionState;
}

/**
 * Set the memory configuration from GordonConfig
 */
export function setMemoryConfig(config: Partial<MemoryConfig>): void {
  _memoryConfig = { ...DEFAULT_MEMORY_CONFIG, ...config };
  console.log(`[Gordon] Memory config updated: lastMessages=${_memoryConfig.lastMessages}, maxSessionHours=${_memoryConfig.maxSessionDurationHours}`);
}

/**
 * Get current memory configuration
 */
export function getMemoryConfig(): MemoryConfig {
  return _memoryConfig;
}

/**
 * Check if session has exceeded maximum duration
 */
export function isSessionExpired(): boolean {
  const session = getSessionState();
  const maxDurationMs = _memoryConfig.maxSessionDurationHours * 60 * 60 * 1000;
  return Date.now() - session.startTime > maxDurationMs;
}

/**
 * Memory usage statistics
 */
export interface MemoryUsageStats {
  messageCount: number;
  maxMessages: number;
  usagePercent: number;
  sessionDurationHours: number;
  maxSessionHours: number;
  sessionExpired: boolean;
  warningLevel: "none" | "warning" | "critical";
  contextStats: {
    analysesCount: number;
    backtestsCount: number;
    hasScanner: boolean;
    hasPlanner: boolean;
    totalVersions: number;
  };
}

/**
 * Get memory usage statistics and check for warnings
 */
export function getMemoryUsageStats(): MemoryUsageStats {
  const session = getSessionState();
  const contextStats = getMemoryStats();

  const usagePercent = session.messageCount / _memoryConfig.lastMessages;
  const sessionDurationHours = (Date.now() - session.startTime) / (60 * 60 * 1000);
  const sessionExpired = isSessionExpired();

  let warningLevel: "none" | "warning" | "critical" = "none";
  if (usagePercent >= 0.95 || sessionExpired) {
    warningLevel = "critical";
  } else if (usagePercent >= _memoryConfig.memoryWarningThreshold) {
    warningLevel = "warning";
  }

  return {
    messageCount: session.messageCount,
    maxMessages: _memoryConfig.lastMessages,
    usagePercent: Math.min(usagePercent, 1),
    sessionDurationHours,
    maxSessionHours: _memoryConfig.maxSessionDurationHours,
    sessionExpired,
    warningLevel,
    contextStats: {
      analysesCount: contextStats.analysesCount,
      backtestsCount: contextStats.backtestsCount,
      hasScanner: contextStats.hasScanner,
      hasPlanner: contextStats.hasPlanner,
      totalVersions: contextStats.totalVersions,
    },
  };
}

/**
 * Check memory usage and return warning message if needed
 * Should be called periodically (e.g., after each message)
 */
export function checkMemoryUsageWarning(): string | null {
  const stats = getMemoryUsageStats();
  const session = getSessionState();

  // Don't repeat warnings too frequently
  if (session.warningIssued && stats.warningLevel === "warning") {
    return null;
  }

  if (stats.warningLevel === "critical") {
    session.warningIssued = true;
    if (stats.sessionExpired) {
      return `[Memory Warning] Session has exceeded maximum duration (${stats.maxSessionHours}h). Consider starting a new session to maintain performance.`;
    }
    return `[Memory Warning] Memory usage at ${Math.round(stats.usagePercent * 100)}%. Oldest messages will be dropped soon. Consider starting a new session.`;
  }

  if (stats.warningLevel === "warning" && !session.warningIssued) {
    session.warningIssued = true;
    return `[Memory Notice] Memory usage at ${Math.round(stats.usagePercent * 100)}% (${stats.messageCount}/${stats.maxMessages} messages). Session running for ${stats.sessionDurationHours.toFixed(1)}h.`;
  }

  return null;
}

/**
 * Track a new message in the session
 */
export function trackMessage(): void {
  const session = getSessionState();
  session.messageCount++;
  session.lastActivity = Date.now();
}

/**
 * Clear session and reset memory
 * Call this when starting a new session or when session expires
 */
export function clearSession(): void {
  _sessionState = null;
  resetSharedMemory();
  resetAgents();
  console.log("[Gordon] Session cleared and memory reset");
}

/**
 * Auto-clear session if expired
 * Returns true if session was cleared
 */
export function autoClearIfExpired(): boolean {
  if (isSessionExpired()) {
    console.log("[Gordon] Session expired, auto-clearing...");
    clearSession();
    return true;
  }
  return false;
}

// ============================================================================
// Instrumented Tools (with metrics recording)
// ============================================================================

/**
 * Wrap all tools with metrics recording to track:
 * - Tool invocation count
 * - Success/failure rates per tool
 */
const instrumentedIndicatorTools = withToolsMetrics(indicatorTools);
const instrumentedExplainTools = withToolsMetrics(explainTools);
const instrumentedMarketTools = withToolsMetrics(marketTools);
const instrumentedPositionTools = withToolsMetrics(positionTools);
const instrumentedSchedulerTools = withToolsMetrics(schedulerTools);
const instrumentedSystemTools = withToolsMetrics(systemTools);
const instrumentedEarnTools = withToolsMetrics(earnTools);
const instrumentedChartTools = withToolsMetrics(chartTools);
const instrumentedOrderbookTools = withToolsMetrics(orderbookTools);
const instrumentedWalletTools = withToolsMetrics(walletTools);
const instrumentedDiscoveryTools = withToolsMetrics(discoveryTools);
const instrumentedHistoryTools = withToolsMetrics(historyTools);
const instrumentedAccountTools = withToolsMetrics(accountTools);
const instrumentedTradingTools = withToolsMetrics(tradingTools);
const instrumentedMarketAnalysisTools = withToolsMetrics(marketAnalysisTools);
const instrumentedLiquidationIntelligenceTools = withToolsMetrics(liquidationIntelligenceTools);
const instrumentedRiskManagementTools = withToolsMetrics(riskManagementTools);
const instrumentedStrategyTools = withToolsMetrics(strategyTools);
const instrumentedMetricsTools = withToolsMetrics(metricsTools);
const instrumentedCompositionTools = withToolsMetrics(compositionTools);
const instrumentedBacktestTools = withToolsMetrics(backtestTools);
const instrumentedSharedContextTools = withToolsMetrics(sharedContextTools);
const instrumentedParallelAnalysisTools = withToolsMetrics(parallelAnalysisTools);
const instrumentedStrategyGenerationTools = withToolsMetrics(strategyGenerationTools);
const instrumentedMultiModalChartTools = withToolsMetrics(multiModalChartTools);
const instrumentedMarketDataTools = withToolsMetrics(marketDataTools);
const instrumentedPairAnalysisTools = withToolsMetrics(pairAnalysisTools);
const instrumentedAutonomousTools = withToolsMetrics(autonomousTools);
const instrumentedBaseOnchainTools = withToolsMetrics(baseOnchainTools);
const instrumentedAgentKitOnchainTools = withToolsMetrics(agentKitOnchainTools);
const instrumentedAgentKitDefiTools = withToolsMetrics(agentKitDefiTools);
const instrumentedBaseSignalTools = withToolsMetrics(baseSignalTools);
const instrumentedBaseIndexerTools = withToolsMetrics(baseIndexerTools);
const instrumentedEvalTools = withToolsMetrics(evalTools);
const instrumentedPositionTrackingTools = withToolsMetrics(positionTrackingTools);
const instrumentedMemoryTools = withToolsMetrics(memoryTools);
const instrumentedPlaybookTools = withToolsMetrics(playbookTools);
const instrumentedPlaybookBacktestTools = withToolsMetrics(playbookBacktestTools);
const instrumentedCheckRiskTool = withToolsMetrics({ check_risk: checkRiskTool });

// ============================================================================
// Memory Configuration (Required for Agent Networks)
// ============================================================================

/**
 * Working memory template for trading context
 * Maintains persistent state across conversations
 *
 * This template captures:
 * - Trader profile and preferences
 * - Risk management settings
 * - Trading style and timeframes
 * - Account context and defaults
 * - Session state for ongoing analysis
 */
const WORKING_MEMORY_TEMPLATE = `
# Trader Profile

## Personal Info
- Name:
- Timezone:
- Trading Experience Level: (beginner/intermediate/advanced)

## Risk Preferences
- Max Risk Per Trade: (e.g., 2%)
- Max Portfolio Allocation Per Position: (e.g., 10%)
- Preferred Stop Loss Style: (tight/normal/wide)
- Risk Tolerance: (conservative/moderate/aggressive)

## Trading Style
- Preferred Timeframes: (1h/4h/1D)
- Favorite Coins/Tokens:
- Avoided Coins/Tokens:
- Preferred Strategies:
- Trading Hours: (e.g., "9am-5pm EST" or "24/7")

## Account Context
- Default Exchange: (active)
- Account Type: (spot/margin/futures)
- Base Currency: USDT

## Session State
- Current Focus:
- Active Analysis:
- Pending Decisions:
- Recent Wins/Losses:
`;

/**
 * Memory store for conversation persistence, task tracking, and semantic recall
 * Required when using .network() for multi-agent orchestration
 *
 * Features:
 * - LibSQLStore: Persistent storage for conversation history
 * - LibSQLVector: Vector database for semantic search (RAG)
 * - semanticRecall: Find similar past trades and analyses
 * - workingMemory: Maintain trading context across conversations
 * - Configurable lastMessages via _memoryConfig
 */
function createMemory(): Memory {
  const dbUrl = process.env.DATABASE_URL || "file:gordon.db";
  const vectorDbUrl = process.env.VECTOR_DATABASE_URL || "file:gordon-vector.db";

  // Use configured lastMessages or default
  const lastMessages = _memoryConfig.lastMessages;
  console.log(`[Gordon] Creating memory with lastMessages=${lastMessages}`);

  return new Memory({
    storage: new LibSQLStore({
      id: "gordon-memory",
      url: dbUrl,
    }),
    vector: new LibSQLVector({
      id: "gordon-vector",
      url: vectorDbUrl,
    }),
    embedder: "openai/text-embedding-3-small",
    options: {
      lastMessages,
      semanticRecall: {
        topK: 5,
        messageRange: {
          before: 3,
          after: 2,
        },
      },
      workingMemory: {
        enabled: true,
        template: WORKING_MEMORY_TEMPLATE,
      },
      generateTitle: true,
    },
  });
}

/**
 * Lightweight shared memory for sub-agents (Scanner, Analyst, etc.)
 *
 * When Mastra's Agent Network routes to a sub-agent, it passes memory context
 * (threadId, resourceId) which triggers injection of the updateWorkingMemory tool.
 * Without a Memory instance on the sub-agent, this tool crashes.
 *
 * This memory disables workingMemory so the tool is NOT injected (Mastra checks
 * workingMemory.enabled before adding the tool). Sub-agents use our custom
 * shared_context tools for cross-agent communication instead.
 */
let _subAgentMemory: Memory | null = null;

function createSubAgentMemory(): Memory {
  if (!_subAgentMemory) {
    const dbUrl = process.env.DATABASE_URL || "file:gordon.db";
    _subAgentMemory = new Memory({
      storage: new LibSQLStore({
        id: "gordon-sub-memory",
        url: dbUrl,
      }),
      options: {
        lastMessages: 10,
        workingMemory: {
          enabled: false,
        },
      },
    });
  }
  return _subAgentMemory;
}

// ============================================================================
// Instructions (unchanged from OpenAI SDK)
// ============================================================================

const SCANNER_INSTRUCTIONS = `You are Gordon's market scanner agent.

Your role is to scan the cryptocurrency market and identify trading opportunities using multiple strategies.

## Your Capabilities
- Scan the top coins by volume for trading setups
- Analyze individual coins for detailed technical analysis
- Identify coins near support with bullish signals
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
- When scanning for the best opportunities across multiple coins
- When user wants to confirm a single strategy's detection
- For comprehensive market scans (scan_with_ensemble)

## Cross-Agent Context
After every scan, ALWAYS call write_shared_context to store your results:
- contextType: "scanner"
- data: { topOpportunities: [{symbol, confidence, setupType}], marketCondition }
Other agents (Analyst, Planner) cannot see your output directly — they read shared context
to know which coins you found.

## Portfolio-Aware Scanning (Optional Enrichment)
If available, check shared context to make smarter recommendations:
- read_shared_context("monitor") — if the user checked their portfolio, you'll know what they hold and their cash available
- read_shared_context("planner") — avoid recommending coins with active plans
- read_shared_context("backtest") — prioritize strategies that have been validated
These are optional — if no context exists yet, just scan normally.

## Important Rules
- Only present coins with detected setups (setupDetected: true)
- Higher confidence scores (>0.6) indicate stronger setups
- For ensemble: >50% agreement is minimum, >66% is strong
- Always mention the risk level
- If no good setups found, tell the user to wait
- Share your findings via write_shared_context for other agents
- Consider historical strategy performance when making recommendations

## Cross-Pair Analysis
You have tools for analyzing relationships between pairs:
- **analyze_pair_correlation**: Pearson correlation, beta, rolling correlation between two coins
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

## Response Style
- Execute tool calls immediately with default parameters. Do NOT ask clarifying questions about scope, timeframe, or exchanges — just show results.
- If the user wants something different, they will tell you.`;

const ANALYST_INSTRUCTIONS = `You are Gordon's technical analyst agent.

Your role is to provide deep analysis of specific cryptocurrencies.

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
- read_shared_context("monitor") — know if user already holds this coin
- read_shared_context("backtest", symbol) — see if this coin was already backtested

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
- Apply playbook criteria when validating setups`;

const PLANNER_INSTRUCTIONS = `You are Gordon's trading planner agent.

Your role is to create well-structured trading plans based on analysis.

## Your Capabilities
- Create trading plans with entry, stop-loss, and take-profit levels
- Calculate appropriate position sizing based on risk tolerance
- Validate plans against user preferences and portfolio constraints
- Calculate ATR-based stop-loss levels using get_stop_loss_levels
- Calculate optimal position size using get_position_size

## Learning from Past Performance
Use historical performance data to create better plans:
- Use **get_strategy_performance** to check how the planned strategy has performed
- Use **get_risk_reward_analysis** to understand optimal R:R targets
- Use **get_performance_context** to see recent patterns and best setups
- Use **track_recommendation** AFTER creating a plan to enable learning from the outcome
- Adjust position sizing based on strategy's historical win rate

## Cross-Agent Context (Optional Enrichment)
Check shared context when available — each makes your plans better, but none are required to proceed:
- **read_shared_context("monitor")**: Portfolio value, cash available, open positions — improves position sizing
- **read_shared_context("analysis", symbol)**: Analyst's technical analysis — improves entry/exit levels
- **read_shared_context("backtest", symbol)**: Backtester's strategy performance — validates the approach
- **read_shared_context("scanner")**: Scanner's latest opportunities — provides context on market conditions
- **write_shared_context**: Store your plans so Executor and Monitor can reference them

## Recommended Workflow
1. **Check performance context**: get_performance_context to see recent win rate and patterns
2. **Check strategy performance**: get_strategy_performance for the specific strategy
3. **Check cross-agent context**: read_shared_context to see existing analysis/backtests
4. **Use context for decisions**: Base entry/exit levels on Analyst's support/resistance
5. **Create informed plan**: Build plan using all available context
6. **Track for learning**: Use track_recommendation to record the plan for outcome tracking
7. **Share plan**: write_shared_context so Executor knows the plan details

## Strategy Generation Tools
- strategy_generate: Create new AI-generated trading strategies
- strategy_iterate: Refine and improve an existing strategy
- list_generated_strategies: View all generated strategies
- delete_generated_strategy: Remove a generated strategy

## Risk-Based Position Sizing
- calculate_kelly_size: Optimal position size via Kelly criterion
- calculate_volatility_adjusted_size: Position size adjusted for current volatility
- assess_trade_risk: Pre-trade risk assessment

## Important Rules
- Never suggest risking more than user's max allocation
- Always maintain cash reserve
- Risk/reward ratio should be at least 1.2:1
- Explain the reasoning behind each level
- Leverage existing analysis from shared context when available
- When possible, check portfolio context to ensure position sizing accounts for existing exposure

## Position Tracking
When creating a trade plan for an analyzed position:
- Call **report_plan** with positionId, entryPrice, stopLoss, takeProfit, positionSize
- This transitions the position from "analyzed" to "planned"

## Risk Pre-Check
Before finalizing any plan:
- Call **check_risk** to pre-validate the order against the risk kernel
- If risk check returns warnings, mention them in the plan
- If risk check rejects, explain why and suggest adjustments

## Persistent Memory
- **search_memory**: Check past trade outcomes for this strategy/symbol
- **get_lessons**: Review lessons learned before recommending the same approach

## Playbooks
- **get_playbook_for_agent**: Get planner-specific execution rules (entry, stop, target, sizing)
- Apply playbook position sizing and R:R rules to your plans`;

const EXECUTOR_INSTRUCTIONS = `You are Gordon's trade executor agent.

Your role is to safely execute trading plans and orders on the active exchange.

## Safety Protocol
1. NEVER execute unless the system is ARMED
2. ALWAYS confirm the order/plan details before executing
3. ALWAYS wait for explicit user approval
4. If anything seems wrong, STOP and ask the user

## Simple Market Orders
For simple spot conversions, swaps, or purchases (e.g., "buy USDT with 54 USDC", "swap USDC to USDT", "buy $50 of ETH"):
- Use **place_market_order** — it supports both quantity (base asset) and quoteOrderQty (spend amount in quote asset)
- No stop-loss or take-profit needed
- Still requires ARMED mode and user confirmation

## Limit Orders
For orders at a specific price (e.g., "buy BTC at 95000", "set a sell limit at 4000"):
- Use **place_limit_order** — places a GTC limit order on the book
- Supports GTC (Good Til Cancelled), IOC (Immediate or Cancel), FOK (Fill or Kill)
- Requires ARMED mode

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
execute_plan, close_trade, arm_system, approve_plan, list_plans, set_trailing_stop, update_trailing_stop, close_partial_position, place_bracket_order, place_market_order, place_limit_order, place_oco_order, cancel_all_orders, cancel_order, cancel_replace_order, cancel_order_list, get_order_status, read_shared_context, write_shared_context.

## Risk Gate
Before placing any order, the risk kernel validates it:
- Call **check_risk** to verify the order passes all risk checks
- If the check adjusts position size, use the adjusted quantity
- If the check rejects the order, inform the user and do NOT proceed

## Position Tracking
After order execution:
- Use **list_active_positions** to see tracked positions
- Use **get_position_detail** to check a specific position's state`;

const MONITOR_INSTRUCTIONS = `You are Gordon's position monitor agent.

Your role is to watch open positions and keep the user informed.

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
- Periodically update live data on monitoring-state positions`;

const TEACHER_INSTRUCTIONS = `You are Gordon's teacher agent.

Your role is to explain trading concepts in simple, friendly terms.

## Available Tools
- **explain**: Explain any trading concept, indicator, or term
- **strategy_explain**: Explain a specific trading strategy in detail
- **read_shared_context**: Read data from other agents to give contextual explanations

## Contextual Teaching (Optional but Powerful)
When explaining concepts, check if other agents have context you can use for concrete examples:
- read_shared_context("monitor") — use real portfolio/PnL (e.g., "Your ETH position is up 12%, which means...")
- read_shared_context("analysis", symbol) — use actual indicator values (e.g., "Your ETH RSI is at 28, which means...")
- read_shared_context("planner") — use actual plan levels to explain entry/SL/TP concepts
- read_shared_context("backtest") — use actual metrics to explain Sharpe ratio, win rate, etc.
- read_shared_context("scanner") — use actual found coins to explain setups

If context exists, teaching with real numbers is 10x more effective. If no context exists, explain with general examples — that's perfectly fine too.

## Teaching Principles
1. Use simple language - no jargon without explanation
2. Use analogies when helpful
3. Give concrete examples from their ACTUAL trading session when possible
4. Connect concepts to practical trading decisions

## Position Review
After a trade closes, review it for learning:
- **review_position**: Score the trade (1-5) with lessons learned
- **list_active_positions**: See recent positions to review
- **get_position_detail**: Get full trade history for review

## Persistent Memory
- **search_memory**: Find relevant past trades and insights
- **get_lessons**: Pull lessons for a specific symbol
- Use memory to give contextual, experience-based teaching

## Playbooks
- **list_playbooks**: Show available trading strategies
- **get_playbook**: Explain a specific playbook in detail
- Use playbooks as teaching material for trading concepts`;

const BACKTESTER_INSTRUCTIONS = `You are Gordon's backtesting specialist agent.

Your role is to run historical backtests and optimize trading strategies.

## Your Capabilities
- Run backtests on any strategy with historical data
- Calculate comprehensive performance metrics (Sharpe, drawdown, win rate)
- Optimize strategy parameters using grid search
- Compare multiple strategies on the same data
- Analyze backtest results and provide insights
- **Backtest playbooks**: Use backtest_playbook to test a playbook's rules against historical candles
- **Compare playbooks**: Use compare_backtest_results to compare playbook backtests side by side
- **Rank playbooks**: Use get_best_strategy to find the top-performing playbook for a symbol

## Pre-Analysis Capabilities (NEW)
You now have access to analyst tools for comprehensive pre-backtest analysis:
- **get_technical_analysis**: Get current market context before backtesting
- **get_rsi/get_vwap**: Check indicator values for context (get_rsi includes StochRSI, MFI, WaveTrend)
- **analyze_whale_orders**: Check for whale activity that might affect strategy validity
- **get_order_book/get_spread**: Understand liquidity context
- **run_full_analysis**: Get comprehensive analysis combining all signals

## Cross-Agent Context (NEW)
Use shared context tools to collaborate with other agents:
- **read_shared_context**: Check if Analyst already analyzed this coin
- **write_shared_context**: Store your backtest results for Planner to use

## Cross-Agent Context Reading (Optional Enrichment)
Check what other agents have found — use if available, proceed without if not:
- read_shared_context("monitor") — know actual portfolio size for realistic position sizing
- read_shared_context("analysis", symbol) — get Analyst's technical context for the symbol
- read_shared_context("scanner") — see which coins/strategies Scanner recommended
- read_shared_context("planner") — if user says "backtest this plan", read the plan details for strategy/symbol/params

## Recommended Workflow
1. **Check shared context first**: read_shared_context to see if analysis or plan exists
2. **Pre-analyze if needed**: Run get_technical_analysis for current market context
3. **Run backtest**: Execute the strategy backtest with historical data
4. **Contextualize results**: Compare backtest assumptions to current conditions
5. **Share results**: write_shared_context so Planner can use your findings

## When Presenting Results
1. Always show key metrics: Total Return, Sharpe Ratio, Max Drawdown, Win Rate
2. Explain what the metrics mean for the strategy
3. Highlight any concerns (high drawdown, low win rate, few trades)
4. Compare to benchmarks when relevant (buy & hold)
5. Suggest parameter adjustments if metrics are poor
6. **NEW**: Note if current market conditions differ from backtest period

## Important Rules
- Warn if backtest period is too short (< 30 days)
- Note that past performance doesn't guarantee future results
- Mention if there were very few trades (statistically insignificant)
- Be honest about overfitting risks when optimizing
- Check current market context before recommending a strategy from backtest

## Persistent Memory
- **search_memory**: Look up past backtest results and insights
- **get_lessons**: Check historical lessons for the strategy/symbol being tested

## Playbooks
- Use playbooks as strategy definitions for backtesting
- **search_playbooks**: Find playbooks to test
- **get_playbook_for_agent**: Get strategy details in structured form`;

const GORDON_INSTRUCTIONS = `You are Gordon, an AI trading assistant for cryptocurrency.

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

When the user asks for analysis, scanning, planning, backtesting, or execution — immediately transfer to the specialist agent. Do not narrate or describe what you plan to do. Just transfer.

## Safety Rules
1. NEVER execute trades without explicit user approval
2. ALWAYS show plan details before execution
3. In SAFE mode, you can analyze and plan but NOT execute
4. Remind users about risk appropriately

## Key Capabilities Across Agents
- Raw market data (candles, prices, tickers, orderbook) -> Scanner or Analyst
- Charts and visualization -> Analyst
- Whale detection and orderbook analysis -> Analyst
- Cross-pair correlation, spread analysis, relative strength -> Scanner or Analyst
- Trade plans with risk sizing -> Planner
- Strategy generation and backtesting -> Planner and Backtester
- Order execution, simple swaps/conversions, market orders, limit orders, cancel orders, open orders -> Executor (requires ARMED mode)
- Portfolio, positions, earn, wallet, fund transfers, withdrawals -> Monitor
- Educational explanations -> Teacher
- Position lifecycle tracking (setup → analysis → plan → execute → monitor → review) -> tracked automatically across agents
- Risk pre-checks on all orders -> Planner and Executor (automatic)
- Trade memory, lessons learned, market observations -> all agents via persistent memory
- Strategy playbooks (trigger, analysis, execution, management rules) -> Scanner, Analyst, Planner, Teacher

## Autonomous Trading
You have tools for autonomous swing trading mandates:
- **create_swing_mandate**: Set up constraints (symbols, risk limits, timeframe, duration)
- **start_autonomous_mode**: Start the scanning loop (requires ARMED)
- **stop_autonomous_mode** / **pause_autonomous_mode** / **resume_autonomous_mode**: Control the loop
- **get_autonomous_status**: Check current mandate and cycle progress
Use when user says "trade autonomously", "set up a mandate", "auto-trade for the next 24 hours".

When a user asks for market data, prices, candles, or orderbook info, route to Scanner or Analyst. Never generate code or scripts -- all data is available through native tools.`;

// ============================================================================
// Lazy Agent Initialization
// ============================================================================

/**
 * Cache for lazily initialized agents
 * Agents are created on first access to ensure environment is loaded
 */
let _agents: {
  scanner?: Agent;
  analyst?: Agent;
  planner?: Agent;
  executor?: Agent;
  monitor?: Agent;
  teacher?: Agent;
  backtester?: Agent;
  gordon?: Agent;
} = {};

/**
 * Get or create the Scanner Agent
 */
function getScannerAgent(): Agent {
  if (!_agents.scanner) {
    _agents.scanner = new Agent({
      id: "scanner",
      name: "Scanner",
      description:
        "Specialist in scanning the market and finding trading opportunities. " +
        "Use when the user wants to find coins to trade, asks 'what should I buy?', " +
        "needs market overview, wants to discover new coins, or asks about strategies.",
      instructions: SCANNER_INSTRUCTIONS,
      model: getModel(process.env.GORDON_PROVIDER, process.env.GORDON_MODEL),
      tools: {
        ...instrumentedIndicatorTools,
        ...instrumentedMarketDataTools,  // Raw market data: candles, prices, tickers, book tickers
        // Coin discovery tools (excluding place_bracket_order which belongs on Executor)
        get_trending_tokens: instrumentedDiscoveryTools.get_trending_tokens,
        get_high_volume_tokens: instrumentedDiscoveryTools.get_high_volume_tokens,
        get_available_markets: instrumentedDiscoveryTools.get_available_markets,
        ...instrumentedStrategyTools,   // Strategy library tools
        ...instrumentedParallelAnalysisTools,  // Parallel execution tools
        scan_market: instrumentedMarketTools.scan_market,
        analyze_coin: instrumentedMarketTools.analyze_coin,
        get_historical_opportunities: instrumentedMarketTools.get_historical_opportunities,
        // Orderbook tools for combining scanning with orderbook analysis
        get_order_book: instrumentedOrderbookTools.get_order_book,
        get_spread: instrumentedOrderbookTools.get_spread,
        // Liquidation intelligence tools (cascade risk, squeeze detection)
        ...instrumentedLiquidationIntelligenceTools,
        // Cross-pair analysis tools
        ...instrumentedPairAnalysisTools,
        // Shared context for cross-agent memory
        ...instrumentedSharedContextTools,
        // Performance evaluation tools for learning from trade outcomes
        get_strategy_performance: instrumentedEvalTools.get_strategy_performance,
        get_performance_context: instrumentedEvalTools.get_performance_context,
        get_all_strategy_performances: instrumentedEvalTools.get_all_strategy_performances,
        // Base L2 onchain discovery tools
        get_base_trending: instrumentedBaseOnchainTools.get_base_trending,
        get_base_featured: instrumentedBaseOnchainTools.get_base_featured,
        get_base_info: instrumentedBaseOnchainTools.get_base_info,
        // Base L2 on-chain signal tools (whale detection, DEX data, new tokens)
        scan_base_whale_transfers: instrumentedBaseSignalTools.scan_base_whale_transfers,
        get_base_dex_pairs: instrumentedBaseSignalTools.get_base_dex_pairs,
        scan_base_volume_spikes: instrumentedBaseSignalTools.scan_base_volume_spikes,
        scan_base_new_tokens: instrumentedBaseSignalTools.scan_base_new_tokens,
        // DeFiLlama protocol discovery (search for DeFi protocols by name)
        defillama_search_protocols: instrumentedAgentKitDefiTools.defillama_search_protocols,
        // Base L2 DEX indexer tools (The Graph — top pools, Aerodrome)
        indexer_top_pools: instrumentedBaseIndexerTools.indexer_top_pools,
        indexer_aerodrome_pools: instrumentedBaseIndexerTools.indexer_aerodrome_pools,
        // Position tracking (report setups) (v0.7)
        report_setup: instrumentedPositionTrackingTools.report_setup,
        // Memory tools (v0.7)
        ...instrumentedMemoryTools,
        // Playbook tools (v0.7)
        ...instrumentedPlaybookTools,
      },
      memory: createSubAgentMemory(),
      inputProcessors: [new TokenLimiterProcessor({ limit: 32000 })],
    });
  }
  return _agents.scanner;
}

/**
 * Get or create the Analyst Agent
 */
function getAnalystAgent(): Agent {
  if (!_agents.analyst) {
    _agents.analyst = new Agent({
      id: "analyst",
      name: "Analyst",
      description:
        "Specialist in deep coin analysis and technical indicators. " +
        "Use when user asks about a specific coin, wants detailed analysis, " +
        "needs to understand support/resistance levels, wants whale analysis, " +
        "breakout detection, or order book depth analysis.",
      instructions: ANALYST_INSTRUCTIONS,
      model: getModel(process.env.GORDON_PROVIDER, process.env.GORDON_MODEL),
      tools: {
        ...instrumentedIndicatorTools,
        ...instrumentedMarketDataTools,        // Raw market data: candles, prices, tickers, book tickers
        ...instrumentedChartTools,
        // Order book read-only tools (mutation tools like place_oco_order stay on Executor)
        get_order_book: instrumentedOrderbookTools.get_order_book,
        get_spread: instrumentedOrderbookTools.get_spread,
        get_market_trades: instrumentedOrderbookTools.get_market_trades,
        get_order_status: instrumentedOrderbookTools.get_order_status,
        test_order: instrumentedOrderbookTools.test_order,
        ...instrumentedMarketAnalysisTools,    // Whale detection, breakouts, consolidation, scoring
        ...instrumentedCompositionTools,       // Full analysis composition tool
        ...instrumentedParallelAnalysisTools,  // Parallel deep analysis tools
        ...instrumentedMultiModalChartTools,   // Advanced chart generation and vision analysis
        // Liquidation intelligence tools (cascade risk, squeeze detection)
        ...instrumentedLiquidationIntelligenceTools,
        // Cross-pair analysis tools (correlation, spread, performance comparison)
        ...instrumentedPairAnalysisTools,
        analyze_coin: instrumentedMarketTools.analyze_coin,
        // Base L2 onchain tools (gas, balances for onchain analysis)
        get_base_gas: instrumentedBaseOnchainTools.get_base_gas,
        get_base_balance: instrumentedBaseOnchainTools.get_base_balance,
        // AgentKit DEX price quote (read-only, for onchain price discovery)
        agentkit_get_swap_price: instrumentedAgentKitOnchainTools.agentkit_get_swap_price,
        // Pyth oracle price feeds (decentralized real-time prices)
        pyth_get_price_feed: instrumentedAgentKitDefiTools.pyth_get_price_feed,
        pyth_fetch_price: instrumentedAgentKitDefiTools.pyth_fetch_price,
        // DeFiLlama protocol analysis and token prices
        defillama_get_protocol: instrumentedAgentKitDefiTools.defillama_get_protocol,
        defillama_get_token_prices: instrumentedAgentKitDefiTools.defillama_get_token_prices,
        // Base L2 DEX indexer tool (The Graph — detailed pool stats)
        indexer_pool_stats: instrumentedBaseIndexerTools.indexer_pool_stats,
        // Base L2 on-chain analysis tools (wallet tracking, holders, DEX pairs)
        track_base_wallet: instrumentedBaseSignalTools.track_base_wallet,
        get_base_token_holders: instrumentedBaseSignalTools.get_base_token_holders,
        get_base_dex_pairs: instrumentedBaseSignalTools.get_base_dex_pairs,
        // Shared context for cross-agent memory
        ...instrumentedSharedContextTools,
        // Performance evaluation tools for learning from trade outcomes
        get_performance_context: instrumentedEvalTools.get_performance_context,
        get_market_condition_performance: instrumentedEvalTools.get_market_condition_performance,
        get_learning_insights: instrumentedEvalTools.get_learning_insights,
        // Position tracking (report analysis) (v0.7)
        report_analysis: instrumentedPositionTrackingTools.report_analysis,
        // Memory tools (v0.7)
        ...instrumentedMemoryTools,
        // Playbook tools (v0.7)
        ...instrumentedPlaybookTools,
      },
      memory: createSubAgentMemory(),
      inputProcessors: [new TokenLimiterProcessor({ limit: 32000 })],
    });
  }
  return _agents.analyst;
}

/**
 * Get or create the Planner Agent
 */
function getPlannerAgent(): Agent {
  if (!_agents.planner) {
    _agents.planner = new Agent({
      id: "planner",
      name: "Planner",
      description:
        "Specialist in creating trading plans with entry, stop-loss, and take-profit levels. " +
        "Use when user wants to create a trade plan, buy a coin, needs help with position sizing, " +
        "Kelly criterion calculations, or pre-trade risk assessment.",
      instructions: PLANNER_INSTRUCTIONS,
      model: getModel(process.env.GORDON_PROVIDER, process.env.GORDON_MODEL),
      tools: {
        ...instrumentedIndicatorTools,
        ...instrumentedStrategyTools,  // Strategy library tools for plan creation
        create_plan: instrumentedTradingTools.create_plan,
        create_grid_plan: instrumentedTradingTools.create_grid_plan,
        list_plans: instrumentedTradingTools.list_plans,
        // Strategy generation tools for AI-powered strategy creation
        strategy_generate: instrumentedStrategyGenerationTools.strategy_generate,
        strategy_iterate: instrumentedStrategyGenerationTools.strategy_iterate,
        list_generated_strategies: instrumentedStrategyGenerationTools.list_generated_strategies,
        delete_generated_strategy: instrumentedStrategyGenerationTools.delete_generated_strategy,
        // Risk-based position sizing tools
        calculate_kelly_size: instrumentedRiskManagementTools.calculate_kelly_size,
        calculate_volatility_adjusted_size: instrumentedRiskManagementTools.calculate_volatility_adjusted_size,
        assess_trade_risk: instrumentedRiskManagementTools.assess_trade_risk,
        // Shared context for cross-agent memory
        ...instrumentedSharedContextTools,
        // Performance evaluation tools for learning from trade outcomes
        get_strategy_performance: instrumentedEvalTools.get_strategy_performance,
        get_performance_context: instrumentedEvalTools.get_performance_context,
        get_risk_reward_analysis: instrumentedEvalTools.get_risk_reward_analysis,
        track_recommendation: instrumentedEvalTools.track_recommendation,
        // Position tracking (report plan) (v0.7)
        report_plan: instrumentedPositionTrackingTools.report_plan,
        // Risk pre-check (v0.7)
        ...instrumentedCheckRiskTool,
        // Memory tools (v0.7)
        ...instrumentedMemoryTools,
        // Playbook tools (v0.7)
        ...instrumentedPlaybookTools,
      },
      memory: createSubAgentMemory(),
      inputProcessors: [new TokenLimiterProcessor({ limit: 32000 })],
    });
  }
  return _agents.planner;
}

/**
 * Get or create the Executor Agent
 */
function getExecutorAgent(): Agent {
  if (!_agents.executor) {
    _agents.executor = new Agent({
      id: "executor",
      name: "Executor",
      description:
        "Specialist in executing trades, placing orders, and managing positions. " +
        "Use when user wants to execute a plan, place a market or limit order, " +
        "swap/convert coins, buy or sell spot, cancel an order, or arm the system.",
      instructions: EXECUTOR_INSTRUCTIONS,
      model: getModel(process.env.GORDON_PROVIDER, process.env.GORDON_MODEL),
      tools: {
        execute_plan: instrumentedTradingTools.execute_plan,
        close_trade: instrumentedTradingTools.close_trade,
        arm_system: instrumentedTradingTools.arm_system,
        list_plans: instrumentedTradingTools.list_plans,
        approve_plan: instrumentedTradingTools.approve_plan,
        // Trailing stop and partial close tools
        set_trailing_stop: instrumentedTradingTools.set_trailing_stop,
        update_trailing_stop: instrumentedTradingTools.update_trailing_stop,
        close_partial_position: instrumentedTradingTools.close_partial_position,
        // Bracket, market, limit, and OCO order tools
        place_bracket_order: instrumentedDiscoveryTools.place_bracket_order,
        place_market_order: instrumentedDiscoveryTools.place_market_order,
        place_limit_order: instrumentedOrderbookTools.place_limit_order,
        place_oco_order: instrumentedOrderbookTools.place_oco_order,
        cancel_all_orders: instrumentedOrderbookTools.cancel_all_orders,
        cancel_order: instrumentedOrderbookTools.cancel_order,
        // Order management tools
        cancel_replace_order: instrumentedOrderbookTools.cancel_replace_order,
        cancel_order_list: instrumentedOrderbookTools.cancel_order_list,
        // Order status and validation tools
        get_order_status: instrumentedOrderbookTools.get_order_status,
        test_order: instrumentedOrderbookTools.test_order,
        // AgentKit onchain execution tools (Base L2 transfers, wraps, faucet)
        agentkit_native_transfer: instrumentedAgentKitOnchainTools.agentkit_native_transfer,
        agentkit_erc20_transfer: instrumentedAgentKitOnchainTools.agentkit_erc20_transfer,
        agentkit_wrap_eth: instrumentedAgentKitOnchainTools.agentkit_wrap_eth,
        agentkit_request_faucet: instrumentedAgentKitOnchainTools.agentkit_request_faucet,
        // AgentKit DEX swap tools (Base L2 — 0x aggregation across Uniswap, Aerodrome, etc.)
        agentkit_swap: instrumentedAgentKitOnchainTools.agentkit_swap,
        agentkit_get_swap_price: instrumentedAgentKitOnchainTools.agentkit_get_swap_price,
        // Moonwell lending tools (deposit/withdraw on Base L2)
        moonwell_deposit: instrumentedAgentKitDefiTools.moonwell_deposit,
        moonwell_withdraw: instrumentedAgentKitDefiTools.moonwell_withdraw,
        // Basenames registration (.base domain names)
        basenames_register: instrumentedAgentKitDefiTools.basenames_register,
        // Shared context for reading plan details and analysis before execution
        ...instrumentedSharedContextTools,
        // Risk pre-check (v0.7)
        ...instrumentedCheckRiskTool,
        // Position tracking (ordering, filled, closed) (v0.7)
        list_active_positions: instrumentedPositionTrackingTools.list_active_positions,
        get_position_detail: instrumentedPositionTrackingTools.get_position_detail,
        // Memory tools (search only) (v0.7)
        search_memory: instrumentedMemoryTools.search_memory,
      },
      memory: createSubAgentMemory(),
      inputProcessors: [new TokenLimiterProcessor({ limit: 32000 })],
    });
  }
  return _agents.executor;
}

/**
 * Get or create the Monitor Agent
 */
function getMonitorAgent(): Agent {
  if (!_agents.monitor) {
    _agents.monitor = new Agent({
      id: "monitor",
      name: "Monitor",
      description:
        "Specialist in monitoring open positions, portfolio health, and wallet management. " +
        "Use when user asks about their trades, positions, portfolio status, wallet balances, " +
        "open orders, order history, earn positions, trade history, account snapshots, " +
        "exit conditions, drawdown status, " +
        "or wants to transfer funds between wallets (spot, funding, futures, margin).",
      instructions: MONITOR_INSTRUCTIONS,
      model: getModel(process.env.GORDON_PROVIDER, process.env.GORDON_MODEL),
      tools: {
        check_positions: instrumentedPositionTools.check_positions,
        ...instrumentedAccountTools,
        ...instrumentedWalletTools,    // Wallet management, transfers, user assets, wallet balances, dust log
        ...instrumentedEarnTools,      // Staking/savings positions and earn history
        ...instrumentedHistoryTools,   // Trade and transfer history
        get_order_history: instrumentedOrderbookTools.get_order_history,  // Order history (placed/cancelled/expired)
        get_open_orders: instrumentedOrderbookTools.get_open_orders,    // Open/pending orders
        get_open_order_lists: instrumentedOrderbookTools.get_open_order_lists,  // Open OCO/OTO lists
        ...instrumentedMetricsTools,   // Performance metrics and statistics
        // Risk monitoring tools
        check_exit_conditions: instrumentedRiskManagementTools.check_exit_conditions,
        check_drawdown_status: instrumentedRiskManagementTools.check_drawdown_status,
        check_daily_limit: instrumentedRiskManagementTools.check_daily_limit,
        // Autonomous mode status
        get_autonomous_status: instrumentedAutonomousTools.get_autonomous_status,
        // AgentKit onchain wallet tools (Base L2 wallet info, balances)
        agentkit_get_wallet: instrumentedAgentKitOnchainTools.agentkit_get_wallet,
        agentkit_get_balance: instrumentedAgentKitOnchainTools.agentkit_get_balance,
        agentkit_erc20_balance: instrumentedAgentKitOnchainTools.agentkit_erc20_balance,
        // Shared context for cross-agent memory
        ...instrumentedSharedContextTools,
        // Performance evaluation tools for recording trade outcomes
        record_trade_outcome: instrumentedEvalTools.record_trade_outcome,
        get_performance_report: instrumentedEvalTools.get_performance_report,
        process_unrecorded_trades: instrumentedEvalTools.process_unrecorded_trades,
        get_win_rate_analysis: instrumentedEvalTools.get_win_rate_analysis,
        // Position tracking (monitoring, live updates) (v0.7)
        list_active_positions: instrumentedPositionTrackingTools.list_active_positions,
        get_position_detail: instrumentedPositionTrackingTools.get_position_detail,
        update_position_live: instrumentedPositionTrackingTools.update_position_live,
        // Memory tools (v0.7)
        ...instrumentedMemoryTools,
      },
      memory: createSubAgentMemory(),
      inputProcessors: [new TokenLimiterProcessor({ limit: 32000 })],
    });
  }
  return _agents.monitor;
}

/**
 * Get or create the Teacher Agent
 */
function getTeacherAgent(): Agent {
  if (!_agents.teacher) {
    _agents.teacher = new Agent({
      id: "teacher",
      name: "Teacher",
      description:
        "Specialist in explaining trading concepts in simple terms. " +
        "Use when user asks 'what is X?', needs help understanding something, " +
        "or is confused about trading terms.",
      instructions: TEACHER_INSTRUCTIONS,
      model: getModel(process.env.GORDON_PROVIDER, process.env.GORDON_MODEL),
      tools: {
        explain: instrumentedExplainTools.explain,
        strategy_explain: instrumentedStrategyGenerationTools.strategy_explain,
        // Shared context so Teacher can explain using real data from any agent
        ...instrumentedSharedContextTools,
        // Position tracking (review) (v0.7)
        review_position: instrumentedPositionTrackingTools.review_position,
        list_active_positions: instrumentedPositionTrackingTools.list_active_positions,
        get_position_detail: instrumentedPositionTrackingTools.get_position_detail,
        // Memory tools (v0.7)
        ...instrumentedMemoryTools,
        // Playbook tools (v0.7)
        ...instrumentedPlaybookTools,
      },
      memory: createSubAgentMemory(),
      inputProcessors: [new TokenLimiterProcessor({ limit: 32000 })],
    });
  }
  return _agents.teacher;
}

/**
 * Get or create the Backtester Agent
 *
 * Enhanced with analyst tools for pre-analysis capabilities:
 * - Can analyze current market conditions before backtesting
 * - Access to technical indicators for context
 * - Shared context for cross-agent collaboration
 */
function getBacktesterAgent(): Agent {
  if (!_agents.backtester) {
    _agents.backtester = new Agent({
      id: "backtester",
      name: "Backtester",
      description:
        "Specialist in backtesting strategies and parameter optimization. " +
        "Use when user asks to backtest, test a strategy historically, optimize parameters, " +
        "or compare strategy performance.",
      instructions: BACKTESTER_INSTRUCTIONS,
      model: getModel(process.env.GORDON_PROVIDER, process.env.GORDON_MODEL),
      tools: {
        // Core backtesting tools
        ...instrumentedBacktestTools,
        ...instrumentedStrategyTools,  // For listing strategies

        // Analyst tools for pre-analysis (Improvement #3)
        ...instrumentedIndicatorTools,           // RSI, MACD, Bollinger, etc.
        ...instrumentedMarketAnalysisTools,      // Whale detection, breakouts, scoring
        // Order book read-only tools (mutation tools stay on Executor)
        get_order_book: instrumentedOrderbookTools.get_order_book,
        get_spread: instrumentedOrderbookTools.get_spread,
        get_market_trades: instrumentedOrderbookTools.get_market_trades,
        ...instrumentedCompositionTools,         // run_full_analysis for comprehensive context
        analyze_coin: instrumentedMarketTools.analyze_coin,

        // Shared context tools for cross-agent memory (Improvement #2)
        ...instrumentedSharedContextTools,
        // Memory tools (search for past results) (v0.7)
        search_memory: instrumentedMemoryTools.search_memory,
        get_lessons: instrumentedMemoryTools.get_lessons,
        // Playbook tools (v0.7)
        ...instrumentedPlaybookTools,
        // Playbook backtest tools (v0.7) — run/compare/rank playbook backtests
        ...instrumentedPlaybookBacktestTools,
      },
      memory: createSubAgentMemory(),
      inputProcessors: [new TokenLimiterProcessor({ limit: 32000 })],
    });
  }
  return _agents.backtester;
}

/**
 * Get or create the main Gordon Agent
 */
function getGordonAgent(): Agent {
  if (!_agents.gordon) {
    const model = getModel(process.env.GORDON_PROVIDER, process.env.GORDON_MODEL);
    console.log(`[Gordon] Initializing agent with model: ${model}`);

    _agents.gordon = new Agent({
      id: "gordon",
      name: "Gordon",
      description: "Main AI trading assistant for cryptocurrency. Coordinates specialized agents.",
      instructions: GORDON_INSTRUCTIONS,
      model,

      // Sub-agents for network routing (replaces handoffs)
      agents: {
        scanner: getScannerAgent(),
        analyst: getAnalystAgent(),
        planner: getPlannerAgent(),
        executor: getExecutorAgent(),
        monitor: getMonitorAgent(),
        teacher: getTeacherAgent(),
        backtester: getBacktesterAgent(),
      },

      // Gordon only has essential routing/system tools + MCP plugin tools
      // Specialized tools are delegated to sub-agents to avoid confusion
      // This improves tool selection accuracy by keeping Gordon focused on orchestration
      // MCP tools from installed plugins are included here for direct access
      tools: {
        ...instrumentedSystemTools,       // arm/disarm system control
        ...instrumentedSchedulerTools,    // task scheduling (cross-cutting concern)
        ...instrumentedAutonomousTools,   // autonomous swing trading control
        ...getMCPTools(),                 // MCP plugin tools (if any installed/enabled)
      },

      // Memory for network orchestration
      memory: createMemory(),

      // Token limiter to prevent context window overflow in long sessions
      // Gordon (routing agent) needs high limit: system prompt + 7 transfer tools + system/scheduler tools + Mastra routing prompt
      inputProcessors: [new TokenLimiterProcessor({ limit: 64000 })],
    });
  }
  return _agents.gordon;
}

// ============================================================================
// Exported Agent Accessors
// ============================================================================

/**
 * Lazy-loaded agents - accessed via getters to ensure env is loaded first
 */
export const scannerAgent = { get agent() { return getScannerAgent(); } };
export const analystAgent = { get agent() { return getAnalystAgent(); } };
export const plannerAgent = { get agent() { return getPlannerAgent(); } };
export const executorAgent = { get agent() { return getExecutorAgent(); } };
export const monitorAgent = { get agent() { return getMonitorAgent(); } };
export const teacherAgent = { get agent() { return getTeacherAgent(); } };
export const backtesterAgent = { get agent() { return getBacktesterAgent(); } };

/**
 * Main Gordon agent - use this for all interactions
 */
export const gordonAgent = getGordonAgent;

/**
 * Get all agents (lazily initialized)
 */
export function getAllAgents() {
  return {
    gordon: getGordonAgent(),
    scanner: getScannerAgent(),
    analyst: getAnalystAgent(),
    planner: getPlannerAgent(),
    executor: getExecutorAgent(),
    monitor: getMonitorAgent(),
    teacher: getTeacherAgent(),
    backtester: getBacktesterAgent(),
  };
}

/**
 * Reset agent cache (useful for testing or reinitializing)
 */
export function resetAgents(): void {
  _agents = {};
  _subAgentMemory = null;
}
