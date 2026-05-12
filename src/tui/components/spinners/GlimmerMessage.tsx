import React, { useState, useEffect } from "react";
import { Box } from "../../ink-custom";
import { ShimmerChar } from "./ShimmerChar.js";
import { useAnimationClock } from "../../hooks/animation/useAnimationClock.js";

// ============================================================================
// GlimmerMessage — Sweeping shimmer animation across text
//
// A light-trail sweeps left-to-right across the message characters.
// When isActive is false, renders all characters without highlight.
// ============================================================================

interface Props {
  text: string;
  isActive: boolean;
}

export function GlimmerMessage({ text, isActive }: Props) {
  const [glimmerIndex, setGlimmerIndex] = useState(0);

  // Use shared animation clock instead of per-component setInterval
  const clockFrame = useAnimationClock(isActive ? 50 : 0);

  useEffect(() => {
    if (!isActive || text.length === 0) return;
    const totalLength = text.length + 4;
    setGlimmerIndex((prev) => (prev + 1) % totalLength);
  }, [clockFrame, isActive, text.length]);

  if (!isActive) {
    // Static render — no highlight
    return (
      <Box>
        {text.split("").map((char, i) => (
          <ShimmerChar key={i} char={char} glimmerIndex={-10} charIndex={i} />
        ))}
      </Box>
    );
  }

  return (
    <Box>
      {text.split("").map((char, i) => (
        <ShimmerChar key={i} char={char} glimmerIndex={glimmerIndex} charIndex={i} />
      ))}
    </Box>
  );
}
