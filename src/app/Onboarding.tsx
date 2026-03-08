import React from "react";
import { Box, Text } from "ink";
import { FocusSelect } from "./components/PromptPrimitives.tsx";
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
          Gordon should get you to first trading value quickly, then widen the surface safely.
        </Text>
        <Text color={COLORS.DIM}>
          Pick the setup path that fits what you need right now.
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.TAN} bold>
          Paths
        </Text>
        <Box flexDirection="column" marginLeft={2}>
          <Text color={COLORS.WHITE}>
            QuickStart: one model, one venue, then straight to scan and analysis.
          </Text>
          <Text color={COLORS.WHITE}>
            Advanced: brokers, chains, rails, MCP, and the full provider surface.
          </Text>
          <Text color={COLORS.WHITE}>
            Demo: no credentials, read-only mode, useful for exploring the interface.
          </Text>
        </Box>
      </Box>

      <Box marginBottom={1}>
        <Text color={COLORS.DIM}>
          Re-run setup later with `gordon configure`. Inspect the machine with `gordon doctor`.
        </Text>
      </Box>

      <FocusSelect
        title="Choose a path"
        hint="Use the arrow keys to move fast. You can reconfigure everything later."
        options={[
          { label: "QuickStart", value: "quickstart" },
          { label: "Advanced setup", value: "advanced" },
          { label: "Demo mode", value: "demo" },
        ]}
        onChange={(value) => onComplete({ mode: value as OnboardingSelection["mode"] })}
      />
    </Box>
  );
}

export default Onboarding;
