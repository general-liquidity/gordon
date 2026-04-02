import React from "react";
import { Box, Text } from "ink";

import { COLORS } from "./theme.ts";
import { DeskPanel } from "./components/desk/DeskPanel.tsx";
import { OrbitalBoot } from "./components/effects/OrbitalBoot.tsx";

export const WelcomeBanner: React.FC<{ mode?: string; context?: string }> = ({
  mode = "full",
  context = "welcome",
}) => {
  const panelWidth = Math.max(88, Math.min((process.stdout.columns ?? 120) - 6, 132));

  return (
    <Box flexGrow={1} justifyContent="center" alignItems="center">
      <Box width={panelWidth}>
        <DeskPanel
          eyebrow={context === "welcome" ? "Boot" : "Onboarding"}
          title="Gordon Trading Terminal"
          subtitle="General Liquidity command center for agent-native market reasoning."
          tone="brand"
        >
          <Box flexDirection="column">
            {mode === "quiet" ? (
              <>
                <Text color={COLORS.BRASS}>◇ General Liquidity</Text>
                <Text color={COLORS.DIM}>logo boot suppressed in quiet mode</Text>
              </>
            ) : (
              <OrbitalBoot
                title="General Liquidity orbital"
                subtitle="Logo-derived boot sequence for Gordon."
                intervalMs={180}
              />
            )}
            <Text color={COLORS.WHITE}>conversation, thesis, review, execution</Text>
            <Text color={COLORS.DIM}>Press any key to continue. Press B to toggle quiet boot.</Text>
          </Box>
        </DeskPanel>
      </Box>
    </Box>
  );
};
