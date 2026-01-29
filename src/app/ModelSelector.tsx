/**
 * ModelSelector Component
 * Interactive UI for selecting AI provider and model
 * Supports both direct providers and Dedalus meta-provider
 */

import React, { useState, useCallback, useEffect } from "react";
import { Box, Text, useInput } from "ink";

import { resetAgents } from "../infra/agents/index.ts";
import { providerRegistry, DEDALUS_MODELS } from "../infra/providers/registry.ts";
import { loadConfig, saveConfig } from "../infra/storage/config.ts";
import { saveEnvKeys } from "../infra/storage/env.ts";
import type { GordonConfig } from "../types/index.ts";
import { COLORS } from "./theme.ts";

interface ModelOption {
  id: string;
  fullId: string;
  name: string;
  description: string;
  tier: "flagship" | "balanced" | "fast";
  viaDedalus: boolean;
}

interface ProviderOption {
  id: string;
  name: string;
  configured: boolean;
  viaDedalus: boolean;
  models: ModelOption[];
}

/**
 * Build provider list based on available API keys
 */
function buildProviderList(): ProviderOption[] {
  const providers: ProviderOption[] = [];
  const hasDedalus = providerRegistry.hasDedalus();
  const directProviders = providerRegistry.getAvailableProviders();

  // Direct providers
  const directProviderConfigs = [
    {
      id: "openai",
      name: "OpenAI",
      models: [
        { id: "gpt-5.2-pro", name: "GPT-5.2 Pro", description: "Most capable, best for complex analysis", tier: "flagship" as const },
        { id: "gpt-5.2", name: "GPT-5.2", description: "Great balance of speed and capability", tier: "balanced" as const },
        { id: "gpt-5-mini", name: "GPT-5 Mini", description: "Fastest responses, lower cost", tier: "fast" as const },
      ],
    },
    {
      id: "anthropic",
      name: "Anthropic",
      models: [
        { id: "claude-opus-4-5", name: "Claude Opus 4.5", description: "Most capable, excellent reasoning", tier: "flagship" as const },
        { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", description: "Good balance of speed and capability", tier: "balanced" as const },
        { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", description: "Fastest responses, lower cost", tier: "fast" as const },
      ],
    },
    {
      id: "google",
      name: "Google",
      models: [
        { id: "gemini-3-pro-preview", name: "Gemini 3 Pro", description: "Most capable Google model", tier: "flagship" as const },
        { id: "gemini-3-flash-preview", name: "Gemini 3 Flash", description: "Fast and efficient", tier: "fast" as const },
      ],
    },
  ];

  for (const config of directProviderConfigs) {
    const isConfigured = directProviders.includes(config.id as "openai" | "anthropic" | "google");
    providers.push({
      id: config.id,
      name: config.name,
      configured: isConfigured,
      viaDedalus: false,
      models: config.models.map((m) => ({
        ...m,
        fullId: `${config.id}/${m.id}`,
        viaDedalus: false,
      })),
    });
  }

  // Dedalus provider (if available)
  if (hasDedalus) {
    providers.push({
      id: "dedalus",
      name: "Dedalus Labs",
      configured: true,
      viaDedalus: true,
      models: DEDALUS_MODELS.map((m) => ({
        id: m.id.split("/")[1],
        fullId: m.id,
        name: m.name,
        description: getModelDescription(m.id),
        tier: m.tier,
        viaDedalus: true,
      })),
    });
  }

  return providers;
}

function getModelDescription(modelId: string): string {
  const descriptions: Record<string, string> = {
    "openai/gpt-5.2": "OpenAI's flagship model via Dedalus",
    "anthropic/claude-opus-4-5": "Most capable Claude, excellent reasoning",
    "anthropic/claude-sonnet-4-5-20250929": "Balanced Claude with great tool use",
    "anthropic/claude-haiku-4-5-20251001": "Fast Claude for quick responses",
    "google/gemini-3-pro-preview": "Google's most capable model",
    "google/gemini-3-flash-preview": "Fast and efficient Gemini",
    "xai/grok-4-1-fast-reasoning": "xAI's reasoning-optimized model",
    "xai/grok-4-1-fast-non-reasoning": "xAI's fast response model",
    "moonshot/kimi-k2.5": "Moonshot's extended context model",
  };
  return descriptions[modelId] || "AI model via Dedalus";
}

type Step = "provider" | "model" | "confirm" | "done";

interface ModelSelectorState {
  step: Step;
  providers: ProviderOption[];
  selectedProviderIndex: number;
  selectedModelIndex: number;
  currentProvider: string | null;
  currentModel: string | null;
}

interface ModelSelectorProps {
  onComplete: (changed: boolean) => void;
}

export function ModelSelector({ onComplete }: ModelSelectorProps): React.ReactElement {
  const [state, setState] = useState<ModelSelectorState>({
    step: "provider",
    providers: [],
    selectedProviderIndex: 0,
    selectedModelIndex: 0,
    currentProvider: null,
    currentModel: null,
  });

  // Load current config and build provider list
  useEffect(() => {
    const init = async () => {
      const config = await loadConfig();
      const providers = buildProviderList();

      // Find current provider index
      const currentProvider = config.modelConfig?.provider || process.env.GORDON_PROVIDER || null;
      const currentModel = config.modelConfig?.model || process.env.GORDON_MODEL || null;

      let providerIndex = 0;
      if (currentProvider) {
        const idx = providers.findIndex((p) => p.id === currentProvider);
        if (idx >= 0) providerIndex = idx;
      }

      setState((prev) => ({
        ...prev,
        providers,
        selectedProviderIndex: providerIndex,
        currentProvider,
        currentModel,
      }));
    };
    init();
  }, []);

  const selectedProvider = state.providers[state.selectedProviderIndex];
  const selectedModel = selectedProvider?.models[state.selectedModelIndex];

  const saveModelConfig = useCallback(async () => {
    if (!selectedProvider || !selectedModel) return;

    const config = await loadConfig();

    // Determine provider ID for config (use the prefix from fullId for Dedalus models)
    const providerForConfig = selectedProvider.viaDedalus
      ? "dedalus"
      : selectedProvider.id;

    const newConfig: GordonConfig = {
      ...config,
      modelConfig: {
        provider: providerForConfig as "openai" | "anthropic" | "google",
        model: selectedModel.fullId,
      },
    };

    await saveConfig(newConfig);

    // Update env vars for immediate effect
    await saveEnvKeys({
      GORDON_PROVIDER: providerForConfig,
      GORDON_MODEL: selectedModel.fullId,
    });

    // Reset agent cache so next access reinitializes with new model
    resetAgents();

    setState((prev) => ({ ...prev, step: "done" }));
  }, [selectedProvider, selectedModel]);

  useInput((input, key) => {
    if (state.step === "provider") {
      if (key.upArrow) {
        setState((prev) => ({
          ...prev,
          selectedProviderIndex: prev.selectedProviderIndex > 0
            ? prev.selectedProviderIndex - 1
            : prev.providers.length - 1,
          selectedModelIndex: 0,
        }));
      } else if (key.downArrow) {
        setState((prev) => ({
          ...prev,
          selectedProviderIndex: prev.selectedProviderIndex < prev.providers.length - 1
            ? prev.selectedProviderIndex + 1
            : 0,
          selectedModelIndex: 0,
        }));
      } else if (key.return) {
        if (selectedProvider?.configured) {
          setState((prev) => ({ ...prev, step: "model" }));
        }
      } else if (key.escape) {
        onComplete(false);
      }
    } else if (state.step === "model") {
      if (key.upArrow) {
        setState((prev) => ({
          ...prev,
          selectedModelIndex: prev.selectedModelIndex > 0
            ? prev.selectedModelIndex - 1
            : (selectedProvider?.models.length || 1) - 1,
        }));
      } else if (key.downArrow) {
        setState((prev) => ({
          ...prev,
          selectedModelIndex: prev.selectedModelIndex < (selectedProvider?.models.length || 1) - 1
            ? prev.selectedModelIndex + 1
            : 0,
        }));
      } else if (key.return) {
        setState((prev) => ({ ...prev, step: "confirm" }));
      } else if (key.escape) {
        setState((prev) => ({ ...prev, step: "provider" }));
      }
    } else if (state.step === "confirm") {
      if (input === "y" || input === "Y" || key.return) {
        saveModelConfig();
      } else if (input === "n" || input === "N" || key.escape) {
        setState((prev) => ({ ...prev, step: "model" }));
      }
    } else if (state.step === "done") {
      if (key.return || input) {
        onComplete(true);
      }
    }
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text color={COLORS.TAN} bold>
          AI Model Selection
        </Text>
      </Box>

      {/* Current Model Info */}
      <Box marginBottom={1}>
        <Text color={COLORS.DIM}>Current: </Text>
        <Text color={COLORS.WHITE}>
          {state.currentModel || `${state.currentProvider || "auto"}/default`}
        </Text>
      </Box>

      {/* Provider Selection */}
      {state.step === "provider" && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text color={COLORS.WHITE}>Select Provider:</Text>
          </Box>

          {state.providers.map((provider, index) => (
            <Box key={`provider-${provider.id}`} marginLeft={1}>
              <Text color={index === state.selectedProviderIndex ? COLORS.TAN : COLORS.DIM}>
                {index === state.selectedProviderIndex ? "> " : "  "}
              </Text>
              <Text
                color={provider.configured
                  ? (index === state.selectedProviderIndex ? COLORS.TAN : COLORS.WHITE)
                  : COLORS.DIM
                }
                bold={index === state.selectedProviderIndex}
              >
                {provider.name}
              </Text>
              {provider.viaDedalus && provider.configured && (
                <Text color={COLORS.TAN_DIM}> (multi-provider)</Text>
              )}
              {!provider.configured && (
                <Text color={COLORS.DIM}> (API key not set)</Text>
              )}
              {provider.configured && index === state.selectedProviderIndex && (
                <Text color={COLORS.TAN_DIM}> - {provider.models.length} models</Text>
              )}
            </Box>
          ))}

          <Box marginTop={1}>
            <Text color={COLORS.DIM}>
              Arrow keys to navigate, Enter to select, ESC to cancel
            </Text>
          </Box>
        </Box>
      )}

      {/* Model Selection */}
      {state.step === "model" && selectedProvider && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text color={COLORS.WHITE}>Select Model from </Text>
            <Text color={COLORS.TAN} bold>{selectedProvider.name}</Text>
            <Text color={COLORS.WHITE}>:</Text>
          </Box>

          {selectedProvider.models.map((model, index) => (
            <Box key={`model-${model.fullId}`} flexDirection="column" marginLeft={1} marginBottom={index === state.selectedModelIndex ? 1 : 0}>
              <Box>
                <Text color={index === state.selectedModelIndex ? COLORS.TAN : COLORS.DIM}>
                  {index === state.selectedModelIndex ? "> " : "  "}
                </Text>
                <Text
                  color={index === state.selectedModelIndex ? COLORS.TAN : COLORS.WHITE}
                  bold={index === state.selectedModelIndex}
                >
                  {model.name}
                </Text>
                <Text color={COLORS.DIM}> [{model.tier}]</Text>
              </Box>
              {index === state.selectedModelIndex && (
                <Box marginLeft={4} flexDirection="column">
                  <Text color={COLORS.TAN_DIM}>{model.description}</Text>
                  <Text color={COLORS.DIM}>ID: {model.fullId}</Text>
                </Box>
              )}
            </Box>
          ))}

          <Box marginTop={1}>
            <Text color={COLORS.DIM}>
              Arrow keys to navigate, Enter to select, ESC to go back
            </Text>
          </Box>
        </Box>
      )}

      {/* Confirmation */}
      {state.step === "confirm" && selectedProvider && selectedModel && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text color={COLORS.WHITE}>Confirm model change:</Text>
          </Box>

          <Box marginLeft={2} marginBottom={1} flexDirection="column">
            <Box>
              <Text color={COLORS.DIM}>Provider: </Text>
              <Text color={COLORS.TAN}>{selectedProvider.name}</Text>
              {selectedProvider.viaDedalus && (
                <Text color={COLORS.TAN_DIM}> (via Dedalus)</Text>
              )}
            </Box>
            <Box>
              <Text color={COLORS.DIM}>Model: </Text>
              <Text color={COLORS.TAN}>{selectedModel.name}</Text>
            </Box>
            <Box>
              <Text color={COLORS.DIM}>ID: </Text>
              <Text color={COLORS.WHITE}>{selectedModel.fullId}</Text>
            </Box>
          </Box>

          <Box marginTop={1}>
            <Text color={COLORS.WHITE}>Apply this change? </Text>
            <Text color={COLORS.TAN}>[Y/n]</Text>
          </Box>
        </Box>
      )}

      {/* Done */}
      {state.step === "done" && selectedProvider && selectedModel && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text color="green" bold>Model Updated!</Text>
          </Box>

          <Box marginLeft={2} marginBottom={1} flexDirection="column">
            <Box>
              <Text color={COLORS.DIM}>Now using: </Text>
              <Text color={COLORS.TAN}>{selectedModel.name}</Text>
            </Box>
            <Box>
              <Text color={COLORS.DIM}>Via: </Text>
              <Text color={COLORS.WHITE}>
                {selectedProvider.viaDedalus ? "Dedalus Labs" : selectedProvider.name}
              </Text>
            </Box>
          </Box>

          <Box marginTop={1}>
            <Text color={COLORS.DIM}>Press any key to continue...</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}

export default ModelSelector;
