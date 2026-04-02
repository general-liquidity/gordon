import React from "react";
import { Text } from "ink";

import { COLORS } from "../../theme.ts";
import { DeskPanel } from "../desk/DeskPanel.tsx";

export interface CommandDeckItem {
  label: string;
  command: string;
  detail: string;
}

export const CommandDeck: React.FC<{
  items: CommandDeckItem[];
  selectedIndex: number;
}> = ({ items, selectedIndex }) => (
  <DeskPanel eyebrow="Command Deck" title="Command palette" subtitle="Arrow to move. Enter stages the command." tone="warning">
    {items.map((item, index) => {
      const active = index === selectedIndex;
      return (
        <Text key={`${item.command}:${item.detail}`} color={active ? COLORS.BRASS : COLORS.WHITE}>
          {active ? ">" : " "} {item.label}
          <Text color={COLORS.DIM}> · {item.detail} · {item.command}</Text>
        </Text>
      );
    })}
  </DeskPanel>
);
