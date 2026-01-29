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
 */

import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { LibSQLStore } from "@mastra/libsql";

import { getModel } from "../providers/registry.ts";
import { indicatorTools } from "./tools/indicators.ts";
// TODO: Import other tool modules after migration

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
    storage: new LibSQLStore({ url: dbUrl }),
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
// Sub-Agents (Specialists)
// ============================================================================

/**
 * Scanner Agent - Finds trading opportunities
 */
export const scannerAgent = new Agent({
  id: "scanner",
  name: "Scanner",
  description:
    "Specialist in scanning the market and finding trading opportunities. " +
    "Use when the user wants to find coins to trade, asks 'what should I buy?', " +
    "or needs market overview.",
  instructions: SCANNER_INSTRUCTIONS,
  model: getModel(process.env.GORDON_PROVIDER, process.env.GORDON_MODEL),
  tools: {
    // TODO: Add scan_market, analyze_coin after migration
    get_technical_signals: indicatorTools.get_technical_signals,
    get_rsi: indicatorTools.get_rsi,
    get_vwap: indicatorTools.get_vwap,
    get_stochastic_rsi: indicatorTools.get_stochastic_rsi,
  },
});

/**
 * Analyst Agent - Deep technical analysis
 */
export const analystAgent = new Agent({
  id: "analyst",
  name: "Analyst",
  description:
    "Specialist in deep coin analysis and technical indicators. " +
    "Use when user asks about a specific coin, wants detailed analysis, " +
    "or needs to understand support/resistance levels.",
  instructions: ANALYST_INSTRUCTIONS,
  model: getModel(process.env.GORDON_PROVIDER, process.env.GORDON_MODEL),
  tools: {
    // TODO: Add analyze_coin, explain after migration
    get_technical_analysis: indicatorTools.get_technical_analysis,
    get_rsi: indicatorTools.get_rsi,
    get_vwap: indicatorTools.get_vwap,
    get_stochastic_rsi: indicatorTools.get_stochastic_rsi,
  },
});

/**
 * Planner Agent - Creates trading plans
 */
export const plannerAgent = new Agent({
  id: "planner",
  name: "Planner",
  description:
    "Specialist in creating trading plans with entry, stop-loss, and take-profit levels. " +
    "Use when user wants to create a trade plan, buy a coin, or needs help with position sizing.",
  instructions: PLANNER_INSTRUCTIONS,
  model: getModel(process.env.GORDON_PROVIDER, process.env.GORDON_MODEL),
  tools: {
    // TODO: Add create_plan, list_plans, approve_plan after migration
    get_stop_loss_levels: indicatorTools.get_stop_loss_levels,
    get_position_size: indicatorTools.get_position_size,
  },
});

/**
 * Executor Agent - Executes trades (requires ARMED mode)
 */
export const executorAgent = new Agent({
  id: "executor",
  name: "Executor",
  description:
    "Specialist in executing trading plans and managing orders. " +
    "Use when user wants to execute an approved plan or needs to arm the system.",
  instructions: EXECUTOR_INSTRUCTIONS,
  model: getModel(process.env.GORDON_PROVIDER, process.env.GORDON_MODEL),
  tools: {
    // TODO: Add execute_plan, arm_system, list_plans after migration
  },
});

/**
 * Monitor Agent - Watches positions
 */
export const monitorAgent = new Agent({
  id: "monitor",
  name: "Monitor",
  description:
    "Specialist in monitoring open positions and detecting issues. " +
    "Use when user asks about their trades, positions, or portfolio status.",
  instructions: MONITOR_INSTRUCTIONS,
  model: getModel(process.env.GORDON_PROVIDER, process.env.GORDON_MODEL),
  tools: {
    // TODO: Add check_positions, close_trade, get_portfolio after migration
  },
});

/**
 * Teacher Agent - Explains concepts
 */
export const teacherAgent = new Agent({
  id: "teacher",
  name: "Teacher",
  description:
    "Specialist in explaining trading concepts in simple terms. " +
    "Use when user asks 'what is X?', needs help understanding something, " +
    "or is confused about trading terms.",
  instructions: TEACHER_INSTRUCTIONS,
  model: getModel(process.env.GORDON_PROVIDER, process.env.GORDON_MODEL),
  tools: {
    // TODO: Add explain after migration
  },
});

// ============================================================================
// Gordon - Main Orchestrator Agent with Network
// ============================================================================

/**
 * Gordon - The main orchestrator agent
 * Uses Agent Network for multi-agent coordination
 */
export const gordonAgent = new Agent({
  id: "gordon",
  name: "Gordon",
  description: "Main AI trading assistant for cryptocurrency. Coordinates specialized agents.",
  instructions: GORDON_INSTRUCTIONS,
  model: getModel(process.env.GORDON_PROVIDER, process.env.GORDON_MODEL),

  // Sub-agents for network routing (replaces handoffs)
  agents: {
    scanner: scannerAgent,
    analyst: analystAgent,
    planner: plannerAgent,
    executor: executorAgent,
    monitor: monitorAgent,
    teacher: teacherAgent,
  },

  // Direct tools for simple operations
  tools: {
    ...indicatorTools,
    // TODO: Add other tool categories after migration
  },

  // Memory for network orchestration
  memory: createMemory(),
});

// ============================================================================
// Export all agents
// ============================================================================

export const allAgents = {
  gordon: gordonAgent,
  scanner: scannerAgent,
  analyst: analystAgent,
  planner: plannerAgent,
  executor: executorAgent,
  monitor: monitorAgent,
  teacher: teacherAgent,
};
