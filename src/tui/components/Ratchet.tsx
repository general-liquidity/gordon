import React, { useState, useRef, useEffect } from "react";
import { Box, measureElement } from "ink";

// ============================================================================
// Ratchet — Prevents layout bounce
//
// Maintains minimum height equal to max height ever seen.
// Critical for live-updating tables that change row count
// (positions filling/closing, scan results updating).
// ============================================================================

interface Props {
  children: React.ReactNode;
}

export function Ratchet({ children }: Props) {
  const ref = useRef(null);
  const [minHeight, setMinHeight] = useState(0);

  useEffect(() => {
    if (ref.current) {
      const { height } = measureElement(ref.current);
      setMinHeight((prev) => Math.max(prev, height));
    }
  });

  return (
    <Box ref={ref} minHeight={minHeight} flexDirection="column">
      {children}
    </Box>
  );
}
