/**
 * Explainer module for Gordon CLI
 *
 * Uses AI to answer user questions about trading concepts,
 * decisions, and plans in plain language.
 */

import { LLMClient, loadPrompt, buildMessages } from "../infra/llm/index.ts";
import type { Plan, Trade, CoinAnalysis } from "../types/index.ts";
import { createModuleLogger } from "../infra/logger/index.ts";

const logger = createModuleLogger("explainer");

// ============================================================================
// Types
// ============================================================================

export interface ExplainContext {
  plan?: Plan;
  trade?: Trade;
  analysis?: CoinAnalysis;
  topic?: string;
}

// ============================================================================
// Preset Explanations
// ============================================================================

const PRESET_EXPLANATIONS: Record<string, string> = {
  rsi: `RSI (Relative Strength Index) is a momentum indicator that measures how fast and how much a price has moved recently. It ranges from 0 to 100.

When RSI is below 30, the asset is considered "oversold" - meaning it might have dropped too far too fast and could be due for a bounce. When RSI is above 70, it's "overbought" - meaning it might have risen too quickly and could pull back.

Gordon uses RSI to help identify good entry points. We like to buy when RSI is low (oversold) because it often means the selling pressure is exhausted and buyers might step in.`,

  macd: `MACD (Moving Average Convergence Divergence) is a trend-following indicator that shows the relationship between two moving averages of price.

Think of it like measuring the momentum of a trend. When the MACD line crosses above the signal line, it suggests upward momentum is building - a "bullish cross." When it crosses below, momentum is fading - a "bearish cross."

Gordon watches for MACD crosses to confirm that momentum aligns with our trade direction. A bullish cross near a support level gives us more confidence in a bounce trade.`,

  support: `A support level is a price where buyers have historically stepped in to stop the price from falling further. It's like a floor that the price bounces off.

The more times a price has touched a support level and bounced back up, the stronger that support is considered. Think of it like a trampoline - each bounce proves the floor is solid.

Gordon looks for trades near strong support levels because they give us a clear place to set our stop loss (just below support) and a logical reason to expect a bounce.`,

  resistance: `A resistance level is a price where sellers have historically stepped in to stop the price from rising further. It's like a ceiling that the price struggles to break through.

Just like support, resistance levels get stronger each time the price tests them and fails to break through. When resistance finally breaks, it often becomes new support.

Gordon uses resistance levels to set realistic take profit targets. We aim to sell some of our position before the price hits strong resistance, rather than hoping it breaks through.`,

  stop_loss: `A stop loss is an automatic order to sell your position if the price drops to a certain level. It's your safety net that limits how much you can lose on a trade.

Think of it like a seatbelt - you hope you never need it, but it protects you when things go wrong. Without a stop loss, a small loss can turn into a devastating one if you don't act in time.

Gordon always sets a stop loss on every trade. We place it at a level where our trade idea would be proven wrong (usually just below a key support level). This way, we take small losses quickly rather than holding onto losing positions.`,

  take_profit: `Take profit levels are preset prices where we automatically sell portions of our position to lock in gains. Instead of trying to guess the exact top, we scale out gradually.

Gordon typically uses multiple take profit levels (TP1, TP2, TP3). We might sell 50% at the first target, 30% at the second, and let the remaining 20% run further. This way, we secure some profit early while keeping upside potential.

This approach helps remove emotion from selling decisions. It's easy to get greedy and hold too long, only to watch your gains disappear. Preset targets keep us disciplined.`,

  dca: `DCA (Dollar Cost Averaging) in trading means adding to your position at lower prices if the trade initially goes against you. Instead of going "all in" at once, you enter in stages.

For example, if we buy at $10 and set a DCA level at $9.50, we'll add more if the price dips to $9.50. This lowers our average entry price, so we need less of a bounce to break even or profit.

Gordon uses DCA conservatively - only at levels where there's technical support. We don't chase falling prices forever. If price breaks our stop loss, we exit the entire position. DCA is a tool to improve entries, not an excuse to ignore risk management.`,

  risk_reward: `Risk/reward ratio compares how much you could lose versus how much you could gain on a trade. It's written as a ratio like 1:2 or 1:3.

A 1:3 risk/reward means for every $1 you risk, you could make $3. If your stop loss would cost you $50, your profit target should be $150. This is important because you don't need to win every trade to be profitable - with 1:3 ratio, you can win just 30% of trades and still make money.

Gordon aims for at least 1.5:1 risk/reward on every trade. This ensures that over many trades, even with some losses, the math works in our favor. We never take trades where the potential reward doesn't justify the risk.`,
};

// Aliases for common variations
const TOPIC_ALIASES: Record<string, string> = {
  "relative strength index": "rsi",
  "rsi indicator": "rsi",
  "moving average convergence divergence": "macd",
  "macd indicator": "macd",
  "support level": "support",
  "support levels": "support",
  "resistance level": "resistance",
  "resistance levels": "resistance",
  "stop": "stop_loss",
  "stoploss": "stop_loss",
  "stop-loss": "stop_loss",
  "stops": "stop_loss",
  "tp": "take_profit",
  "take profits": "take_profit",
  "profit target": "take_profit",
  "profit targets": "take_profit",
  "dollar cost averaging": "dca",
  "averaging down": "dca",
  "risk reward": "risk_reward",
  "risk-reward": "risk_reward",
  "r:r": "risk_reward",
  "rr": "risk_reward",
};

// ============================================================================
// Preset Explanation Function
// ============================================================================

/**
 * Get a preset explanation for a common topic
 * Returns null if no preset exists for the topic
 *
 * @param topic - The topic to explain (e.g., "rsi", "macd", "stop_loss")
 * @returns Preset explanation string or null if not found
 */
export function getPresetExplanation(topic: string): string | null {
  const normalizedTopic = topic.toLowerCase().trim();

  // Check direct match first
  if (PRESET_EXPLANATIONS[normalizedTopic]) {
    return PRESET_EXPLANATIONS[normalizedTopic];
  }

  // Check aliases
  const aliasedTopic = TOPIC_ALIASES[normalizedTopic];
  if (aliasedTopic && PRESET_EXPLANATIONS[aliasedTopic]) {
    return PRESET_EXPLANATIONS[aliasedTopic];
  }

  return null;
}

// ============================================================================
// Plan Formatting Function
// ============================================================================

/**
 * Format a plan into a human-readable summary without needing AI
 *
 * @param plan - The trading plan to format
 * @returns Human-readable summary of the plan
 */
export function formatPlanExplanation(plan: Plan): string {
  const lines: string[] = [];

  // Header
  lines.push(`Trade Plan for ${plan.symbol}`);
  lines.push(`Strategy: ${formatStrategy(plan.strategy)}`);
  lines.push("");

  // Entry
  if (plan.entry.type === "market") {
    lines.push("Entry: Market order (buy at current price)");
  } else {
    lines.push(`Entry: Limit order at $${formatPrice(plan.entry.price!)}`);
  }

  // Position size
  lines.push(
    `Position Size: $${plan.allocation.amount.toFixed(2)} (${(plan.allocation.percentOfPortfolio * 100).toFixed(1)}% of portfolio)`
  );
  lines.push("");

  // Risk management
  lines.push("Risk Management:");
  lines.push(`  Stop Loss: $${formatPrice(plan.stopLoss.price)}`);

  if (plan.entry.price) {
    const stopPercent =
      ((plan.entry.price - plan.stopLoss.price) / plan.entry.price) * 100;
    lines.push(`    (${stopPercent.toFixed(1)}% below entry)`);
  }
  lines.push("");

  // Take profit targets
  lines.push("Take Profit Targets:");
  plan.takeProfit.forEach((tp, index) => {
    const tpLabel = `TP${index + 1}`;
    const percentToSell = (tp.percentToSell * 100).toFixed(0);
    let tpLine = `  ${tpLabel}: $${formatPrice(tp.price)} (sell ${percentToSell}%)`;

    if (plan.entry.price) {
      const gainPercent = ((tp.price - plan.entry.price) / plan.entry.price) * 100;
      tpLine += ` - +${gainPercent.toFixed(1)}% gain`;
    }

    lines.push(tpLine);
  });
  lines.push("");

  // DCA levels if present
  if (plan.dca && plan.dca.length > 0) {
    lines.push("DCA Levels (buy more if price drops):");
    plan.dca.forEach((dca, index) => {
      const dcaLabel = `DCA${index + 1}`;
      const percentAlloc = (dca.percentOfAllocation * 100).toFixed(0);
      lines.push(
        `  ${dcaLabel}: $${formatPrice(dca.price)} (add ${percentAlloc}% of allocation)`
      );
    });
    lines.push("");
  }

  // Reasoning
  lines.push("Reasoning:");
  lines.push(`  ${plan.reasoning}`);

  return lines.join("\n");
}

/**
 * Format a strategy enum value to human-readable text
 */
function formatStrategy(strategy: string): string {
  const strategyNames: Record<string, string> = {
    support_bounce: "Support Bounce",
  };

  return strategyNames[strategy] ?? strategy;
}

/**
 * Format a price with appropriate decimal places
 */
function formatPrice(price: number): string {
  if (price >= 1000) {
    return price.toFixed(2);
  } else if (price >= 1) {
    return price.toFixed(4);
  } else {
    return price.toFixed(6);
  }
}

// ============================================================================
// Context Building
// ============================================================================

/**
 * Build a context string from available data for the LLM
 */
function buildContextString(context: ExplainContext): string {
  const parts: string[] = [];

  // Plan context
  if (context.plan) {
    const plan = context.plan;
    parts.push("=== Current Trade Plan ===");
    parts.push(`Symbol: ${plan.symbol}`);
    parts.push(`Direction: ${plan.direction}`);
    parts.push(`Strategy: ${plan.strategy}`);

    if (plan.entry.type === "market") {
      parts.push("Entry: Market order");
    } else {
      parts.push(`Entry: Limit at $${formatPrice(plan.entry.price!)}`);
    }

    parts.push(`Stop Loss: $${formatPrice(plan.stopLoss.price)}`);

    if (plan.entry.price) {
      const stopPercent =
        ((plan.entry.price - plan.stopLoss.price) / plan.entry.price) * 100;
      parts.push(`Stop Distance: ${stopPercent.toFixed(1)}%`);
    }

    parts.push("Take Profits:");
    plan.takeProfit.forEach((tp, i) => {
      parts.push(
        `  TP${i + 1}: $${formatPrice(tp.price)} (${(tp.percentToSell * 100).toFixed(0)}%)`
      );
    });

    if (plan.dca && plan.dca.length > 0) {
      parts.push("DCA Levels:");
      plan.dca.forEach((dca, i) => {
        parts.push(
          `  DCA${i + 1}: $${formatPrice(dca.price)} (${(dca.percentOfAllocation * 100).toFixed(0)}%)`
        );
      });
    }

    parts.push(`Allocation: $${plan.allocation.amount.toFixed(2)}`);
    parts.push(`Reasoning: ${plan.reasoning}`);
    parts.push("");
  }

  // Trade context
  if (context.trade) {
    const trade = context.trade;
    parts.push("=== Active Trade ===");
    parts.push(`Symbol: ${trade.symbol}`);
    parts.push(`Status: ${trade.status}`);
    parts.push(`Opened: ${trade.openedAt}`);

    if (trade.averageEntry > 0) {
      parts.push(`Average Entry: $${formatPrice(trade.averageEntry)}`);
    }

    parts.push(`Realized PnL: $${trade.realizedPnl.toFixed(2)} (${trade.realizedPnlPercent.toFixed(2)}%)`);

    if (trade.entries.length > 0) {
      parts.push("Entry Fills:");
      trade.entries.forEach((entry) => {
        parts.push(
          `  ${entry.quantity} @ $${formatPrice(entry.price)} (${entry.filledAt})`
        );
      });
    }

    if (trade.exits.length > 0) {
      parts.push("Exit Fills:");
      trade.exits.forEach((exit) => {
        parts.push(
          `  ${exit.quantity} @ $${formatPrice(exit.price)} - ${exit.reason} (${exit.filledAt})`
        );
      });
    }
    parts.push("");
  }

  // Analysis context
  if (context.analysis) {
    const analysis = context.analysis;
    parts.push("=== Technical Analysis ===");
    parts.push(`Symbol: ${analysis.symbol}`);
    parts.push(`Current Price: $${formatPrice(analysis.price)}`);
    parts.push(`24h Change: ${analysis.change24h.toFixed(2)}%`);
    parts.push(`Trend: ${analysis.trend}`);
    parts.push(`Bias: ${analysis.bias}`);
    parts.push(`Risk Level: ${analysis.risk}`);

    // Indicators
    parts.push("Indicators:");
    if (analysis.indicators.rsi !== null) {
      parts.push(`  RSI: ${analysis.indicators.rsi.toFixed(1)}`);
    }
    if (analysis.indicators.macd) {
      parts.push(`  MACD: ${analysis.indicators.macd.macd.toFixed(4)}`);
      parts.push(`  MACD Signal: ${analysis.indicators.macd.signal.toFixed(4)}`);
      parts.push(`  MACD Histogram: ${analysis.indicators.macd.histogram.toFixed(4)}`);
    }
    if (analysis.indicators.volumeRatio !== null) {
      parts.push(`  Volume Ratio: ${analysis.indicators.volumeRatio.toFixed(2)}x`);
    }

    // Key levels
    if (analysis.levels.length > 0) {
      const supports = analysis.levels.filter((l) => l.type === "support");
      const resistances = analysis.levels.filter((l) => l.type === "resistance");

      if (supports.length > 0) {
        parts.push("Support Levels:");
        supports.slice(0, 3).forEach((level, i) => {
          parts.push(
            `  S${i + 1}: $${formatPrice(level.price)} (strength: ${(level.strength * 100).toFixed(0)}%, touches: ${level.touches})`
          );
        });
      }

      if (resistances.length > 0) {
        parts.push("Resistance Levels:");
        resistances.slice(0, 3).forEach((level, i) => {
          parts.push(
            `  R${i + 1}: $${formatPrice(level.price)} (strength: ${(level.strength * 100).toFixed(0)}%, touches: ${level.touches})`
          );
        });
      }
    }

    if (analysis.setupDetected) {
      parts.push(`Setup Detected: Yes (confidence: ${(analysis.setupConfidence * 100).toFixed(0)}%)`);
    }
    parts.push("");
  }

  // Topic hint
  if (context.topic) {
    parts.push(`Topic of interest: ${context.topic}`);
  }

  return parts.join("\n");
}

// ============================================================================
// Main Explain Function
// ============================================================================

/**
 * Use AI to explain a trading concept or decision in plain language
 *
 * @param client - LLM client for making API calls
 * @param question - The user's question
 * @param context - Context about the current plan, trade, or analysis
 * @returns Natural language explanation
 */
export async function explain(
  client: LLMClient,
  question: string,
  context: ExplainContext
): Promise<string> {
  logger.debug("Processing explanation request", {
    question: question.substring(0, 50),
    hasContext: !!context.plan || !!context.trade || !!context.analysis
  });

  // Check if this is a question about a preset topic
  const presetAnswer = detectAndGetPreset(question, context);
  if (presetAnswer) {
    logger.debug("Returning preset explanation");
    return presetAnswer;
  }

  // Load the explainer prompt
  const systemPrompt = await loadPrompt("explainer");

  // Build context string from available data
  const contextString = buildContextString(context);

  // Construct the user message with context and question
  const userMessage = contextString
    ? `Context:\n${contextString}\n\nUser Question: ${question}`
    : `User Question: ${question}`;

  // Build messages for the LLM
  const messages = buildMessages(systemPrompt, userMessage);

  // Call the LLM (natural language mode, not JSON)
  const response = await client.chat(messages);

  return response.content.trim();
}

/**
 * Detect if the question is about a preset topic and return the preset if so
 */
function detectAndGetPreset(
  question: string,
  context: ExplainContext
): string | null {
  const lowerQuestion = question.toLowerCase();

  // Check if context has a specific topic
  if (context.topic) {
    const presetFromTopic = getPresetExplanation(context.topic);
    if (presetFromTopic) {
      return presetFromTopic;
    }
  }

  // Check for topic keywords in the question
  const topicKeywords = [
    { keywords: ["what is rsi", "what's rsi", "explain rsi", "rsi mean"], topic: "rsi" },
    { keywords: ["what is macd", "what's macd", "explain macd", "macd mean"], topic: "macd" },
    { keywords: ["what is support", "what's support", "explain support", "support mean", "support level"], topic: "support" },
    { keywords: ["what is resistance", "what's resistance", "explain resistance", "resistance mean", "resistance level"], topic: "resistance" },
    { keywords: ["what is stop loss", "what's a stop", "explain stop", "stop loss mean", "why stop loss"], topic: "stop_loss" },
    { keywords: ["what is take profit", "what's take profit", "explain take profit", "tp mean"], topic: "take_profit" },
    { keywords: ["what is dca", "what's dca", "explain dca", "dca mean", "dollar cost"], topic: "dca" },
    { keywords: ["what is risk reward", "what's risk reward", "explain risk reward", "r:r mean", "risk/reward"], topic: "risk_reward" },
  ];

  for (const { keywords, topic } of topicKeywords) {
    for (const keyword of keywords) {
      if (lowerQuestion.includes(keyword)) {
        return getPresetExplanation(topic);
      }
    }
  }

  return null;
}
