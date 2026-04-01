/**
 * ModelSelector Component
 * Interactive UI for selecting AI provider and model
 * Supports both direct providers and Dedalus meta-provider
 */

import React, { useState, useCallback, useEffect } from "react";
import { Box, Text, useInput } from "ink";

import { resetAgents } from "../infra/agents/index.ts";
import { providerRegistry, getDedalusModels, refreshDedalusModels, resetProviderRegistry, getActiveRoute, DIRECT_MODELS, type DirectProviderName } from "../infra/providers/registry.ts";
import { loadConfig, saveConfig } from "../infra/storage/config.ts";
import { saveEnvKeys } from "../infra/storage/env.ts";
import type { GordonConfig, ProviderName } from "../types/index.ts";
import { COLORS } from "./theme.ts";
import { DeskPanel } from "./components/desk/DeskPanel.tsx";
import { TicketCard } from "./components/desk/TicketCard.tsx";

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
async function buildProviderList(): Promise<ProviderOption[]> {
  const providers: ProviderOption[] = [];
  const hasDedalus = providerRegistry.hasDedalus();
  const directProviders = providerRegistry.getAvailableProviders();

  if (hasDedalus) {
    await refreshDedalusModels().catch(() => undefined);
  }

  // Direct providers
  const directProviderConfigs = [
    {
      id: "openai",
      name: "OpenAI",
      models: [
        { id: DIRECT_MODELS.openai.flagship, name: "GPT-5.4 Pro", description: "Most capable, best for complex analysis", tier: "flagship" as const },
        { id: DIRECT_MODELS.openai.balanced, name: "GPT-5.4", description: "Best default for direct OpenAI usage", tier: "balanced" as const },
      ],
    },
    {
      id: "anthropic",
      name: "Anthropic",
      models: [
        { id: DIRECT_MODELS.anthropic.flagship, name: "Claude Opus 4.6", description: "Most capable, excellent reasoning", tier: "flagship" as const },
        { id: DIRECT_MODELS.anthropic.balanced, name: "Claude Sonnet 4.6", description: "Good balance of speed and capability", tier: "balanced" as const },
        { id: DIRECT_MODELS.anthropic.fast, name: "Claude Haiku 4.5", description: "Fastest responses, lower cost", tier: "fast" as const },
      ],
    },
    {
      id: "google",
      name: "Google",
      models: [
        { id: DIRECT_MODELS.google.flagship, name: "Gemini 3.1 Pro", description: "Most capable Google model", tier: "flagship" as const },
        { id: DIRECT_MODELS.google.fast, name: "Gemini 3.1 Flash Lite", description: "Fast and lightweight", tier: "fast" as const },
      ],
    },
    {
      id: "inception",
      name: "Inception Labs",
      models: [
        { id: DIRECT_MODELS.inception.flagship, name: "Mercury 2", description: "128K context, fast tool-capable reasoning via Inception", tier: "flagship" as const },
      ],
    },
  ];

  for (const config of directProviderConfigs) {
    const isConfigured = directProviders.includes(config.id as DirectProviderName);
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
      models: getDedalusModels().map((m) => ({
        id: m.id.split("/")[1] ?? m.id,
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
    "anthropic/claude-opus-4-6": "Most capable Claude, excellent reasoning",
    "anthropic/claude-sonnet-4-5-20250929": "Balanced Claude with great tool use",
    "anthropic/claude-haiku-4-5-20251001": "Fast Claude for quick responses",
    "google/gemini-3-1-pro-preview": "Google's most capable model",
    "google/gemini-3-pro-preview": "Google's most capable model",
    "google/gemini-3-flash-preview": "Fast and efficient Gemini",
    "xai/grok-4-1-fast-reasoning": "xAI's reasoning-optimized model",
    "xai/grok-4-1-fast-non-reasoning": "xAI's fast response model",
    "moonshot/kimi-k2.5": "Moonshot's extended context model",
    "inception/mercury-2": "Mercury 2 via Inception's OpenAI-compatible API",
  };
  return descriptions[modelId] || "AI model via Dedalus";
}

function getTierTone(tier: ModelOption["tier"]): "brand" | "analysis" | "info" {
  switch (tier) {
    case "flagship":
      return "brand";
    case "balanced":
      return "analysis";
    case "fast":
    default:
      return "info";
  }
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
      const providers = await buildProviderList();

      // Find current provider index
      const activeRoute = getActiveRoute();
      const currentProvider = config.modelConfig?.provider || activeRoute.provider || null;
      const currentModel = config.modelConfig?.model || activeRoute.modelString || null;

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
    const providerForConfig: ProviderName = selectedProvider.viaDedalus
      ? "dedalus"
      : (selectedProvider.id as ProviderName);

    const newConfig: GordonConfig = {
      ...config,
      modelConfig: {
        provider: providerForConfig,
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
    resetProviderRegistry();
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
    <Box flexDirection="column" paddingX={2} paddingY={1} gap={1}>
      <DeskPanel
        eyebrow="Model Routing"
        title="AI Model Selection"
        subtitle="Choose the provider and model that run the current desk."
        tone="brand"
      >
        <Box flexDirection="column" gap={1}>
          <TicketCard
            eyebrow="Active Route"
            title={state.currentModel || `${state.currentProvider || "auto"}/default`}
            subtitle={state.currentProvider
              ? `Current provider: ${state.currentProvider}`
              : "Current provider follows the detected active route."}
            tone="info"
          />

          {state.step === "provider" && (
            <DeskPanel
              eyebrow="Provider Shelf"
              title="Select a provider"
              subtitle="Providers without configured credentials are shown but cannot be selected."
              tone="neutral"
            >
              <Box flexDirection="column" gap={1}>
                {state.providers.map((provider, index) => {
                  const isSelected = index === state.selectedProviderIndex;
                  const tone = !provider.configured
                    ? "warning"
                    : provider.viaDedalus
                      ? "analysis"
                      : "brand";

                  return (
                    <TicketCard
                      key={`provider-${provider.id}`}
                      eyebrow={provider.viaDedalus ? "Multi-Provider Route" : "Direct Route"}
                      title={`${isSelected ? ">" : " "} ${provider.name}`}
                      subtitle={!provider.configured
                        ? "API key not set for this route."
                        : provider.viaDedalus
                          ? `${provider.models.length} routed models available via Dedalus`
                          : `${provider.models.length} direct models available`}
                      tone={tone}
                      actions={isSelected
                        ? ["Move: Up/Down", provider.configured ? "Select: Enter" : "Selection locked", "Exit: Esc"]
                        : undefined}
                    >
                      {provider.configured && isSelected && (
                        <Text color={COLORS.DIM}>
                          Highlighted route will open its model shelf.
                        </Text>
                      )}
                    </TicketCard>
                  );
                })}
                <Text color={COLORS.DIM}>
                  Arrow keys move between routes. Enter opens the selected provider. Esc returns to the menu.
                </Text>
              </Box>
            </DeskPanel>
          )}

          {state.step === "model" && selectedProvider && (
            <DeskPanel
              eyebrow="Model Shelf"
              title={`Select a model from ${selectedProvider.name}`}
              subtitle={selectedProvider.viaDedalus
                ? "These models run through the Dedalus route."
                : "These models run directly against the selected provider."}
              tone={selectedProvider.viaDedalus ? "analysis" : "brand"}
            >
              <Box flexDirection="column" gap={1}>
                {selectedProvider.models.map((model, index) => {
                  const isSelected = index === state.selectedModelIndex;
                  return (
                    <TicketCard
                      key={`model-${model.fullId}`}
                      eyebrow={model.tier}
                      title={`${isSelected ? ">" : " "} ${model.name}`}
                      subtitle={model.description}
                      tone={getTierTone(model.tier)}
                      actions={isSelected ? [`ID: ${model.fullId}`, "Choose: Enter", "Back: Esc"] : undefined}
                    >
                      <Text color={COLORS.DIM}>
                        Route: {model.viaDedalus ? "Dedalus" : selectedProvider.name} · Tier: {model.tier}
                      </Text>
                    </TicketCard>
                  );
                })}
                <Text color={COLORS.DIM}>
                  Arrow keys move between models. Enter stages the selected route. Esc returns to providers.
                </Text>
              </Box>
            </DeskPanel>
          )}

          {state.step === "confirm" && selectedProvider && selectedModel && (
            <TicketCard
              eyebrow="Trade-Off"
              title="Confirm model change"
              subtitle="This updates Gordon's active route and resets the in-memory agent cache."
              tone="warning"
              actions={["Apply: Enter or Y", "Back: Esc or N"]}
            >
              <Box flexDirection="column">
                <Text color={COLORS.DIM}>
                  Provider: <Text color={COLORS.ACCENT}>{selectedProvider.name}</Text>
                  {selectedProvider.viaDedalus && <Text color={COLORS.ACCENT_DIM}> via Dedalus</Text>}
                </Text>
                <Text color={COLORS.DIM}>
                  Model: <Text color={COLORS.ACCENT}>{selectedModel.name}</Text>
                </Text>
                <Text color={COLORS.DIM}>
                  Route ID: <Text color={COLORS.WHITE}>{selectedModel.fullId}</Text>
                </Text>
              </Box>
            </TicketCard>
          )}

          {state.step === "done" && selectedProvider && selectedModel && (
            <TicketCard
              eyebrow="Route Updated"
              title="Model updated"
              subtitle="The desk will use the new route for the next agent initialization."
              tone="success"
              actions={["Continue: Any key"]}
            >
              <Box flexDirection="column">
                <Text color={COLORS.DIM}>
                  Now using: <Text color={COLORS.MONEY}>{selectedModel.name}</Text>
                </Text>
                <Text color={COLORS.DIM}>
                  Via: <Text color={COLORS.WHITE}>{selectedProvider.viaDedalus ? "Dedalus Labs" : selectedProvider.name}</Text>
                </Text>
              </Box>
            </TicketCard>
          )}
        </Box>
      </DeskPanel>
    </Box>
  );
}

export default ModelSelector;
