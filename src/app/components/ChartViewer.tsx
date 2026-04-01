/**
 * Chart Viewer Component
 * Terminal-based chart display with multiple rendering options
 *
 * Features:
 * - ASCII art representation of price action
 * - Terminal image protocol support (iTerm2, Kitty)
 * - Option to open chart in default image viewer
 * - Support/resistance level display
 * - Keyboard navigation
 */

import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { COLORS } from "../theme.ts";
import { DeskPanel } from "./desk/DeskPanel.tsx";
import { TicketCard } from "./desk/TicketCard.tsx";

// ============================================================================
// Types
// ============================================================================

export interface PriceLevel {
  price: number;
  type: "support" | "resistance";
  strength?: "strong" | "moderate" | "weak";
}

export interface ChartData {
  symbol: string;
  timeframe: string;
  asciiChart?: string;
  imagePath?: string;
  currentPrice?: number;
  priceChange?: number;
  priceChangePercent?: number;
  levels?: PriceLevel[];
  indicators?: {
    rsi?: number | null;
    ma20?: number | null;
    ma50?: number | null;
  };
  patterns?: string[];
  analysis?: {
    trend?: string;
    bias?: string;
    summary?: string;
    recommendation?: string;
  };
}

export interface ChartViewerProps {
  data: ChartData;
  /** Show technical analysis panel */
  showAnalysis?: boolean;
  /** Show key price levels */
  showLevels?: boolean;
  /** Callback when user presses 'o' to open image */
  onOpenImage?: (path: string) => void;
  /** Callback when user presses 'r' to refresh */
  onRefresh?: () => void;
  /** Callback when user changes timeframe */
  onTimeframeChange?: (timeframe: string) => void;
  /** Enable keyboard controls */
  interactive?: boolean;
}

// ============================================================================
// Helper Components
// ============================================================================

/**
 * Format price with appropriate precision
 */
function formatPrice(price: number): string {
  if (price >= 10000) return price.toFixed(0);
  if (price >= 100) return price.toFixed(1);
  if (price >= 1) return price.toFixed(2);
  if (price >= 0.01) return price.toFixed(4);
  return price.toFixed(6);
}

/**
 * Price Level Indicator
 */
const LevelIndicator: React.FC<{ level: PriceLevel }> = ({ level }) => {
  const color = level.type === "support" ? COLORS.GREEN : COLORS.RED;
  const icon = level.type === "support" ? "S" : "R";
  const strengthIcon =
    level.strength === "strong" ? "***" : level.strength === "moderate" ? "**" : "*";

  return (
    <Box gap={1}>
      <Text color={color} bold>
        [{icon}]
      </Text>
      <Text color={COLORS.WHITE}>${formatPrice(level.price)}</Text>
      <Text color={COLORS.DIM}>{strengthIcon}</Text>
    </Box>
  );
};

/**
 * Technical Indicator Display
 */
const IndicatorPanel: React.FC<{
  rsi?: number | null;
  ma20?: number | null;
  ma50?: number | null;
  currentPrice?: number;
}> = ({ rsi, ma20, ma50, currentPrice }) => {
  // RSI color based on value
  const getRSIColor = (val: number | null | undefined): string => {
    if (val === null || val === undefined) return COLORS.DIM;
    if (val > 70) return COLORS.RED;
    if (val < 30) return COLORS.GREEN;
    return COLORS.WHITE;
  };

  // RSI status
  const getRSIStatus = (val: number | null | undefined): string => {
    if (val === null || val === undefined) return "N/A";
    if (val > 70) return "Overbought";
    if (val > 60) return "Bullish";
    if (val < 30) return "Oversold";
    if (val < 40) return "Bearish";
    return "Neutral";
  };

  // MA position relative to price
  const getMAPosition = (ma: number | null | undefined, price: number | undefined): string => {
    if (!ma || !price) return "";
    const diff = ((price - ma) / ma) * 100;
    if (Math.abs(diff) < 0.5) return "(at price)";
    return diff > 0 ? `(+${diff.toFixed(1)}%)` : `(${diff.toFixed(1)}%)`;
  };

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={COLORS.ACCENT_DIM} bold>
        Indicators
      </Text>
      <Box flexDirection="column" paddingLeft={1}>
        {/* RSI */}
        <Box gap={2}>
          <Box width={10}>
            <Text color={COLORS.DIM}>RSI(14):</Text>
          </Box>
          <Text color={getRSIColor(rsi)}>
            {rsi !== null && rsi !== undefined ? rsi.toFixed(1) : "N/A"}
          </Text>
          <Text color={COLORS.DIM}>{getRSIStatus(rsi)}</Text>
        </Box>

        {/* MA20 */}
        <Box gap={2}>
          <Box width={10}>
            <Text color={COLORS.YELLOW}>MA20:</Text>
          </Box>
          <Text color={COLORS.WHITE}>
            {ma20 !== null && ma20 !== undefined ? `$${formatPrice(ma20)}` : "N/A"}
          </Text>
          <Text color={COLORS.DIM}>{getMAPosition(ma20, currentPrice)}</Text>
        </Box>

        {/* MA50 */}
        <Box gap={2}>
          <Box width={10}>
            <Text color={COLORS.BLUE}>MA50:</Text>
          </Box>
          <Text color={COLORS.WHITE}>
            {ma50 !== null && ma50 !== undefined ? `$${formatPrice(ma50)}` : "N/A"}
          </Text>
          <Text color={COLORS.DIM}>{getMAPosition(ma50, currentPrice)}</Text>
        </Box>
      </Box>
    </Box>
  );
};

/**
 * Analysis Panel Component
 */
const AnalysisPanel: React.FC<{
  trend?: string;
  bias?: string;
  patterns?: string[];
  summary?: string;
  recommendation?: string;
}> = ({ trend, bias, patterns, summary, recommendation }) => {
  // Trend color
  const getTrendColor = (t: string | undefined): string => {
    if (!t) return COLORS.DIM;
    const lower = t.toLowerCase();
    if (lower.includes("bullish") || lower.includes("buy")) return COLORS.GREEN;
    if (lower.includes("bearish") || lower.includes("sell")) return COLORS.RED;
    return COLORS.YELLOW;
  };

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={COLORS.ACCENT_DIM} bold>
        Analysis
      </Text>
      <Box flexDirection="column" paddingLeft={1}>
        {/* Trend and Bias */}
        <Box gap={2}>
          <Box width={8}>
            <Text color={COLORS.DIM}>Trend:</Text>
          </Box>
          <Text color={getTrendColor(trend)} bold>
            {trend || "N/A"}
          </Text>
          <Text color={COLORS.DIM}>|</Text>
          <Text color={COLORS.DIM}>Bias:</Text>
          <Text color={getTrendColor(bias)} bold>
            {bias || "N/A"}
          </Text>
        </Box>

        {/* Patterns */}
        {patterns && patterns.length > 0 && (
          <Box gap={2}>
            <Box width={10}>
              <Text color={COLORS.DIM}>Patterns:</Text>
            </Box>
            <Box flexDirection="column">
              {patterns.slice(0, 3).map((p, i) => (
                <Text key={i} color={COLORS.HIGHLIGHT}>
                  {p}
                </Text>
              ))}
            </Box>
          </Box>
        )}

        {/* Summary */}
        {summary && (
          <Box marginTop={1}>
            <Text color={COLORS.SECONDARY} wrap="wrap">
              {summary}
            </Text>
          </Box>
        )}

        {/* Recommendation */}
        {recommendation && (
          <Box marginTop={1}>
            <Text color={COLORS.DIM}>Rec: </Text>
            <Text color={COLORS.ACCENT} wrap="wrap">
              {recommendation}
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};

/**
 * Key Levels Panel Component
 */
const LevelsPanel: React.FC<{
  levels?: PriceLevel[];
  currentPrice?: number;
}> = ({ levels, currentPrice }) => {
  if (!levels || levels.length === 0) return null;

  const supports = levels.filter((l) => l.type === "support");
  const resistances = levels.filter((l) => l.type === "resistance");

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={COLORS.ACCENT_DIM} bold>
        Key Levels
      </Text>
      <Box paddingLeft={1} gap={4}>
        {/* Support Levels */}
        <Box flexDirection="column">
          <Text color={COLORS.GREEN} bold>
            Support
          </Text>
          {supports.length > 0 ? (
            supports.map((s, i) => (
              <Box key={i} gap={1}>
                <Text color={COLORS.GREEN}>${formatPrice(s.price)}</Text>
                {currentPrice && (
                  <Text color={COLORS.DIM}>
                    ({(((currentPrice - s.price) / s.price) * 100).toFixed(1)}%)
                  </Text>
                )}
              </Box>
            ))
          ) : (
            <Text color={COLORS.DIM}>None detected</Text>
          )}
        </Box>

        {/* Resistance Levels */}
        <Box flexDirection="column">
          <Text color={COLORS.RED} bold>
            Resistance
          </Text>
          {resistances.length > 0 ? (
            resistances.map((r, i) => (
              <Box key={i} gap={1}>
                <Text color={COLORS.RED}>${formatPrice(r.price)}</Text>
                {currentPrice && (
                  <Text color={COLORS.DIM}>
                    ({(((r.price - currentPrice) / currentPrice) * 100).toFixed(1)}%)
                  </Text>
                )}
              </Box>
            ))
          ) : (
            <Text color={COLORS.DIM}>None detected</Text>
          )}
        </Box>
      </Box>
    </Box>
  );
};

// ============================================================================
// Main Component
// ============================================================================

export const ChartViewer: React.FC<ChartViewerProps> = ({
  data,
  showAnalysis = true,
  showLevels = true,
  onOpenImage,
  onRefresh,
  onTimeframeChange,
  interactive = true,
}) => {
  const [selectedTimeframe, setSelectedTimeframe] = useState(data.timeframe);
  const timeframes = ["1h", "4h", "1d"];

  // Keyboard controls
  useInput(
    (input, key) => {
      if (!interactive) return;

      // Refresh
      if (input === "r" || input === "R") {
        onRefresh?.();
      }

      // Open image
      if ((input === "o" || input === "O") && data.imagePath && onOpenImage) {
        onOpenImage(data.imagePath);
      }

      // Timeframe navigation
      if (key.leftArrow || key.rightArrow) {
        const currentIndex = timeframes.indexOf(selectedTimeframe);
        let newIndex: number;

        if (key.leftArrow) {
          newIndex = currentIndex > 0 ? currentIndex - 1 : timeframes.length - 1;
        } else {
          newIndex = currentIndex < timeframes.length - 1 ? currentIndex + 1 : 0;
        }

        const newTimeframe = timeframes[newIndex]!;
        setSelectedTimeframe(newTimeframe);
        onTimeframeChange?.(newTimeframe);
      }
    },
    { isActive: interactive }
  );

  // Price change formatting
  const changeColor = (data.priceChangePercent ?? 0) >= 0 ? COLORS.GREEN : COLORS.RED;
  const changeSign = (data.priceChangePercent ?? 0) >= 0 ? "+" : "";

  return (
    <DeskPanel
      eyebrow="Chart Desk"
      title={`${data.symbol} · ${data.timeframe}`}
      subtitle={data.currentPrice !== undefined
        ? `${formatPrice(data.currentPrice)}${data.priceChangePercent !== undefined ? ` · ${changeSign}${data.priceChangePercent.toFixed(2)}%` : ""}`
        : "Terminal chart view"}
      tone="analysis"
    >
      {/* Header */}
      <Box justifyContent="space-between" marginBottom={1}>
        <Box gap={2}>
          <Text color={COLORS.ACCENT} bold>
            {data.symbol}
          </Text>
          <Text color={COLORS.DIM}>|</Text>
          <Text color={COLORS.HIGHLIGHT}>{data.timeframe}</Text>
        </Box>

        {/* Price */}
        {data.currentPrice !== undefined && (
          <Box gap={2}>
            <Text color={COLORS.WHITE} bold>
              ${formatPrice(data.currentPrice)}
            </Text>
            {data.priceChangePercent !== undefined && (
              <Text color={changeColor}>
                {changeSign}
                {data.priceChangePercent.toFixed(2)}%
              </Text>
            )}
          </Box>
        )}
      </Box>

      {/* Timeframe Selector */}
      {interactive && onTimeframeChange && (
        <Box marginBottom={1}>
          <Text color={COLORS.DIM}>Timeframe: </Text>
          {timeframes.map((tf, i) => (
            <React.Fragment key={tf}>
              {i > 0 && <Text color={COLORS.DIM}> | </Text>}
              <Text
                color={tf === selectedTimeframe ? COLORS.HIGHLIGHT : COLORS.DIM}
                bold={tf === selectedTimeframe}
              >
                {tf}
              </Text>
            </React.Fragment>
          ))}
          <Text color={COLORS.DIM}> (use arrow keys)</Text>
        </Box>
      )}

      {/* ASCII Chart */}
      {data.asciiChart && (
        <Box flexDirection="column">
          <Text>{data.asciiChart}</Text>
        </Box>
      )}

      {/* Indicators Panel */}
      {data.indicators && (
        <IndicatorPanel
          rsi={data.indicators.rsi}
          ma20={data.indicators.ma20}
          ma50={data.indicators.ma50}
          currentPrice={data.currentPrice}
        />
      )}

      {/* Key Levels */}
      {showLevels && data.levels && (
        <LevelsPanel levels={data.levels} currentPrice={data.currentPrice} />
      )}

      {/* Analysis Panel */}
      {showAnalysis && data.analysis && (
        <AnalysisPanel
          trend={data.analysis.trend}
          bias={data.analysis.bias}
          patterns={data.patterns}
          summary={data.analysis.summary}
          recommendation={data.analysis.recommendation}
        />
      )}

      {/* Footer with controls */}
      {interactive && (
        <Box marginTop={1} gap={3}>
          <Text color={COLORS.MUTED}>
            Press{" "}
            <Text color={COLORS.DIM}>R</Text> to refresh
          </Text>
          {data.imagePath && onOpenImage && (
            <Text color={COLORS.MUTED}>
              <Text color={COLORS.DIM}>O</Text> to open image
            </Text>
          )}
        </Box>
      )}
    </DeskPanel>
  );
};

// ============================================================================
// Compact Chart Display
// ============================================================================

export interface CompactChartProps {
  symbol: string;
  timeframe: string;
  trend: "bullish" | "bearish" | "neutral";
  price: number;
  change: number;
  rsi?: number | null;
  support?: number;
  resistance?: number;
}

/**
 * Compact chart summary for inline display
 */
export const CompactChart: React.FC<CompactChartProps> = ({
  symbol,
  timeframe,
  trend,
  price,
  change,
  rsi,
  support,
  resistance,
}) => {
  const trendColor =
    trend === "bullish" ? COLORS.GREEN : trend === "bearish" ? COLORS.RED : COLORS.YELLOW;
  const changeColor = change >= 0 ? COLORS.GREEN : COLORS.RED;
  const changeSign = change >= 0 ? "+" : "";

  // Mini sparkline representation
  const trendArrow = trend === "bullish" ? "/^" : trend === "bearish" ? "\\v" : "--";

  return (
    <TicketCard
      eyebrow="Compact Chart"
      title={`${symbol} · ${timeframe}`}
      subtitle={`${trend.charAt(0).toUpperCase() + trend.slice(1)} trend`}
      tone={trend === "bullish" ? "success" : trend === "bearish" ? "danger" : "warning"}
    >
      <Box gap={2}>
      {/* Symbol and timeframe */}
      <Box flexDirection="column" width={12}>
        <Text color={COLORS.ACCENT} bold>
          {symbol}
        </Text>
        <Text color={COLORS.DIM}>{timeframe}</Text>
      </Box>

      {/* Trend indicator */}
      <Box flexDirection="column" width={10}>
        <Text color={trendColor} bold>
          {trendArrow} {trend.charAt(0).toUpperCase() + trend.slice(1)}
        </Text>
        {rsi !== null && rsi !== undefined && (
          <Text color={COLORS.DIM}>RSI: {rsi.toFixed(0)}</Text>
        )}
      </Box>

      {/* Price and change */}
      <Box flexDirection="column" width={16}>
        <Text color={COLORS.WHITE} bold>
          ${formatPrice(price)}
        </Text>
        <Text color={changeColor}>
          {changeSign}
          {change.toFixed(2)}%
        </Text>
      </Box>

      {/* Levels */}
      <Box flexDirection="column" width={20}>
        {support && (
          <Box gap={1}>
            <Text color={COLORS.GREEN}>S:</Text>
            <Text color={COLORS.DIM}>${formatPrice(support)}</Text>
          </Box>
        )}
        {resistance && (
          <Box gap={1}>
            <Text color={COLORS.RED}>R:</Text>
            <Text color={COLORS.DIM}>${formatPrice(resistance)}</Text>
          </Box>
        )}
      </Box>
      </Box>
    </TicketCard>
  );
};

// ============================================================================
// Chart Loading State
// ============================================================================

export interface ChartLoadingProps {
  symbol: string;
  message?: string;
}

export const ChartLoading: React.FC<ChartLoadingProps> = ({
  symbol,
  message = "Generating chart...",
}) => {
  const [dots, setDots] = useState("");

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? "" : prev + "."));
    }, 300);

    return () => clearInterval(interval);
  }, []);

  return (
    <TicketCard
      eyebrow="Chart Desk"
      title={symbol}
      subtitle={`${message}${dots}`}
      tone="info"
    />
  );
};

// ============================================================================
// Chart Error State
// ============================================================================

export interface ChartErrorProps {
  symbol: string;
  error: string;
  onRetry?: () => void;
}

export const ChartError: React.FC<ChartErrorProps> = ({ symbol, error, onRetry }) => {
  useInput((input) => {
    if ((input === "r" || input === "R") && onRetry) {
      onRetry();
    }
  });

  return (
    <TicketCard
      eyebrow="Chart Error"
      title={symbol}
      subtitle={error}
      tone="danger"
      actions={onRetry ? ["Retry: R"] : undefined}
    />
  );
};

export default ChartViewer;
