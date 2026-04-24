/**
 * IndicatorBrowser — Browse all 32 indicators grouped by category
 *
 * Categories: Trend, Momentum, Volatility, Volume, Structure, Advanced.
 * Arrow keys navigate, Enter selects, Escape closes.
 * Shows parameter list for focused indicator.
 *
 * Pattern: Claude Code MCP/plugin browser (grouped list with descriptions).
 */

import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "../ink-custom";
import { Pane } from "../design-system/Pane.js";

// ============================================================================
// Types
// ============================================================================

export interface IndicatorInfo {
  id: string;
  name: string;
  category: string;
  description: string;
  parameters: string[];
}

interface Props {
  onSelect?: (indicator: IndicatorInfo) => void;
  onClose: () => void;
}

// ============================================================================
// Indicator catalog (32 indicators)
// ============================================================================

const INDICATORS: IndicatorInfo[] = [
  // Trend (6)
  { id: "sma", name: "SMA", category: "Trend", description: "Simple Moving Average", parameters: ["period"] },
  { id: "ema", name: "EMA", category: "Trend", description: "Exponential Moving Average", parameters: ["period"] },
  { id: "wma", name: "WMA", category: "Trend", description: "Weighted Moving Average", parameters: ["period"] },
  { id: "dema", name: "DEMA", category: "Trend", description: "Double Exponential Moving Average", parameters: ["period"] },
  { id: "supertrend", name: "SuperTrend", category: "Trend", description: "Trend-following overlay with ATR bands", parameters: ["period", "multiplier"] },
  { id: "ichimoku", name: "Ichimoku", category: "Trend", description: "Ichimoku Cloud with 5 components", parameters: ["tenkan", "kijun", "senkou"] },

  // Momentum (6)
  { id: "rsi", name: "RSI", category: "Momentum", description: "Relative Strength Index", parameters: ["period"] },
  { id: "macd", name: "MACD", category: "Momentum", description: "Moving Average Convergence Divergence", parameters: ["fast", "slow", "signal"] },
  { id: "stoch", name: "Stochastic", category: "Momentum", description: "Stochastic Oscillator %K/%D", parameters: ["kPeriod", "dPeriod", "smooth"] },
  { id: "cci", name: "CCI", category: "Momentum", description: "Commodity Channel Index", parameters: ["period"] },
  { id: "williams", name: "Williams %R", category: "Momentum", description: "Williams Percent Range", parameters: ["period"] },
  { id: "roc", name: "ROC", category: "Momentum", description: "Rate of Change", parameters: ["period"] },

  // Volatility (5)
  { id: "bb", name: "Bollinger Bands", category: "Volatility", description: "Price bands at N standard deviations", parameters: ["period", "stdDev"] },
  { id: "atr", name: "ATR", category: "Volatility", description: "Average True Range", parameters: ["period"] },
  { id: "keltner", name: "Keltner Channels", category: "Volatility", description: "EMA-based volatility channels", parameters: ["period", "multiplier"] },
  { id: "donchian", name: "Donchian Channels", category: "Volatility", description: "Highest high / lowest low channels", parameters: ["period"] },
  { id: "stddev", name: "Std Deviation", category: "Volatility", description: "Rolling standard deviation of price", parameters: ["period"] },

  // Volume (5)
  { id: "obv", name: "OBV", category: "Volume", description: "On-Balance Volume", parameters: [] },
  { id: "vwap", name: "VWAP", category: "Volume", description: "Volume-Weighted Average Price", parameters: [] },
  { id: "ad", name: "A/D Line", category: "Volume", description: "Accumulation/Distribution Line", parameters: [] },
  { id: "mfi", name: "MFI", category: "Volume", description: "Money Flow Index", parameters: ["period"] },
  { id: "cmf", name: "CMF", category: "Volume", description: "Chaikin Money Flow", parameters: ["period"] },

  // Structure (5)
  { id: "pivot", name: "Pivot Points", category: "Structure", description: "Support/resistance pivot levels", parameters: ["type"] },
  { id: "fib", name: "Fibonacci Levels", category: "Structure", description: "Fibonacci retracement levels", parameters: ["swingHigh", "swingLow"] },
  { id: "sr", name: "Support/Resistance", category: "Structure", description: "Auto-detected S/R zones", parameters: ["lookback", "threshold"] },
  { id: "trendline", name: "Trendlines", category: "Structure", description: "Auto-drawn trend lines", parameters: ["lookback"] },
  { id: "patterns", name: "Chart Patterns", category: "Structure", description: "Detected chart patterns (H&S, triangles, etc.)", parameters: ["lookback"] },

  // Advanced (5)
  { id: "hurst", name: "Hurst Exponent", category: "Advanced", description: "Mean-reversion vs trend persistence measure", parameters: ["maxLag"] },
  { id: "entropy", name: "Shannon Entropy", category: "Advanced", description: "Market uncertainty / information measure", parameters: ["period"] },
  { id: "correlation", name: "Correlation Matrix", category: "Advanced", description: "Cross-asset rolling correlation", parameters: ["period", "assets"] },
  { id: "regime", name: "Regime Detector", category: "Advanced", description: "HMM-based market regime classification", parameters: ["states"] },
  { id: "fractal", name: "Fractal Dimension", category: "Advanced", description: "Price series complexity measure", parameters: ["period"] },
];

const CATEGORIES = ["Trend", "Momentum", "Volatility", "Volume", "Structure", "Advanced"];

const CATEGORY_COLOR: Record<string, string> = {
  Trend: "cyan",
  Momentum: "magenta",
  Volatility: "red",
  Volume: "blue",
  Structure: "yellow",
  Advanced: "green",
};

// ============================================================================
// Helpers
// ============================================================================

interface FlatEntry {
  type: "header" | "indicator";
  category?: string;
  count?: number;
  indicator?: IndicatorInfo;
}

function buildFlatList(): FlatEntry[] {
  const entries: FlatEntry[] = [];
  for (const cat of CATEGORIES) {
    const items = INDICATORS.filter((ind) => ind.category === cat);
    entries.push({ type: "header", category: cat, count: items.length });
    for (const ind of items) {
      entries.push({ type: "indicator", indicator: ind });
    }
  }
  return entries;
}

function selectableIndices(entries: FlatEntry[]): number[] {
  return entries.map((e, i) => (e.type === "indicator" ? i : -1)).filter((i) => i >= 0);
}

function padRight(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}

// ============================================================================
// Component
// ============================================================================

export function IndicatorBrowser({ onSelect, onClose }: Props) {
  const flatList = useMemo(() => buildFlatList(), []);
  const selectable = useMemo(() => selectableIndices(flatList), [flatList]);
  const [cursor, setCursor] = useState(0);

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => Math.min(selectable.length - 1, c + 1));
      return;
    }
    if (key.return) {
      const idx = selectable[cursor];
      if (idx === undefined) return;
      const entry = flatList[idx];
      if (entry?.indicator && onSelect) onSelect(entry.indicator);
    }
  });

  const selectedFlatIdx = selectable[cursor] ?? -1;
  const focusedIndicator = selectedFlatIdx >= 0 ? flatList[selectedFlatIdx]?.indicator : undefined;

  return (
    <Pane title="INDICATOR BROWSER" color="cyan">
      <Box>
        <Text dimColor>({INDICATORS.length} indicators)</Text>
      </Box>
      <Text> </Text>

      {/* List */}
      <Box flexDirection="column">
        {flatList.map((entry, i) => {
          if (entry.type === "header") {
            const catColor = CATEGORY_COLOR[entry.category!] ?? "white";
            return (
              <Box key={`hdr-${entry.category}`} marginTop={i > 0 ? 1 : 0}>
                <Text bold color={catColor}>
                  {entry.category!.toUpperCase()}
                </Text>
                <Text dimColor> ({entry.count})</Text>
              </Box>
            );
          }

          const ind = entry.indicator!;
          const isFocused = i === selectedFlatIdx;
          const pointer = isFocused ? "\u25B8 " : "  ";
          const catColor = CATEGORY_COLOR[ind.category] ?? "white";

          return (
            <Box key={ind.id} paddingLeft={1}>
              <Text color={isFocused ? "cyanBright" : undefined}>{pointer}</Text>
              <Box width={20}>
                <Text bold={isFocused} color={isFocused ? catColor : undefined}>
                  {padRight(ind.name, 20)}
                </Text>
              </Box>
              <Text dimColor>{ind.description}</Text>
            </Box>
          );
        })}
      </Box>

      {/* Focused indicator details */}
      {focusedIndicator && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>{"\u2500".repeat(40)}</Text>
          <Box>
            <Text bold color={CATEGORY_COLOR[focusedIndicator.category] ?? "white"}>
              {focusedIndicator.name}
            </Text>
            <Text dimColor> {"\u00b7"} </Text>
            <Text>{focusedIndicator.description}</Text>
          </Box>
          <Box>
            <Text dimColor>Parameters: </Text>
            <Text>
              {focusedIndicator.parameters.length > 0
                ? focusedIndicator.parameters.join(", ")
                : "none"}
            </Text>
          </Box>
        </Box>
      )}

      <Text> </Text>
      <Text dimColor>
        {"\u2191\u2193"} navigate {"\u00b7"} Enter select {"\u00b7"} Esc close
      </Text>
    </Pane>
  );
}
