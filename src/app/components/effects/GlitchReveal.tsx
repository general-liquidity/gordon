/**
 * GlitchReveal Component
 * "Decrypt" animation that resolves scrambled characters into target text.
 * Characters resolve left-to-right with a wave effect per line.
 *
 * Used for the startup banner — gives a "hacking the market" feel.
 */

import React, { useState, useEffect, useMemo } from "react";
import { Box, Text } from "ink";
import { getGradientColor, type GradientName, GRADIENTS } from "./GradientText.tsx";

// Block characters for the scrambled state — heavy, techy feel
const BLOCK_CHARS = "█▓▒░▄▀▐▌■□▪▫#@$%&*+=~";
const GLITCH_CHARS = "0123456789ABCDEFabcdef:.<>{}[]|/\\+-*#@";

export interface GlitchRevealProps {
  /** Target text to reveal (multi-line) */
  children: string;
  /** Duration of the reveal in ms (default: 1500) */
  duration?: number;
  /** Frame rate in ms (default: 50 = 20fps) */
  frameRate?: number;
  /** Character set: "block" for logo, "glitch" for text */
  charset?: "block" | "glitch";
  /** Color gradient for the revealed text */
  gradient?: readonly string[] | GradientName;
  /** Color for scrambled characters */
  scrambleColor?: string;
  /** Bold text */
  bold?: boolean;
  /** Callback when reveal completes */
  onComplete?: () => void;
}

function scrambleChar(charset: "block" | "glitch"): string {
  const chars = charset === "block" ? BLOCK_CHARS : GLITCH_CHARS;
  return chars[Math.floor(Math.random() * chars.length)]!;
}

/**
 * Compute revealed text at a given progress (0-1).
 * Characters resolve left-to-right with a wave effect across lines.
 */
function computeFrame(
  lines: string[],
  progress: number,
  charset: "block" | "glitch"
): string[] {
  return lines.map((line, lineIdx) => {
    // Each line resolves with a slight delay (wave effect)
    const lineProgress = progress + lineIdx * 0.04;
    const clampedProgress = Math.max(0, Math.min(1, lineProgress));

    const runes = [...line];
    const totalNonSpace = runes.filter((r) => r !== " " && r !== "\n").length;
    const resolved = Math.floor(totalNonSpace * clampedProgress);

    let nonSpaceIdx = 0;
    const result = runes.map((r) => {
      if (r === " " || r === "\n") return r;

      if (nonSpaceIdx < resolved) {
        nonSpaceIdx++;
        return r;
      }
      // Near the resolve frontier — occasionally show the correct char
      if (nonSpaceIdx < resolved + 3 && Math.random() < 0.3) {
        nonSpaceIdx++;
        return r;
      }

      nonSpaceIdx++;
      return scrambleChar(charset);
    });

    return result.join("");
  });
}

export const GlitchReveal: React.FC<GlitchRevealProps> = ({
  children,
  duration = 1500,
  frameRate = 50,
  charset = "block",
  gradient = "GORDON",
  scrambleColor = "#22c55e",
  bold = true,
  onComplete,
}) => {
  const [progress, setProgress] = useState(0);
  const lines = useMemo(() => children.split("\n"), [children]);
  const colors = typeof gradient === "string" ? GRADIENTS[gradient] : gradient;

  useEffect(() => {
    const totalFrames = Math.ceil(duration / frameRate);
    let frame = 0;

    const interval = setInterval(() => {
      frame++;
      const p = frame / totalFrames;
      setProgress(Math.min(1, p));

      if (p >= 1) {
        clearInterval(interval);
        onComplete?.();
      }
    }, frameRate);

    return () => clearInterval(interval);
  }, [duration, frameRate, onComplete]);

  const displayLines = progress >= 1 ? lines : computeFrame(lines, progress, charset);

  return (
    <Box flexDirection="column">
      {displayLines.map((line, i) => {
        // Apply gradient color per line (for both scrambled and resolved)
        const t = lines.length === 1 ? 0.5 : i / (lines.length - 1);
        const lineColor = progress >= 1
          ? getGradientColor(colors, t)
          : scrambleColor;

        return (
          <Text key={i} color={lineColor} bold={bold}>
            {line}
          </Text>
        );
      })}
    </Box>
  );
};

export default GlitchReveal;
