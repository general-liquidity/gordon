/**
 * TradeWaterfall Component
 * Animated sequential reveal of trade execution details in the terminal.
 * Each line appears one after another with a brief delay, fading from
 * dim to bright — giving a "data streaming in" feel after an order fills.
 *
 * Usage:
 *   <TradeWaterfall
 *     symbol="BTCUSDT"
 *     side="BUY"
 *     price={104200}
 *     quantity={0.05}
 *     total={5210}
 *     fee={5.21}
 *     onComplete={() => console.log("done")}
 *   />
 */

import React, { useState, useEffect, useCallback } from "react";
import { Box, Text } from "ink";
import { COLORS } from "../../theme.ts";

/** Trade details passed to the waterfall */
export interface TradeDetails {
  /** Trading pair symbol, e.g. "BTCUSDT" */
  symbol: string;
  /** Order side */
  side: "BUY" | "SELL";
  /** Execution price */
  price: number;
  /** Order quantity */
  quantity: number;
  /** Total value (price * quantity) */
  total: number;
  /** Trading fee (optional) */
  fee?: number;
  /** Exchange order ID (optional) */
  orderId?: string;
  /** Execution timestamp (optional) */
  time?: string;
}

export interface TradeWaterfallProps extends TradeDetails {
  /** Delay in ms between each line reveal (default: 150) */
  delay?: number;
  /** Compact mode — hides fee, order ID, and time lines (default: false) */
  compact?: boolean;
  /** Called when all lines have been revealed */
  onComplete?: () => void;
}

// ── Formatting helpers ─────────────────────────────────────────────

/** Format a number as USD with commas and 2 decimal places */
function formatUSD(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Extract the base asset from a symbol (e.g. "BTCUSDT" -> "BTC") */
function extractBaseAsset(symbol: string): string {
  const quoteAssets = ["USDT", "USDC", "BUSD", "USD", "EUR", "BTC", "ETH", "BNB"];
  for (const quote of quoteAssets) {
    if (symbol.endsWith(quote) && symbol.length > quote.length) {
      return symbol.slice(0, -quote.length);
    }
  }
  return symbol;
}

// ── Line definitions ───────────────────────────────────────────────

interface WaterfallLine {
  /** Label portion (left side) */
  label: string;
  /** Value portion (right side) */
  value: string;
  /** Color for the label text */
  labelColor: string;
  /** Color for the value text */
  valueColor: string;
  /** Bold the value */
  bold?: boolean;
  /** Whether this is a decorative border line (rendered as a single span) */
  isBorder?: boolean;
}

function buildLines(trade: TradeDetails, compact: boolean): WaterfallLine[] {
  const sideColor = trade.side === "BUY" ? COLORS.GREEN : COLORS.RED;
  const base = extractBaseAsset(trade.symbol);

  const lines: WaterfallLine[] = [];

  // Header border
  lines.push({
    label: "─── Trade Executed ───",
    value: "",
    labelColor: sideColor,
    valueColor: sideColor,
    bold: true,
    isBorder: true,
  });

  // Side
  lines.push({
    label: "Side:     ",
    value: trade.side,
    labelColor: COLORS.DIM,
    valueColor: sideColor,
    bold: true,
  });

  // Symbol
  lines.push({
    label: "Symbol:   ",
    value: trade.symbol,
    labelColor: COLORS.DIM,
    valueColor: COLORS.WHITE,
  });

  // Price
  lines.push({
    label: "Price:    ",
    value: formatUSD(trade.price),
    labelColor: COLORS.DIM,
    valueColor: COLORS.HIGHLIGHT,
    bold: true,
  });

  // Quantity
  lines.push({
    label: "Quantity: ",
    value: `${trade.quantity} ${base}`,
    labelColor: COLORS.DIM,
    valueColor: COLORS.WHITE,
  });

  // Total
  lines.push({
    label: "Total:    ",
    value: formatUSD(trade.total),
    labelColor: COLORS.DIM,
    valueColor: COLORS.WHITE,
    bold: true,
  });

  // Optional lines (hidden in compact mode)
  if (!compact) {
    if (trade.fee !== undefined) {
      lines.push({
        label: "Fee:      ",
        value: formatUSD(trade.fee),
        labelColor: COLORS.DIM,
        valueColor: COLORS.ACCENT_DIM,
      });
    }

    if (trade.orderId !== undefined) {
      lines.push({
        label: "Order ID: ",
        value: trade.orderId,
        labelColor: COLORS.DIM,
        valueColor: COLORS.ACCENT_DIM,
      });
    }

    if (trade.time !== undefined) {
      lines.push({
        label: "Time:     ",
        value: trade.time,
        labelColor: COLORS.DIM,
        valueColor: COLORS.ACCENT_DIM,
      });
    }
  }

  // Footer border
  lines.push({
    label: "─────────────────────",
    value: "",
    labelColor: COLORS.ACCENT_DIM,
    valueColor: COLORS.ACCENT_DIM,
    isBorder: true,
  });

  return lines;
}

// ── Dim variants for fade-in effect ────────────────────────────────

/** Map a color to its dim counterpart for the first fade frame */
function dimColor(color: string): string {
  const DIM_MAP: Record<string, string> = {
    [COLORS.GREEN]: "#15803d",
    [COLORS.RED]: "#991b1b",
    [COLORS.WHITE]: COLORS.DIM,
    [COLORS.HIGHLIGHT]: "#92400e",
    [COLORS.DIM]: "#3f3f46",
    [COLORS.ACCENT_DIM]: COLORS.DIM,
  };
  return DIM_MAP[color] ?? COLORS.DIM;
}

// ── Fade state per line ────────────────────────────────────────────

type LineState = "hidden" | "dim" | "bright";

// ── Component ──────────────────────────────────────────────────────

export const TradeWaterfall: React.FC<TradeWaterfallProps> = ({
  delay = 150,
  compact = false,
  onComplete,
  ...trade
}) => {
  const lines = buildLines(trade, compact);
  const totalLines = lines.length;

  // Each line transitions through: hidden -> dim -> bright
  // The dim frame lasts one tick before transitioning to bright
  const [lineStates, setLineStates] = useState<LineState[]>(
    () => Array(totalLines).fill("hidden") as LineState[]
  );

  const [completeFired, setCompleteFired] = useState(false);

  const stableOnComplete = useCallback(() => {
    onComplete?.();
  }, [onComplete]);

  useEffect(() => {
    // We schedule 2 frames per line: one for dim, one for bright.
    // dim  at: lineIndex * delay
    // bright at: lineIndex * delay + dimDuration
    const DIM_DURATION = Math.min(80, Math.floor(delay * 0.5));
    const timers: ReturnType<typeof setTimeout>[] = [];

    for (let i = 0; i < totalLines; i++) {
      // Dim frame
      const dimTime = i * delay;
      timers.push(
        setTimeout(() => {
          setLineStates((prev) => {
            const next = [...prev];
            next[i] = "dim";
            return next;
          });
        }, dimTime)
      );

      // Bright frame
      const brightTime = dimTime + DIM_DURATION;
      timers.push(
        setTimeout(() => {
          setLineStates((prev) => {
            const next = [...prev];
            next[i] = "bright";
            return next;
          });
        }, brightTime)
      );
    }

    // Complete callback after last line is bright
    const completeTime = (totalLines - 1) * delay + DIM_DURATION + 50;
    timers.push(
      setTimeout(() => {
        setCompleteFired(true);
      }, completeTime)
    );

    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [totalLines, delay]);

  // Fire onComplete once
  useEffect(() => {
    if (completeFired) {
      stableOnComplete();
    }
  }, [completeFired, stableOnComplete]);

  return (
    <Box flexDirection="column" paddingLeft={1}>
      {lines.map((line, i) => {
        const state = lineStates[i] ?? "hidden";

        if (state === "hidden") {
          return <Text key={i}>{" "}</Text>;
        }

        const isDim = state === "dim";

        if (line.isBorder) {
          return (
            <Text
              key={i}
              color={isDim ? dimColor(line.labelColor) : line.labelColor}
              bold={line.bold}
              dimColor={isDim}
            >
              {line.label}
            </Text>
          );
        }

        return (
          <Text key={i}>
            <Text color={isDim ? dimColor(line.labelColor) : line.labelColor}>
              {line.label}
            </Text>
            <Text
              color={isDim ? dimColor(line.valueColor) : line.valueColor}
              bold={line.bold}
            >
              {line.value}
            </Text>
          </Text>
        );
      })}
    </Box>
  );
};

export default TradeWaterfall;
