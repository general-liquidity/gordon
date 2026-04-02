import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";

import type { EnvStatus } from "../infra/storage/env.ts";
import { COLORS } from "./theme.ts";
import { DeskPanel } from "./components/desk/DeskPanel.tsx";

type QuickStartProvider = "openai" | "inception" | "dedalus";

function getQuickStartChoice(provider: QuickStartProvider): {
  provider: QuickStartProvider;
  model: string;
} {
  switch (provider) {
    case "inception":
      return { provider, model: "inception/mercury-2" };
    case "dedalus":
      return { provider, model: "openai/gpt-5.2" };
    case "openai":
    default:
      return { provider: "openai", model: "openai/gpt-5.4" };
  }
}

function inferExistingChoice(status: EnvStatus): { provider: QuickStartProvider; model: string } | null {
  const provider = status.keys.GORDON_PROVIDER;
  const model = status.keys.GORDON_MODEL;
  if (
    (provider === "openai" || provider === "inception" || provider === "dedalus")
    && typeof model === "string"
    && model.trim().length > 0
  ) {
    return { provider, model };
  }
  if (status.hasInceptionKey) return getQuickStartChoice("inception");
  if (status.hasLLMKey) return getQuickStartChoice("openai");
  return null;
}

export const __quickStartInternals = {
  getQuickStartChoice,
  inferExistingChoice,
};

export const QuickStartWizard: React.FC<{
  onComplete: () => void | Promise<void>;
}> = ({ onComplete }) => {
  const providers: QuickStartProvider[] = ["openai", "inception", "dedalus"];
  const [selectedIndex, setSelectedIndex] = useState(0);
  const current = useMemo(() => getQuickStartChoice(providers[selectedIndex]!), [providers, selectedIndex]);

  useInput((input, key) => {
    if (key.upArrow) setSelectedIndex((currentIndex) => (currentIndex - 1 + providers.length) % providers.length);
    else if (key.downArrow) setSelectedIndex((currentIndex) => (currentIndex + 1) % providers.length);
    else if (key.return || key.escape) void onComplete();
    else if (/^[1-3]$/u.test(input)) {
      const index = Number.parseInt(input, 10) - 1;
      if (providers[index]) setSelectedIndex(index);
    }
  });

  return (
    <Box flexGrow={1} justifyContent="center" alignItems="center">
      <Box width={84}>
        <DeskPanel
          eyebrow="Quickstart"
          title="Choose an initial model lane"
          subtitle="Gordon will validate the actual provider at activation."
          tone="brand"
        >
          {providers.map((provider, index) => {
            const choice = getQuickStartChoice(provider);
            const active = index === selectedIndex;
            return (
              <Box
                key={provider}
                borderStyle="single"
                borderColor={active ? COLORS.BRASS : COLORS.BRASS_DIM}
                paddingX={1}
                marginBottom={1}
              >
                <Text color={active ? COLORS.BRASS : COLORS.WHITE}>
                  {active ? ">" : " "} {index + 1}. {provider}
                  <Text color={COLORS.DIM}> · {choice.model}</Text>
                </Text>
              </Box>
            );
          })}
          <Text color={COLORS.WHITE}>Selected default: {current.provider} / {current.model}</Text>
          <Text color={COLORS.DIM}>Enter continues into activation.</Text>
        </DeskPanel>
      </Box>
    </Box>
  );
};

