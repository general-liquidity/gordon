import type React from "react";
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
    <Box borderStyle="round" borderColor={color} paddingX={1} flexDirection="column">
      {live ? (
        <>
          <Text color={color} bold>
            {"⚠"} LIVE TRADING — real money at risk
          </Text>
          <Text>
            {banner.mode === "auto"
              ? "mode: auto — approved orders reach the venue."
              : `mode: ${banner.mode} — each order still needs your approval.`}
          </Text>
          <Text>/paper to switch to simulated fills.</Text>
        </>
      ) : banner.mode === "paper" ? (
        <>
          <Text color={color} bold>
            {"▮"} PAPER TRADING — simulated fills only
          </Text>
          <Text>No order will reach a real venue.</Text>
          <Text>/ask or /auto to trade for real.</Text>
        </>
      ) : (
        <Text color={color} bold>
          Execution constrained — mode {banner.mode}.
        </Text>
      )}
      <Text dimColor>Esc/d dismiss</Text>
    </Box>
  );
}
