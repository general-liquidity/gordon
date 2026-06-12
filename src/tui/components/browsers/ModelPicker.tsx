import React from "react";
import { Box, Text } from "../../ink-custom";
import { GordonSelect } from "../../design-system/GordonSelect.js";
import { MultiStepPicker, type PickerStep } from "../../design-system/MultiStepPicker.tsx";

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
    { label: "Mercury 2 (fastest reasoning, 128K ctx — $0.25/$0.75)", value: "mercury-2" },
    { label: "Mercury Edit 2 (code editing, 32K ctx — $0.25/$0.75)", value: "mercury-edit-2" },
    { label: "Provider default", value: "__default__" },
  ],
  dedalus: [
    { label: "GPT-5.2", value: "openai/gpt-5.2" },
    { label: "Claude Opus 4.6", value: "anthropic/claude-opus-4-6" },
    { label: "Claude Sonnet 4.5", value: "anthropic/claude-sonnet-4-5-20250929" },
    { label: "Claude Haiku 4.5", value: "anthropic/claude-haiku-4-5-20251001" },
    { label: "Gemini 3 Pro", value: "google/gemini-3-pro-preview" },
    { label: "Gemini 3 Flash", value: "google/gemini-3-flash-preview" },
    { label: "Grok 4.1 Reasoning", value: "xai/grok-4-1-fast-reasoning" },
    { label: "Kimi K2", value: "moonshot/kimi-k2-0905-preview" },
    { label: "Provider default", value: "__default__" },
  ],
};

export function ModelPicker({ currentProvider, currentModel, onSelect, onCancel }: Props) {
  type ModelPickerData = { provider: string };
  const steps: Record<string, PickerStep<ModelPickerData>> = {
    provider: {
      title: "Step 1: Choose provider",
      hint: "Which AI provider should Gordon use?",
      render: (ctx) => (
        <Box marginTop={1}>
          <GordonSelect
            options={PROVIDERS}
            onChange={(value) => {
              ctx.set("provider", value);
              ctx.go("model");
            }}
          />
        </Box>
      ),
    },
    model: {
      title: "Step 2: Choose model",
      render: (ctx) => {
        const provider = ctx.data.provider ?? currentProvider;
        const providerLabel = PROVIDERS.find((p) => p.value === provider)?.label ?? provider;
        return (
          <>
            <Text dimColor>Provider: {providerLabel}</Text>
            <Box marginTop={1}>
              <GordonSelect
                options={MODEL_OPTIONS[provider] ?? MODEL_OPTIONS.openai!}
                onChange={(value) => onSelect(provider, value === "__default__" ? undefined : value)}
              />
            </Box>
          </>
        );
      },
    },
  };

  return (
    <MultiStepPicker<ModelPickerData>
      title="MODEL SELECTION"
      titleNote={`(current: ${currentProvider}/${currentModel})`}
      steps={steps}
      initialStep="provider"
      onComplete={() => {}}
      onCancel={onCancel}
    />
  );
}
