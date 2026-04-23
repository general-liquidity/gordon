import React from "react";
import { Box, Text } from "ink";
import { ShimmerChar } from "./ShimmerChar.js";
import { useAnimationClock } from "../hooks/useAnimationClock.js";

// ============================================================================
// ShimmeredInput — Dimmed shimmer overlay while Gordon is processing
//
// Replaces the real input visually during streaming/processing.
// Animates a glimmer highlight sweeping across lastInput characters.
// Returns null when visible=false.
// ============================================================================

interface Props {
  lastInput: string;
  visible: boolean;
}

// Shimmer sweeps forward then wraps around — 80ms ticks feels fluid
const SHIMMER_INTERVAL_MS = 80;

export function ShimmeredInput({ lastInput, visible }: Props) {
  const frame = useAnimationClock(visible ? SHIMMER_INTERVAL_MS : 0);

  if (!visible) return null;

  // Glimmer index cycles through the full string length (plus padding so it
  // fully exits before re-entering from the left)
  const totalLen = lastInput.length + 4;
  const glimmerIndex = totalLen > 0 ? frame % totalLen : 0;

  const chars = lastInput.split("");

  return (
    <Box>
      {/* Prompt char — dim while processing */}
      <Text dimColor>{"❯"} </Text>

      {chars.length === 0 ? (
        <Text dimColor>{"…"}</Text>
      ) : (
        chars.map((char, i) => (
          <ShimmerChar
            key={i}
            char={char}
            charIndex={i}
            glimmerIndex={glimmerIndex}
          />
        ))
      )}
    </Box>
  );
}
