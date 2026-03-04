/**
 * TickerTape Component
 * Horizontally scrolling price ticker banner for the terminal.
 * Displays crypto symbols, prices, and percentage changes in a continuous loop.
 *
 * Each item renders as:  BTC $104,200.00 +2.30%
 * Items separated by dim " · " dividers.
 *
 * Usage:
 *   <TickerTape
 *     items={[
 *       { symbol: "BTC", price: 104200, change: 2.3 },
 *       { symbol: "ETH", price: 3280, change: -1.1 },
 *     ]}
 *     speed={100}
 *     direction="left"
 *   />
 */

import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useStdout } from "ink";
import { COLORS } from "../../theme.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TickerItem {
  /** Ticker symbol (e.g., "BTC", "ETH") */
  symbol: string;
  /** Current price in USD */
  price: number;
  /** Percentage change (positive = up, negative = down) */
  change: number;
}

export interface TickerTapeProps {
  /** Array of ticker items to display */
  items: TickerItem[];
  /** Milliseconds between each scroll tick (lower = faster). Default: 150 */
  speed?: number;
  /** Scroll direction. Default: "left" */
  direction?: "left" | "right";
  /** Visual hint for positioning — caller handles actual placement. Default: "top" */
  position?: "top" | "bottom";
  /** Optional callback fired on each scroll tick with the current offset */
  onTick?: (offset: number) => void;
}

// ---------------------------------------------------------------------------
// Formatting utilities
// ---------------------------------------------------------------------------

/**
 * Format a single ticker item into a display string.
 *
 * @example
 *   formatTickerItem({ symbol: "BTC", price: 104200, change: 2.3 })
 *   // → "BTC $104,200.00 +2.30%"
 */
export function formatTickerItem(item: TickerItem): string {
  const sign = item.change >= 0 ? "+" : "";
  const priceStr = item.price.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: item.price >= 1 ? 2 : 4,
    maximumFractionDigits: item.price >= 1 ? 2 : 4,
  });
  const changeStr = `${sign}${item.change.toFixed(2)}%`;
  return `${item.symbol} ${priceStr} ${changeStr}`;
}

/** Separator string between ticker items */
const SEPARATOR = " \u00B7 ";

/**
 * Build the full tape string by joining formatted items with separators.
 * A trailing separator is appended so the loop wraps seamlessly.
 */
function buildTapeContent(items: TickerItem[]): string {
  if (items.length === 0) return "";
  return items.map(formatTickerItem).join(SEPARATOR) + SEPARATOR;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const TickerTape: React.FC<TickerTapeProps> = ({
  items,
  speed = 150,
  direction = "left",
  position = "top",
  onTick,
}) => {
  const { stdout } = useStdout();
  const termWidth = stdout?.columns ?? 80;

  const [offset, setOffset] = useState(0);
  const onTickRef = useRef(onTick);

  // Keep the callback ref fresh without re-triggering the interval effect
  useEffect(() => {
    onTickRef.current = onTick;
  }, [onTick]);

  // Build the raw tape content (one copy of all items)
  const tapeUnit = buildTapeContent(items);
  const unitLength = tapeUnit.length;

  // We need enough repetitions to fill the terminal width + one extra unit
  // so the scroll loops seamlessly without visible gaps.
  const repeatCount = unitLength > 0 ? Math.ceil((termWidth / unitLength) + 2) : 0;
  const fullTape = tapeUnit.repeat(repeatCount);

  // Advance offset on interval
  useEffect(() => {
    if (unitLength === 0) return;

    const interval = setInterval(() => {
      setOffset((prev) => {
        const next = (prev + 1) % unitLength;
        onTickRef.current?.(next);
        return next;
      });
    }, speed);

    return () => clearInterval(interval);
  }, [speed, unitLength]);

  // Nothing to render
  if (items.length === 0 || unitLength === 0) {
    return null;
  }

  // Compute the visible window start position
  const start = direction === "left" ? offset : (unitLength - offset) % unitLength;

  // ---------------------------------------------------------------------------
  // Render: color each character according to which segment it belongs to
  // ---------------------------------------------------------------------------

  // Pre-compute the colored segments for the visible slice.
  // We walk through the original tape structure so we know which item (and which
  // part of that item) each character belongs to.
  const segments = buildColoredSegments(items, start, termWidth, fullTape);

  return (
    <Box
      width={termWidth}
      height={1}
      overflow="hidden"
      borderStyle="single"
      borderTop={position === "bottom"}
      borderBottom={position === "top"}
      borderLeft={false}
      borderRight={false}
      borderColor={COLORS.DIM}
    >
      <Box>
        {segments.map((seg, i) => (
          <Text key={i} color={seg.color} bold={seg.bold} dimColor={seg.dim}>
            {seg.text}
          </Text>
        ))}
      </Box>
    </Box>
  );
};

// ---------------------------------------------------------------------------
// Segment building — maps characters to themed colors
// ---------------------------------------------------------------------------

interface ColorSegment {
  text: string;
  color: string;
  bold: boolean;
  dim: boolean;
}

/**
 * Walk the ticker tape at a given offset and produce colored segments
 * that respect the theme: symbol in WHITE, price in HIGHLIGHT,
 * change in GREEN/RED, separators in DIM.
 */
function buildColoredSegments(
  items: TickerItem[],
  startOffset: number,
  width: number,
  fullTape: string,
): ColorSegment[] {
  if (items.length === 0) return [];

  // Build a color map for one unit of the tape, then tile it.
  const unitParts: ColorSegment[] = [];

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx]!;
    const changeColor = item.change >= 0 ? COLORS.GREEN : COLORS.RED;

    // Symbol
    unitParts.push({
      text: item.symbol,
      color: COLORS.WHITE,
      bold: true,
      dim: false,
    });

    // Space before price
    unitParts.push({ text: " ", color: COLORS.WHITE, bold: false, dim: false });

    // Price
    const priceStr = item.price.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: item.price >= 1 ? 2 : 4,
      maximumFractionDigits: item.price >= 1 ? 2 : 4,
    });
    unitParts.push({
      text: priceStr,
      color: COLORS.HIGHLIGHT,
      bold: false,
      dim: false,
    });

    // Space before change
    unitParts.push({ text: " ", color: COLORS.WHITE, bold: false, dim: false });

    // Change percentage
    const sign = item.change >= 0 ? "+" : "";
    const changeStr = `${sign}${item.change.toFixed(2)}%`;
    unitParts.push({
      text: changeStr,
      color: changeColor,
      bold: true,
      dim: false,
    });

    // Separator after item
    unitParts.push({
      text: SEPARATOR,
      color: COLORS.DIM,
      bold: false,
      dim: true,
    });
  }

  // Flatten the unit into a character-level color array
  const unitCharColors: Array<{ color: string; bold: boolean; dim: boolean }> = [];
  for (const part of unitParts) {
    for (const _ch of part.text) {
      unitCharColors.push({ color: part.color, bold: part.bold, dim: part.dim });
    }
  }

  const unitLen = unitCharColors.length;
  if (unitLen === 0) return [];

  // Build output segments by grouping consecutive characters with the same style
  const segments: ColorSegment[] = [];
  let currentText = "";
  let currentStyle = unitCharColors[startOffset % unitLen]!;

  for (let i = 0; i < width; i++) {
    const charIdx = (startOffset + i) % unitLen;
    const style = unitCharColors[charIdx]!;
    const ch = fullTape[startOffset + i] ?? " ";

    if (
      style.color === currentStyle.color &&
      style.bold === currentStyle.bold &&
      style.dim === currentStyle.dim
    ) {
      currentText += ch;
    } else {
      if (currentText) {
        segments.push({
          text: currentText,
          color: currentStyle.color,
          bold: currentStyle.bold,
          dim: currentStyle.dim,
        });
      }
      currentText = ch;
      currentStyle = style;
    }
  }

  // Push final segment
  if (currentText) {
    segments.push({
      text: currentText,
      color: currentStyle.color,
      bold: currentStyle.bold,
      dim: currentStyle.dim,
    });
  }

  return segments;
}

export default TickerTape;
