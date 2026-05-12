/**
 * RiskConfigPanel — All 8 risk checks with thresholds
 *
 * Shows each check with a ProgressBar (current/limit), pass/fail icon,
 * and color coding by threshold proximity. Mode selector at top.
 *
 * Pattern: Claude Code configuration panel with inline gauges.
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { Pane } from "../../design-system/Pane.js";
import { ProgressBar } from "../../design-system/ProgressBar.js";

// ============================================================================
// Types
// ============================================================================

export interface RiskCheck {
  id: string;
  name: string;
  currentValue: number;
  limit: number;
  passed: boolean;
  description: string;
}

export type RiskMode = "enforce" | "warn" | "paper";

interface Props {
  checks: RiskCheck[];
  mode: RiskMode;
  onModeChange?: (mode: RiskMode) => void;
  onThresholdChange?: (checkId: string, value: number) => void;
  onClose: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

const MODES: RiskMode[] = ["enforce", "warn", "paper"];

const MODE_COLOR: Record<RiskMode, string> = {
  enforce: "red",
  warn: "yellow",
  paper: "cyan",
};

function thresholdColor(ratio: number): string {
  if (ratio < 0.6) return "green";
  if (ratio < 0.8) return "yellow";
  return "red";
}

function padRight(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}

// ============================================================================
// Component
// ============================================================================

export function RiskConfigPanel({
  checks,
  mode,
  onModeChange,
  onThresholdChange,
  onClose,
}: Props) {
  const [cursor, setCursor] = useState(0);
  const [modeIndex, setModeIndex] = useState(MODES.indexOf(mode));

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => Math.min(checks.length - 1, c + 1));
      return;
    }
    if (input === "m") {
      const next = (modeIndex + 1) % MODES.length;
      setModeIndex(next);
      onModeChange?.(MODES[next]!);
    }
  });

  const activeMode = MODES[modeIndex] ?? mode;

  return (
    <Pane title="RISK CONFIGURATION" color="red">
      {/* Mode selector */}
      <Box>
        <Text dimColor>Mode: </Text>
        {MODES.map((m, i) => {
          const isActive = m === activeMode;
          return (
            <React.Fragment key={m}>
              {i > 0 && <Text dimColor> </Text>}
              <Text
                bold={isActive}
                color={isActive ? MODE_COLOR[m] : undefined}
                dimColor={!isActive}
              >
                [{m.toUpperCase()}]
              </Text>
            </React.Fragment>
          );
        })}
        <Text dimColor> (press m to cycle)</Text>
      </Box>
      <Text> </Text>

      {/* Column headers */}
      <Box paddingLeft={3}>
        <Box width={22}><Text bold dimColor>CHECK</Text></Box>
        <Box width={24}><Text bold dimColor>USAGE</Text></Box>
        <Box width={10}><Text bold dimColor>STATUS</Text></Box>
      </Box>

      {/* Check rows */}
      {checks.map((check, i) => {
        const isFocused = i === cursor;
        const pointer = isFocused ? "\u25B8 " : "  ";
        const ratio = check.limit > 0 ? check.currentValue / check.limit : 0;
        const color = thresholdColor(ratio);
        const icon = check.passed ? "\u2713" : "\u2717";
        const iconColor = check.passed ? "green" : "red";
        const pct = (ratio * 100).toFixed(0);

        return (
          <Box key={check.id} flexDirection="column">
            <Box>
              <Text color={isFocused ? "cyanBright" : undefined}>{pointer}</Text>
              <Box width={22}>
                <Text bold={isFocused}>{padRight(check.name, 22)}</Text>
              </Box>
              <Box width={24}>
                <ProgressBar value={Math.min(ratio, 1)} width={12} fillColor={color} />
                <Text color={color}> {pct}%</Text>
                <Text dimColor> ({check.currentValue}/{check.limit})</Text>
              </Box>
              <Box width={10}>
                <Text color={iconColor}>{icon} {check.passed ? "PASS" : "FAIL"}</Text>
              </Box>
            </Box>
            {isFocused && (
              <Box paddingLeft={4}>
                <Text dimColor>{check.description}</Text>
              </Box>
            )}
          </Box>
        );
      })}

      <Text> </Text>
      <Text dimColor>
        {"\u2191\u2193"} navigate {"\u00b7"} m cycle mode {"\u00b7"} Esc close
      </Text>
    </Pane>
  );
}
