import React from "react";
import { Box, Text } from "ink";
import { Select } from "@inkjs/ui";

import { COLORS } from "./theme.ts";
import type { OnboardingSelection } from "./setup-flow.ts";

interface OnboardingProps {
  onComplete: (selection: OnboardingSelection) => void;
}

export function Onboarding({ onComplete }: OnboardingProps): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text color={COLORS.ACCENT} bold>
          Gordon Onboarding
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.WHITE}>
          Gordon should get you to first trading value quickly, then let you expand safely.
        </Text>
        <Text color={COLORS.DIM}>
          Choose the setup path that matches what you need right now.
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.TAN} bold>
          Paths
        </Text>
        <Box flexDirection="column" marginLeft={2}>
          <Text color={COLORS.WHITE}>
            QuickStart: one LLM, one primary venue, one risk profile, then straight to scan and analysis.
          </Text>
          <Text color={COLORS.WHITE}>
            Advanced: brokers, chains, agent rails, MCP, and the full multi-provider surface.
          </Text>
          <Text color={COLORS.WHITE}>
            Demo: no credentials, SAFE mode only, useful for exploring commands and agent behavior.
          </Text>
        </Box>
      </Box>

      <Box marginBottom={1}>
        <Text color={COLORS.DIM}>
          You can re-run setup later with `gordon configure`, and inspect the machine with `gordon doctor`.
        </Text>
      </Box>

      <Select
        options={[
          {
            label: "QuickStart (Recommended)",
            value: "quickstart",
          },
          {
            label: "Advanced Setup",
            value: "advanced",
          },
          {
            label: "Demo Mode",
            value: "demo",
          },
        ]}
        onChange={(value) => onComplete({ mode: value as OnboardingSelection["mode"] })}
      />
    </Box>
  );
}

export default Onboarding;
