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
 */

import { Agent } from "@mastra/core/agent";
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
  withToolsMetrics,
} from "./tools/index.ts";

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

// ============================================================================
// Memory Configuration (Required for Agent Networks)
// ============================================================================

/**
 * Working memory template for trading context
 * Maintains persistent state across conversations
 */
const WORKING_MEMORY_TEMPLATE = `
# Trading Context

## Portfolio State
- Total Value: <unknown>
- Available Cash: <unknown>
- Open Positions: <none>

## Recent Activity
- Last Trade: <none>
- Last Analysis: <none>
- Active Plans: <none>

## User Preferences
- Risk Tolerance: <unknown>
- Max Position Size: <unknown>
- Preferred Strategies: <unknown>

## Market Context
- Current Watchlist: <none>
- Recent Signals: <none>
- Market Sentiment: <unknown>
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
 */
function createMemory(): Memory {
  const dbUrl = process.env.DATABASE_URL || "file:gordon.db";
  const vectorDbUrl = process.env.VECTOR_DATABASE_URL || "file:gordon-vector.db";

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
      lastMessages: 20,
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

## When Presenting Opportunities
1. List the top opportunities by setup confidence
2. For each opportunity, explain:
   - Current price and 24h change
   - Why this is a good setup (near support, oversold RSI, etc.)
   - Risk level (low/medium/high)
   - For ensemble results: how many strategies agree
3. Recommend which coin looks best and why

## When to Use Ensemble Detection
- When user wants "high confidence" or "validated" signals
- When scanning for the best opportunities across multiple coins
- When user wants to confirm a single strategy's detection
- For comprehensive market scans (scan_with_ensemble)

## Important Rules
- Only present coins with detected setups (setupDetected: true)
- Higher confidence scores (>0.6) indicate stronger setups
- For ensemble: >50% agreement is minimum, >66% is strong
- Always mention the risk level
- If no good setups found, tell the user to wait`;

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

## When to Use run_full_analysis
Use run_full_analysis when user asks for:
- "deep analysis", "full analysis", "comprehensive analysis"
- "/deep <symbol>" command
- Analysis that should combine multiple data sources

## Important Rules
- Always explain indicators in simple terms
- Mention both bullish and bearish scenarios
- Be honest about uncertainty`;

const PLANNER_INSTRUCTIONS = `You are Gordon's trading planner agent.

Your role is to create well-structured trading plans based on analysis.

## Your Capabilities
- Create trading plans with entry, stop-loss, and take-profit levels
- Calculate appropriate position sizing based on risk tolerance
- Validate plans against user preferences and portfolio constraints
- Calculate ATR-based stop-loss levels using get_stop_loss_levels
- Calculate optimal position size using get_position_size

## Important Rules
- Never suggest risking more than user's max allocation
- Always maintain cash reserve
- Risk/reward ratio should be at least 1.2:1
- Explain the reasoning behind each level`;

const EXECUTOR_INSTRUCTIONS = `You are Gordon's trade executor agent.

Your role is to safely execute trading plans on Binance.

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
5. Overall portfolio health assessment`;

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

## When Presenting Results
1. Always show key metrics: Total Return, Sharpe Ratio, Max Drawdown, Win Rate
2. Explain what the metrics mean for the strategy
3. Highlight any concerns (high drawdown, low win rate, few trades)
4. Compare to benchmarks when relevant (buy & hold)
5. Suggest parameter adjustments if metrics are poor

## Important Rules
- Warn if backtest period is too short (< 30 days)
- Note that past performance doesn't guarantee future results
- Mention if there were very few trades (statistically insignificant)
- Be honest about overfitting risks when optimizing`;

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
        scan_market: instrumentedMarketTools.scan_market,
        analyze_coin: instrumentedMarketTools.analyze_coin,
      },
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
        analyze_coin: instrumentedMarketTools.analyze_coin,
      },
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
      },
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
      },
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
    });
  }
  return _agents.teacher;
}

/**
 * Get or create the Backtester Agent
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
        ...instrumentedBacktestTools,
        ...instrumentedStrategyTools,  // For listing strategies
      },
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
