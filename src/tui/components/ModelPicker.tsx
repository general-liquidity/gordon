import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { Select } from "@inkjs/ui";

/**
 * ModelPicker — Interactive 2-step model selector (Claude Code style)
 *
 * Step 1: Pick provider (openai, anthropic, google, inception, dedalus)
 * Step 2: Pick or type model name
 *
 * Esc at any point cancels. Selection saves to config immediately.
 */

interface Props {
  currentProvider: string;
  currentModel: string;
  onSelect: (provider: string, model: string | undefined) => void;
  onCancel: () => void;
}

interface ModelOption {
  label: string;
  value: string;
}

const PROVIDERS: ModelOption[] = [
  { label: "OpenAI", value: "openai" },
  { label: "Anthropic (Claude)", value: "anthropic" },
  { label: "Google (Gemini)", value: "google" },
  { label: "Inception (Mercury)", value: "inception" },
  { label: "Dedalus (OpenAI-compatible router)", value: "dedalus" },
];

const MODEL_OPTIONS: Record<string, ModelOption[]> = {
  openai: [
    { label: "GPT-5.4 (flagship, 1.1M ctx — $3/$15)", value: "gpt-5.4" },
    { label: "GPT-5.4 Pro (1.1M ctx)", value: "gpt-5.4-pro" },
    { label: "GPT-5.4 mini (fast, 400K ctx — $0.75/$5)", value: "gpt-5.4-mini" },
    { label: "GPT-5.4 nano (cheapest, 400K ctx — $0.20/$1)", value: "gpt-5.4-nano" },
    { label: "Provider default", value: "__default__" },
  ],
  anthropic: [
    { label: "Claude Opus 4.6 (most capable)", value: "claude-opus-4-6" },
    { label: "Claude Sonnet 4.6 (balanced)", value: "claude-sonnet-4-6" },
    { label: "Claude Haiku 4.5 (fast — $1/$5)", value: "claude-haiku-4-5" },
    { label: "Provider default", value: "__default__" },
  ],
  google: [
    { label: "Gemini 3.1 Pro", value: "gemini-3.1-pro-preview" },
    { label: "Gemini 3.1 Pro (custom tools)", value: "gemini-3.1-pro-preview-customtools" },
    { label: "Gemini 3.1 Flash Lite", value: "gemini-3.1-flash-lite-preview" },
    { label: "Gemma 4 31B", value: "gemma-4-31b-it" },
    { label: "Gemma 4 26B", value: "gemma-4-26b-it" },
    { label: "Provider default", value: "__default__" },
  ],
  inception: [
    { label: "Mercury Coder (flagship)", value: "inception/mercury-coder-small-2506" },
    { label: "Mercury 2", value: "inception/mercury-2" },
    { label: "Provider default", value: "__default__" },
  ],
  dedalus: [
    { label: "Claude Sonnet via Dedalus", value: "openai/anthropic/claude-sonnet-4-6" },
    { label: "GPT-5.4 via Dedalus", value: "openai/gpt-5.4" },
    { label: "Gemini 3.1 Pro via Dedalus", value: "openai/google/gemini-3.1-pro-preview" },
    { label: "Provider default", value: "__default__" },
  ],
};

export function ModelPicker({ currentProvider, currentModel, onSelect, onCancel }: Props) {
  const [step, setStep] = useState<"provider" | "model">("provider");
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);

  useInput((_input, key) => {
    if (key.escape) {
      if (step === "model") {
        setStep("provider");
        setSelectedProvider(null);
      } else {
        onCancel();
      }
    }
  });

  const handleProviderSelect = useCallback((value: string) => {
    setSelectedProvider(value);
    setStep("model");
  }, []);

  const handleModelSelect = useCallback((value: string) => {
    if (!selectedProvider) return;
    const model = value === "__default__" ? undefined : value;
    onSelect(selectedProvider, model);
  }, [selectedProvider, onSelect]);

  const providerLabel = selectedProvider
    ? PROVIDERS.find((p) => p.value === selectedProvider)?.label ?? selectedProvider
    : "";

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyanBright">MODEL SELECTION</Text>
        <Text dimColor>  (current: {currentProvider}/{currentModel})</Text>
      </Box>

      {step === "provider" ? (
        <>
          <Text bold>Step 1: Choose provider</Text>
          <Text dimColor>Which AI provider should Gordon use?</Text>
          <Box marginTop={1}>
            <Select options={PROVIDERS} onChange={handleProviderSelect} />
          </Box>
        </>
      ) : (
        <>
          <Text bold>Step 2: Choose model</Text>
          <Text dimColor>Provider: {providerLabel}</Text>
          <Box marginTop={1}>
            <Select
              options={MODEL_OPTIONS[selectedProvider ?? "openai"] ?? MODEL_OPTIONS.openai!}
              onChange={handleModelSelect}
            />
          </Box>
        </>
      )}

      <Box marginTop={1}>
        <Text dimColor>Esc {step === "model" ? "to go back" : "to cancel"} {"\u00B7"} Enter to select</Text>
      </Box>
    </Box>
  );
}
