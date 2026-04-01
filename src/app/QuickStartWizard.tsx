import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

import { NoticeAlert, FocusSelect } from "./components/PromptPrimitives.tsx";
import { COLORS } from "./theme.ts";
import { DeskPanel } from "./components/desk/DeskPanel.tsx";
import { TicketCard } from "./components/desk/TicketCard.tsx";
import { resetAgents } from "../infra/agents/index.ts";
import { recordStructuredObservation } from "../infra/observability/index.ts";
import { resetProviderRegistry } from "../infra/providers/index.ts";
import { loadConfig, saveConfig } from "../infra/storage/config.ts";
import {
  checkEnvStatus,
  createEnvFile,
  saveEnvKeys,
  type EnvKeys,
  type EnvStatus,
} from "../infra/storage/env.ts";
import type { GordonConfig } from "../types/index.ts";

type QuickStartProvider = "openai" | "inception" | "dedalus";
type QuickStartStep = "provider" | "key" | "review" | "saving";

interface QuickStartWizardProps {
  onComplete: () => void;
}

interface QuickStartChoice {
  provider: QuickStartProvider;
  model: string;
}

function getQuickStartChoice(provider: QuickStartProvider): QuickStartChoice {
  switch (provider) {
    case "openai":
      return { provider, model: "openai/gpt-5.4" };
    case "inception":
      return { provider, model: "inception/mercury-2" };
    case "dedalus":
      return { provider, model: "openai/gpt-5.2" };
  }
}

function inferExistingChoice(status: EnvStatus): QuickStartChoice | null {
  const configuredProvider = status.keys.GORDON_PROVIDER;
  if (configuredProvider === "openai" || configuredProvider === "inception" || configuredProvider === "dedalus") {
    return {
      provider: configuredProvider,
      model: status.keys.GORDON_MODEL || getQuickStartChoice(configuredProvider).model,
    };
  }

  if (status.hasLLMKey) {
    return getQuickStartChoice("openai");
  }
  if (status.hasInceptionKey) {
    return getQuickStartChoice("inception");
  }
  if (status.keys.DEDALUS_API_KEY) {
    return getQuickStartChoice("dedalus");
  }

  return null;
}

function buildEnvKeys(provider: QuickStartProvider, apiKey: string): Partial<EnvKeys> {
  const choice = getQuickStartChoice(provider);
  return {
    [provider === "openai"
      ? "OPENAI_API_KEY"
      : provider === "inception"
        ? "INCEPTION_API_KEY"
        : "DEDALUS_API_KEY"]: apiKey,
    GORDON_PROVIDER: choice.provider,
    GORDON_MODEL: choice.model,
  };
}

function formatProviderLabel(provider: QuickStartProvider): string {
  switch (provider) {
    case "openai":
      return "OpenAI";
    case "inception":
      return "Inception";
    case "dedalus":
      return "Dedalus";
  }
}

export function QuickStartWizard({ onComplete }: QuickStartWizardProps): React.ReactElement {
  const [step, setStep] = useState<QuickStartStep>("provider");
  const [selectedProvider, setSelectedProvider] = useState<QuickStartProvider>("openai");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<EnvStatus | null>(null);
  const [existingChoice, setExistingChoice] = useState<QuickStartChoice | null>(null);

  useEffect(() => {
    void (async () => {
      const envStatus = await checkEnvStatus();
      setStatus(envStatus);
      setExistingChoice(inferExistingChoice(envStatus));
    })();
  }, []);

  const selectedChoice = useMemo(() => getQuickStartChoice(selectedProvider), [selectedProvider]);

  const persistQuickStart = useCallback(async (
    choice: QuickStartChoice,
    nextApiKey?: string,
  ): Promise<void> => {
    setStep("saving");
    setError(null);

    try {
      const currentConfig = await loadConfig();
      const updatedConfig: GordonConfig = {
        ...currentConfig,
        onboardingComplete: true,
        modelConfig: {
          provider: choice.provider,
          model: choice.model,
        },
      };

      if (nextApiKey) {
        const envKeys = buildEnvKeys(choice.provider, nextApiKey);
        const envStatus = status ?? await checkEnvStatus();
        if (envStatus.fileExists) {
          await saveEnvKeys(envKeys);
        } else {
          await createEnvFile(envKeys);
        }
      }

      await saveConfig(updatedConfig);
      resetProviderRegistry();
      resetAgents();

      recordStructuredObservation({
        eventType: "setup.quickstart_completed",
        workflow: "setup",
        source: "quickstart",
        component: "QuickStartWizard",
        outcome: "success",
        status: nextApiKey ? "new_provider" : "existing_provider",
        provider: choice.provider,
        model: choice.model,
        details: {
          usedExistingProvider: !nextApiKey,
          venueDeferred: true,
        },
      });

      onComplete();
    } catch (persistError) {
      setStep(nextApiKey ? "key" : "review");
      setError(persistError instanceof Error ? persistError.message : String(persistError));
    }
  }, [onComplete, status]);

  if (!status) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <DeskPanel eyebrow="QuickStart" title="Opening the read-only desk" subtitle="Loading your current environment..." tone="info" />
      </Box>
    );
  }

  if (step === "saving") {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <DeskPanel eyebrow="QuickStart" title="Saving the desk state" subtitle="Persisting model access and preparing Gordon..." tone="brand" />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <DeskPanel
        eyebrow="QuickStart"
        title="Open a read-only desk"
        subtitle="Configure only the model layer now. Add venues, rails, and integrations later."
        tone="brand"
      >
        <Text color={COLORS.WHITE}>
          This path is optimized for first market value, not full infrastructure.
        </Text>
      </DeskPanel>

      {existingChoice && (
        <NoticeAlert title="Existing model access detected" variant="success">
          <Text color={COLORS.WHITE}>
            Gordon already sees {formatProviderLabel(existingChoice.provider)} with model {existingChoice.model}.
          </Text>
        </NoticeAlert>
      )}

      {!existingChoice && (
        <NoticeAlert title="Read-only first value" variant="info">
          <Text color={COLORS.WHITE}>
            QuickStart gets you to market scans, analysis, and planning first. Execution stays unavailable until you connect a venue later.
          </Text>
        </NoticeAlert>
      )}

      <Box marginBottom={1}>
        <TicketCard
          eyebrow="Desk Outcome"
          title="Read-only first value"
          subtitle="QuickStart lands Gordon in scan, analysis, and planning mode."
          tone="info"
          actions={["Configure later: gordon configure", "Inspect host: gordon doctor"]}
        >
          <Text color={COLORS.DIM}>
            Execution stays unavailable until you wire a venue later.
          </Text>
        </TicketCard>
      </Box>

      {error && (
        <NoticeAlert title="QuickStart failed" variant="error">
          <Text color={COLORS.WHITE}>{error}</Text>
        </NoticeAlert>
      )}

      {step === "provider" && (
        <FocusSelect
          title="Choose the model path"
          hint="Use an existing provider if one is already configured. Otherwise save a single API key and continue."
          options={[
            ...(existingChoice
              ? [{ label: `Use existing ${formatProviderLabel(existingChoice.provider)} setup`, value: "existing" }]
              : []),
            { label: "OpenAI GPT-5.4", value: "openai" },
            { label: "Inception Mercury 2", value: "inception" },
            { label: "Dedalus route", value: "dedalus" },
          ]}
          onChange={(value) => {
            if (value === "existing" && existingChoice) {
              void persistQuickStart(existingChoice);
              return;
            }
            setSelectedProvider(value as QuickStartProvider);
            setApiKey("");
            setError(null);
            setStep("key");
          }}
        />
      )}

      {step === "key" && (
        <DeskPanel
          eyebrow="Model Credential"
          title={`Enter ${formatProviderLabel(selectedProvider)} API key`}
          subtitle={`Gordon will store this in ~/.gordon/.env and set the runtime model to ${selectedChoice.model}.`}
          tone="warning"
        >
          <Box marginTop={1}>
            <TextInput
              value={apiKey}
              onChange={(value) => {
                setApiKey(value);
                if (error) {
                  setError(null);
                }
              }}
              onSubmit={(value) => {
                const trimmed = value.trim();
                if (!trimmed) {
                  setError("API key cannot be empty.");
                  return;
                }
                setApiKey(trimmed);
                setStep("review");
              }}
              placeholder={selectedProvider === "openai" ? "sk-..." : selectedProvider === "inception" ? "inception-..." : "dd-..."}
              mask="*"
            />
          </Box>
          <Box marginTop={1}>
            <Text color={COLORS.DIM}>Press Enter to continue.</Text>
          </Box>
        </DeskPanel>
      )}

      {step === "review" && (
        <Box flexDirection="column">
          <TicketCard
            eyebrow="Review Ticket"
            title={`${formatProviderLabel(selectedChoice.provider)} · ${selectedChoice.model}`}
            subtitle="Gordon will start in read-only scan/analyze mode until you add execution credentials later."
            tone="brand"
          />
          <Box marginTop={1}>
            <FocusSelect
              title="Complete QuickStart"
              hint="You can widen the desk later without losing this model configuration."
              options={[
                { label: "Save and continue", value: "save" },
                { label: "Change provider", value: "change" },
              ]}
              onChange={(value) => {
                if (value === "change") {
                  setStep("provider");
                  return;
                }
                void persistQuickStart(selectedChoice, apiKey.trim());
              }}
            />
          </Box>
        </Box>
      )}
    </Box>
  );
}

export const __quickStartInternals = {
  buildEnvKeys,
  getQuickStartChoice,
  inferExistingChoice,
};

export default QuickStartWizard;
