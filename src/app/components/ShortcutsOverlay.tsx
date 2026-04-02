import React from "react";
import { Box, Text } from "ink";

import { COLORS } from "../theme.ts";
import { DeskPanel } from "./desk/DeskPanel.tsx";

export const ShortcutsOverlay: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <Box marginX={2} marginY={1}>
    <DeskPanel
      eyebrow="Shortcuts"
      title="Operator command book"
      subtitle="Esc closes."
      tone="info"
    >
      <Box flexDirection="column">
        <Text color={COLORS.WHITE}>1-5 workspace routes when the prompt is empty</Text>
        <Text color={COLORS.WHITE}>[ / ] cycle workspaces</Text>
        <Text color={COLORS.WHITE}>Ctrl+K quick actions</Text>
        <Text color={COLORS.WHITE}>Ctrl+J symbol jump</Text>
        <Text color={COLORS.WHITE}>Ctrl+R review desk</Text>
        <Text color={COLORS.WHITE}>PgUp/PgDn/Home/End transcript</Text>
        <Text color={COLORS.DIM}>Use /help for command coverage.</Text>
      </Box>
    </DeskPanel>
  </Box>
);

export const ShortcutsHint: React.FC = () => (
  <Text color={COLORS.DIM}>? shortcuts</Text>
);

export function useShortcutsHint(): string {
  return "? shortcuts";
}

