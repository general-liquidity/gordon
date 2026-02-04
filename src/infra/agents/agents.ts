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
  metricsTools,
  compositionTools,
  backtestTools,
  sharedContextTools,
  parallelAnalysisTools,
  withToolsMetrics,
} from "./tools/index.ts";
import { getSessionSummary, getMemoryStats, resetSharedMemory } from "./shared-context.ts";
import { evalTools } from "../evals/index.ts";
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
const instrumentedRiskManagementTools = withToolsMetrics(riskManagementTools);
const instrumentedStrategyTools = withToolsMetrics(strategyTools);
const instrumentedMetricsTools = withToolsMetrics(metricsTools);
const instrumentedCompositionTools = withToolsMetrics(compositionTools);
const instrumentedBacktestTools = withToolsMetrics(backtestTools);
const instrumentedSharedContextTools = withToolsMetrics(sharedContextTools);
const instrumentedParallelAnalysisTools = withToolsMetrics(parallelAnalysisTools);
const instrumentedEvalTools = withToolsMetrics(evalTools);

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
After scanning, use write_shared_context to store findings:
- contextType: "scanner"
- data: { topOpportunities, marketCondition, ensembleResults }

This allows Analyst and Planner to know what opportunities you found.

## Important Rules
- Only present coins with detected setups (setupDetected: true)
- Higher confidence scores (>0.6) indicate stronger setups
- For ensemble: >50% agreement is minimum, >66% is strong
- Always mention the risk level
- If no good setups found, tell the user to wait
- Share your findings via write_shared_context for other agents
- Consider historical strategy performance when making recommendations`;

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
- Stochastic RSI for precise entry/exit timing using get_stochastic_rsi
- **Comprehensive analysis** combining signals, RSI, whale orders, and orderbook using run_full_analysis

## Learning from Past Performance
Your analysis should be informed by historical trade outcomes:
- Use **get_performance_context** to understand recent performance patterns
- Use **get_market_condition_performance** to see which market conditions favor our trading
- Adjust confidence levels based on historical accuracy in similar conditions
- Note if current market condition historically produces better or worse results

## Cross-Agent Context
Use shared context tools to collaborate with other agents:
- **read_shared_context**: Check if Scanner already found opportunities
- **write_shared_context**: Store your analysis for Planner/Backtester to use

After completing a significant analysis, always call write_shared_context with:
- contextType: "analysis"
- symbol: the analyzed symbol
- data: { overallBias, confidence, technicalSignals, supportResistance }

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
- Consider historical performance when assessing confidence levels`;

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

## Cross-Agent Context
Use shared context tools to leverage work from other agents:
- **read_shared_context("analysis", symbol)**: Get Analyst's technical analysis
- **read_shared_context("backtest", symbol)**: Get Backtester's strategy performance
- **read_shared_context("scanner")**: See Scanner's latest opportunities
- **write_shared_context**: Store your plans for Executor to reference

## Recommended Workflow
1. **Check performance context**: get_performance_context to see recent win rate and patterns
2. **Check strategy performance**: get_strategy_performance for the specific strategy
3. **Check cross-agent context**: read_shared_context to see existing analysis/backtests
4. **Use context for decisions**: Base entry/exit levels on Analyst's support/resistance
5. **Create informed plan**: Build plan using all available context
6. **Track for learning**: Use track_recommendation to record the plan for outcome tracking
7. **Share plan**: write_shared_context so Executor knows the plan details

## Important Rules
- Never suggest risking more than user's max allocation
- Always maintain cash reserve
- Risk/reward ratio should be at least 1.2:1
- Explain the reasoning behind each level
- Leverage existing analysis from shared context when available`;

const EXECUTOR_INSTRUCTIONS = `You are Gordon's trade executor agent.

Your role is to safely execute trading plans on the active exchange.

## Safety Protocol
1. NEVER execute unless the system is ARMED
2. ALWAYS confirm the plan details before executing
3. ALWAYS wait for explicit user approval
4. If anything seems wrong, STOP and ask the user`;

const MONITOR_INSTRUCTIONS = `You are Gordon's position monitor agent.

Your role is to watch open positions and keep the user informed.

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
- Mention any patterns identified from the trade history`;

const TEACHER_INSTRUCTIONS = `You are Gordon's teacher agent.

Your role is to explain trading concepts in simple, friendly terms.

## Teaching Principles
1. Use simple language - no jargon without explanation
2. Use analogies when helpful
3. Give concrete examples
4. Connect concepts to practical trading decisions`;

const BACKTESTER_INSTRUCTIONS = `You are Gordon's backtesting specialist agent.

Your role is to run historical backtests and optimize trading strategies.

## Your Capabilities
- Run backtests on any strategy with historical data
- Calculate comprehensive performance metrics (Sharpe, drawdown, win rate)
- Optimize strategy parameters using grid search
- Compare multiple strategies on the same data
- Analyze backtest results and provide insights

## Pre-Analysis Capabilities (NEW)
You now have access to analyst tools for comprehensive pre-backtest analysis:
- **get_technical_analysis**: Get current market context before backtesting
- **get_rsi/get_vwap/get_stochastic_rsi**: Check indicator values for context
- **detect_whales**: Check for whale activity that might affect strategy validity
- **get_orderbook_depth/get_orderbook_imbalance**: Understand liquidity context
- **run_full_analysis**: Get comprehensive analysis combining all signals

## Cross-Agent Context (NEW)
Use shared context tools to collaborate with other agents:
- **read_shared_context**: Check if Analyst already analyzed this coin
- **write_shared_context**: Store your backtest results for Planner to use

## Recommended Workflow
1. **Check shared context first**: read_shared_context to see if analysis exists
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
- Check current market context before recommending a strategy from backtest`;

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

The network will automatically route to the appropriate agent based on the user's request.

## Safety Rules
1. NEVER execute trades without explicit user approval
2. ALWAYS show plan details before execution
3. In SAFE mode, you can analyze and plan but NOT execute
4. Remind users about risk appropriately`;

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
        ...instrumentedDiscoveryTools,  // Coin discovery tools
        ...instrumentedStrategyTools,   // Strategy library tools
        ...instrumentedParallelAnalysisTools,  // Parallel execution tools
        scan_market: instrumentedMarketTools.scan_market,
        analyze_coin: instrumentedMarketTools.analyze_coin,
        // Shared context for cross-agent memory
        ...instrumentedSharedContextTools,
        // Performance evaluation tools for learning from trade outcomes
        get_strategy_performance: instrumentedEvalTools.get_strategy_performance,
        get_performance_context: instrumentedEvalTools.get_performance_context,
        get_all_strategy_performances: instrumentedEvalTools.get_all_strategy_performances,
      },
      // Token limiter to prevent context window overflow in long sessions
      inputProcessors: [new TokenLimiterProcessor({ limit: 8000 })],
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
        ...instrumentedChartTools,
        ...instrumentedOrderbookTools,         // Order book depth and liquidity analysis
        ...instrumentedMarketAnalysisTools,    // Whale detection, breakouts, consolidation, scoring
        ...instrumentedCompositionTools,       // Full analysis composition tool
        ...instrumentedParallelAnalysisTools,  // Parallel deep analysis tools
        analyze_coin: instrumentedMarketTools.analyze_coin,
        // Shared context for cross-agent memory
        ...instrumentedSharedContextTools,
        // Performance evaluation tools for learning from trade outcomes
        get_performance_context: instrumentedEvalTools.get_performance_context,
        get_market_condition_performance: instrumentedEvalTools.get_market_condition_performance,
        get_learning_insights: instrumentedEvalTools.get_learning_insights,
      },
      // Token limiter to prevent context window overflow in long sessions
      inputProcessors: [new TokenLimiterProcessor({ limit: 8000 })],
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
      },
      // Token limiter to prevent context window overflow in long sessions
      inputProcessors: [new TokenLimiterProcessor({ limit: 8000 })],
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
        "Specialist in executing trading plans and managing orders. " +
        "Use when user wants to execute an approved plan or needs to arm the system.",
      instructions: EXECUTOR_INSTRUCTIONS,
      model: getModel(process.env.GORDON_PROVIDER, process.env.GORDON_MODEL),
      tools: {
        execute_plan: instrumentedTradingTools.execute_plan,
        close_trade: instrumentedTradingTools.close_trade,
        arm_system: instrumentedTradingTools.arm_system,
        list_plans: instrumentedTradingTools.list_plans,
        approve_plan: instrumentedTradingTools.approve_plan,
      },
      // Token limiter to prevent context window overflow in long sessions
      inputProcessors: [new TokenLimiterProcessor({ limit: 8000 })],
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
        "Specialist in monitoring open positions, portfolio health, and detecting issues. " +
        "Use when user asks about their trades, positions, portfolio status, wallet balances, " +
        "earn positions, trade history, exit conditions, or drawdown status.",
      instructions: MONITOR_INSTRUCTIONS,
      model: getModel(process.env.GORDON_PROVIDER, process.env.GORDON_MODEL),
      tools: {
        check_positions: instrumentedPositionTools.check_positions,
        ...instrumentedAccountTools,
        ...instrumentedWalletTools,    // Wallet management and transfers
        ...instrumentedEarnTools,      // Staking/savings positions
        ...instrumentedHistoryTools,   // Trade and transfer history
        ...instrumentedMetricsTools,   // Performance metrics and statistics
        // Risk monitoring tools
        check_exit_conditions: instrumentedRiskManagementTools.check_exit_conditions,
        check_drawdown_status: instrumentedRiskManagementTools.check_drawdown_status,
        check_daily_limit: instrumentedRiskManagementTools.check_daily_limit,
        // Shared context for cross-agent memory
        ...instrumentedSharedContextTools,
        // Performance evaluation tools for recording trade outcomes
        record_trade_outcome: instrumentedEvalTools.record_trade_outcome,
        get_performance_report: instrumentedEvalTools.get_performance_report,
        process_unrecorded_trades: instrumentedEvalTools.process_unrecorded_trades,
      },
      // Token limiter to prevent context window overflow in long sessions
      inputProcessors: [new TokenLimiterProcessor({ limit: 8000 })],
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
      },
      // Token limiter to prevent context window overflow in long sessions
      inputProcessors: [new TokenLimiterProcessor({ limit: 8000 })],
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
        ...instrumentedOrderbookTools,           // Orderbook depth and imbalance
        ...instrumentedCompositionTools,         // run_full_analysis for comprehensive context
        analyze_coin: instrumentedMarketTools.analyze_coin,

        // Shared context tools for cross-agent memory (Improvement #2)
        ...instrumentedSharedContextTools,
      },
      // Token limiter to prevent context window overflow in long sessions
      inputProcessors: [new TokenLimiterProcessor({ limit: 8000 })],
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

      // Gordon only has essential routing/system tools
      // Specialized tools are delegated to sub-agents to avoid confusion
      // This improves tool selection accuracy by keeping Gordon focused on orchestration
      tools: {
        ...instrumentedSystemTools,       // arm/disarm system control
        ...instrumentedSchedulerTools,    // task scheduling (cross-cutting concern)
      },

      // Memory for network orchestration
      memory: createMemory(),

      // Token limiter to prevent context window overflow in long sessions
      inputProcessors: [new TokenLimiterProcessor({ limit: 8000 })],
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
}
