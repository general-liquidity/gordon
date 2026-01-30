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
import { LibSQLStore } from "@mastra/libsql";

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
} from "./tools/index.ts";

// ============================================================================
// Memory Configuration (Required for Agent Networks)
// ============================================================================

/**
 * Memory store for conversation persistence and task tracking
 * Required when using .network() for multi-agent orchestration
 */
const createMemory = () => {
  const dbUrl = process.env.DATABASE_URL || "file:gordon.db";
  return new Memory({
    storage: new LibSQLStore({
      id: "gordon-memory",
      url: dbUrl,
    }),
  });
};

// ============================================================================
// Instructions (unchanged from OpenAI SDK)
// ============================================================================

const SCANNER_INSTRUCTIONS = `You are Gordon's market scanner agent.

Your role is to scan the cryptocurrency market and identify trading opportunities using the Support Bounce strategy.

## Your Capabilities
- Scan the top coins by volume for trading setups
- Analyze individual coins for detailed technical analysis
- Identify coins near support with bullish signals
- Quick technical signals check (RSI, trend, MACD) using get_technical_signals

## When Presenting Opportunities
1. List the top opportunities by setup confidence
2. For each opportunity, explain:
   - Current price and 24h change
   - Why this is a good setup (near support, oversold RSI, etc.)
   - Risk level (low/medium/high)
3. Recommend which coin looks best and why

## Important Rules
- Only present coins with detected setups (setupDetected: true)
- Higher confidence scores (>0.6) indicate stronger setups
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
        ...indicatorTools,
        ...discoveryTools,  // Coin discovery tools
        ...strategyTools,   // Strategy library tools
        scan_market: marketTools.scan_market,
        analyze_coin: marketTools.analyze_coin,
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
        ...indicatorTools,
        ...chartTools,
        ...orderbookTools,         // Order book depth and liquidity analysis
        ...marketAnalysisTools,    // Whale detection, breakouts, consolidation, scoring
        analyze_coin: marketTools.analyze_coin,
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
        ...indicatorTools,
        ...strategyTools,  // Strategy library tools for plan creation
        create_plan: tradingTools.create_plan,
        create_grid_plan: tradingTools.create_grid_plan,
        list_plans: tradingTools.list_plans,
        // Risk-based position sizing tools
        calculate_kelly_size: riskManagementTools.calculate_kelly_size,
        calculate_volatility_adjusted_size: riskManagementTools.calculate_volatility_adjusted_size,
        assess_trade_risk: riskManagementTools.assess_trade_risk,
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
        execute_plan: tradingTools.execute_plan,
        close_trade: tradingTools.close_trade,
        arm_system: tradingTools.arm_system,
        list_plans: tradingTools.list_plans,
        approve_plan: tradingTools.approve_plan,
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
        check_positions: positionTools.check_positions,
        ...accountTools,
        ...walletTools,    // Wallet management and transfers
        ...earnTools,      // Staking/savings positions
        ...historyTools,   // Trade and transfer history
        ...metricsTools,   // Performance metrics and statistics
        // Risk monitoring tools
        check_exit_conditions: riskManagementTools.check_exit_conditions,
        check_drawdown_status: riskManagementTools.check_drawdown_status,
        check_daily_limit: riskManagementTools.check_daily_limit,
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
        explain: explainTools.explain,
      },
    });
  }
  return _agents.teacher;
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
      },

      // Gordon only has essential routing/system tools
      // Specialized tools are delegated to sub-agents to avoid confusion
      // This improves tool selection accuracy by keeping Gordon focused on orchestration
      tools: {
        ...systemTools,       // arm/disarm system control
        ...schedulerTools,    // task scheduling (cross-cutting concern)
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
  };
}

/**
 * Reset agent cache (useful for testing or reinitializing)
 */
export function resetAgents(): void {
  _agents = {};
}
