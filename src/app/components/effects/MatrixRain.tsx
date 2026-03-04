/**
 * MatrixRain Component
 * Animated matrix-style falling characters in the terminal.
 * Designed for brief startup splash — runs for a set duration then calls onComplete.
 *
 * Uses raw character grids rendered via Ink's Text component.
 * Color gradient from bright white (head) → bright green → dark green (tail).
 */

import React, { useState, useEffect, useMemo } from "react";
import { Box, Text, useStdout } from "ink";

const MATRIX_CHARS = "0123456789ABCDEFabcdef:.<>{}[]|/\\+-*#@$!?~^&=";

interface Column {
  pos: number;      // Current head row (negative = delayed start)
  speed: number;    // Ticks between advances
  length: number;   // Trail length
  chars: string[];  // Character at each row
  tick: number;     // Counter for speed gating
}

function randomChar(): string {
  return MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)]!;
}

function createColumn(height: number): Column {
  return {
    pos: -(Math.floor(Math.random() * (height + 10))),
    speed: 1 + Math.floor(Math.random() * 3),
    length: 4 + Math.floor(Math.random() * (Math.floor(height / 2) + 1)),
    chars: Array.from({ length: height }, () => randomChar()),
    tick: 0,
  };
}

// Color stops for the rain trail (head → tail)
const TRAIL_COLORS = [
  "#ffffff", // Head: bright white
  "#4ade80", // Near head: bright green
  "#22c55e", // Green
  "#16a34a", // Medium green
  "#15803d", // Dark green
  "#052e16", // Very dark green (tail)
] as const;

function getTrailColor(dist: number, length: number): string {
  if (dist === 0) return TRAIL_COLORS[0]!;
  if (dist === 1) return TRAIL_COLORS[1]!;
  const t = dist / length;
  if (t <= 0.25) return TRAIL_COLORS[2]!;
  if (t <= 0.5) return TRAIL_COLORS[3]!;
  if (t <= 0.75) return TRAIL_COLORS[4]!;
  return TRAIL_COLORS[5]!;
}

export interface MatrixRainProps {
  /** Duration in ms before auto-stop (default: 2000) */
  duration?: number;
  /** Frame rate in ms (default: 60 = ~16fps) */
  frameRate?: number;
  /** Override width (defaults to terminal width) */
  width?: number;
  /** Override height (defaults to min(terminal height, 20)) */
  height?: number;
  /** Called when the rain duration ends */
  onComplete?: () => void;
}

export const MatrixRain: React.FC<MatrixRainProps> = ({
  duration = 2000,
  frameRate = 60,
  width: widthOverride,
  height: heightOverride,
  onComplete,
}) => {
  const { stdout } = useStdout();
  const termWidth = widthOverride ?? (stdout?.columns ?? 80);
  const termHeight = heightOverride ?? Math.min(stdout?.rows ?? 24, 20);

  // Use ~half the terminal width for density (every other column)
  const colCount = Math.floor(termWidth / 2);
  const rowCount = termHeight;

  const columns = useMemo(
    () => Array.from({ length: colCount }, () => createColumn(rowCount)),
    [colCount, rowCount]
  );

  const [frame, setFrame] = useState(0);
  const [done, setDone] = useState(false);

  // Advance simulation
  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((f) => f + 1);

      // Advance each column
      for (const col of columns) {
        col.tick++;
        if (col.tick < col.speed) continue;
        col.tick = 0;
        col.pos++;

        // New char at head
        if (col.pos >= 0 && col.pos < rowCount) {
          col.chars[col.pos] = randomChar();
        }

        // Shimmer: randomly change trail characters
        for (let j = Math.max(0, col.pos - col.length); j < col.pos && j < rowCount; j++) {
          if (j >= 0 && Math.random() < 0.08) {
            col.chars[j] = randomChar();
          }
        }

        // Reset when fully past screen
        if (col.pos - col.length > rowCount) {
          col.pos = -(Math.floor(Math.random() * (rowCount / 2 + 5)));
          col.speed = 1 + Math.floor(Math.random() * 3);
          col.length = 4 + Math.floor(Math.random() * (Math.floor(rowCount / 2) + 1));
        }
      }
    }, frameRate);

    return () => clearInterval(interval);
  }, [columns, rowCount, frameRate]);

  // Duration timer
  useEffect(() => {
    const timer = setTimeout(() => {
      setDone(true);
      onComplete?.();
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onComplete]);

  if (done) return null;

  // Render grid
  const rows: React.ReactNode[] = [];
  for (let y = 0; y < rowCount; y++) {
    const chars: React.ReactNode[] = [];
    for (let x = 0; x < colCount; x++) {
      const col = columns[x]!;

      // Not in trail range → space
      if (col.pos < 0 || y > col.pos || y < col.pos - col.length) {
        chars.push(
          <Text key={x} color="#09090b">
            {"  "}
          </Text>
        );
        continue;
      }

      const dist = col.pos - y;
      const ch = col.chars[y] ?? " ";
      const color = getTrailColor(dist, col.length);
      const isBold = dist <= 1;

      chars.push(
        <Text key={x} color={color} bold={isBold}>
          {ch}{" "}
        </Text>
      );
    }

    rows.push(
      <Box key={y}>
        {chars}
      </Box>
    );
  }

  return <Box flexDirection="column">{rows}</Box>;
};

export default MatrixRain;
