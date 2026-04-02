import React from "react";
import { Box, Text, useInput } from "ink";

import { COLORS } from "./theme.ts";
import { DeskPanel } from "./components/desk/DeskPanel.tsx";

export const DoctorPanel: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  useInput((input, key) => {
    if (key.return || key.escape || input.toLowerCase() === "q") {
      onComplete();
    }
  });

  return (
    <Box flexGrow={1} justifyContent="center" alignItems="center">
      <Box width={84}>
        <DeskPanel
          eyebrow="Doctor"
          title="Runtime doctor"
          subtitle="This panel now acts as a diagnostic staging surface instead of the old standalone wizard."
          tone="info"
        >
          <Text color={COLORS.WHITE}>Use /health, /runtime-state, /runtime-plugins, and /context for full diagnostics.</Text>
          <Text color={COLORS.DIM}>Press Enter, Esc, or Q to return.</Text>
        </DeskPanel>
      </Box>
    </Box>
  );
};
