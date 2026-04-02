import React from "react";
import { Box, Text } from "ink";
import { FocusSelect } from "../PromptPrimitives.tsx";
import { DeskPanel } from "../desk/DeskPanel.tsx";
import { COLORS } from "../../theme.ts";

export interface CommandPaletteItem {
  label: string;
  command: string;
  detail?: string;
}

interface CommandPaletteOverlayProps {
  items: CommandPaletteItem[];
  onSelect: (command: string) => void;
}

export function CommandPaletteOverlay({
  items,
  onSelect,
}: CommandPaletteOverlayProps): React.ReactElement {
  return (
    <Box marginX={1} marginY={1} flexDirection="column">
      <DeskPanel
        eyebrow="Command Palette"
        title="One palette for the whole desk"
        subtitle="Workspace routes, live actions, staged commands."
        tone="brand"
      >
        <Text color={COLORS.DIM}>
          Pick an action or hit Escape to drop back to the desk.
        </Text>
      </DeskPanel>

      <Box marginTop={1}>
        <FocusSelect
          title="Palette actions"
          hint="Enter stages the selected route or command."
          options={items.map((item) => ({
            label: item.detail ? `${item.label} · ${item.detail}` : item.label,
            value: item.command,
          }))}
          onChange={onSelect}
        />
      </Box>
    </Box>
  );
}

export default CommandPaletteOverlay;
