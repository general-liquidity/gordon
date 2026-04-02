import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

import type { OnboardingSelection } from "./setup-flow.ts";
import { COLORS } from "./theme.ts";
import { DeskPanel } from "./components/desk/DeskPanel.tsx";

const OPTIONS: OnboardingSelection[] = [
  { mode: "quickstart" },
  { mode: "advanced" },
  { mode: "demo" },
];

const COPY: Record<OnboardingSelection["mode"], { title: string; detail: string }> = {
  quickstart: { title: "Quickstart", detail: "Fast operator bootstrap with sane defaults." },
  advanced: { title: "Advanced setup", detail: "Walk venues, rails, MCP, and preferences deliberately." },
  demo: { title: "Demo mode", detail: "Skip setup and open a read-only desk." },
};

export const Onboarding: React.FC<{
  onComplete: (selection: OnboardingSelection) => void | Promise<void>;
}> = ({ onComplete }) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) setSelectedIndex((current) => (current - 1 + OPTIONS.length) % OPTIONS.length);
    else if (key.downArrow) setSelectedIndex((current) => (current + 1) % OPTIONS.length);
    else if (key.return) void onComplete(OPTIONS[selectedIndex]!);
    else if (/^[1-3]$/u.test(input)) {
      const index = Number.parseInt(input, 10) - 1;
      if (OPTIONS[index]) {
        setSelectedIndex(index);
        void onComplete(OPTIONS[index]!);
      }
    }
  });

  return (
    <Box flexGrow={1} justifyContent="center" alignItems="center">
      <Box width={84}>
        <DeskPanel
          eyebrow="Onboarding"
          title="Choose the initial route"
          subtitle="This only decides the first operating path. Gordon stays reversible."
          tone="brand"
        >
          {OPTIONS.map((option, index) => {
            const active = index === selectedIndex;
            const copy = COPY[option.mode];
            return (
              <Box
                key={option.mode}
                borderStyle="single"
                borderColor={active ? COLORS.BRASS : COLORS.BRASS_DIM}
                paddingX={1}
                marginBottom={1}
              >
                <Text color={active ? COLORS.BRASS : COLORS.WHITE}>
                  {active ? ">" : " "} {index + 1}. {copy.title}
                  <Text color={COLORS.DIM}> · {copy.detail}</Text>
                </Text>
              </Box>
            );
          })}
          <Text color={COLORS.DIM}>Use arrows or 1-3. Enter commits the route.</Text>
        </DeskPanel>
      </Box>
    </Box>
  );
};
