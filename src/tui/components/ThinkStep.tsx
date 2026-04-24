/**
 * ThinkStep — Collapsible agent reasoning display (trading-adapted)
 *
 * Compact (default): ∴ Analyzing risk dimensions... · 3s
 * Expanded (Ctrl+O):  Full reasoning text
 * After complete:     ∴ analyzed for 3s
 *
 * Trading-contextual labels based on agent name.
 */

import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useInput } from "../ink-custom";
import { GlimmerMessage } from "./GlimmerMessage.js";

// ============================================================================
// Types
// ============================================================================

interface Props {
  reasoning: string;
  agentName?: string;
  elapsedMs?: number;
  isComplete?: boolean;
}

// ============================================================================
// Trading-contextual thinking labels
// ============================================================================

const THINKING_LABELS: Record<string, string> = {
  gordon: "Thinking",
  executor: "Preparing execution",
  researcher: "Researching",
  scanner: "Scanning markets",
  analyst: "Analyzing charts",
  planner: "Building trade plan",
  monitor: "Checking positions",
  backtester: "Running backtest",
  critic: "Evaluating risk",
};

function getThinkingLabel(agentName?: string): string {
  if (agentName && THINKING_LABELS[agentName]) return THINKING_LABELS[agentName]!;
  return "Thinking";
}

// ============================================================================
// Helpers
// ============================================================================

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ============================================================================
// Component
// ============================================================================

export function ThinkStep({ reasoning, agentName, elapsedMs, isComplete = false }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [showShimmer, setShowShimmer] = useState(false);
  const mountTimeRef = useRef(Date.now());

  // Shimmer glow starts after 3s delay (Claude Code pattern)
  useEffect(() => {
    if (isComplete) return;
    const timer = setTimeout(() => setShowShimmer(true), 3000);
    return () => clearTimeout(timer);
  }, [isComplete]);

  // Minimum 2s display before allowing collapse
  const [minDisplayMet, setMinDisplayMet] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setMinDisplayMet(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  // Ctrl+O to toggle expand
  useInput((input, key) => {
    if (key.ctrl && input === "o") {
      setExpanded((e) => !e);
    }
  });

  const label = getThinkingLabel(agentName);
  const elapsedStr = elapsedMs != null ? formatElapsed(elapsedMs) : "";

  // After completion: "∴ analyzed for 3s"
  if (isComplete && minDisplayMet) {
    return (
      <Box paddingLeft={2} marginTop={0}>
        <Text dimColor italic>
          {"\u2234"} {label.toLowerCase().replace(/ing$/, "ed").replace(/think$/, "thought")} for {elapsedStr}
        </Text>
      </Box>
    );
  }

  // Compact mode (default)
  if (!expanded) {
    return (
      <Box flexDirection="column" paddingLeft={2}>
        <Box>
          {showShimmer ? (
            <GlimmerMessage text={`\u2234 ${label}\u2026`} isActive={true} />
          ) : (
            <Text dimColor italic>{"\u2234"} {label}{"\u2026"}</Text>
          )}
          {elapsedStr && (
            <>
              <Text dimColor> {"\u00b7"} </Text>
              <Text dimColor>{elapsedStr}</Text>
            </>
          )}
          <Text dimColor> {"\u00b7"} Ctrl+O expand</Text>
        </Box>
      </Box>
    );
  }

  // Expanded mode
  const lines = reasoning.split("\n").filter((l) => l.trim().length > 0).slice(0, 8);
  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Box>
        <Text dimColor italic>{"\u2234"} {label}{"\u2026"}</Text>
        {elapsedStr && (
          <>
            <Text dimColor> {"\u00b7"} </Text>
            <Text dimColor>{elapsedStr}</Text>
          </>
        )}
        <Text dimColor> {"\u00b7"} Ctrl+O collapse</Text>
      </Box>
      <Box flexDirection="column" paddingLeft={2}>
        {lines.map((line, i) => (
          <Text key={i} dimColor>{line}</Text>
        ))}
        {reasoning.split("\n").length > 8 && (
          <Text dimColor>... (+{reasoning.split("\n").length - 8} more)</Text>
        )}
      </Box>
    </Box>
  );
}
