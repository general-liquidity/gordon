/**
 * ModelSelector Component
 * Interactive UI for selecting AI provider and model
 */

import React, { useState, useCallback, useEffect } from "react";
import { Box, Text, useInput } from "ink";

import { resetAgents } from "../infra/agents/index.ts";
import { providerRegistry } from "../infra/providers/registry.ts";
import { loadConfig, saveConfig } from "../infra/storage/config.ts";
import { saveEnvKeys } from "../infra/storage/env.ts";
import type { GordonConfig, ProviderName } from "../types/index.ts";
import { COLORS } from "./theme.ts";

interface ModelOption {
  id: string;
  name: string;
  description: string;
  tier: "flagship" | "balanced" | "fast";
}

interface ProviderOption {
  id: ProviderName;
  name: string;
  configured: boolean;
  models: ModelOption[];
}

const PROVIDERS: ProviderOption[] = [
  {
    id: "openai",
    name: "OpenAI",
    configured: false,
    models: [
      { id: "gpt-5.2-pro", name: "GPT-5.2 Pro", description: "Most capable, best for complex analysis", tier: "flagship" },
      { id: "gpt-5.2", name: "GPT-5.2", description: "Great balance of speed and capability", tier: "balanced" },
      { id: "gpt-5-mini", name: "GPT-5 Mini", description: "Fastest responses, lower cost", tier: "fast" },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    configured: false,
    models: [
      { id: "claude-opus-4-5", name: "Claude Opus 4.5", description: "Most capable, excellent reasoning", tier: "flagship" },
      { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", description: "Good balance of speed and capability", tier: "balanced" },
      { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", description: "Fastest responses, lower cost", tier: "fast" },
    ],
  },
  {
    id: "google",
    name: "Google",
    configured: false,
    models: [
      { id: "gemini-3-pro-preview", name: "Gemini 3 Pro", description: "Most capable Google model", tier: "flagship" },
      { id: "gemini-3-flash-preview", name: "Gemini 3 Flash", description: "Fast and efficient", tier: "fast" },
    ],
  },
];

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
    providers: PROVIDERS,
    selectedProviderIndex: 0,
    selectedModelIndex: 0,
    currentProvider: null,
    currentModel: null,
  });

  // Load current config and check available providers
  useEffect(() => {
    const init = async () => {
      const config = await loadConfig();
      const availableProviders = providerRegistry.getAvailableProviders();

      // Update provider availability
      const updatedProviders = PROVIDERS.map((p) => ({
        ...p,
        configured: availableProviders.includes(p.id),
      }));

      // Find current provider index
      const currentProvider = config.modelConfig?.provider || process.env.GORDON_PROVIDER || "openai";
      const currentModel = config.modelConfig?.model || process.env.GORDON_MODEL || null;
      const providerIndex = updatedProviders.findIndex((p) => p.id === currentProvider);

      setState((prev) => ({
        ...prev,
        providers: updatedProviders,
        selectedProviderIndex: providerIndex >= 0 ? providerIndex : 0,
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
    const newConfig: GordonConfig = {
      ...config,
      modelConfig: {
        provider: selectedProvider.id,
        model: selectedModel.id,
      },
    };

    await saveConfig(newConfig);

    // Also update env vars for immediate effect
    await saveEnvKeys({
      GORDON_PROVIDER: selectedProvider.id,
      GORDON_MODEL: selectedModel.id,
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
          {state.currentProvider || "auto"}/{state.currentModel || "default"}
        </Text>
      </Box>

      {/* Provider Selection */}
      {state.step === "provider" && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text color={COLORS.WHITE}>Select AI Provider:</Text>
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
              {!provider.configured && (
                <Text color={COLORS.DIM}> (API key not set)</Text>
              )}
              {provider.configured && index === state.selectedProviderIndex && (
                <Text color={COLORS.TAN_DIM}> - {provider.models.length} models available</Text>
              )}
            </Box>
          ))}

          <Box marginTop={1}>
            <Text color={COLORS.DIM}>
              Use arrow keys to navigate, Enter to select, ESC to cancel
            </Text>
          </Box>
        </Box>
      )}

      {/* Model Selection */}
      {state.step === "model" && selectedProvider && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text color={COLORS.WHITE}>Select Model for </Text>
            <Text color={COLORS.TAN} bold>{selectedProvider.name}</Text>
            <Text color={COLORS.WHITE}>:</Text>
          </Box>

          {selectedProvider.models.map((model, index) => (
            <Box key={`model-${model.id}`} flexDirection="column" marginLeft={1} marginBottom={index === state.selectedModelIndex ? 1 : 0}>
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
                <Box marginLeft={4}>
                  <Text color={COLORS.TAN_DIM}>{model.description}</Text>
                </Box>
              )}
            </Box>
          ))}

          <Box marginTop={1}>
            <Text color={COLORS.DIM}>
              Use arrow keys to navigate, Enter to select, ESC to go back
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
            </Box>
            <Box>
              <Text color={COLORS.DIM}>Model: </Text>
              <Text color={COLORS.TAN}>{selectedModel.name}</Text>
            </Box>
            <Box>
              <Text color={COLORS.DIM}>ID: </Text>
              <Text color={COLORS.WHITE}>{selectedProvider.id}/{selectedModel.id}</Text>
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
              <Text color={COLORS.TAN}>{selectedProvider.name} - {selectedModel.name}</Text>
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
