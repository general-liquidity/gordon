import React, { useState, useEffect } from "react";
import { Box } from "ink";
import { ShimmerChar } from "./ShimmerChar.js";

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

  useEffect(() => {
    if (!isActive || text.length === 0) return;

    const interval = setInterval(() => {
      setGlimmerIndex((prev) => {
        // Sweep across the text, then wrap around with a short gap
        const totalLength = text.length + 4; // 4-char gap before wrapping
        return (prev + 1) % totalLength;
      });
    }, 50);

    return () => clearInterval(interval);
  }, [isActive, text.length]);

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
