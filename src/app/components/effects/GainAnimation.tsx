/**
 * GainAnimation Component
 * Animated celebration (rocket) or crash (explosion) effect for the terminal.
 * Triggered on significant price movements to give Gordon some personality.
 *
 * - Gain mode: rocket ascending with exhaust trail, resolves to green percentage
 * - Loss mode: downward crash with expanding explosion, resolves to red percentage
 *
 * Supports both emoji and ASCII rendering for terminal compatibility.
 */

import React, { useState, useEffect, useCallback } from "react";
import { Box, Text } from "ink";
import { COLORS } from "../../theme.ts";

// ---------------------------------------------------------------------------
// ASCII art pieces
// ---------------------------------------------------------------------------

const ASCII_ROCKET = [
  " /^\\ ",
  " |A| ",
  " |.| ",
  " \\|/ ",
];

const ASCII_EXHAUST_CHARS = [":", ".", "'", "*", ","];
const ASCII_STAR_CHARS = ["*", "+", "."];
const ASCII_DEBRIS_CHARS = ["*", "#", "@", "!", "~", "^"];

// ---------------------------------------------------------------------------
// Frame generators
// ---------------------------------------------------------------------------

/** Build a single gain frame. `step` is 0-based. */
function buildGainFrame(
  step: number,
  totalSteps: number,
  magnitude: number,
  useEmoji: boolean,
): string[] {
  const width = 24;
  const height = 10;
  const lines: string[] = [];

  // Rocket position rises from bottom to top
  const rocketRow = Math.max(0, height - 2 - step * 2);
  // Horizontal sway for flavour
  const sway = Math.round(Math.sin(step * 1.2) * 2);
  const rocketCol = Math.floor(width / 2) + sway;

  // Intensity scales with magnitude — more stars / longer exhaust
  const exhaustLength = Math.min(step + 1, Math.ceil(magnitude / 5) + 1);
  const starCount = Math.min(step, Math.ceil(magnitude / 10));

  // Seed some deterministic-ish star positions
  const stars: Array<{ r: number; c: number; ch: string }> = [];
  for (let s = 0; s < starCount; s++) {
    const sr = ((s * 7 + step * 3) % height);
    const sc = ((s * 13 + step * 5) % width);
    const ch = useEmoji ? "✨" : ASCII_STAR_CHARS[s % ASCII_STAR_CHARS.length]!;
    stars.push({ r: sr, c: sc, ch });
  }

  for (let r = 0; r < height; r++) {
    let line = " ".repeat(width);

    // Draw stars
    for (const star of stars) {
      if (star.r === r && star.c < width) {
        const arr = [...line];
        arr[star.c] = star.ch;
        line = arr.join("");
      }
    }

    // Draw rocket
    if (useEmoji) {
      if (r === rocketRow) {
        const arr = [...line];
        const pos = Math.max(0, Math.min(rocketCol, width - 2));
        arr[pos] = "\u{1F680}"; // rocket emoji
        line = arr.join("");
      }
    } else {
      // Multi-line ASCII rocket
      const rocketLines = ASCII_ROCKET;
      for (let rl = 0; rl < rocketLines.length; rl++) {
        if (r === rocketRow + rl) {
          const piece = rocketLines[rl]!;
          const startCol = Math.max(0, rocketCol - Math.floor(piece.length / 2));
          const before = line.slice(0, startCol);
          const after = line.slice(startCol + piece.length);
          line = (before + piece + after).slice(0, width);
        }
      }
    }

    // Draw exhaust trail below rocket
    const exhaustStart = useEmoji ? rocketRow + 1 : rocketRow + ASCII_ROCKET.length;
    if (r >= exhaustStart && r < exhaustStart + exhaustLength) {
      const dist = r - exhaustStart;
      const ch = useEmoji
        ? (dist === 0 ? "🔥" : "⋮")
        : ASCII_EXHAUST_CHARS[dist % ASCII_EXHAUST_CHARS.length]!;
      const pos = Math.max(0, Math.min(rocketCol, width - 2));
      const arr = [...line];
      arr[pos] = ch;
      line = arr.join("");
    }

    lines.push(line);
  }

  return lines;
}

/** Build a single loss frame. `step` is 0-based. */
function buildLossFrame(
  step: number,
  totalSteps: number,
  magnitude: number,
  useEmoji: boolean,
): string[] {
  const width = 24;
  const height = 8;
  const lines: string[] = [];

  const centerR = Math.floor(height / 2);
  const centerC = Math.floor(width / 2);

  // Explosion radius expands with each step, scaled by magnitude
  const baseRadius = step + 1;
  const radius = Math.min(baseRadius + Math.floor(magnitude / 15), Math.min(centerR, centerC) - 1);

  for (let r = 0; r < height; r++) {
    const chars: string[] = new Array(width).fill(" ");

    for (let c = 0; c < width; c++) {
      const dr = r - centerR;
      const dc = c - centerC;
      const dist = Math.sqrt(dr * dr + dc * dc);

      if (dist <= radius && dist > radius - 2) {
        // Outer ring of explosion
        const idx = Math.floor((c + r + step) * 7) % ASCII_DEBRIS_CHARS.length;
        chars[c] = useEmoji
          ? (Math.random() < 0.3 ? "💥" : ASCII_DEBRIS_CHARS[idx]!)
          : ASCII_DEBRIS_CHARS[idx]!;
      } else if (dist <= radius - 2 && dist > 0 && step > 1) {
        // Inner debris cloud — gets sparser over time
        if (Math.random() < 0.25) {
          chars[c] = useEmoji ? "🔻" : ".";
        }
      }

      // Center marker on early frames
      if (r === centerR && c === centerC && step <= 1) {
        chars[c] = useEmoji ? "📉" : "X";
      }
    }

    lines.push(chars.join(""));
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface GainAnimationProps {
  /** Animation type: celebration for gains, crash for losses */
  type: "gain" | "loss";
  /** Magnitude of the move in percentage points (e.g. 15 for 15%) — affects intensity */
  magnitude: number;
  /** The actual percentage to display at the end (e.g. 15.2) */
  percentage: number;
  /** Total animation duration in ms (default 1500) */
  duration?: number;
  /** Milliseconds per frame (default 120) */
  frameRate?: number;
  /** Show the percentage after animation completes (default true) */
  showPercentage?: boolean;
  /** Use emoji instead of ASCII art (default false) */
  useEmoji?: boolean;
  /** Callback fired when animation finishes */
  onComplete?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const GainAnimation: React.FC<GainAnimationProps> = ({
  type,
  magnitude,
  percentage,
  duration = 1500,
  frameRate = 120,
  showPercentage = true,
  useEmoji = false,
  onComplete,
}) => {
  const [frameIdx, setFrameIdx] = useState(0);
  const [done, setDone] = useState(false);

  const totalFrames = Math.max(1, Math.ceil(duration / frameRate));

  const handleComplete = useCallback(() => {
    setDone(true);
    onComplete?.();
  }, [onComplete]);

  // Frame ticker
  useEffect(() => {
    let frame = 0;
    const interval = setInterval(() => {
      frame++;
      setFrameIdx(frame);

      if (frame >= totalFrames) {
        clearInterval(interval);
        handleComplete();
      }
    }, frameRate);

    return () => clearInterval(interval);
  }, [totalFrames, frameRate, handleComplete]);

  // After completion — render final result
  if (done) {
    if (!showPercentage) return null;

    const sign = type === "gain" ? "+" : "-";
    const color = type === "gain" ? COLORS.GREEN : COLORS.RED;
    const icon = useEmoji ? (type === "gain" ? " \u{1F4C8}" : " \u{1F4C9}") : "";
    const arrow = useEmoji ? "" : (type === "gain" ? "  ^" : "  v");

    return (
      <Box justifyContent="center" paddingY={1}>
        <Text color={color} bold>
          {sign}
          {Math.abs(percentage).toFixed(1)}%{icon}{arrow}
        </Text>
      </Box>
    );
  }

  // Build current frame
  const frameLines =
    type === "gain"
      ? buildGainFrame(frameIdx, totalFrames, magnitude, useEmoji)
      : buildLossFrame(frameIdx, totalFrames, magnitude, useEmoji);

  const primaryColor = type === "gain" ? COLORS.GREEN : COLORS.RED;
  const trailColor = COLORS.DIM;

  return (
    <Box flexDirection="column">
      {frameLines.map((line, i) => {
        // Colorize: bright chars get the primary color, dim chars get trail color
        const hasContent = line.trim().length > 0;
        // Lines closer to the "action" get brighter color
        const isBright =
          type === "gain"
            ? i <= Math.ceil(frameLines.length / 2)
            : Math.abs(i - Math.floor(frameLines.length / 2)) <= 2;

        return (
          <Text
            key={i}
            color={hasContent ? (isBright ? primaryColor : trailColor) : undefined}
            bold={isBright && hasContent}
          >
            {line}
          </Text>
        );
      })}
      {/* Subtle percentage hint during animation */}
      <Box justifyContent="center" marginTop={1}>
        <Text color={COLORS.DIM} dimColor>
          {type === "gain" ? "+" : "-"}
          {Math.abs(percentage).toFixed(1)}%
        </Text>
      </Box>
    </Box>
  );
};

export default GainAnimation;
