import React from "react";
import { Box, Text, useInput } from "../../ink-custom";
import type { ModeBannerState } from "../../state/types.ts";
import { useTheme } from "../../themes/ThemeProvider.tsx";

export function TradingModeBanner({
  banner,
  onDismiss,
}: {
  banner: ModeBannerState;
  onDismiss: () => void;
}): React.JSX.Element | null {
  const theme = useTheme();
  useInput((input, key) => {
    if (key.escape || input === "d" || input === "D") onDismiss();
  });

  if (banner.dismissed) return null;
  const live = banner.liveCapable;
  const color = live ? theme.riskDanger : theme.riskWarning;
  return (
    <Box borderStyle="round" borderColor={color} paddingX={1}>
      <Text color={color} bold>
        {live
          ? `LIVE TRADING CAPABLE - mode ${banner.mode}. Real orders may execute under risk rules.`
          : banner.mode === "paper"
            ? "PAPER MODE - simulated fills only."
            : `Execution constrained - mode ${banner.mode}.`}
      </Text>
      <Text dimColor> Esc/d dismiss</Text>
    </Box>
  );
}
