import React from "react";
import { Box, Text } from "ink";
import { FocusSelect } from "./components/PromptPrimitives.tsx";
import { COLORS } from "./theme.ts";
import type { OnboardingSelection } from "./setup-flow.ts";
import { DeskPanel } from "./components/desk/DeskPanel.tsx";
import { TicketCard } from "./components/desk/TicketCard.tsx";
import { WelcomeBanner } from "./WelcomeBanner.tsx";

interface OnboardingProps {
  onComplete: (selection: OnboardingSelection) => void;
}

export function Onboarding({ onComplete }: OnboardingProps): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <WelcomeBanner mode="quiet" context="welcome" />

      <Box marginTop={1}>
        <DeskPanel
          eyebrow="Open The Desk"
          title="Choose how Gordon should come online"
          subtitle="Start with first value, full infrastructure, or a clean read-only demo."
          tone="brand"
        >
          <Text color={COLORS.WHITE}>
            Gordon should get you to trading value quickly, then widen the surface safely.
          </Text>
          <Text color={COLORS.DIM}>
            Re-run setup later with `gordon configure`. Inspect the machine with `gordon doctor`.
          </Text>
        </DeskPanel>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Box marginBottom={1}>
          <TicketCard
            eyebrow="QuickStart"
            title="Open a read-only desk fast"
            subtitle="One model, then straight into scan, analysis, and planning."
            tone="info"
          >
            <Text color={COLORS.DIM}>
              Best when you want first market value in minutes.
            </Text>
          </TicketCard>
        </Box>
        <Box marginBottom={1}>
          <TicketCard
            eyebrow="Advanced"
            title="Provision the full desk"
            subtitle="Brokers, chains, rails, MCP, and the full provider surface."
            tone="brand"
          >
            <Text color={COLORS.DIM}>
              Best when you already know the stack you want to wire.
            </Text>
          </TicketCard>
        </Box>
        <Box marginBottom={1}>
          <TicketCard
            eyebrow="Demo"
            title="Enter with no credentials"
            subtitle="Read-only mode for exploring the shell, workflows, and operator surfaces."
            tone="analysis"
          >
            <Text color={COLORS.DIM}>
              Best when you want to feel the product before committing anything.
            </Text>
          </TicketCard>
        </Box>
      </Box>

      <Box marginTop={1}>
        <FocusSelect
          title="Choose the desk opening"
          hint="Use the arrow keys to move fast. You can widen or reconfigure the desk later."
          options={[
            { label: "QuickStart", value: "quickstart" },
            { label: "Advanced setup", value: "advanced" },
            { label: "Demo mode", value: "demo" },
          ]}
          onChange={(value) => onComplete({ mode: value as OnboardingSelection["mode"] })}
        />
      </Box>
    </Box>
  );
}

export default Onboarding;
