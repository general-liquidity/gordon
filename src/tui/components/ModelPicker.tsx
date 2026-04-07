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
    { label: "GPT-4o (flagship)", value: "gpt-4o" },
    { label: "GPT-4o mini (fast)", value: "gpt-4o-mini" },
    { label: "GPT-4.1", value: "gpt-4.1" },
    { label: "GPT-4.1 mini", value: "gpt-4.1-mini" },
    { label: "o3 (reasoning)", value: "o3" },
    { label: "o4-mini (reasoning, fast)", value: "o4-mini" },
    { label: "Provider default", value: "__default__" },
  ],
  anthropic: [
    { label: "Claude Opus 4 (most capable)", value: "claude-opus-4-6" },
    { label: "Claude Sonnet 4 (balanced)", value: "claude-sonnet-4-6" },
    { label: "Claude Haiku 4.5 (fast)", value: "claude-haiku-4-5-20251001" },
    { label: "Provider default", value: "__default__" },
  ],
  google: [
    { label: "Gemini 2.5 Pro", value: "gemini-2.5-pro" },
    { label: "Gemini 2.5 Flash", value: "gemini-2.5-flash" },
    { label: "Provider default", value: "__default__" },
  ],
  inception: [
    { label: "Mercury Coder (flagship)", value: "inception/mercury-coder-small-2506" },
    { label: "Mercury 2", value: "inception/mercury-2" },
    { label: "Provider default", value: "__default__" },
  ],
  dedalus: [
    { label: "Claude via Dedalus", value: "openai/anthropic/claude-sonnet-4-6" },
    { label: "GPT-4o via Dedalus", value: "openai/gpt-4o" },
    { label: "Gemini via Dedalus", value: "openai/google/gemini-2.5-pro" },
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
