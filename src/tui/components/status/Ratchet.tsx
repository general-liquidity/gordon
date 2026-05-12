import React, { useState, useRef, useEffect } from "react";
import { Box, measureElement } from "../../ink-custom";

// ============================================================================
// Ratchet — Prevents layout bounce + offscreen optimization
//
// Maintains minimum height equal to max height ever seen.
// When lock="offscreen", replaces children with empty space to save CPU.
// Critical for live-updating tables and old messages above viewport.
// ============================================================================

interface Props {
  children: React.ReactNode;
  /** "offscreen" locks height and hides children. "visible" (default) renders normally with min-height ratchet. */
  lock?: "offscreen" | "visible";
}

export function Ratchet({ children, lock = "visible" }: Props) {
  const ref = useRef(null);
  const [minHeight, setMinHeight] = useState(0);

  useEffect(() => {
    if (ref.current) {
      const { height } = measureElement(ref.current);
      setMinHeight((prev) => Math.max(prev, height));
    }
  });

  // Offscreen: lock height, skip rendering children
  if (lock === "offscreen" && minHeight > 0) {
    return <Box height={minHeight} />;
  }

  return (
    <Box ref={ref} minHeight={minHeight} flexDirection="column">
      {children}
    </Box>
  );
}
