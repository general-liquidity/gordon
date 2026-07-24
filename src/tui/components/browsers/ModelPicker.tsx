import React from "react";
import { Box, Text } from "../../ink-custom";
import { GordonSelect } from "../../design-system/GordonSelect.js";
import { MultiStepPicker, type PickerStep } from "../../design-system/MultiStepPicker.tsx";
import { DIRECT_MODELS } from "../../../infra/runtime/providers/registry.ts";

/**
 * ModelPicker — Interactive 2-step model selector (Claude Code style)
 *
 * Step 1: Pick provider (first-party families + gateways)
 * Step 2: Pick from that family's latest tier models, or type any model name
 *
 * The model lists are derived from the registry's DIRECT_MODELS catalog so
 * they always reflect each family's current flagship / balanced / fast tiers.
 * Gateways route free-typed "provider/model" strings straight through.
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

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (GPT)",
  google: "Google (Gemini)",
  xai: "xAI (Grok)",
  openrouter: "OpenRouter (gateway)",
  huggingface: "Hugging Face (gateway)",
};

const GATEWAY_PROVIDERS = ["openrouter", "huggingface"] as const;

const PROVIDERS: ModelOption[] = [
  ...Object.keys(DIRECT_MODELS),
  ...GATEWAY_PROVIDERS,
].map((p) => ({ label: PROVIDER_LABELS[p] ?? p, value: p }));

// Build each first-party family's model options from the live tier catalog.
// De-duplicate models shared across tiers (e.g. when flagship === balanced).
const MODEL_OPTIONS: Record<string, ModelOption[]> = Object.fromEntries(
  Object.entries(DIRECT_MODELS).map(([provider, tiers]) => {
    const opts: ModelOption[] = [];
    const seen = new Set<string>();
    for (const [tier, model] of Object.entries(tiers)) {
      if (seen.has(model)) continue;
      seen.add(model);
      opts.push({ label: `${model} (${tier})`, value: model });
    }
    opts.push({ label: "Provider default", value: "__default__" });
    return [provider, opts];
  }),
);

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
                options={MODEL_OPTIONS[provider] ?? [{ label: "Provider default", value: "__default__" }]}
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
