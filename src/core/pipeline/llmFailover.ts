import type { LLMClient, LLMProvider, ModelConfig } from "../../infra/ai/llm/index.ts";
import { GORDON_MODELS } from "../../infra/ai/llm/index.ts";

type PipelinePreset = "planGeneration" | "explanations";

const FALLBACK_MODEL_BY_PROVIDER: Record<LLMProvider, ModelConfig["model"]> = {
  anthropic: GORDON_MODELS.planGeneration.model,
  openai: "gpt-5.5-2026-04-23",
  google: "gemini-3.1-pro-preview",
  xai: "grok-4.5",
};

export function buildFailoverModelChain(
  client: LLMClient,
  presetName: PipelinePreset,
): ModelConfig[] {
  const preset = GORDON_MODELS[presetName];
  const providers: LLMProvider[] = [];

  if (client.hasProvider(preset.provider)) {
    providers.push(preset.provider);
  }

  for (const provider of client.getAvailableProviders()) {
    if (!providers.includes(provider)) {
      providers.push(provider);
    }
  }

  return providers.map((provider) => ({
    provider,
    model: provider === preset.provider ? preset.model : FALLBACK_MODEL_BY_PROVIDER[provider],
    temperature: preset.temperature,
    maxTokens: preset.maxTokens,
  }));
}

export function describeFailoverChain(config: ModelConfig): string {
  return `${config.provider}:${String(config.model)}`;
}

export function formatFailoverErrors(errors: Array<{ id: string; error: string }>): string {
  return errors.map((e) => `${e.id}: ${e.error}`).join("; ");
}
