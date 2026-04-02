import React from "react";
import { Box } from "ink";
import { FocusSelect } from "../PromptPrimitives.tsx";
import { DeskPanel } from "../desk/DeskPanel.tsx";

interface SymbolJumpOverlayProps {
  symbols: string[];
  onSelect: (symbol: string) => void;
}

export function SymbolJumpOverlay({
  symbols,
  onSelect,
}: SymbolJumpOverlayProps): React.ReactElement {
  const options = symbols.map((symbol) => ({
    label: `${symbol} · analyze`,
    value: symbol,
  }));

  return (
    <Box marginX={1} marginY={1} flexDirection="column">
      <DeskPanel
        eyebrow="Symbol Jump"
        title="Jump one symbol into focus"
        subtitle="Route to Market and seed a fresh analysis."
        tone="analysis"
      />

      <Box marginTop={1}>
        <FocusSelect
          title="Focus symbol"
          hint="Symbols come from scans, plans, holdings, positions, and orders."
          options={options.length > 0 ? options : [{ label: "BTC · analyze", value: "BTC" }]}
          onChange={onSelect}
        />
      </Box>
    </Box>
  );
}

export default SymbolJumpOverlay;
