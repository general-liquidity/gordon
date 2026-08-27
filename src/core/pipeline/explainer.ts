/**
 * Explainer module for Gordon CLI
 *
 * Uses AI to answer user questions about trading concepts,
 * decisions, and plans in plain language.
 */

import {
  type LLMClient,
  loadPrompt,
  buildMessages,
  executeWithFailover,
} from "../../infra/ai/llm/index.ts";
import type { Plan, Trade, CoinAnalysis } from "../../types/index.ts";
import { createModuleLogger } from "../../infra/logger/index.ts";
import {
  buildFailoverModelChain,
  describeFailoverChain,
  formatFailoverErrors,
} from "./llmFailover.ts";

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
  // Strategy presets
  support_bounce: `Support Bounce is Gordon's flagship beginner strategy. It identifies coins near strong support levels showing reversal signals.

Entry conditions:
- Price within 3% of a strong support level
- RSI oversold (<35) or recovering
- Volume confirmation on bounce candle
- MACD showing bullish momentum

This strategy works best in ranging markets where support levels hold. Stop loss goes below support, and we scale out at resistance levels. It's lower risk because you have a clear invalidation point (support breaking).`,

  bollinger_bounce: `Bollinger Bounce is a mean reversion strategy that buys when price touches the lower Bollinger Band.

Entry conditions:
- Price at or below lower band (2 std dev)
- RSI oversold (<30)
- Bollinger bandwidth not too wide (not trending hard)
- Volume spike on the touch

The theory: Price tends to revert to the mean (middle band). When it stretches too far, it snaps back. Best in ranging/consolidating markets. Avoid during strong trends where price can "walk the bands."`,

  sma_crossover: `SMA Crossover uses the classic Golden Cross signal - when the 50-day SMA crosses above the 200-day SMA.

Entry conditions:
- SMA 50 recently crossed above SMA 200
- Price above both SMAs
- Volume increasing during crossover
- RSI in healthy range (40-60)

This is a trend-following strategy that catches major moves. It's slower but more reliable - fewer false signals. Works best on higher timeframes (4h, daily). Stop loss goes below the SMA 200.`,

  volume_surge: `Volume Surge identifies breakouts backed by unusual trading volume - a sign of institutional interest.

Entry conditions:
- Volume 2x+ above 20-day average
- Price breaking above recent resistance
- Bullish candle structure
- Ideally on news catalyst or fresh breakout

High volume validates price moves. A breakout without volume often fails. This strategy catches momentum early but requires quick stops if the move reverses.`,

  vwap_bounce: `VWAP Bounce is an intraday strategy that buys when price pulls back to VWAP (Volume Weighted Average Price).

Entry conditions:
- Price at or below VWAP
- Overall trend is bullish (price was above VWAP)
- Volume confirming the bounce
- Time of day matters (works best mid-session)

VWAP represents the "fair value" for the day. Big players use it as a benchmark. Buying at VWAP in an uptrend is buying at fair value with the trend.`,

  ema_rsi_crossover: `EMA+RSI Crossover combines EMA 9/21 crossovers with RSI momentum filter for higher quality signals.

Entry conditions:
- EMA 9 crosses above EMA 21
- RSI > 50 and rising
- Price above EMA 50 (medium-term trend)
- Volume confirming the crossover

The RSI filter removes many false crossover signals that happen in choppy markets. Best when EMAs are fully aligned (9 > 21 > 50).`,

  engulfing_pattern: `Engulfing Pattern identifies bullish engulfing candlesticks at support - a powerful reversal signal.

Entry conditions:
- Bearish (red) candle followed by larger bullish (green) candle
- The green candle's body completely "engulfs" the red
- Pattern occurs at or near support
- Volume higher on the engulfing candle

This pattern shows buyers overwhelming sellers in one candle. Stop loss goes below the pattern low. Works best on 4h+ timeframes.`,

  adx_trend: `ADX Trend trades only when trend strength is confirmed by ADX (Average Directional Index).

Entry conditions:
- ADX > 25 (strong trend)
- +DI above -DI (bullish direction)
- ADX rising (trend strengthening)
- Price above key moving averages

ADX tells you HOW STRONG a trend is, not direction. High ADX = trending, Low ADX = ranging. This avoids choppy markets where other strategies fail.`,

  consolidation_pop: `Consolidation Pop catches breakouts from tight price ranges - compressed springs ready to pop.

Entry conditions:
- Bollinger bandwidth at 20-day low (price squeezed)
- ATR compression (low volatility)
- Price breaks above the range high
- Volume confirming the breakout

Tight consolidation = energy building up. When it breaks, moves are often explosive. Set stops below the range and ride the momentum.`,

  relative_strength: `Relative Strength identifies coins outperforming BTC - showing they have alpha and aren't just riding the market.

Entry conditions:
- Coin/BTC ratio rising (outperforming)
- Price above moving averages
- BTC not in freefall (market supportive)
- Strong RS momentum

When BTC is flat or up, strong alts can moon. When BTC dumps, strong alts often hold better. This finds the leaders, not the laggers.`,

  // Indicator presets
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
  // Indicator aliases
  "relative strength index": "rsi",
  "rsi indicator": "rsi",
  "moving average convergence divergence": "macd",
  "macd indicator": "macd",
  "support level": "support",
  "support levels": "support",
  "resistance level": "resistance",
  "resistance levels": "resistance",
  stop: "stop_loss",
  stoploss: "stop_loss",
  "stop-loss": "stop_loss",
  stops: "stop_loss",
  tp: "take_profit",
  "take profits": "take_profit",
  "profit target": "take_profit",
  "profit targets": "take_profit",
  "dollar cost averaging": "dca",
  "averaging down": "dca",
  "risk reward": "risk_reward",
  "risk-reward": "risk_reward",
  "r:r": "risk_reward",
  rr: "risk_reward",
  // Strategy aliases
  "support bounce": "support_bounce",
  "support bounce strategy": "support_bounce",
  "bollinger bounce": "bollinger_bounce",
  "bollinger bounce strategy": "bollinger_bounce",
  "bollinger bands strategy": "bollinger_bounce",
  "sma crossover": "sma_crossover",
  "golden cross": "sma_crossover",
  "golden cross strategy": "sma_crossover",
  "volume surge": "volume_surge",
  "volume surge strategy": "volume_surge",
  "vwap bounce": "vwap_bounce",
  "vwap bounce strategy": "vwap_bounce",
  "vwap strategy": "vwap_bounce",
  "ema rsi crossover": "ema_rsi_crossover",
  "ema crossover": "ema_rsi_crossover",
  "ema rsi": "ema_rsi_crossover",
  "engulfing pattern": "engulfing_pattern",
  "engulfing pattern strategy": "engulfing_pattern",
  "bullish engulfing": "engulfing_pattern",
  "adx trend": "adx_trend",
  "adx trend strategy": "adx_trend",
  "adx strategy": "adx_trend",
  "consolidation pop": "consolidation_pop",
  "consolidation pop strategy": "consolidation_pop",
  "breakout strategy": "consolidation_pop",
  "relative strength": "relative_strength",
  "relative strength strategy": "relative_strength",
  "rs strategy": "relative_strength",
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
    lines.push(
      `Entry: Market order (${plan.direction === "short" ? "sell short" : "buy"} at current price)`,
    );
  } else {
    lines.push(`Entry: Limit order at $${formatPrice(plan.entry.price!)}`);
  }

  // Position size
  lines.push(
    `Position Size: $${plan.allocation.amount.toFixed(2)} (${(plan.allocation.percentOfPortfolio * 100).toFixed(1)}% of portfolio)`,
  );
  lines.push("");

  // Risk management
  lines.push("Risk Management:");
  lines.push(`  Stop Loss: $${formatPrice(plan.stopLoss.price)}`);

  if (plan.entry.price) {
    const stopPercent = (Math.abs(plan.entry.price - plan.stopLoss.price) / plan.entry.price) * 100;
    lines.push(
      `    (${stopPercent.toFixed(1)}% ${plan.direction === "short" ? "above" : "below"} entry)`,
    );
  }
  lines.push("");

  // Take profit targets
  lines.push("Take Profit Targets:");
  plan.takeProfit.forEach((tp, index) => {
    const tpLabel = `TP${index + 1}`;
    const percentToSell = (tp.percentToSell * 100).toFixed(0);
    let tpLine = `  ${tpLabel}: $${formatPrice(tp.price)} (close ${percentToSell}%)`;

    if (plan.entry.price) {
      const multiplier = plan.direction === "short" ? -1 : 1;
      const gainPercent = multiplier * ((tp.price - plan.entry.price) / plan.entry.price) * 100;
      tpLine += ` - +${gainPercent.toFixed(1)}% gain`;
    }

    lines.push(tpLine);
  });
  lines.push("");

  // DCA levels if present
  if (plan.dca && plan.dca.length > 0) {
    lines.push(
      `DCA Levels (${plan.direction === "short" ? "sell more if price rises" : "buy more if price drops"}):`,
    );
    plan.dca.forEach((dca, index) => {
      const dcaLabel = `DCA${index + 1}`;
      const percentAlloc = (dca.percentOfAllocation * 100).toFixed(0);
      lines.push(`  ${dcaLabel}: $${formatPrice(dca.price)} (add ${percentAlloc}% of allocation)`);
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
    // Tier 1 - Beginner
    support_bounce: "Support Bounce",
    bollinger_bounce: "Bollinger Bounce",
    sma_crossover: "SMA Crossover (Golden Cross)",
    volume_surge: "Volume Surge",
    vwap_bounce: "VWAP Bounce",
    // Tier 2 - Intermediate
    ema_rsi_crossover: "EMA+RSI Crossover",
    engulfing_pattern: "Engulfing Pattern",
    adx_trend: "ADX Trend",
    consolidation_pop: "Consolidation Pop",
    relative_strength: "Relative Strength",
    // Special
    grid_entry: "Grid Entry",
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
        (Math.abs(plan.entry.price - plan.stopLoss.price) / plan.entry.price) * 100;
      parts.push(`Stop Distance: ${stopPercent.toFixed(1)}%`);
    }

    parts.push("Take Profits:");
    plan.takeProfit.forEach((tp, i) => {
      parts.push(
        `  TP${i + 1}: $${formatPrice(tp.price)} (${(tp.percentToSell * 100).toFixed(0)}%)`,
      );
    });

    if (plan.dca && plan.dca.length > 0) {
      parts.push("DCA Levels:");
      plan.dca.forEach((dca, i) => {
        parts.push(
          `  DCA${i + 1}: $${formatPrice(dca.price)} (${(dca.percentOfAllocation * 100).toFixed(0)}%)`,
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

    parts.push(
      `Realized PnL: $${trade.realizedPnl.toFixed(2)} (${trade.realizedPnlPercent.toFixed(2)}%)`,
    );

    if (trade.entries.length > 0) {
      parts.push("Entry Fills:");
      trade.entries.forEach((entry) => {
        parts.push(`  ${entry.quantity} @ $${formatPrice(entry.price)} (${entry.filledAt})`);
      });
    }

    if (trade.exits.length > 0) {
      parts.push("Exit Fills:");
      trade.exits.forEach((exit) => {
        parts.push(
          `  ${exit.quantity} @ $${formatPrice(exit.price)} - ${exit.reason} (${exit.filledAt})`,
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
            `  S${i + 1}: $${formatPrice(level.price)} (strength: ${(level.strength * 100).toFixed(0)}%, touches: ${level.touches})`,
          );
        });
      }

      if (resistances.length > 0) {
        parts.push("Resistance Levels:");
        resistances.slice(0, 3).forEach((level, i) => {
          parts.push(
            `  R${i + 1}: $${formatPrice(level.price)} (strength: ${(level.strength * 100).toFixed(0)}%, touches: ${level.touches})`,
          );
        });
      }
    }

    if (analysis.setupDetected) {
      parts.push(
        `Setup Detected: Yes (confidence: ${(analysis.setupConfidence * 100).toFixed(0)}%)`,
      );
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
  context: ExplainContext,
): Promise<string> {
  logger.debug("Processing explanation request", {
    question: question.substring(0, 50),
    hasContext: !!context.plan || !!context.trade || !!context.analysis,
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
  const failover = await executeWithFailover({
    chain: buildFailoverModelChain(client, "explanations"),
    idOf: describeFailoverChain,
    call: async (config) => client.chatWithConfig(messages, config),
  });

  if (!failover.ok || !failover.result) {
    throw new Error(
      `Explanation failed across all LLM providers: ${formatFailoverErrors(failover.errors)}`,
    );
  }

  if (failover.degraded) {
    logger.warn("Explanation used fallback LLM provider", {
      provider: failover.usedId,
      attempts: failover.attempts,
    });
  }

  const response = failover.result;

  return response.content.trim();
}

/**
 * Detect if the question is about a preset topic and return the preset if so
 */
function detectAndGetPreset(question: string, context: ExplainContext): string | null {
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
    // Indicator keywords
    { keywords: ["what is rsi", "what's rsi", "explain rsi", "rsi mean"], topic: "rsi" },
    { keywords: ["what is macd", "what's macd", "explain macd", "macd mean"], topic: "macd" },
    {
      keywords: [
        "what is support",
        "what's support",
        "explain support",
        "support mean",
        "support level",
      ],
      topic: "support",
    },
    {
      keywords: [
        "what is resistance",
        "what's resistance",
        "explain resistance",
        "resistance mean",
        "resistance level",
      ],
      topic: "resistance",
    },
    {
      keywords: [
        "what is stop loss",
        "what's a stop",
        "explain stop",
        "stop loss mean",
        "why stop loss",
      ],
      topic: "stop_loss",
    },
    {
      keywords: ["what is take profit", "what's take profit", "explain take profit", "tp mean"],
      topic: "take_profit",
    },
    {
      keywords: ["what is dca", "what's dca", "explain dca", "dca mean", "dollar cost"],
      topic: "dca",
    },
    {
      keywords: [
        "what is risk reward",
        "what's risk reward",
        "explain risk reward",
        "r:r mean",
        "risk/reward",
      ],
      topic: "risk_reward",
    },
    // Strategy keywords
    {
      keywords: ["support bounce", "support_bounce", "tell me about support bounce"],
      topic: "support_bounce",
    },
    {
      keywords: ["bollinger bounce", "bollinger_bounce", "bollinger bands strategy"],
      topic: "bollinger_bounce",
    },
    {
      keywords: ["sma crossover", "sma_crossover", "golden cross strategy"],
      topic: "sma_crossover",
    },
    { keywords: ["volume surge", "volume_surge", "volume strategy"], topic: "volume_surge" },
    { keywords: ["vwap bounce", "vwap_bounce", "vwap strategy"], topic: "vwap_bounce" },
    {
      keywords: ["ema rsi crossover", "ema_rsi_crossover", "ema crossover strategy"],
      topic: "ema_rsi_crossover",
    },
    {
      keywords: ["engulfing pattern", "engulfing_pattern", "bullish engulfing strategy"],
      topic: "engulfing_pattern",
    },
    { keywords: ["adx trend", "adx_trend", "adx strategy"], topic: "adx_trend" },
    {
      keywords: ["consolidation pop", "consolidation_pop", "breakout strategy"],
      topic: "consolidation_pop",
    },
    {
      keywords: ["relative strength", "relative_strength", "rs strategy"],
      topic: "relative_strength",
    },
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
