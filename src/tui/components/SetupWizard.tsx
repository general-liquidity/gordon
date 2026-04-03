import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { Select, TextInput, Badge } from "@inkjs/ui";
import {
  SETUP_WIZARD_SECTIONS,
  getSetupSectionLabel,
  type SetupWizardSection,
} from "../../app/setup-flow.ts";

// ============================================================================
// SetupWizard — Multi-step onboarding flow
//
// Steps: exchange → broker → chains → rails → mcp → llm → preferences
// Each step: title, description, input (TextInput or Select), next/skip.
// Calls onComplete with collected data when done.
// ============================================================================

interface Props {
  onComplete: (data: Record<string, string>) => void;
  onSkip: () => void;
}

interface StepConfig {
  section: SetupWizardSection;
  title: string;
  description: string;
  inputType: "text" | "select";
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
  key: string;
}

const STEPS: StepConfig[] = [
  {
    section: "llm",
    title: "LLM Provider",
    description: "Which AI provider should Gordon use?",
    inputType: "select",
    key: "llmProvider",
    options: [
      { label: "OpenAI (recommended)", value: "openai" },
      { label: "Anthropic (Claude)", value: "anthropic" },
      { label: "Inception", value: "inception" },
    ],
  },
  {
    section: "llm",
    title: "API Key",
    description: "Enter your LLM API key:",
    inputType: "text",
    key: "llmKey",
    placeholder: "sk-...",
  },
  {
    section: "exchange",
    title: "Crypto Exchange",
    description: "Which exchange should Gordon connect to? (skip if stocks only)",
    inputType: "select",
    key: "exchange",
    options: [
      { label: "Binance", value: "binance" },
      { label: "Coinbase", value: "coinbase" },
      { label: "Kraken", value: "kraken" },
      { label: "Hyperliquid", value: "hyperliquid" },
      { label: "Skip", value: "skip" },
    ],
  },
  {
    section: "broker",
    title: "Stock Broker",
    description: "Which broker for stocks/options? (skip if crypto only)",
    inputType: "select",
    key: "broker",
    options: [
      { label: "Alpaca", value: "alpaca" },
      { label: "Schwab", value: "schwab" },
      { label: "Webull", value: "webull" },
      { label: "Interactive Brokers", value: "ibkr" },
      { label: "Tastytrade", value: "tastytrade" },
      { label: "Skip", value: "skip" },
    ],
  },
  {
    section: "preferences",
    title: "Risk Level",
    description: "How much risk per trade?",
    inputType: "select",
    key: "riskLevel",
    options: [
      { label: "Conservative (1% max)", value: "conservative" },
      { label: "Moderate (2% max)", value: "moderate" },
      { label: "Aggressive (5% max)", value: "aggressive" },
    ],
  },
];

export function SetupWizard({ onComplete, onSkip }: Props) {
  const [stepIndex, setStepIndex] = useState(0);
  const [data, setData] = useState<Record<string, string>>({});

  // Allow escape to skip entire wizard
  useInput((input, key) => {
    if (key.escape) {
      onSkip();
    }
  });

  const step = STEPS[stepIndex];
  if (!step) {
    // All steps done
    onComplete(data);
    return null;
  }

  const handleValue = useCallback((value: string) => {
    const newData = { ...data, [step!.key]: value };
    setData(newData);

    if (stepIndex < STEPS.length - 1) {
      setStepIndex(stepIndex + 1);
    } else {
      onComplete(newData);
    }
  }, [stepIndex, data, step, onComplete]);

  const progress = `${stepIndex + 1}/${STEPS.length}`;

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {/* Header */}
      <Box>
        <Text bold color="yellow">GORDON SETUP</Text>
        <Text dimColor> ({progress})</Text>
      </Box>
      <Text> </Text>

      {/* Progress indicators */}
      <Box>
        {STEPS.map((s, i) => (
          <Text key={s.key} color={i < stepIndex ? "green" : i === stepIndex ? "yellow" : "gray"}>
            {i < stepIndex ? " \u2713 " : i === stepIndex ? " \u25CF " : " \u25CB "}
          </Text>
        ))}
      </Box>
      <Text> </Text>

      {/* Step content */}
      <Text bold>{step.title}</Text>
      <Text dimColor>{step.description}</Text>
      <Text> </Text>

      {step.inputType === "select" && step.options ? (
        <Select
          options={step.options}
          onChange={handleValue}
        />
      ) : (
        <TextInput
          placeholder={step.placeholder ?? ""}
          onSubmit={handleValue}
        />
      )}

      <Text> </Text>
      <Text dimColor>Esc to skip setup · Enter to continue</Text>
    </Box>
  );
}
