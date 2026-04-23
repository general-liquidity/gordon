import React from "react";
import { Text } from "ink";

// ============================================================================
// SpinnerGlyph — Low-level animated spinner glyph (single rotating character)
//
// Accepts an external frame counter from useAnimationClock so it stays in
// sync with other animated components that share the same clock.
// When stalled: shows a solid red ● regardless of frame.
// ============================================================================

const DEFAULT_FRAMES = ["·", "✢", "✳", "✶", "✻", "✽"];
const DEFAULT_ALL_FRAMES = [...DEFAULT_FRAMES, ...[...DEFAULT_FRAMES].reverse()];

interface Props {
  /** External frame counter (from useAnimationClock) */
  frame?: number;
  /** Ink color string — default "cyanBright" */
  color?: string;
  /** When true, renders a solid red ● instead of the animation */
  stalled?: boolean;
  /** Custom frame set — forwards then reverse is applied automatically */
  frames?: string[];
}

export function SpinnerGlyph({ frame = 0, color = "cyanBright", stalled = false, frames }: Props) {
  if (stalled) {
    return <Text color="red">{"●"}</Text>;
  }

  const allFrames = frames
    ? [...frames, ...[...frames].reverse()]
    : DEFAULT_ALL_FRAMES;

  const char = allFrames[frame % allFrames.length] ?? "·";

  return <Text color={color}>{char}</Text>;
}
