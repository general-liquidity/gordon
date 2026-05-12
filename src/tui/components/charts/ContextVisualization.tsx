/**
 * ContextVisualization — Runtime context summary panel
 *
 * Shows:
 *   - Active positions count
 *   - Recent analysis symbols
 *   - Loaded strategies
 *   - Context window % used
 *   - Memory files loaded
 *
 * Formatted as a key-value table with labels and values.
 *
 * Phase 17 of the TUI rebuild.
 */

import React from "react";
import { Box, Text } from "../../ink-custom";

// ============================================================================
// Types
// ============================================================================

export interface ContextInfo {
  activePositions: number;
  recentSymbols: string[];
  loadedStrategies: string[];
  contextWindowPercent: number;
  memoryFilesLoaded: number;
}

interface Props {
  context: ContextInfo;
}

// ============================================================================
// Helpers
// ============================================================================

function contextBarColor(pct: number): string {
  if (pct >= 90) return "red";
  if (pct >= 70) return "yellow";
  return "green";
}

function renderBar(pct: number, width: number = 20): string {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  return "\u2588".repeat(filled) + "\u2591".repeat(empty);
}

// ============================================================================
// KeyValueRow
// ============================================================================

function KVRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box paddingLeft={2}>
      <Box width={24}>
        <Text dimColor>{label}</Text>
      </Box>
      <Box>{children}</Box>
    </Box>
  );
}

// ============================================================================
// Component
// ============================================================================

export function ContextVisualization({ context }: Props) {
  const {
    activePositions,
    recentSymbols,
    loadedStrategies,
    contextWindowPercent,
    memoryFilesLoaded,
  } = context;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      paddingY={0}
    >
      {/* Header */}
      <Box>
        <Text bold color="cyan">CONTEXT</Text>
      </Box>

      {/* Active positions */}
      <KVRow label="Active Positions">
        <Text bold color={activePositions > 0 ? "yellow" : "green"}>
          {activePositions}
        </Text>
      </KVRow>

      {/* Recent symbols */}
      <KVRow label="Recent Symbols">
        {recentSymbols.length > 0 ? (
          <Text>{recentSymbols.slice(0, 8).join(", ")}</Text>
        ) : (
          <Text dimColor>none</Text>
        )}
      </KVRow>

      {/* Loaded strategies */}
      <KVRow label="Loaded Strategies">
        {loadedStrategies.length > 0 ? (
          <Text>{loadedStrategies.slice(0, 5).join(", ")}</Text>
        ) : (
          <Text dimColor>none</Text>
        )}
      </KVRow>

      {/* Context window */}
      <KVRow label="Context Window">
        <Text color={contextBarColor(contextWindowPercent)}>
          {renderBar(contextWindowPercent)} {contextWindowPercent.toFixed(0)}%
        </Text>
      </KVRow>

      {/* Memory files */}
      <KVRow label="Memory Files">
        <Text>{memoryFilesLoaded}</Text>
      </KVRow>
    </Box>
  );
}
