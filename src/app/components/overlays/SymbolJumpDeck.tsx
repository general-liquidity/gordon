import React from "react";
import { Text } from "ink";

import { COLORS } from "../../theme.ts";
import { DeskPanel } from "../desk/DeskPanel.tsx";

export const SymbolJumpDeck: React.FC<{
  symbols: string[];
  selectedIndex: number;
}> = ({ symbols, selectedIndex }) => (
  <DeskPanel eyebrow="Symbol Deck" title="Jump to symbol" subtitle="Enter stages /analyze for the selected symbol." tone="info">
    {symbols.map((symbol, index) => {
      const active = index === selectedIndex;
      return (
        <Text key={symbol} color={active ? COLORS.BRASS : COLORS.WHITE}>
          {active ? ">" : " "} {symbol}
        </Text>
      );
    })}
  </DeskPanel>
);
