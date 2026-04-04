import React from "react";
import { Text } from "ink";

// ============================================================================
// ThinkingToggle — Compact thinking mode indicator + toggle
// ============================================================================

import type { ThinkingConfig } from "../services/extendedThinking.js";

interface Props {
  config: ThinkingConfig;
  onToggle?: () => void;
}

function formatBudget(tokens: number): string {
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
  return String(tokens);
}

export function ThinkingToggle({ config, onToggle: _onToggle }: Props) {
  if (config.enabled) {
    return (
      <Text color="magenta" bold>
        THINKING: ON ({formatBudget(config.budgetTokens)} tokens)
      </Text>
    );
  }
  return <Text color="gray">THINKING: OFF</Text>;
}
