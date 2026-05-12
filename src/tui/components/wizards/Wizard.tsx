import React, { useState, type ReactNode } from "react";
import { Box, Text, useInput } from "../../ink-custom";

// ============================================================================
// Wizard — Multi-step flow with data collection and back-navigation
// ============================================================================

export interface WizardStep {
  id: string;
  title: string;
  render: (data: Record<string, any>, setData: (key: string, value: any) => void) => ReactNode;
}

interface Props { steps: WizardStep[]; onComplete: (data: Record<string, any>) => void; onCancel: () => void; }

export function Wizard({ steps, onComplete, onCancel }: Props) {
  const [stepIndex, setStepIndex] = useState(0);
  const [data, setDataState] = useState<Record<string, any>>({});

  const setData = (key: string, value: any) => {
    setDataState((prev) => ({ ...prev, [key]: value }));
  };

  useInput((_, key) => {
    if (key.escape) {
      if (stepIndex === 0) onCancel();
      else setStepIndex((p) => p - 1);
    }
  });

  const step = steps[stepIndex]!;
  const isLast = stepIndex === steps.length - 1;
  const dots = steps.map((_, i) => i <= stepIndex ? "\u25CF" : "\u25CB").join(" ");

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyanBright" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyanBright">{step.title}</Text>
        <Text dimColor>Step {stepIndex + 1} of {steps.length}</Text>
      </Box>
      <Text dimColor>{dots}</Text>
      <Box flexDirection="column" marginTop={1}>
        {step.render(data, setData)}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          {isLast ? "Enter to confirm" : "Enter to continue"} {"\u00B7"} Esc to {stepIndex === 0 ? "cancel" : "back"}
        </Text>
      </Box>
    </Box>
  );
}
