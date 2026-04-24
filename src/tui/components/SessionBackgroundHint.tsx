/**
 * SessionBackgroundHint — Dim one-line hint shown when Gordon is running
 * in background mode with active strategies.
 *
 * Returns null when isActive is false.
 */

import React from "react";
import { Box, Text } from "../ink-custom";

// ============================================================================
// Types
// ============================================================================

interface Props {
  strategyCount: number;
  isActive: boolean;
}

// ============================================================================
// Component
// ============================================================================

export function SessionBackgroundHint({ strategyCount, isActive }: Props) {
  if (!isActive) return null;

  return (
    <Box paddingLeft={2}>
      <Text dimColor>
        {"Gordon is running in background · "}
        {strategyCount}
        {" strateg"}
        {strategyCount === 1 ? "y" : "ies"}
        {" active · /status to check"}
      </Text>
    </Box>
  );
}
