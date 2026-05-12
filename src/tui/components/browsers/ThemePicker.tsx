import React, { useState } from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { THEME_NAMES, THEMES } from "../../themes/themes.js";

// ============================================================================
// ThemePicker — Interactive theme selector with color preview swatches
// ============================================================================

interface Props { onSelect: (themeName: string) => void; onClose: () => void; }

export function ThemePicker({ onSelect, onClose }: Props) {
  const [selected, setSelected] = useState(0);

  useInput((_, key) => {
    if (key.escape) onClose();
    else if (key.return) onSelect(THEME_NAMES[selected]!);
    else if (key.upArrow) setSelected((p) => Math.max(0, p - 1));
    else if (key.downArrow) setSelected((p) => Math.min(THEME_NAMES.length - 1, p + 1));
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyanBright" paddingX={1}>
      <Text bold color="cyanBright">SELECT THEME</Text>
      {THEME_NAMES.map((name, i) => {
        const theme = THEMES[name]!;
        return (
          <Box key={name}>
            <Text color={i === selected ? "cyanBright" : undefined}>{i === selected ? "\u25B8 " : "  "}</Text>
            <Text bold={i === selected}>{name.padEnd(22)}</Text>
            <Text color={theme.moneyProfit}>{"\u2588"}</Text>
            <Text color={theme.moneyLoss}>{"\u2588"}</Text>
            <Text color={theme.uiBrand}>{"\u2588"}</Text>
            <Text color={theme.riskWarning}>{"\u2588"}</Text>
            <Text color={theme.signalBuy}>{"\u2588"}</Text>
            <Text color={theme.agentGordon}>{"\u2588"}</Text>
          </Box>
        );
      })}
      <Text dimColor>Enter to apply {"\u00B7"} Esc to cancel</Text>
    </Box>
  );
}
