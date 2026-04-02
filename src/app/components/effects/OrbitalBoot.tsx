import React, { useEffect, useMemo, useState } from "react";
import { Box, Text } from "ink";

import {
  GENERAL_LIQUIDITY_ASCII,
  GENERAL_LIQUIDITY_ASCII_COMPACT,
} from "../../assets/generalLiquidityAscii.ts";
import { COLORS } from "../../theme.ts";

const SWEEP_STEP = 6;
const SWEEP_FRAME_COUNT = 24;

function getSweepColor(character: string, x: number, y: number, frameIndex: number, maxWidth: number): string {
  if (character === " ") {
    return COLORS.DIM;
  }

  const sweepCenter = ((frameIndex * SWEEP_STEP) % (maxWidth + 18)) - 9;
  const bandDistance = Math.abs((x + y * 0.35) - sweepCenter);

  if (bandDistance <= 1.4) {
    return /[@#%*=+]/u.test(character) ? COLORS.MONEY : COLORS.ICE;
  }
  if (bandDistance <= 3.2) {
    return COLORS.BRASS;
  }
  if (/[#%@]/u.test(character)) {
    return COLORS.BRASS;
  }
  if (/[+=*:.-]/u.test(character)) {
    return COLORS.BRASS_DIM;
  }
  return COLORS.DIM;
}

function renderStyledLine(line: string, y: number, frameIndex: number, maxWidth: number): React.ReactElement {
  const segments: Array<{ text: string; color: string }> = [];

  for (let x = 0; x < line.length; x += 1) {
    const character = line[x] ?? " ";
    const color = getSweepColor(character, x, y, frameIndex, maxWidth);
    const previous = segments[segments.length - 1];
    if (previous && previous.color === color) {
      previous.text += character;
    } else {
      segments.push({ text: character, color });
    }
  }

  return (
    <Text key={`${frameIndex}:${y}`}>
      {segments.map((segment, index) => (
        <Text key={`${y}:${index}`} color={segment.color}>
          {segment.text}
        </Text>
      ))}
    </Text>
  );
}

interface OrbitalBootProps {
  compact?: boolean;
  title?: string;
  subtitle?: string;
  intervalMs?: number;
}

export function OrbitalBoot({
  compact = false,
  title = "Orbital boot",
  subtitle = "Initializing the Gordon trading stack.",
  intervalMs = 280,
}: OrbitalBootProps): React.ReactElement {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % SWEEP_FRAME_COUNT);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  const frame = useMemo(
    () => (compact ? GENERAL_LIQUIDITY_ASCII_COMPACT : GENERAL_LIQUIDITY_ASCII),
    [compact],
  );
  const maxWidth = useMemo(
    () => frame.reduce((current, line) => Math.max(current, line.length), 0),
    [frame],
  );

  return (
    <Box flexDirection="column">
      <Text color={COLORS.BRASS} bold>{title}</Text>
      {frame.map((line, index) => renderStyledLine(line, index, frameIndex, maxWidth))}
      <Text color={COLORS.DIM}>{subtitle}</Text>
    </Box>
  );
}

export default OrbitalBoot;
