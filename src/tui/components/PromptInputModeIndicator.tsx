import React from "react";
import { Text } from "ink";

// ============================================================================
// PromptInputModeIndicator — Compact inline mode badge
//
// Shown inside or beside the prompt to indicate the current permission mode.
// Single line, bold text, no border.
// ============================================================================

interface Props {
  mode: string;
}

interface ModeConfig {
  label: string;
  color: string;
}

const MODE_CONFIG: Record<string, ModeConfig> = {
  auto:    { label: "[AUTO]",   color: "cyanBright" },
  ask:     { label: "[ASK]",    color: "yellow"     },
  strict:  { label: "[STRICT]", color: "red"        },
  paper:   { label: "[PAPER]",  color: "blue"       },
  observe: { label: "[OBS]",    color: "gray"       },
  plan:    { label: "[PLAN]",   color: "magenta"    },
};

export function PromptInputModeIndicator({ mode }: Props) {
  const config = MODE_CONFIG[mode] ?? { label: `[${mode.toUpperCase()}]`, color: "white" };

  return (
    <Text color={config.color} bold>
      {config.label}
    </Text>
  );
}
